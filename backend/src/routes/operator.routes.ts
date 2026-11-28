import { strongPassword, phoneNumber } from "../validators/account-input.schemas.js";
import { requestCancellation } from "../services/cancellation.service.js";
import { Router, type Request, type Response } from "express";

import mongoose from "mongoose";

import { z } from "zod";

import multer from "multer";

import { fileTypeFromBuffer } from "file-type";

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";

import { join } from "node:path";

import { randomUUID } from "node:crypto";

import { hashPassword } from "../modules/auth/index.js";

import * as M from "../models/index.js";

import {
  amount,
  asyncRoute,
  dateOnly,
  fail,
  id,
  literalRegex,
  ok,
  pagination,
  permit,
  tenant,
  text,
  type Permission,
} from "../utils/core.js";

import { provider, requireCapability } from "../integrations/providers.js";

import {
  blockSeats,
  confirmDirectBooking,
  createBooking,
  createHold,
  passengerInput,
  releaseHold,
  seatList,
} from "../services/inventory.service.js";

import { analytics } from "../services/analytics.service.js";

import { counterRouter } from "./counter.routes.js";
import { createScheduledTrip } from "../services/trip-scheduling.service.js";
import { readPublishedCarInventory } from "../services/car-inventory-preview.service.js";
import { commissionConfig } from "../validators/agent.schemas.js";

import { contactInput, gstInput } from "../services/pricing.service.js";

import type { Config } from "../config/env.js";
import {
  busInput,
  carInput,
  fareInput,
  layoutInput,
  offerInput,
  profileInput,
  routeInput,
  scheduleInput,
} from "../validators/operator.schemas.js";

const parseId = (req: Request) => id.parse(req.params.id);

const sortMap: Record<string, string> = {
  id: "_id",
  route: "source",
  duration: "durationMinutes",
  date: "createdAt",
  fare: "totalPaise",
  amount: "amountPaise",
  passenger: "passengers.name",
  seat: "passengers.seat",
  weekday: "basePaise",
  weekend: "weekendPaise",
  festival: "basePaise",
  commission: "commissionPaise",
};

function sortFor(p: ReturnType<typeof pagination>): Record<string, 1 | -1> {
  return p.sort
    ? { [sortMap[p.sort] || p.sort]: p.order === "asc" ? 1 : -1, _id: -1 }
    : { createdAt: -1, _id: -1 };
}

async function owned(
  model: mongoose.Model<any>,
  req: Request,
  recordId: string,
): Promise<any> {
  const result = await model.findOne({ _id: recordId, ...tenant(req) }).lean();
  if (!result) fail(404, "NOT_FOUND", "Record not found");
  return result!;
}

async function audit(
  req: Request,
  action: string,
  resourceId: string,
  session?: mongoose.ClientSession,
) {
  await M.Audit.create(
    [
      {
        ...tenant(req),
        actorId: req.auth.userId,
        action,
        resourceId,
        requestId: req.requestId,
      },
    ],
    { session },
  );
}

async function list(
  model: mongoose.Model<any>,
  req: Request,
  res: Response,
  searchFields: string[],
  extra: Record<string, unknown> = {},
) {
  const p = pagination(req);
  const filter: Record<string, unknown> = { ...tenant(req), ...extra };
  if (p.search && searchFields.length)
    filter.$or = searchFields.map((k) => ({ [k]: literalRegex(p.search) }));
  else if (p.search) {
    if (model.schema.path("routeId")) {
      const matches = await M.Route.find({
        ...tenant(req),
        $or: [
          { source: literalRegex(p.search) },
          { destination: literalRegex(p.search) },
        ],
      })
        .select("_id")
        .lean();
      filter.routeId = { $in: matches.map((r) => r._id) };
    } else filter._id = { $in: [] };
  }
  if (p.status && model.schema.path("status")) filter.status = p.status;
  else if (p.status && model.modelName === "User")
    filter.active = p.status === "Active";
  if (p.tripId) filter.tripId = p.tripId;
  if (p.journeyDate) filter.journeyDate = p.journeyDate;
  const [rows, total] = await Promise.all([
    model
      .find(filter)
      .sort(sortFor(p))
      .skip((p.page - 1) * p.limit)
      .limit(p.limit)
      .lean(),
    model.countDocuments(filter),
  ]);
  return ok(res, rows, {
    page: p.page,
    limit: p.limit,
    total,
    pages: Math.max(1, Math.ceil(total / p.limit)),
  });
}

function registerCrud(
  router: Router,
  path: string,
  model: mongoose.Model<any>,
  schema: z.AnyZodObject,
  permission: Permission,
  searchFields: string[],
  validate?: (req: Request, input: any, existing?: any) => Promise<void>,
) {
  router.get(
    path,
    permit("read"),
    asyncRoute(async (req, res) => list(model, req, res, searchFields)),
  );
  router.get(
    `${path}/:id`,
    permit("read"),
    asyncRoute(async (req, res) =>
      ok(res, await owned(model, req, parseId(req))),
    ),
  );
  router.post(
    path,
    permit(permission),
    asyncRoute(async (req, res) => {
      const input = schema.parse(req.body);
      if (validate) await validate(req, input);
      let created: any;
      await mongoose.connection.transaction(async (session) => {
        [created] = await model.create([{ ...input, ...tenant(req) }], {
          session,
        });
        await audit(
          req,
          `${path.slice(1)}.create`,
          String(created._id),
          session,
        );
      });
      ok(res, created, undefined, 201);
    }),
  );
  router.patch(
    `${path}/:id`,
    permit(permission),
    asyncRoute(async (req, res) => {
      const recordId = parseId(req),
        existing = await owned(model, req, recordId);
      const input = schema.partial().parse(req.body);
      if (!Object.keys(input).length)
        fail(400, "EMPTY_UPDATE", "Provide fields to update");
      if (validate) await validate(req, { ...existing, ...input }, existing);
      let updated: any;
      await mongoose.connection.transaction(async (session) => {
        if (
          model.modelName === "Bus" &&
          input.capacity !== undefined &&
          input.capacity !== existing.capacity &&
          (await M.Layout.exists({ ...tenant(req), busId: recordId }).session(
            session,
          ))
        )
          fail(
            409,
            "LAYOUT_CAPACITY_LOCKED",
            "Seat capacity cannot change while a bus layout exists",
          );
        updated = await model.findOneAndUpdate(
          { _id: recordId, ...tenant(req) },
          { $set: input, $inc: { __v: 1 } },
          { new: true, runValidators: true, session },
        );
        if (!updated) fail(404, "NOT_FOUND", "Record not found");
        await audit(req, `${path.slice(1)}.update`, recordId, session);
      });
      ok(res, updated);
    }),
  );
}

function redactBooking(row: any, pii: boolean, finance = false) {
  const result =
    typeof row.toObject === "function" ? row.toObject() : { ...row };
  if (!pii) {
    delete result.contact;
    delete result.gst;
  }
  if (!finance) {
    delete result.commissionSnapshot;
    delete result.commissionPaise;
  }
  if (!pii)
    result.passengers = (result.passengers || []).map((p: any) => ({
      seat: p.seat,
      checkedInAt: p.checkedInAt,
    }));
  return result;
}

export function operatorRouter(config: Config) {
  const router = Router();
  router.use((req, _res, next) => {
    try {
      tenant(req);
      next();
    } catch (e) {
      next(e);
    }
  });
  router.use(counterRouter(config));
  router.get(
    "/profile",
    permit("read"),
    asyncRoute(async (req, res) =>
      ok(res, await M.Operator.findOne({ _id: req.auth.operatorId }).lean()),
    ),
  );
  router.patch(
    "/profile",
    permit("settings:write"),
    asyncRoute(async (req, res) => {
      const values = profileInput.parse(req.body);
      let record: any;
      await mongoose.connection.transaction(async (session) => {
        record = await M.Operator.findOneAndUpdate(
          { _id: req.auth.operatorId },
          { $set: values },
          { new: true, runValidators: true, session },
        );
        await audit(req, "profile.update", req.auth.operatorId!, session);
      });
      ok(res, record);
    }),
  );
  router.get(
    "/integrations",
    permit("read"),
    asyncRoute(async (_req, res) =>
      ok(res, {
        reservation: {
          provider: provider.id,
          configured: false,
          capabilities: [...provider.capabilities],
        },
        payment: { configured: false, capabilities: [] },
        inventoryAuthority:
          "MongoDB for operator-owned trips; external inventory unavailable until adapter configuration",
      }),
    ),
  );
  router.get(
    "/preferences",
    permit("read"),
    asyncRoute(async (req, res) => {
      const user = await M.User.findOne({
        _id: req.auth.userId,
        ...tenant(req),
      }).lean();
      ok(res, user?.preferences || {});
    }),
  );
  router.patch(
    "/preferences",
    permit("read"),
    asyncRoute(async (req, res) => {
      const input = z
        .record(
          z.enum([
            "New bookings",
            "Cancellation requests",
            "Upcoming departures",
            "Settlement updates",
          ]),
          z.boolean(),
        )
        .parse(req.body);
      const user = await M.User.findOneAndUpdate(
        { _id: req.auth.userId, ...tenant(req) },
        { $set: { preferences: input } },
        { new: true },
      );
      ok(res, user?.preferences);
    }),
  );
  registerCrud(
    router,
    "/buses",
    M.Bus,
    busInput,
    "fleet:write",
    ["registration", "name", "type"],
    async (req, input, existing) => {
      if (existing) {
        const activeTrips = await M.Trip.exists({
          ...tenant(req),
          busId: existing._id,
          status: "Scheduled",
          departureAt: { $gt: new Date() },
        });
        if (
          activeTrips &&
          (input.capacity !== existing.capacity || input.status === "Inactive")
        )
          fail(
            409,
            "BUS_IN_USE",
            "Cancel or reassign upcoming trips before changing capacity or deactivating this bus",
          );
        if (
          input.capacity !== existing.capacity &&
          (await M.Layout.exists({ ...tenant(req), busId: existing._id }))
        )
          fail(
            409,
            "LAYOUT_CAPACITY_CONFLICT",
            "Seat capacity cannot change while a bus layout exists",
          );
      }
    },
  );
  registerCrud(
    router,
    "/cars",
    M.Car,
    carInput,
    "fleet:write",
    [
      "registrationNumber",
      "registration",
      "make",
      "model",
      "modelName",
      "vehicleCategory",
      "category",
    ],
    async (req, input, existing) => {
      if (input.layoutTemplateId) {
        if (existing) return fail(400, "LAYOUT_CREATE_ONLY", "Use Seat Layout Designer to edit an existing vehicle layout");
        const template = await owned(M.VehicleLayout, req, input.layoutTemplateId);
        const category = input.vehicleCategory ?? input.category;
        const type = category === "Bus" || category === "Mini Bus" ? category : "Car";
        if (template.vehicleType !== type)
          return fail(400, "LAYOUT_TYPE_MISMATCH", "Choose a layout for this vehicle type");
        input.seatLayout = template.seats.map(({ number, row, column }: { number: string; row: number; column: number }) => ({ number, row, column }));
        input.totalPhysicalSeats = template.seats.length;
        input.bookablePassengerCapacity = template.seats.length - 1;
        delete input.layoutTemplateId;
      }
      if (input.totalPhysicalSeats !== input.bookablePassengerCapacity + 1)
        fail(400, "INVALID_CAPACITY", "Physical seats must include one driver seat");
      if (existing?.seatLayout?.length && existing.bookablePassengerCapacity !== input.bookablePassengerCapacity)
        fail(409, "LAYOUT_CAPACITY_LOCKED", "Capacity cannot change while a vehicle seat layout exists");
      if (input.registrationNumber && !input.registration) {
        input.registration = input.registrationNumber.toUpperCase().replace(/[\s-]/g, "");
      }
      if (input.registration && !input.registrationNumber) {
        input.registrationNumber = input.registration;
      }
      if (input.model && !input.modelName) {
        input.modelName = input.model;
      }
      if (input.modelName && !input.model) {
        input.model = input.modelName;
      }
      if (input.vehicleCategory && !input.category) {
        input.category = input.vehicleCategory;
      }
      if (input.category && !input.vehicleCategory) {
        input.vehicleCategory = input.category;
      }
      const reg = (input.registrationNumber || input.registration || "")
        .toUpperCase()
        .replace(/[\s-]/g, "");
      if (reg) {
        const query: any = {
          ...tenant(req),
          $or: [{ registration: reg }, { registrationNumber: reg }],
        };
        if (existing) {
          query._id = { $ne: existing._id };
        }
        const duplicate = await M.Car.exists(query);
        if (duplicate) {
          fail(
            409,
            "DUPLICATE_REGISTRATION",
            `Vehicle registration '${reg}' is already registered.`,
          );
        }
      }
    },
  );
  const vehicleLayoutSeats = z.array(z.object({
          number: z.string().regex(/^(D|CS-[A-Z0-9-]{1,9})$/),
          row: z.number().int().min(0).max(100),
          column: z.number().int().min(0).max(5),
        }).strict()).min(2).max(101).refine((seats) =>
          seats.filter((seat) => seat.number === "D").length === 1 &&
          new Set(seats.map((seat) => seat.number)).size === seats.length &&
          new Set(seats.map((seat) => seat.row * 6 + seat.column)).size === seats.length,
          "Use one driver seat, unique seat numbers and unique positions");
  router.get("/vehicle-layouts", permit("read"), asyncRoute(async (req, res) => {
    await list(M.VehicleLayout, req, res, ["name", "vehicleType"]);
  }));
  router.post("/vehicle-layouts", permit("fleet:write"), asyncRoute(async (req, res) => {
    const input = z.object({
      name: z.string().trim().min(1).max(80),
      vehicleType: z.enum(["Car", "Mini Bus", "Bus"]),
      seats: vehicleLayoutSeats,
    }).strict().parse(req.body);
    const layout = await M.VehicleLayout.create({ ...input, ...tenant(req) });
    ok(res, layout, undefined, 201);
  }));
  router.delete("/vehicle-layouts/:id", permit("fleet:write"), asyncRoute(async (req, res) => {
    const recordId = parseId(req);
    await mongoose.connection.transaction(async (session) => {
      const deleted = await M.VehicleLayout.deleteOne({ _id: recordId, ...tenant(req) }, { session });
      if (!deleted.deletedCount) return fail(404, "NOT_FOUND", "Seat layout template not found");
      await audit(req, "vehicle.layout.template.delete", recordId, session);
    });
    ok(res, { id: recordId });
  }));
  router.put(
    "/cars/:id/layout",
    permit("fleet:write"),
    asyncRoute(async (req, res) => {
      const recordId = parseId(req);
      const { seats } = z.object({ seats: vehicleLayoutSeats }).strict().parse(req.body);
      const vehicle = await mongoose.connection.transaction(async (session) => {
        const updated = await M.Car.findOneAndUpdate(
          { _id: recordId, ...tenant(req), bookablePassengerCapacity: seats.length - 1 },
          { $set: { seatLayout: seats }, $inc: { __v: 1 } },
          { new: true, runValidators: true, session },
        );
        if (!updated) return fail(409, "LAYOUT_CAPACITY_MISMATCH", "Vehicle is unavailable or the layout does not match its capacity");
        await audit(req, "vehicle.layout.update", recordId, session);
        return updated;
      });
      ok(res, vehicle);
    }),
  );
  router.patch(
    "/cars/:id/status",
    permit("fleet:write"),
    asyncRoute(async (req, res) => {
      const statusSchema = z.object({
        status: z.enum([
          "Active",
          "Inactive",
          "Maintenance",
          "Under Maintenance",
          "Archived",
        ]),
      });
      const { status: newStatus } = statusSchema.parse(req.body);
      const recordId = parseId(req);
      const car = await M.Car.findOneAndUpdate(
        { _id: recordId, ...tenant(req) },
        { $set: { status: newStatus } },
        { new: true, runValidators: true },
      );
      if (!car) fail(404, "NOT_FOUND", "Car record not found");
      ok(res, car);
    }),
  );
  for (const resource of ["cars", "routes", "trips"] as const) {
    router.delete(
      `/${resource}/:id`,
      permit(resource === "cars" ? "fleet:write" : "routes:write"),
      asyncRoute(async (req, res) => {
        if (req.auth.role !== "operator_admin" || req.auth.agentId)
          return fail(403, "FORBIDDEN", "Only operator admins can permanently delete records");
        const recordId = parseId(req);
        const target = { _id: recordId, ...tenant(req) };
        const model: mongoose.Model<any> = resource === "cars" ? M.Car : resource === "routes" ? M.Route : M.Trip;
        const status = resource === "trips" ? { $in: ["Draft", "Cancelled"] } : "Inactive";
        const fields = resource === "cars" ? ["carId", "busId"] : resource === "routes" ? ["routeId", "routeIds"] : ["tripId", "fromTripId", "toTripId"];
        await mongoose.connection.transaction(async (session) => {
          const record = await model.findOne(target).session(session);
          if (!record) return fail(404, "NOT_FOUND", "Record not found");
          for (const linked of Object.values(mongoose.models)) {
            const paths = fields.filter((field) => linked.schema.path(field));
            if (resource !== "cars" && linked.schema.path("targetId") && linked.schema.path("kind"))
              paths.push("targetId");
            if (paths.length && await linked.exists({ $or: paths.map((field) => ({ [field]: record._id })) }).session(session))
              return fail(409, "RECORD_IN_USE", "This record has linked data. Keep it inactive to preserve history.");
          }
          const deleted = await model.deleteOne({
            ...target, status,
            ...(resource === "trips" ? { carId: { $exists: true, $ne: null }, inventoryOwner: "internal" } : {}),
          }).session(session);
          if (!deleted.deletedCount)
            return fail(409, "RECORD_NOT_DELETABLE", "Make the record inactive, or cancel the car trip, before deleting.");
          await audit(req, `${resource}.delete`, recordId, session);
        });
        ok(res, { deleted: true });
      }),
    );
  }
  router.get(
    "/buses/:id/layout",
    permit("read"),
    asyncRoute(async (req, res) => {
      const busId = parseId(req);
      await owned(M.Bus, req, busId);
      ok(res, await M.Layout.findOne({ ...tenant(req), busId }).lean());
    }),
  );
  router.put(
    "/buses/:id/layout",
    permit("fleet:write"),
    asyncRoute(async (req, res) => {
      const busId = parseId(req),
        bus = await owned(M.Bus, req, busId),
        input = layoutInput.parse(req.body);
      if (input.seats.length !== bus.capacity)
        fail(
          400,
          "CAPACITY_MISMATCH",
          "Layout seat count must equal the registered bus capacity",
        );
      let layout: any;
      await mongoose.connection.transaction(async (session) => {
        layout = await M.Layout.findOneAndUpdate(
          { ...tenant(req), busId },
          { $set: input },
          { upsert: true, new: true, runValidators: true, session },
        );
        await audit(req, "layout.update", busId, session);
      });
      ok(res, layout);
    }),
  );
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  });
  router.post(
    "/buses/:id/images",
    permit("fleet:write"),
    upload.single("image"),
    asyncRoute(async (req, res) => {
      const busId = parseId(req);
      const bus = await owned(M.Bus, req, busId);
      if ((bus.images || []).length >= 10)
        fail(400, "IMAGE_LIMIT", "A bus can have at most ten images");
      if (!req.file)
        fail(400, "IMAGE_REQUIRED", "Choose a JPEG, PNG or WebP image");
      const type = await fileTypeFromBuffer(req.file!.buffer);
      if (
        !type ||
        !["image/jpeg", "image/png", "image/webp"].includes(type.mime)
      )
        fail(
          400,
          "INVALID_IMAGE",
          "Only JPEG, PNG and WebP images are supported",
        );
      const name = `${randomUUID()}.${type!.ext}`;
      const directory = join(config.UPLOAD_DIR, req.auth.operatorId!);
      await mkdir(directory, { recursive: true });
      const path = join(directory, name);
      await writeFile(path, req.file!.buffer, { flag: "wx" });
      try {
        await M.Bus.updateOne(
          { _id: busId, ...tenant(req) },
          { $push: { images: name } },
        );
        await audit(req, "bus.image.upload", busId);
      } catch (error) {
        await unlink(path);
        throw error;
      }
      ok(res, { imageId: name }, undefined, 201);
    }),
  );
  router.get(
    "/buses/:id/images/:image",
    permit("read"),
    asyncRoute(async (req, res) => {
      const bus = await owned(M.Bus, req, parseId(req)),
        name = z
          .string()
          .regex(/^[a-f\d-]{36}\.(jpg|png|webp)$/)
          .parse(req.params.image);
      if (!(bus.images as string[]).includes(name))
        fail(404, "NOT_FOUND", "Image not found");
      const bytes = await readFile(
        join(config.UPLOAD_DIR, req.auth.operatorId!, name),
      );
      res.setHeader("Cache-Control", "private, max-age=300");
      res.type(name.split(".").pop()!).send(bytes);
    }),
  );
  registerCrud(
    router,
    "/routes",
    M.Route,
    routeInput,
    "routes:write",
    ["source", "destination"],
    async (req, input) => {
      if (input.source.toLowerCase() === input.destination.toLowerCase())
        fail(400, "INVALID_ROUTE", "Source and destination must differ");

      // Resolve or auto-create source city in M.City
      if (!input.sourceCityId && req.auth.operatorId) {
        const sourceCity = (await M.City.findOne({
          ...tenant(req),
          name: literalRegex(input.source.trim()),
        })) as any;
        if (
          sourceCity &&
          String(sourceCity.name || "").toLowerCase() === input.source.trim().toLowerCase()
        ) {
          input.sourceCityId = sourceCity._id;
        } else if (!sourceCity) {
          const created = await M.City.create({
            operatorId: req.auth.operatorId,
            name: input.source.trim(),
            state: "Maharashtra",
            country: "India",
            status: "Active",
          });
          input.sourceCityId = created._id;
        }
      }

      // Resolve or auto-create destination city in M.City
      if (!input.destinationCityId && req.auth.operatorId) {
        const destCity = (await M.City.findOne({
          ...tenant(req),
          name: literalRegex(input.destination.trim()),
        })) as any;
        if (
          destCity &&
          String(destCity.name || "").toLowerCase() === input.destination.trim().toLowerCase()
        ) {
          input.destinationCityId = destCity._id;
        } else if (!destCity) {
          const created = await M.City.create({
            operatorId: req.auth.operatorId,
            name: input.destination.trim(),
            state: "Maharashtra",
            country: "India",
            status: "Active",
          });
          input.destinationCityId = created._id;
        }
      }
    },
  );
  registerCrud(
    router,
    "/schedules",
    M.Schedule,
    scheduleInput,
    "routes:write",
    [],
    async (req, input) => {
      await owned(M.Bus, req, input.busId);
      await owned(M.Route, req, input.routeId);
      if (input.endDate < input.startDate)
        fail(
          400,
          "INVALID_DATE_RANGE",
          "Schedule end date must not precede start date",
        );
      if (!input.daysOfWeek.length && !input.specialDates.length)
        fail(400, "EMPTY_SCHEDULE", "Select weekdays or special dates");
    },
  );
  router.get(
    "/trips",
    permit("read"),
    asyncRoute(async (req, res) => {
      const p = pagination(req),
        filter: any = { ...tenant(req) };
      if (p.status) filter.status = p.status;
      if (p.journeyDate) filter.journeyDate = p.journeyDate;
      const [rows, total] = await Promise.all([
        M.Trip.find(filter)
          .sort(sortFor(p))
          .skip((p.page - 1) * p.limit)
          .limit(p.limit)
          .lean(),
        M.Trip.countDocuments(filter),
      ]);
      const mapped = rows.map((t: any) => {
        const available = t.seats
          ? (t.seats as any[]).filter(
              (s) => s.state === "available" && !s.isDriver && s.number !== "D",
            ).length
          : t.bookableCapacity || 4;
        return {
          ...t,
          availableSeatsCount: t.availableSeatsCount ?? available,
        };
      });
      return ok(res, mapped, {
        page: p.page,
        limit: p.limit,
        total,
        pages: Math.max(1, Math.ceil(total / p.limit)),
      });
    }),
  );
  router.get(
    "/trips/:id",
    permit("read"),
    asyncRoute(async (req, res) =>
      ok(res, await owned(M.Trip, req, parseId(req))),
    ),
  );
  router.post(
    "/trips",
    permit("routes:write"),
    asyncRoute(async (req, res) => {
      ok(
        res,
        await createScheduledTrip(req.auth, req.body, {
          requestId: req.requestId,
        }),
        undefined,
        201,
      );
    }),
  );
  router.post(
    "/trips/:id/publish",
    permit("routes:write"),
    asyncRoute(async (req, res) => {
      const tripId = parseId(req);
      const trip = await M.Trip.findOneAndUpdate(
        {
          _id: tripId,
          ...tenant(req),
          status: "Draft",
          departureAt: { $gt: new Date() },
        },
        { $set: { status: "Scheduled", bookingOpen: true } },
        { new: true },
      );
      if (!trip) fail(404, "NOT_FOUND", "Trip not found");
      ok(res, trip);
    }),
  );
  router.post(
    "/trips/:id/open-sales",
    permit("routes:write"),
    asyncRoute(async (req, res) => {
      const tripId = parseId(req);
      const trip = await M.Trip.findOneAndUpdate({
        _id: tripId, ...tenant(req), status: "Scheduled",
        inventoryOwner: "internal", departureAt: { $gt: new Date() },
      }, { $set: { bookingOpen: true }, $inc: { __v: 1 } }, { new: true });
      if (!trip) return fail(409, "TRIP_CLOSED", "Only upcoming scheduled trips can reopen sales");
      ok(res, trip);
    }),
  );
  router.post(
    "/trips/:id/close-sales",
    permit("routes:write"),
    asyncRoute(async (req, res) => {
      const tripId = parseId(req);
      const trip = await M.Trip.findOneAndUpdate(
        { _id: tripId, ...tenant(req) },
        { $set: { bookingOpen: false } },
        { new: true },
      );
      if (!trip) fail(404, "NOT_FOUND", "Trip not found");
      ok(res, trip);
    }),
  );
  router.post(
    "/trips/:id/cancel",
    permit("routes:write"),
    asyncRoute(async (req, res) => {
      const tripId = parseId(req);
      let trip: any;
      await mongoose.connection.transaction(async (session) => {
        const current = await M.Trip.findOne({
          _id: tripId,
          ...tenant(req),
        }).session(session);
        if (!current) fail(404, "NOT_FOUND", "Trip not found");
        if (current!.inventoryOwner !== "internal") requireCapability("cancel");
        if (
          await M.Booking.exists({
            ...tenant(req),
            tripId,
            status: {
              $in: ["Confirmed", "Pending payment", "Reconciliation required"],
            },
          }).session(session)
        )
          fail(
            409,
            "BOOKINGS_EXIST",
            "Resolve bookings and refunds before cancelling this trip",
          );
        trip = await M.Trip.findOneAndUpdate(
          { _id: tripId, ...tenant(req), status: "Scheduled" },
          { $set: { status: "Cancelled" } },
          { new: true, session },
        );
        if (!trip) fail(409, "TRIP_CLOSED", "Trip cannot be cancelled");
        await M.Hold.updateMany(
          { ...tenant(req), tripId, status: "held" },
          { $set: { status: "released" } },
          { session },
        );
        await audit(req, "trip.cancel", tripId, session);
        await M.Outbox.create(
          [
            {
              ...tenant(req),
              event: "trip.status.updated",
              resourceId: tripId,
            },
          ],
          { session },
        );
      });
      ok(res, trip);
    }),
  );
  router.get(
    "/trips/:id/car-inventory-preview",
    permit("read"),
    asyncRoute(async (req, res) => {
      const trip = await owned(M.Trip, req, parseId(req));
      res.set("Cache-Control", "no-store");
      ok(res, await readPublishedCarInventory(String(trip.operatorId), String(trip._id)));
    }),
  );
  router.get(
    "/trips/:id/seats",
    permit("read"),
    asyncRoute(async (req, res) => {
      const trip = await owned(M.Trip, req, parseId(req));
      if (trip.inventoryOwner !== "internal") requireCapability("availability");
      const now = new Date();
      const bookingIds = (trip.seats as any[])
        .filter((s: any) => s.state === "booked" && s.bookingId)
        .map((s: any) => s.bookingId);
      const bookings: any[] = bookingIds.length
        ? await M.Booking.find({ _id: { $in: bookingIds } }).lean()
        : [];
      const bookingMap = new Map(bookings.map((b: any) => [String(b._id), b]));

      const seats = (trip.seats as any[]).map((s) => {
        const booking = s.bookingId ? bookingMap.get(String(s.bookingId)) : null;
        const passenger = booking?.passengers?.find((p: any) => p.seat === s.number);
        let bookedByChannel: "operator" | "agent" | "customer" | "external" | undefined;
        let bookedByName: string | undefined;
        let bookedPnr: string | undefined;
        let bookedPassengerName: string | undefined;
        if (s.state === "booked" && booking) {
          bookedByChannel = booking.source || (booking.agentId ? "agent" : "operator");
          bookedByName =
            bookedByChannel === "operator"
              ? "Operator Counter"
              : bookedByChannel === "agent"
                ? (booking.commissionSnapshot?.partnerName || "Travel Agent")
                : bookedByChannel === "external"
                  ? "API User / External Partner"
                  : "Customer App";
          bookedPnr = booking.pnr;
          bookedPassengerName = passenger?.name || booking.passengers?.[0]?.name;
        }
        return {
          number: s.number,
          deck: s.deck,
          row: s.row,
          column: s.column,
          category: s.category,
          farePaise: s.farePaise,
          quotaLabel: s.quotaLabel,
          state:
            s.state === "held" && new Date(s.holdUntil) <= now
              ? "available"
              : s.state,
          bookedByChannel,
          bookedByName,
          bookedPnr,
          bookedPassengerName,
        };
      });
      ok(res, {
        tripId: String(trip._id),
        status: trip.status,
        inventoryOwner: trip.inventoryOwner,
        seats,
      });
    }),
  );
  router.post(
    "/trips/:id/holds",
    permit("bookings:write"),
    asyncRoute(async (req, res) => {
      const { seats } = z.object({ seats: seatList }).strict().parse(req.body);
      ok(res, await createHold(req.auth, parseId(req), seats), undefined, 201);
    }),
  );
  router.delete(
    "/trips/:id/holds/:holdId",
    permit("bookings:write"),
    asyncRoute(async (req, res) => {
      await releaseHold(
        req.auth,
        parseId(req),
        z.string().uuid().parse(req.params.holdId),
      );
      ok(res, { released: true });
    }),
  );
  for (const action of ["block", "unblock"])
    router.post(
      `/trips/:id/${action}`,
      permit("inventory:write"),
      asyncRoute(async (req, res) => {
        const { seats } = z
          .object({ seats: seatList })
          .strict()
          .parse(req.body);
        await blockSeats(req.auth, parseId(req), seats, action === "block");
        ok(res, { updated: true });
      }),
    );
  router.get(
    "/bookings",
    permit("read"),
    asyncRoute(async (req, res) => {
      const p = pagination(req),
        filter: any = { ...tenant(req) };
      if (p.status) filter.status = p.status;
      if (p.tripId) filter.tripId = p.tripId;
      if (p.journeyDate) {
        const trips = await M.Trip.find({
          ...tenant(req),
          journeyDate: p.journeyDate,
        })
          .select("_id")
          .lean();
        filter.tripId = { $in: trips.map((t) => t._id) };
      }
      if (p.search) {
        const fields = req.auth.permissions.includes("manifest:read")
          ? ["reference", "pnr", "passengers.name"]
          : ["reference", "pnr"];
        filter.$or = fields.map((k) => ({ [k]: literalRegex(p.search) }));
      }
      const [rows, total] = await Promise.all([
        M.Booking.find(filter)
          .sort(sortFor(p))
          .skip((p.page - 1) * p.limit)
          .limit(p.limit)
          .lean(),
        M.Booking.countDocuments(filter),
      ]);
      ok(
        res,
        rows.map((r) =>
          redactBooking(
            r,
            req.auth.permissions.includes("manifest:read"),
            req.auth.permissions.includes("finance:read"),
          ),
        ),
        {
          page: p.page,
          limit: p.limit,
          total,
          pages: Math.max(1, Math.ceil(total / p.limit)),
        },
      );
    }),
  );
  router.post(
    "/bookings",
    permit("bookings:write"),
    asyncRoute(async (req, res) => {
      const input = z
        .object({
          tripId: id,
          holdId: z.string().uuid(),
          salesPartnerId: id.optional(),
          passengers: z.array(passengerInput).min(1).max(6),
          quoteId: id.optional(),
          contact: contactInput.optional(),
          gst: gstInput.optional(),
          operatorDiscountPaise: amount.optional(),
          promoCode: z
            .string()
            .regex(/^[A-Z\d_-]{3,24}$/)
            .optional(),
        })
        .strict()
        .parse(req.body);
      const key = z.string().min(16).max(100).parse(req.get("idempotency-key"));
      ok(res, await createBooking(req.auth, input, key, "operator"), undefined, 201);
    }),
  );
  router.post(
    "/bookings/:id/confirm-direct",
    permit("bookings:write"),
    asyncRoute(async (req, res) => {
      ok(res, await confirmDirectBooking(req.auth, parseId(req)));
    }),
  );
  router.get(
    "/bookings/:id",
    permit("read"),
    asyncRoute(async (req, res) =>
      ok(
        res,
        redactBooking(
          await owned(M.Booking, req, parseId(req)),
          req.auth.permissions.includes("manifest:read"),
          req.auth.permissions.includes("finance:read"),
        ),
      ),
    ),
  );
  router.get(
    "/bookings/:id/ticket",
    permit("manifest:read"),
    asyncRoute(async (req, res) => {
      const booking = await owned(M.Booking, req, parseId(req));
      const ticket = await M.Ticket.findOne({
        ...tenant(req),
        bookingId: booking._id,
        status: "valid",
      }).lean();
      if (booking.status !== "Confirmed" || !booking.pnr || !ticket)
        fail(
          409,
          "TICKET_NOT_CONFIRMED",
          "A ticket is available only after authoritative booking confirmation",
        );
      const trip = await owned(M.Trip, req, String(booking.tripId)),
        route = await owned(M.Route, req, String(trip.routeId));
      ok(res, { ticket, booking, trip, route });
    }),
  );
  router.get(
    "/trips/:id/manifest",
    permit("manifest:read"),
    asyncRoute(async (req, res) => {
      const trip = await owned(M.Trip, req, parseId(req));
      const bookings = await M.Booking.find({
        ...tenant(req),
        tripId: trip._id,
        status: "Confirmed",
      }).lean();
      ok(res, {
        trip,
        passengers: bookings
          .flatMap((b) =>
            (b.passengers as any[]).map((p) => ({
              ...p,
              bookingId: String(b._id),
              pnr: b.pnr,
            })),
          )
          .sort((a, b) =>
            a.seat.localeCompare(b.seat, undefined, { numeric: true }),
          ),
      });
    }),
  );
  router.patch(
    "/bookings/:id/check-in",
    permit("manifest:write"),
    asyncRoute(async (req, res) => {
      const { seat, checkedIn } = z
        .object({ seat: z.string().min(1).max(12), checkedIn: z.boolean() })
        .strict()
        .parse(req.body);
      const update = checkedIn
        ? {
            $set: {
              "passengers.$.checkedInAt": new Date(),
              "passengers.$.checkedInBy": req.auth.userId,
            },
          }
        : {
            $unset: {
              "passengers.$.checkedInAt": 1,
              "passengers.$.checkedInBy": 1,
            },
          };
      const booking = await M.Booking.findOneAndUpdate(
        {
          _id: parseId(req),
          ...tenant(req),
          status: "Confirmed",
          "passengers.seat": seat,
        },
        update,
        { new: true },
      );
      if (!booking)
        fail(404, "NOT_FOUND", "Confirmed passenger booking not found");
      await audit(req, "passenger.check-in", String(booking!._id));
      ok(res, booking);
    }),
  );
  router.get(
    "/fares",
    permit("read"),
    asyncRoute(async (req, res) => list(M.Fare, req, res, [])),
  );
  router.get(
    "/fares/:id/history",
    permit("pricing:write"),
    asyncRoute(async (req, res) => {
      await owned(M.Fare, req, parseId(req));
      await list(M.FareHistory, req, res, [], { fareId: req.params.id });
    }),
  );
  async function saveFare(req: Request, res: Response, existingId?: string) {
    const input = fareInput.parse(req.body),
      route = await owned(M.Route, req, input.routeId);
    if (route.providerId)
      fail(
        403,
        "EXTERNAL_PRICING",
        "External provider fares cannot be overridden",
      );
    let value: any;
    await mongoose.connection.transaction(async (session) => {
      const filter = existingId
        ? { _id: existingId, ...tenant(req) }
        : { ...tenant(req), routeId: input.routeId };
      const before = await M.Fare.findOne(filter).session(session).lean();
      if (existingId && !before) fail(404, "NOT_FOUND", "Fare not found");
      value = await M.Fare.findOneAndUpdate(
        filter,
        { $set: input, $inc: { version: 1 } },
        {
          new: true,
          upsert: !existingId,
          runValidators: true,
          session,
          setDefaultsOnInsert: false,
        },
      );
      await M.FareHistory.create(
        [
          {
            ...tenant(req),
            fareId: value!._id,
            actorId: req.auth.userId,
            before,
            after: value!.toObject(),
          },
        ],
        { session },
      );
      await audit(req, "fare.update", String(value!._id), session);
    });
    ok(res, value);
  }
  router.post(
    "/fares",
    permit("pricing:write"),
    asyncRoute(async (req, res) => saveFare(req, res)),
  );
  router.patch(
    "/fares/:id",
    permit("pricing:write"),
    asyncRoute(async (req, res) => saveFare(req, res, parseId(req))),
  );
  registerCrud(
    router,
    "/offers",
    M.Offer,
    offerInput,
    "offers:write",
    ["code", "name"],
    async (req, input, existing) => {
      if (input.endDate < input.startDate)
        fail(
          400,
          "INVALID_DATE_RANGE",
          "Offer end date must not precede its start date",
        );
      for (const routeId of input.routeIds) {
        const route = await owned(M.Route, req, routeId);
        if (route.providerId)
          fail(
            403,
            "EXTERNAL_PRICING",
            "Offers cannot modify third-party prices",
          );
      }
      if (
        existing?.usage &&
        (input.code !== existing.code || input.percent !== existing.percent)
      )
        fail(
          409,
          "OFFER_IN_USE",
          "Used offer codes and discount percentages cannot be changed",
        );
    },
  );
  router.get(
    "/cancellation-policy",
    permit("read"),
    asyncRoute(async (req, res) =>
      ok(res, await M.Policy.findOne(tenant(req)).lean()),
    ),
  );
  router.put(
    "/cancellation-policy",
    permit("refunds:write"),
    asyncRoute(async (req, res) => {
      const input = z
        .object({
          rules: z
            .array(
              z
                .object({
                  hoursBefore: z.number().min(0).max(720),
                  refundPercent: z.number().min(0).max(100),
                })
                .strict(),
            )
            .min(1)
            .max(20),
        })
        .strict()
        .parse(req.body);
      if (
        new Set(input.rules.map((r) => r.hoursBefore)).size !==
        input.rules.length
      )
        fail(400, "POLICY_CONFLICT", "Policy thresholds must be unique");
      let policy: any;
      await mongoose.connection.transaction(async (session) => {
        policy = await M.Policy.findOneAndUpdate(
          tenant(req),
          {
            $set: {
              rules: input.rules.sort((a, b) => b.hoursBefore - a.hoursBefore),
            },
            $inc: { version: 1 },
          },
          { new: true, upsert: true, session, setDefaultsOnInsert: false },
        );
        await audit(
          req,
          "cancellation-policy.update",
          String(policy._id),
          session,
        );
      });
      ok(res, policy);
    }),
  );
  router.get(
    "/cancellations",
    permit("refunds:write"),
    asyncRoute(async (req, res) => list(M.Cancellation, req, res, [])),
  );
  router.post(
    "/bookings/:id/cancellation",
    permit("refunds:write"),
    asyncRoute(async (req, res) => {
      const { reason } = z.object({ reason: text }).strict().parse(req.body);
      const cancellation = await requestCancellation(
        req.auth,
        parseId(req),
        reason,
        req.requestId,
      );
      ok(res, cancellation, undefined, 201);
    }),
  );
  router.get(
    "/refunds",
    permit("refunds:write"),
    asyncRoute(async (req, res) => list(M.Refund, req, res, [])),
  );
  router.post(
    "/refunds/:id/process",
    permit("refunds:write"),
    asyncRoute(async (req, _res) => {
      await owned(M.Refund, req, parseId(req));
      fail(
        503,
        "REFUND_PROVIDER_UNAVAILABLE",
        "Verified cancellation and payment-refund adapters are required. No refund has been marked completed.",
      );
    }),
  );
  router.get(
    "/settlements",
    permit("finance:read"),
    asyncRoute(async (req, res) =>
      list(M.Settlement, req, res, ["externalId"]),
    ),
  );
  const dateRange = (req: Request) => {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const parsed = z
      .object({ from: dateOnly.default(today), to: dateOnly.default(today) })
      .parse(req.query);
    if (parsed.from > parsed.to)
      fail(400, "INVALID_DATE_RANGE", "From date must not follow to date");
    if ((+new Date(parsed.to) - +new Date(parsed.from)) / 86400000 > 366)
      fail(400, "RANGE_TOO_LARGE", "Choose a date range of at most 366 days");
    return parsed;
  };
  router.get(
    "/dashboard",
    permit("read"),
    asyncRoute(async (req, res) => {
      const range = dateRange(req),
        result = await analytics(req.auth.operatorId!, range.from, range.to);
      if (!req.auth.permissions.includes("finance:read")) {
        const {
          totalBookings,
          confirmed,
          cancelled,
          activeBuses,
          totalSeats,
          bookedSeats,
          availableSeats,
          occupancy,
          upcomingDepartures,
        } = result;
        return ok(res, {
          totalBookings,
          confirmed,
          cancelled,
          activeBuses,
          totalSeats,
          bookedSeats,
          availableSeats,
          occupancy,
          upcomingDepartures,
        });
      }
      ok(res, result);
    }),
  );
  for (const name of [
    "revenue",
    "occupancy",
    "route-performance",
    "bus-performance",
    "cancellations",
  ])
    router.get(
      `/reports/${name}`,
      permit(name === "occupancy" ? "read" : "finance:read"),
      asyncRoute(async (req, res) => {
        const range = dateRange(req),
          result = await analytics(req.auth.operatorId!, range.from, range.to);
        ok(
          res,
          name === "occupancy"
            ? {
                totalSeats: result.totalSeats,
                bookedSeats: result.bookedSeats,
                availableSeats: result.availableSeats,
                occupancy: result.occupancy,
                routePerformance: result.routePerformance,
                busPerformance: result.busPerformance,
              }
            : result,
        );
      }),
    );
  router.get(
    "/reports/revenue.csv",
    permit("finance:read"),
    asyncRoute(async (req, res) => {
      const range = dateRange(req),
        report = await analytics(req.auth.operatorId!, range.from, range.to);
      const headers = [
        "date",
        "gross_paise",
        "discount_paise",
        "commission_paise",
        "tickets",
      ];
      const csv = [
        headers,
        ...report.dailyRevenue.map((r: any) => [
          r._id,
          r.grossPaise,
          r.discountPaise,
          r.commissionPaise,
          r.ticketCount,
        ]),
      ]
        .map((r) => r.join(","))
        .join("\n");
      res.attachment("aibus-revenue.csv").type("text/csv").send(csv);
    }),
  );
  router.get(
    "/notifications",
    permit("read"),
    asyncRoute(async (req, res) => list(M.Notification, req, res, ["title"])),
  );
  router.patch(
    "/notifications/:id/read",
    permit("read"),
    asyncRoute(async (req, res) => {
      const value = await M.Notification.findOneAndUpdate(
        { _id: parseId(req), ...tenant(req) },
        { $set: { readAt: new Date() } },
        { new: true },
      );
      if (!value) fail(404, "NOT_FOUND", "Notification not found");
      ok(res, value);
    }),
  );
  router.get(
    "/audit-logs",
    permit("staff:write"),
    asyncRoute(async (req, res) => list(M.Audit, req, res, ["action"])),
  );
  router.get(
    "/staff",
    permit("staff:write"),
    asyncRoute(async (req, res) => list(M.User, req, res, ["name", "email"])),
  );
  const staffInput = z
    .object({
      name: text,
      email: z
        .string()
        .email()
        .max(254)
        .transform((v) => v.toLowerCase()),
      password: strongPassword,
      role: z.enum(["manager", "booking_staff", "read_only"]),
      phone: phoneNumber.optional(),
      commissionType: z
        .enum(["Percent", "Fixed"])
        .optional()
        .default("Percent"),
      commissionRate: amount.optional().default(500),
    })
    .strict();
  router.post(
    "/staff",
    permit("staff:write"),
    asyncRoute(async (req, res) => {
      const input = staffInput.parse(req.body),
        passwordHash = await hashPassword(input.password);
      commissionConfig.parse({
        commissionType: input.commissionType,
        commissionRate: input.commissionRate,
      });
      let user: any;
      await mongoose.connection.transaction(async (session) => {
        [user] = await M.User.create(
          [
            {
              ...tenant(req),
              name: input.name,
              email: input.email,
              role: input.role,
              phone: input.phone,
              commissionType: input.commissionType,
              commissionRate: input.commissionRate,
              passwordHash,
            },
          ],
          { session },
        );
        await audit(req, "staff.create", String(user._id), session);
      });
      ok(
        res,
        {
          id: String(user._id),
          name: user.name,
          email: user.email,
          role: user.role,
          phone: user.phone,
          commissionType: user.commissionType,
          commissionRate: user.commissionRate,
          active: user.active,
        },
        undefined,
        201,
      );
    }),
  );
  router.patch(
    "/staff/:id",
    permit("staff:write"),
    asyncRoute(async (req, res) => {
      const userId = parseId(req),
        input = z
          .object({
            name: text.optional(),
            role: z.enum(["manager", "booking_staff", "read_only"]).optional(),
            phone: phoneNumber.optional(),
            commissionType: z.enum(["Percent", "Fixed"]).optional(),
            commissionRate: amount.optional(),
            active: z.boolean().optional(),
          })
          .strict()
          .parse(req.body);
      if (userId === req.auth.userId)
        fail(
          409,
          "SELF_CHANGE_FORBIDDEN",
          "You cannot change your own staff access",
        );
      let user: any;
      await mongoose.connection.transaction(async (session) => {
        const existing: any = await M.User.findOne({
          _id: userId,
          ...tenant(req),
          role: { $ne: "operator_admin" },
        })
          .session(session)
          .lean();
        if (!existing) fail(404, "NOT_FOUND", "Staff account not found");
        if (
          existing.salesPartnerId &&
          input.role &&
          input.role !== "booking_staff"
        )
          fail(
            409,
            "AGENT_LINK_CONFLICT",
            "Linked agency users cannot be promoted through staff access",
          );
        commissionConfig.parse({
          commissionType:
            input.commissionType ?? existing.commissionType ?? "Percent",
          commissionRate:
            input.commissionRate ?? existing.commissionRate ?? 500,
        });
        user = await M.User.findOneAndUpdate(
          { _id: userId, ...tenant(req), role: { $ne: "operator_admin" } },
          { $set: input },
          { new: true, session },
        );
        if (!user) fail(404, "NOT_FOUND", "Staff account not found");
        await M.Session.updateMany(
          { userId, revokedAt: null },
          { $set: { revokedAt: new Date() } },
          { session },
        );
        await audit(req, "staff.update", userId, session);
      });
      ok(res, {
        id: String(user._id),
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        commissionType: user.commissionType,
        commissionRate: user.commissionRate,
        active: user.active,
      });
    }),
  );
  return router;
}
