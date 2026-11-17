import { Router, type Request } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import * as M from "../models/index.js";
import {
  asyncRoute,
  fail,
  id,
  literalRegex,
  ok,
  pagination,
  permit,
  tenant,
} from "../utils/core.js";
import {
  busMasterAssignmentInput,
  chartInput,
  coachInput,
  crewInput,
  gpsInput,
  ownerInput,
  vehicleDocumentInput,
} from "../validators/bus-master.schemas.js";
import { lockTripCrew } from "../services/bus-master.service.js";
async function owned(
  model: mongoose.Model<any>,
  req: Request,
  recordId: string,
  session?: mongoose.ClientSession,
) {
  const record = await model
    .findOne({ _id: recordId, ...tenant(req) })
    .session(session || null)
    .lean();
  if (!record) fail(404, "NOT_FOUND", "Record not found");
  return record as any;
}
async function audit(
  req: Request,
  action: string,
  resourceId: string,
  session: mongoose.ClientSession,
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
export function busMasterRouter() {
  const router = Router();
  const resources = [
    {
      path: "coaches",
      model: M.CoachType,
      schema: coachInput,
      fields: ["name", "type"],
    },
    {
      path: "owners",
      model: M.FleetOwner,
      schema: ownerInput,
      fields: ["name", "phone", "email"],
    },
    {
      path: "crew",
      model: M.CrewMember,
      schema: crewInput,
      fields: ["name", "phone", "role"],
    },
    {
      path: "charts",
      model: M.SeatChartTemplate,
      schema: chartInput,
      fields: ["name"],
    },
    {
      path: "documents",
      model: M.VehicleDocument,
      schema: vehicleDocumentInput,
      fields: ["reference", "kind"],
    },
    {
      path: "gps",
      model: M.BusGps,
      schema: gpsInput,
      fields: ["provider", "deviceId"],
    },
  ];
  for (const resource of resources) {
    router.get(
      `/${resource.path}`,
      permit("read"),
      asyncRoute(async (req, res) => {
        const p = pagination(req);
        const filter = {
          ...tenant(req),
          ...(p.search
            ? {
                $or: resource.fields.map((field) => ({
                  [field]: literalRegex(p.search),
                })),
              }
            : {}),
          ...(p.status && resource.path !== "documents"
            ? { status: p.status }
            : {}),
        };
        const allowedSorts = [
          ...resource.fields,
          "status",
          "createdAt",
          "licenceExpiry",
          "expiresOn",
          "arrangement",
          "decks",
        ];
        const sortField =
          p.sort && allowedSorts.includes(p.sort) ? p.sort : "createdAt";
        const [rows, total] = await Promise.all([
          resource.model
            .find(filter)
            .sort({ [sortField]: p.order === "asc" ? 1 : -1 })
            .skip((p.page - 1) * p.limit)
            .limit(p.limit)
            .lean(),
          resource.model.countDocuments(filter),
        ]);
        ok(res, rows, {
          page: p.page,
          limit: p.limit,
          total,
          pages: Math.max(1, Math.ceil(total / p.limit)),
        });
      }),
    );
    router.get(
      `/${resource.path}/:id`,
      permit("read"),
      asyncRoute(async (req, res) =>
        ok(res, await owned(resource.model, req, id.parse(req.params.id))),
      ),
    );
    for (const method of ["post", "patch"] as const) {
      router[method](
        `/${resource.path}${method === "patch" ? "/:id" : ""}`,
        permit("fleet:write"),
        asyncRoute(async (req, res) => {
          const input = resource.schema.parse(req.body) as Record<string, any>;
          let result: any;
          await mongoose.connection.transaction(async (session) => {
            if (input.busId) await owned(M.Bus, req, input.busId, session);
            if (method === "patch") {
              const recordId = id.parse(req.params.id);
              await owned(resource.model, req, recordId, session);
              const optionalFields: Record<string, string[]> = {
                owners: ["email", "address"],
                crew: ["licenceNumber", "licenceExpiry", "pickupPoint"],
                documents: ["issuedOn", "expiresOn", "notes"],
              };
              const unset = Object.fromEntries(
                (optionalFields[resource.path] || [])
                  .filter((key) => !(key in input))
                  .map((key) => [key, 1]),
              );
              result = await resource.model.findOneAndUpdate(
                { _id: recordId, ...tenant(req) },
                { $set: input, $unset: unset },
                { new: true, runValidators: true, session },
              );
            } else
              [result] = await resource.model.create(
                [{ ...input, ...tenant(req) }],
                { session },
              );
            await audit(
              req,
              `bus_master.${resource.path}.${method === "post" ? "create" : "update"}`,
              String(result._id),
              session,
            );
          });
          ok(res, result, undefined, method === "post" ? 201 : 200);
        }),
      );
    }
  }
  router.patch(
    "/buses/:id/assignments",
    permit("fleet:write"),
    asyncRoute(async (req, res) => {
      const busId = id.parse(req.params.id),
        input = busMasterAssignmentInput.parse(req.body);
      let value: any;
      await mongoose.connection.transaction(async (session) => {
        await owned(M.Bus, req, busId, session);
        if (input.coachTypeId) {
          const coach = await owned(
            M.CoachType,
            req,
            input.coachTypeId,
            session,
          );
          if (coach.status !== "Active")
            fail(409, "INACTIVE_COACH", "Select an active coach type");
        }
        if (input.ownerId) {
          const owner = await owned(M.FleetOwner, req, input.ownerId, session);
          if (owner.status !== "Active")
            fail(409, "INACTIVE_OWNER", "Select an active owner");
        }
        value = await M.Bus.findOneAndUpdate(
          { _id: busId, ...tenant(req) },
          { $set: input },
          { new: true, session },
        );
        await audit(req, "bus_master.bus.assign", busId, session);
      });
      ok(res, value);
    }),
  );
  router.post(
    "/buses/:id/chart",
    permit("fleet:write"),
    asyncRoute(async (req, res) => {
      const busId = id.parse(req.params.id),
        { templateId } = z.object({ templateId: id }).strict().parse(req.body);
      let layout: any;
      await mongoose.connection.transaction(async (session) => {
        const bus = await owned(M.Bus, req, busId, session),
          chart = await owned(M.SeatChartTemplate, req, templateId, session);
        if (chart.status !== "Active" || chart.seats.length !== bus.capacity)
          fail(
            409,
            "CHART_CAPACITY_MISMATCH",
            "Select an active chart with the same seat capacity as this bus",
          );
        await M.Bus.updateOne(
          { _id: busId, ...tenant(req) },
          { $inc: { __v: 1 } },
          { session },
        );
        layout = await M.Layout.findOneAndUpdate(
          { ...tenant(req), busId },
          { $set: { name: chart.name, seats: chart.seats } },
          { upsert: true, new: true, runValidators: true, session },
        );
        await audit(req, "bus_master.chart.apply", busId, session);
      });
      ok(res, layout);
    }),
  );
  router.get(
    "/gps/:id/status",
    permit("read"),
    asyncRoute(async (req, res) => {
      const device = await owned(M.BusGps, req, id.parse(req.params.id));
      ok(res, {
        deviceId: device.deviceId,
        provider: device.provider,
        configurationStatus: device.status,
        telemetryStatus: "Not connected",
        lastReportedAt: null,
        latitude: null,
        longitude: null,
      });
    }),
  );
  router.patch(
    "/trips/:id/crew",
    permit("routes:write"),
    asyncRoute(async (req, res) => {
      const tripId = id.parse(req.params.id),
        { crewIds } = z
          .object({
            crewIds: z
              .array(id)
              .max(10)
              .refine(
                (v) => new Set(v).size === v.length,
                "Crew members must be unique",
              ),
          })
          .strict()
          .parse(req.body);
      let trip: any;
      await mongoose.connection.transaction(async (session) => {
        const current = await owned(M.Trip, req, tripId, session);
        if (current.status !== "Scheduled")
          fail(
            409,
            "TRIP_NOT_SCHEDULED",
            "Crew can be assigned to scheduled trips",
          );
        const route = current.arrivalAt
          ? null
          : await owned(M.Route, req, String(current.routeId), session);
        const arrival = current.arrivalAt
          ? new Date(current.arrivalAt)
          : new Date(
              +new Date(current.departureAt) + route.durationMinutes * 60000,
            );
        await lockTripCrew(
          req.auth,
          crewIds,
          tripId,
          new Date(current.departureAt),
          arrival,
          current.journeyDate,
          session,
        );
        trip = await M.Trip.findOneAndUpdate(
          { _id: tripId, ...tenant(req), status: "Scheduled" },
          { $set: { crewIds } },
          { new: true, session },
        );
        await audit(req, "bus_master.trip.crew", tripId, session);
      });
      ok(res, trip);
    }),
  );
  return router;
}
