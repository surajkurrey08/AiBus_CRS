import { Router, type Request } from "express";
import mongoose from "mongoose";
import { createHash } from "node:crypto";
import { z } from "zod";
import * as M from "../models/index.js";
import {
  asyncRoute,
  dateOnly,
  fail,
  id,
  literalRegex,
  ok,
  pagination,
  permit,
  tenant,
} from "../utils/core.js";
import {
  busServiceInput,
  commissionInput,
  fuelInput,
  operationInput,
  partnerInput,
  stopRecordInput,
  tabletAssignmentInput,
  tabletInput,
  tripLinkInput,
} from "../validators/trip-master.schemas.js";
import { ownedTripResource } from "../services/trip-scheduling.service.js";
import {
  planServiceTrips,
  scheduleServiceTrips,
  tripMasterReport,
} from "../services/trip-master.service.js";
const requestKey = (req: Request) =>
  z.string().min(16).max(100).parse(req.get("Idempotency-Key"));
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
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
async function repeated(
  model: mongoose.Model<any>,
  req: Request,
  key: string,
  requestHash: string,
  session: mongoose.ClientSession,
) {
  const prior: any = await model
    .findOne({ ...tenant(req), requestKey: key })
    .session(session)
    .lean();
  if (prior && prior.requestHash !== requestHash)
    fail(
      409,
      "IDEMPOTENCY_CONFLICT",
      "This request key was used with different details",
    );
  return prior as any;
}
export function tripMasterRouter() {
  const router = Router();
  router.use((req, _res, next) => {
    try {
      tenant(req);
      next();
    } catch (e) {
      next(e);
    }
  });
  const resources = [
    {
      path: "services",
      model: M.BusService,
      schema: busServiceInput,
      permission: "routes:write" as const,
      fields: ["name", "code", "departure"],
      optional: [],
    },
    {
      path: "tablets",
      model: M.TripTablet,
      schema: tabletInput,
      permission: "fleet:write" as const,
      fields: ["name", "serialNumber"],
      optional: [],
    },
    {
      path: "partners",
      model: M.SalesPartner,
      schema: partnerInput,
      permission: "pricing:write" as const,
      fields: ["name", "kind", "phone", "email"],
      optional: ["email", "parentPartnerId"],
    },
    {
      path: "commissions",
      model: M.CommissionRule,
      schema: commissionInput,
      permission: "pricing:write" as const,
      fields: ["basis", "kind"],
      optional: ["serviceId", "tripId", "basisPoints", "fixedPaise"],
    },
    {
      path: "links",
      model: M.TripLink,
      schema: tripLinkInput,
      permission: "routes:write" as const,
      fields: ["kind", "notes"],
      optional: ["notes"],
    },
  ];
  for (const resource of resources) {
    router.get(
      `/${resource.path}`,
      permit(resource.path === "commissions" ? "pricing:write" : "read"),
      asyncRoute(async (req, res) => {
        const p = pagination(req);
        const filter = {
          ...tenant(req),
          ...(p.status ? { status: p.status } : {}),
          ...(p.search
            ? {
                $or: resource.fields.map((field) => ({
                  [field]: literalRegex(p.search),
                })),
              }
            : {}),
        };
        const sort =
          p.sort && [...resource.fields, "status", "createdAt"].includes(p.sort)
            ? p.sort
            : "createdAt";
        const [rows, total] = await Promise.all([
          resource.model
            .find(filter)
            .sort({ [sort]: p.order === "asc" ? 1 : -1 })
            .skip((p.page - 1) * p.limit)
            .limit(p.limit)
            .lean(),
          resource.model.countDocuments(filter),
        ]);
        let data: any[] = rows;
        if (resource.path === "partners") {
          const parents = await M.SalesPartner.find({
            ...tenant(req),
            _id: { $in: rows.map((row: any) => row.parentPartnerId).filter(Boolean) },
          }).select("name").lean();
          data = rows.map((row: any) => ({
            ...row,
            parentPartnerName: parents.find((parent: any) => String(parent._id) === String(row.parentPartnerId))?.name || null,
          }));
        }
        if (resource.path === "tablets") {
          const assignments = await M.TabletAssignment.find({
            ...tenant(req),
            tabletId: { $in: rows.map((row) => row._id) },
            releasedAt: null,
          }).lean();
          data = rows.map((row) => ({
            ...row,
            assignment:
              assignments.find(
                (assignment) => String(assignment.tabletId) === String(row._id),
              ) || null,
          }));
        }
        ok(res, data, {
          page: p.page,
          limit: p.limit,
          total,
          pages: Math.max(1, Math.ceil(total / p.limit)),
        });
      }),
    );
    router.get(
      `/${resource.path}/:id`,
      permit(resource.path === "commissions" ? "pricing:write" : "read"),
      asyncRoute(async (req, res) =>
        ok(
          res,
          await ownedTripResource(
            resource.model,
            req.auth,
            id.parse(req.params.id),
          ),
        ),
      ),
    );
    for (const method of ["post", "patch"] as const)
      router[method](
        `/${resource.path}${method === "patch" ? "/:id" : ""}`,
        permit(resource.permission),
        asyncRoute(async (req, res) => {
          const input = resource.schema.parse(req.body) as any;
          const recordId =
            method === "patch" ? id.parse(req.params.id) : undefined;
          let result: any;
          await mongoose.connection.transaction(async (session) => {
            if (recordId)
              await ownedTripResource(
                resource.model,
                req.auth,
                recordId,
                session,
              );
            if (resource.path === "services") {
              if (!req.auth.permissions.includes("pricing:write"))
                fail(
                  403,
                  "FORBIDDEN",
                  "Pricing permission is required to configure service fares",
                );
              const bus = await ownedTripResource(
                  M.Bus,
                  req.auth,
                  input.busId,
                  session,
                ),
                route = await ownedTripResource(
                  M.Route,
                  req.auth,
                  input.routeId,
                  session,
                );
              if (bus.providerId || route.providerId)
                fail(
                  403,
                  "EXTERNAL_SERVICE",
                  "External services are managed by their provider",
                );
              if (
                input.status === "Active" &&
                (bus.status !== "Active" || route.status !== "Active")
              )
                fail(
                  409,
                  "INACTIVE_RESOURCE",
                  "Select an active bus and route",
                );
              for (const crewId of input.crewIds) {
                const member = await ownedTripResource(
                  M.CrewMember,
                  req.auth,
                  crewId,
                  session,
                );
                if (input.status === "Active" && member.status !== "Active")
                  fail(409, "CREW_UNAVAILABLE", "Select active default crew");
              }
            }
            if (resource.path === "commissions") {
              await ownedTripResource(
                M.SalesPartner,
                req.auth,
                input.partnerId,
                session,
              );
              if (input.serviceId)
                await ownedTripResource(
                  M.BusService,
                  req.auth,
                  input.serviceId,
                  session,
                );
              if (input.tripId)
                await ownedTripResource(
                  M.Trip,
                  req.auth,
                  input.tripId,
                  session,
                );
            }
            if (resource.path === "partners" && input.parentPartnerId) {
              const parent = await ownedTripResource(
                M.SalesPartner,
                req.auth,
                input.parentPartnerId,
                session,
              );
              if (String(parent._id) === String(recordId || ""))
                fail(400, "PARTNER_HIERARCHY_CYCLE", "A partner cannot report to itself");
              const descendants = await M.SalesPartner.find({ ...tenant(req) })
                .select("_id parentPartnerId")
                .session(session)
                .lean();
              const parentById = new Map(descendants.map((item: any) => [String(item._id), item]));
              let current: string | undefined = String(input.parentPartnerId);
              const seen = new Set<string>();
              while (current) {
                if (current === String(recordId || ""))
                  fail(400, "PARTNER_HIERARCHY_CYCLE", "This reporting line would create a loop");
                if (seen.has(current))
                  fail(409, "PARTNER_HIERARCHY_CYCLE", "The existing reporting line contains a loop");
                seen.add(current);
                const parentRecord: any = parentById.get(current);
                current = parentRecord?.parentPartnerId ? String(parentRecord.parentPartnerId) : undefined;
              }
            }
            if (resource.path === "links") {
              const from = await ownedTripResource(
                  M.Trip,
                  req.auth,
                  input.fromTripId,
                  session,
                ),
                to = await ownedTripResource(
                  M.Trip,
                  req.auth,
                  input.toTripId,
                  session,
                );
              if (
                input.status === "Active" &&
                (from.status === "Cancelled" || to.status === "Cancelled")
              )
                fail(
                  409,
                  "TRIP_CANCELLED",
                  "Select trips that are not cancelled",
                );
              if (input.kind === "Connection" && input.status === "Active") {
                const fromRoute = await ownedTripResource(
                    M.Route,
                    req.auth,
                    String(from.routeId),
                    session,
                  ),
                  toRoute = await ownedTripResource(
                    M.Route,
                    req.auth,
                    String(to.routeId),
                    session,
                  );
                const normalize = (name: string) =>
                  name.trim().replace(/\s+/g, " ").toLowerCase();
                if (
                  normalize(fromRoute.destination) !==
                    normalize(toRoute.source) ||
                  !from.arrivalAt ||
                  +new Date(from.arrivalAt) + input.transferMinutes * 60000 >
                    +new Date(to.departureAt)
                )
                  fail(
                    409,
                    "CONNECTION_INVALID",
                    "Connection cities or transfer times do not match",
                  );
                await M.Trip.updateMany(
                  { ...tenant(req), _id: { $in: [from._id, to._id] } },
                  { $inc: { __v: 1 } },
                  { session },
                );
                const links = await M.TripLink.find({
                  ...tenant(req),
                  kind: "Connection",
                  status: "Active",
                  ...(recordId ? { _id: { $ne: recordId } } : {}),
                })
                  .session(session)
                  .lean();
                const pending = [input.toTripId],
                  seen = new Set<string>();
                while (pending.length) {
                  const current = pending.pop()!;
                  if (current === input.fromTripId)
                    fail(
                      409,
                      "CONNECTION_CYCLE",
                      "A connecting trip chain cannot loop back",
                    );
                  if (seen.has(current)) continue;
                  seen.add(current);
                  for (const link of links)
                    if (String(link.fromTripId) === current)
                      pending.push(String(link.toTripId));
                }
              }
            }
            if (recordId) {
              const unset = Object.fromEntries(
                resource.optional
                  .filter((field) => !(field in input))
                  .map((field) => [field, 1]),
              );
              result = await resource.model.findOneAndUpdate(
                { _id: recordId, ...tenant(req) },
                { $set: input, $unset: unset, $inc: { __v: 1 } },
                { new: true, runValidators: true, session },
              );
            } else
              [result] = await resource.model.create(
                [{ ...input, ...tenant(req) }],
                { session },
              );
            await audit(
              req,
              `trip_master.${resource.path}.${method === "post" ? "create" : "update"}`,
              String(result._id),
              session,
            );
          });
          ok(res, result, undefined, method === "post" ? 201 : 200);
        }),
      );
  }
  router.post(
    "/scheduling/preview",
    permit("routes:write"),
    asyncRoute(async (req, res) =>
      ok(res, await planServiceTrips(req.auth, req.body)),
    ),
  );
  router.post(
    "/scheduling/create",
    permit("routes:write"),
    asyncRoute(async (req, res) =>
      ok(
        res,
        await scheduleServiceTrips(req.auth, req.body, req.requestId),
        undefined,
        201,
      ),
    ),
  );
  router.get(
    "/availability",
    permit("read"),
    asyncRoute(async (req, res) => {
      const query = z
        .object({ journeyDate: dateOnly, serviceIds: z.string().optional() })
        .strict()
        .parse(req.query);
      const serviceIds = query.serviceIds
        ? z.array(id).max(20).parse(query.serviceIds.split(","))
        : [];
      const trips = await M.Trip.find({
        ...tenant(req),
        journeyDate: query.journeyDate,
        status: { $ne: "Cancelled" },
        ...(serviceIds.length ? { serviceId: { $in: serviceIds } } : {}),
      })
        .sort({ departureAt: 1 })
        .lean();
      const [routes, buses] = await Promise.all([
        M.Route.find({
          ...tenant(req),
          _id: { $in: trips.map((trip) => trip.routeId) },
        }).lean(),
        M.Bus.find({
          ...tenant(req),
          _id: { $in: trips.map((trip) => trip.busId) },
        }).lean(),
      ]);
      const now = new Date();
      ok(
        res,
        trips.map((trip: any) => {
          const route = routes.find(
            (row) => String(row._id) === String(trip.routeId),
          );
          const states = trip.seats.map((seat: any) =>
            seat.state === "held" && new Date(seat.holdUntil) <= now
              ? "available"
              : seat.state,
          );
          return {
            id: String(trip._id),
            service: trip.serviceName || "Single trip",
            route: route
              ? `${route.source} → ${route.destination}`
              : "Route unavailable",
            registration:
              buses.find((bus) => String(bus._id) === String(trip.busId))
                ?.registration || "",
            departureAt: trip.departureAt,
            status: trip.status,
            bookingOpen:
              trip.bookingOpen &&
              trip.status === "Scheduled" &&
              new Date(trip.departureAt) > now,
            total: states.length,
            available: states.filter((state: string) => state === "available")
              .length,
            booked: states.filter((state: string) => state === "booked").length,
            held: states.filter((state: string) => state === "held").length,
            blocked: states.filter((state: string) => state === "blocked")
              .length,
            quota: states.filter((state: string) => state === "quota").length,
          };
        }),
      );
    }),
  );
  router.get(
    "/trips/:id/tracker",
    permit("read"),
    asyncRoute(async (req, res) => {
      const trip = await ownedTripResource(
        M.Trip,
        req.auth,
        id.parse(req.params.id),
      );
      const [events, stops, gps] = await Promise.all([
        M.TripOperation.find({ ...tenant(req), tripId: trip._id })
          .sort({ at: 1 })
          .lean(),
        M.TripStopRecord.find({ ...tenant(req), tripId: trip._id })
          .sort({ arrivedAt: 1 })
          .lean(),
        M.BusGps.findOne({ ...tenant(req), busId: trip.busId }).lean(),
      ]);
      delete trip.seats;
      ok(res, {
        trip,
        events,
        stops,
        gps: {
          provider: gps?.provider || null,
          configurationStatus: gps?.status || "Not configured",
          telemetryStatus: "Not connected",
          latitude: null,
          longitude: null,
          lastReportedAt: null,
        },
        integrations: { gps: false, revmax: false },
      });
    }),
  );
  router.post(
    "/trips/:id/operations",
    permit("routes:write"),
    asyncRoute(async (req, res) => {
      const tripId = id.parse(req.params.id),
        input = operationInput.parse(req.body),
        key = requestKey(req),
        requestHash = hash({ tripId, input });
      let result: any;
      await mongoose.connection.transaction(async (session) => {
        const prior = await repeated(
          M.TripOperation,
          req,
          key,
          requestHash,
          session,
        );
        if (prior) {
          result = await ownedTripResource(M.Trip, req.auth, tripId, session);
          return;
        }
        const trip = await ownedTripResource(M.Trip, req.auth, tripId, session);
        if (trip.inventoryOwner !== "internal")
          fail(403, "EXTERNAL_TRIP", "External trips require their provider");
        const current = trip.operationStage || trip.status;
        const next: Record<string, string> = {
          Scheduled: "Boarding",
          Boarding: "Departed",
          Departed: "Arrived",
          Arrived: "Completed",
        };
        if (next[current] !== input.stage || trip.status === "Cancelled")
          fail(
            409,
            "OPERATION_ORDER",
            "Refresh the trip and record the next operational stage",
          );
        const previous = await M.TripOperation.findOne({
          ...tenant(req),
          tripId,
        })
          .sort({ at: -1 })
          .session(session)
          .lean();
        const at = new Date(input.at);
        if (at > new Date() || (previous && at < new Date(previous.at as Date)))
          fail(
            400,
            "OPERATION_TIME",
            "Actual times must be chronological and cannot be in the future",
          );
        if (
          input.odometerKm !== undefined &&
          !["Departed", "Arrived"].includes(input.stage)
        )
          fail(
            400,
            "ODOMETER_STAGE",
            "Record odometer readings at departure or arrival",
          );
        if (
          input.fuelConsumedMillilitres !== undefined &&
          input.stage !== "Arrived"
        )
          fail(
            400,
            "FUEL_STAGE",
            "Record measured fuel consumption at arrival",
          );
        if (
          input.stage === "Arrived" &&
          input.odometerKm !== undefined &&
          trip.startOdometerKm !== undefined &&
          input.odometerKm < trip.startOdometerKm
        )
          fail(
            400,
            "ODOMETER_INVALID",
            "Arrival odometer cannot be below the departure reading",
          );
        const changes: any = { operationStage: input.stage };
        if (input.stage === "Departed") {
          changes.status = "Departed";
          changes.bookingOpen = false;
          changes.actualDepartureAt = at;
          if (input.odometerKm !== undefined)
            changes.startOdometerKm = input.odometerKm;
        }
        if (input.stage === "Arrived") {
          changes.actualArrivalAt = at;
          if (input.odometerKm !== undefined)
            changes.endOdometerKm = input.odometerKm;
          if (input.fuelConsumedMillilitres !== undefined)
            changes.fuelConsumedMillilitres = input.fuelConsumedMillilitres;
        }
        if (input.stage === "Completed") {
          changes.status = "Completed";
          changes.bookingOpen = false;
        }
        result = await M.Trip.findOneAndUpdate(
          {
            _id: tripId,
            ...tenant(req),
            __v: input.expectedVersion,
            status: trip.status,
          },
          { $set: changes, $inc: { __v: 1 } },
          { new: true, session },
        ).lean();
        if (!result)
          fail(
            409,
            "TRIP_CHANGED",
            "Trip changed. Refresh before recording its status",
          );
        await M.TripOperation.create(
          [
            {
              ...tenant(req),
              tripId,
              ...Object.fromEntries(
                Object.entries(input).filter(
                  ([key]) => key !== "expectedVersion",
                ),
              ),
              requestKey: key,
              requestHash,
              actorId: req.auth.userId,
            },
          ],
          { session },
        );
        await audit(
          req,
          `trip.operation.${input.stage.toLowerCase()}`,
          tripId,
          session,
        );
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
      ok(res, result);
    }),
  );
  for (const descriptor of [
    {
      path: "fuel",
      model: M.TripFuel,
      schema: fuelInput,
      read: "finance:read" as const,
      write: "fleet:write" as const,
    },
    {
      path: "stops",
      model: M.TripStopRecord,
      schema: stopRecordInput,
      read: "read" as const,
      write: "routes:write" as const,
    },
  ]) {
    router.get(
      `/${descriptor.path}`,
      permit(descriptor.read),
      asyncRoute(async (req, res) => {
        const p = pagination(req);
        const filter = {
          ...tenant(req),
          ...(p.tripId ? { tripId: p.tripId } : {}),
        };
        const [rows, total] = await Promise.all([
          descriptor.model
            .find(filter)
            .sort({ createdAt: -1 })
            .skip((p.page - 1) * p.limit)
            .limit(p.limit)
            .lean(),
          descriptor.model.countDocuments(filter),
        ]);
        ok(res, rows, {
          page: p.page,
          limit: p.limit,
          total,
          pages: Math.max(1, Math.ceil(total / p.limit)),
        });
      }),
    );
    router.post(
      `/${descriptor.path}`,
      permit(descriptor.write),
      asyncRoute(async (req, res) => {
        const input = descriptor.schema.parse(req.body) as any,
          key = requestKey(req),
          requestHash = hash(input);
        let result: any;
        await mongoose.connection.transaction(async (session) => {
          const prior = await repeated(
            descriptor.model,
            req,
            key,
            requestHash,
            session,
          );
          if (prior) {
            result = prior;
            return;
          }
          const trip = await ownedTripResource(
            M.Trip,
            req.auth,
            input.tripId,
            session,
          );
          if (trip.inventoryOwner !== "internal")
            fail(
              403,
              "EXTERNAL_TRIP",
              "External trip operations require a provider integration",
            );
          await M.Trip.updateOne(
            { _id: trip._id, ...tenant(req) },
            { $inc: { __v: 1 } },
            { session },
          );
          const payload: any = { ...input };
          if (descriptor.path === "fuel") {
            payload.busId = trip.busId;
            if (new Date(input.at) > new Date())
              fail(
                400,
                "FUTURE_EXPENSE",
                "Fuel expense date cannot be in the future",
              );
          } else {
            if (new Date(input.departedAt) > new Date())
              fail(
                400,
                "FUTURE_STOP",
                "Actual stop times cannot be in the future",
              );
            if (input.locationId) {
              const point = await ownedTripResource(
                M.AreaLocation,
                req.auth,
                input.locationId,
                session,
              );
              if (
                ![input.kind, "Both"].includes(point.usage) &&
                input.kind !== "Other"
              )
                fail(
                  400,
                  "STOP_USAGE",
                  "Location type does not match this stop",
                );
              const route = await ownedTripResource(
                M.Route,
                req.auth,
                String(trip.routeId),
                session,
              );
              const expectedCity =
                input.kind === "Pickup"
                  ? route.sourceCityId
                  : route.destinationCityId;
              if (expectedCity && String(point.cityId) !== String(expectedCity))
                fail(400, "STOP_CITY", "Stop city does not match the route");
              payload.name = point.name;
            }
            if (input.poiId) {
              const poi = await ownedTripResource(
                M.AreaPoi,
                req.auth,
                input.poiId,
                session,
              );
              payload.name = poi.name;
            }
          }
          [result] = await descriptor.model.create(
            [{ ...tenant(req), ...payload, requestKey: key, requestHash }],
            { session },
          );
          await audit(
            req,
            `trip.${descriptor.path}.record`,
            String(result._id),
            session,
          );
        });
        ok(res, result, undefined, 201);
      }),
    );
  }
  router.post(
    "/fuel/:id/void",
    permit("fleet:write"),
    asyncRoute(async (req, res) => {
      const recordId = id.parse(req.params.id),
        { reason } = z
          .object({ reason: z.string().trim().min(1).max(200) })
          .strict()
          .parse(req.body);
      let result: any;
      await mongoose.connection.transaction(async (session) => {
        await ownedTripResource(M.TripFuel, req.auth, recordId, session);
        result = await M.TripFuel.findOneAndUpdate(
          { _id: recordId, ...tenant(req) },
          { $set: { status: "Voided", voidReason: reason } },
          { new: true, session },
        );
        await audit(req, "trip.fuel.void", recordId, session);
      });
      ok(res, result);
    }),
  );
  router.get(
    "/tablet-assignments",
    permit("read"),
    asyncRoute(async (req, res) => {
      const p = pagination(req);
      const filter = {
        ...tenant(req),
        ...(req.query.active === "true" ? { releasedAt: null } : {}),
      };
      const [rows, total] = await Promise.all([
        M.TabletAssignment.find(filter)
          .sort({ assignedAt: -1 })
          .skip((p.page - 1) * p.limit)
          .limit(p.limit)
          .lean(),
        M.TabletAssignment.countDocuments(filter),
      ]);
      ok(res, rows, {
        page: p.page,
        limit: p.limit,
        total,
        pages: Math.max(1, Math.ceil(total / p.limit)),
      });
    }),
  );
  router.post(
    "/tablet-assignments",
    permit("routes:write"),
    asyncRoute(async (req, res) => {
      const input = tabletAssignmentInput.parse(req.body);
      let result: any;
      await mongoose.connection.transaction(async (session) => {
        const tablet = await ownedTripResource(
            M.TripTablet,
            req.auth,
            input.tabletId,
            session,
          ),
          trip = await ownedTripResource(
            M.Trip,
            req.auth,
            input.tripId,
            session,
          );
        if (
          tablet.status !== "Active" ||
          !["Scheduled", "Departed"].includes(trip.status)
        )
          fail(
            409,
            "TABLET_ASSIGNMENT_INVALID",
            "Select an active tablet and an ongoing or scheduled trip",
          );
        if (
          input.crewId &&
          !(trip.crewIds || []).map(String).includes(input.crewId)
        )
          fail(400, "CREW_MISMATCH", "Select crew assigned to this trip");
        await M.TripTablet.updateOne(
          { _id: tablet._id, ...tenant(req) },
          { $inc: { __v: 1 } },
          { session },
        );
        const previous = await M.TabletAssignment.findOne({
          ...tenant(req),
          tabletId: tablet._id,
          releasedAt: null,
        })
          .session(session)
          .lean();
        if (previous) {
          if (
            String(previous.tripId) === input.tripId &&
            String(previous.crewId || "") === (input.crewId || "")
          ) {
            result = previous;
            return;
          }
          fail(
            409,
            "TABLET_IN_USE",
            "Unassign this tablet before assigning it again",
          );
        }
        [result] = await M.TabletAssignment.create(
          [
            {
              ...tenant(req),
              ...input,
              assignedAt: new Date(),
              releasedAt: null,
            },
          ],
          { session },
        );
        await audit(req, "tablet.assign", String(result._id), session);
      });
      ok(res, result, undefined, 201);
    }),
  );
  router.post(
    "/tablet-assignments/:id/release",
    permit("routes:write"),
    asyncRoute(async (req, res) => {
      const recordId = id.parse(req.params.id);
      let result: any;
      await mongoose.connection.transaction(async (session) => {
        const previous = await ownedTripResource(
          M.TabletAssignment,
          req.auth,
          recordId,
          session,
        );
        if (previous.releasedAt) {
          result = previous;
          return;
        }
        result = await M.TabletAssignment.findOneAndUpdate(
          { _id: recordId, ...tenant(req) },
          { $set: { releasedAt: new Date() } },
          { new: true, session },
        );
        await audit(req, "tablet.release", recordId, session);
      });
      ok(res, result);
    }),
  );
  router.get(
    "/reports",
    permit("read"),
    asyncRoute(async (req, res) => {
      const input = z
        .object({ from: dateOnly, to: dateOnly })
        .strict()
        .parse(req.query);
      ok(res, await tripMasterReport(req.auth, input.from, input.to));
    }),
  );
  return router;
}
