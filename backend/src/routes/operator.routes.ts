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
  createBooking,
  createHold,
  passengerInput,
  releaseHold,
  seatList,
} from "../services/inventory.service.js";

import { analytics } from "../services/analytics.service.js";

import { counterRouter } from "./counter.routes.js";
import { createScheduledTrip } from "../services/trip-scheduling.service.js";

import { contactInput, gstInput } from "../services/pricing.service.js";

import type { Config } from "../config/env.js";
import {
  busInput,
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

function redactBooking(row: any, pii: boolean) {
  const result =
    typeof row.toObject === "function" ? row.toObject() : { ...row };
  if (!pii) {
    delete result.contact;
    delete result.gst;
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
    async (_req, input) => {
      if (input.source.toLowerCase() === input.destination.toLowerCase())
        fail(400, "INVALID_ROUTE", "Source and destination must differ");
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
    asyncRoute(async (req, res) => list(M.Trip, req, res, [])),
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
    "/trips/:id/seats",
    permit("read"),
    asyncRoute(async (req, res) => {
      const trip = await owned(M.Trip, req, parseId(req));
      if (trip.inventoryOwner !== "internal") requireCapability("availability");
      const now = new Date();
      const seats = (trip.seats as any[]).map((s) => ({
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
      }));
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
          redactBooking(r, req.auth.permissions.includes("manifest:read")),
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
      ok(res, await createBooking(req.auth, input, key), undefined, 201);
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
      const bookingId = parseId(req),
        { reason } = z.object({ reason: text }).strict().parse(req.body);
      const booking = await owned(M.Booking, req, bookingId);
      if (booking.status !== "Confirmed")
        fail(409, "NOT_CONFIRMED", "Only a confirmed booking can be cancelled");
      const prior = await M.Cancellation.findOne({
        ...tenant(req),
        bookingId,
      }).lean();
      if (prior) return ok(res, prior);
      const trip = await owned(M.Trip, req, String(booking.tripId));
      if (new Date(trip.departureAt) <= new Date())
        fail(409, "DEPARTED", "Trip has already departed");
      const policy = await M.Policy.findOne(tenant(req)).lean();
      if (!policy)
        fail(
          409,
          "POLICY_REQUIRED",
          "Configure an operator cancellation policy first",
        );
      const hours = (+new Date(trip.departureAt) - Date.now()) / 3600000;
      const rule = (policy!.rules as any[])
        .sort((a, b) => b.hoursBefore - a.hoursBefore)
        .find((r) => hours >= r.hoursBefore);
      const refundPaise = Math.floor(
        (booking.totalPaise * (rule?.refundPercent || 0)) / 100,
      );
      let cancellation: any;
      await mongoose.connection.transaction(async (session) => {
        [cancellation] = await M.Cancellation.create(
          [
            {
              ...tenant(req),
              bookingId,
              reason,
              requestedBy: req.auth.userId,
              policySnapshot: {
                version: policy!.version,
                rules: policy!.rules,
              },
              refundPaise,
            },
          ],
          { session },
        );
        await M.Refund.create(
          [
            {
              ...tenant(req),
              bookingId,
              cancellationId: cancellation._id,
              amountPaise: refundPaise,
            },
          ],
          { session },
        );
        await audit(req, "cancellation.request", bookingId, session);
      });
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
      password: z.string().min(12).max(128),
      role: z.enum(["manager", "booking_staff", "read_only"]),
      phone: z.string().max(20).optional(),
      commissionType: z.enum(["Percent", "Fixed"]).optional().default("Percent"),
      commissionRate: z.coerce.number().min(0).max(1000000).optional().default(500),
    })
    .strict();
  router.post(
    "/staff",
    permit("staff:write"),
    asyncRoute(async (req, res) => {
      const input = staffInput.parse(req.body),
        passwordHash = await hashPassword(input.password);
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
            phone: z.string().max(20).optional(),
            commissionType: z.enum(["Percent", "Fixed"]).optional(),
            commissionRate: z.coerce.number().min(0).max(1000000).optional(),
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
  router.get(
    "/agents/performance",
    permit("read"),
    asyncRoute(async (req, res) => {
      if (!req.auth.operatorId) {
        fail(403, "OPERATOR_REQUIRED", "Operator context required");
      }
      const opId = new mongoose.Types.ObjectId(req.auth.operatorId!);
      const staffMembers = await M.User.find({
        operatorId: opId,
        role: "booking_staff",
      }).lean();

      const stats = await M.Booking.aggregate([
        { $match: { operatorId: opId } },
        {
          $group: {
            _id: "$userId",
            totalBookings: { $sum: 1 },
            confirmedBookings: {
              $sum: {
                $cond: [{ $in: ["$status", ["Confirmed", "Pending payment"]] }, 1, 0],
              },
            },
            totalSalesPaise: {
              $sum: {
                $cond: [{ $eq: ["$paymentStatus", "Paid"] }, "$grossPaise", 0],
              },
            },
            commissionEarnedPaise: { $sum: "$commissionPaise" },
            lastBookingAt: { $max: "$createdAt" },
          },
        },
      ]);

      const statsMap = new Map(stats.map((s) => [String(s._id), s]));

      const agents = (staffMembers as any[]).map((u) => {
        const s = statsMap.get(String(u._id));
        return {
          id: String(u._id),
          name: u.name,
          email: u.email,
          phone: u.phone || "",
          role: u.role,
          active: u.active,
          commissionType: u.commissionType || "Percent",
          commissionRate: u.commissionRate ?? 500,
          totalBookings: s?.totalBookings || 0,
          confirmedBookings: s?.confirmedBookings || 0,
          totalSalesPaise: s?.totalSalesPaise || 0,
          commissionEarnedPaise: s?.commissionEarnedPaise || 0,
          lastBookingAt: s?.lastBookingAt || null,
        };
      });

      const totals = {
        totalAgents: agents.length,
        activeAgents: agents.filter((a) => a.active).length,
        totalBookings: agents.reduce((acc, a) => acc + a.totalBookings, 0),
        totalSalesPaise: agents.reduce((acc, a) => acc + a.totalSalesPaise, 0),
        commissionEarnedPaise: agents.reduce(
          (acc, a) => acc + a.commissionEarnedPaise,
          0,
        ),
      };

      ok(res, { agents, totals });
    }),
  );
  router.get(
    "/agents/:id/bookings",
    permit("read"),
    asyncRoute(async (req, res) => {
      const agentId = parseId(req);
      const agent = (await M.User.findOne({
        _id: agentId,
        ...tenant(req),
      }).lean()) as any;
      if (!agent) fail(404, "NOT_FOUND", "Agent not found");

      const bookings = await M.Booking.find({
        ...tenant(req),
        userId: agentId,
      })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean();

      const data = (bookings as any[]).map((b: any) => ({
        id: String(b._id),
        reference: b.reference,
        pnr: b.pnr || "Pending",
        tripId: String(b.tripId),
        seats: ((b.passengers || []) as any[]).map((p: any) => p.seat),
        passengerName: b.passengers?.[0]?.name || b.contact?.email || "Passenger",
        passengersCount: ((b.passengers || []) as any[]).length,
        grossPaise: b.grossPaise,
        totalPaise: b.totalPaise,
        commissionPaise: b.commissionPaise,
        commissionSnapshot: b.commissionSnapshot,
        status: b.status,
        paymentStatus: b.paymentStatus,
        createdAt: b.createdAt,
      }));

      ok(res, {
        agent: {
          id: String(agent._id),
          name: agent.name,
          email: agent.email,
          role: agent.role,
          commissionType: agent.commissionType || "Percent",
          commissionRate: agent.commissionRate ?? 500,
        },
        bookings: data,
      });
    }),
  );
  return router;
}
