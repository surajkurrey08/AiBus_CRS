import { tripAmenitiesSchema } from "../validators/operator.schemas.js";
import { resolveAreaRoutes } from "../services/area-master.service.js";
import { Router, type Request } from "express";
import type { Config } from "../config/env.js";
import { razorpayEnabled } from "../integrations/razorpay.js";
import mongoose from "mongoose";
import { z } from "zod";
import { requireCapability } from "../integrations/providers.js";
import * as M from "../models/index.js";
import {
  internalTrip,
  passengerInput,
  seatList,
} from "../services/inventory.service.js";
import {
  contactInput,
  gstInput,
  issueQuote,
  policyInput,
  priceTrip,
  pricingOptions,
  validatePassengers,
} from "../services/pricing.service.js";
import {
  amount,
  asyncRoute,
  dateOnly,
  fail,
  id,
  literalRegex,
  ok,
  permit,
  tenant,
  text,
} from "../utils/core.js";
async function ownedTrip(req: Request) {
  const trip = await M.Trip.findOne({
    _id: id.parse(req.params.id),
    ...tenant(req),
  }).lean();
  if (!trip) fail(404, "NOT_FOUND", "Trip not found");
  return trip!;
}
async function record(
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
const sources = ["operator", "customer", "agent", "external"] as const;
export function counterRouter(config: Config) {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  router.get(
    "/counter/cities",
    permit("read"),
    asyncRoute(async (req, res) => {
      const [savedCities, rawRoutes] = await Promise.all([
        M.City.find({ ...tenant(req), status: { $ne: "Inactive" } })
          .select({ name: 1 })
          .lean(),
        M.Route.find({ ...tenant(req), status: { $ne: "Inactive" } }).lean(),
      ]);
      const routes = await resolveAreaRoutes(req.auth.operatorId!, rawRoutes);
      const cityByKey = new Map<string, string>();
      const registerCity = (raw: unknown) => {
        const name = String(raw || "").trim();
        if (!name) return;
        const key = name.toLowerCase();
        if (!cityByKey.has(key)) cityByKey.set(key, name);
      };
      for (const c of savedCities as any[]) registerCity(c.name);
      const destSets = new Map<string, Set<string>>();
      for (const r of routes as any[]) {
        const ordered = [
          r.source,
          ...(Array.isArray(r.viaStops) ? r.viaStops.map((v: any) => v.city) : []),
          r.destination,
        ]
          .map((value) => String(value || "").trim())
          .filter(Boolean);
        for (const stop of ordered) registerCity(stop);
        for (let i = 0; i < ordered.length - 1; i++) {
          const fromKey = ordered[i].toLowerCase();
          if (!destSets.has(fromKey)) destSets.set(fromKey, new Set());
          const targets = destSets.get(fromKey)!;
          for (let j = i + 1; j < ordered.length; j++) {
            const toCanonical = cityByKey.get(ordered[j].toLowerCase()) || ordered[j];
            if (toCanonical.toLowerCase() !== fromKey) targets.add(toCanonical);
          }
        }
      }
      const cities = [...cityByKey.values()].sort((a, b) => a.localeCompare(b));
      const destinationsByOrigin: Record<string, string[]> = {};
      for (const [originKey, dests] of destSets.entries()) {
        destinationsByOrigin[originKey] = [...dests];
      }
      ok(res, { cities, destinationsByOrigin });
    }),
  );
  router.get(
    "/counter/trips",
    permit("read"),
    asyncRoute(async (req, res) => {
      const q = z
        .object({
          from: z.string().trim().max(80).default(""),
          to: z.string().trim().max(80).default(""),
          journeyDate: dateOnly,
          page: z.coerce.number().int().min(1).default(1),
          limit: z.coerce.number().int().min(1).max(50).default(20),
        })
        .strict()
        .parse(req.query);
      const routeAnd: any[] = [];
      if (q.from) {
        const re = literalRegex(q.from);
        routeAnd.push({ $or: [{ source: re }, { "viaStops.city": re }] });
      }
      if (q.to) {
        const re = literalRegex(q.to);
        routeAnd.push({ $or: [{ destination: re }, { "viaStops.city": re }] });
      }
      const routeFilter: any = {
        ...tenant(req),
        ...(routeAnd.length ? { $and: routeAnd } : {}),
      };
      const allResolvedRoutes = await resolveAreaRoutes(
        req.auth.operatorId!,
        await M.Route.find(routeFilter).lean(),
      );
      const fromRe = q.from ? literalRegex(q.from) : null;
      const toRe = q.to ? literalRegex(q.to) : null;
      const matchedSegmentsByRoute = new Map<
        string,
        { fromCity: string; toCity: string }
      >();
      const routes = allResolvedRoutes.filter((r: any) => {
        const ordered = [
          r.source,
          ...(Array.isArray(r.viaStops) ? r.viaStops.map((v: any) => v.city) : []),
          r.destination,
        ].filter(Boolean) as string[];
        if (!fromRe && !toRe) return true;
        if (fromRe && toRe) {
          for (let i = 0; i < ordered.length - 1; i++) {
            if (!fromRe.test(ordered[i])) continue;
            for (let j = i + 1; j < ordered.length; j++) {
              if (toRe.test(ordered[j])) {
                matchedSegmentsByRoute.set(String(r._id), {
                  fromCity: ordered[i],
                  toCity: ordered[j],
                });
                return true;
              }
            }
          }
          return false;
        }
        if (fromRe) {
          return ordered.slice(0, -1).some((c) => fromRe.test(c));
        }
        return ordered.slice(1).some((c) => toRe!.test(c));
      });
      const filter = {
        ...tenant(req),
        routeId: { $in: routes.map((r) => r._id) },
        journeyDate: q.journeyDate,
        status: "Scheduled",
      };
      const [trips, total] = await Promise.all([
        M.Trip.find(filter)
          .sort({ departureAt: 1, _id: 1 })
          .skip((q.page - 1) * q.limit)
          .limit(q.limit)
          .lean(),
        M.Trip.countDocuments(filter),
      ]);
      const vehicleIds = trips.map((t) => t.carId || t.busId).filter(Boolean);
      const [buses, cars] = await Promise.all([
        M.Bus.find({
          ...tenant(req),
          _id: { $in: vehicleIds },
        }).lean(),
        M.Car.find({
          ...tenant(req),
          _id: { $in: vehicleIds },
        }).lean(),
      ]);
      const now = new Date();
      ok(
        res,
        trips.map((t) => {
          const route = routes.find((r) => String(r._id) === String(t.routeId));
          const car = cars.find(
            (c) => String(c._id) === String(t.carId || t.busId),
          );
          const bus = buses.find((b) => String(b._id) === String(t.busId));
          const vehicleName = car
            ? `${car.make} ${car.model || car.modelName || ""}`.trim()
            : bus?.name || t.carRegistration || "Car";
          const vehicleReg =
            car?.registrationNumber ||
            car?.registration ||
            t.carRegistration ||
            bus?.registration ||
            "";
          const vehicleType =
            car?.vehicleCategory ||
            car?.category ||
            t.vehicleCategory ||
            bus?.type ||
            "4-Passenger Sedan";

          const seats = t.seats as any[],
            internal = t.inventoryOwner === "internal";
          const routeSegment = matchedSegmentsByRoute.get(String(t.routeId));
          const segFare =
            routeSegment && Array.isArray(t.segmentFares)
              ? (t.segmentFares as any[]).find(
                  (seg) =>
                    String(seg.fromCity || "").trim().toLowerCase() ===
                      routeSegment.fromCity.trim().toLowerCase() &&
                    String(seg.toCity || "").trim().toLowerCase() ===
                      routeSegment.toCity.trim().toLowerCase(),
                )
              : undefined;
          const isSubSegment =
            routeSegment &&
            (routeSegment.fromCity.trim().toLowerCase() !==
              String(route?.source || "").trim().toLowerCase() ||
              routeSegment.toCity.trim().toLowerCase() !==
                String(route?.destination || "").trim().toLowerCase());
          return {
            id: String(t._id),
            routeId: String(t.routeId),
            busId: String(t.busId || t.carId),
            route: `${route?.source} → ${route?.destination}`,
            source: route?.source,
            destination: route?.destination,
            boarding: route?.boarding || [],
            dropping: route?.dropping || [],
            viaLabel: route?.viaLabel || "",
            viaStops: route?.viaStops || [],
            distanceKm: route?.distanceKm ?? null,
            durationMinutes: route?.durationMinutes ?? null,
            segmentFares: t.segmentFares || [],
            ...(routeSegment
              ? {
                  matchedSegment: {
                    fromCity: routeSegment.fromCity,
                    toCity: routeSegment.toCity,
                    ...(segFare ? { farePaise: segFare.farePaise } : {}),
                  },
                }
              : {}),
            busName: vehicleName,
            registration: vehicleReg,
            busType: vehicleType,
            amenities: t.amenities ?? bus?.amenities ?? [],
            tripType: t.tripType,
            journeyDate: t.journeyDate,
            departureAt: t.departureAt,
            arrivalAt: t.arrivalAt,
            bookingOpen:
              t.bookingOpen !== false && new Date(t.departureAt as Date) > now,
            version: t.__v || 0,
            inventoryOwner: t.inventoryOwner,
            totalSeats: internal
              ? seats.filter((s) => !s.isDriver && s.number !== "D").length
              : null,
            availableSeats: internal
              ? seats.filter(
                  (s) =>
                    !s.isDriver &&
                    s.number !== "D" &&
                    (s.state === "available" ||
                      (s.state === "held" && new Date(s.holdUntil) <= now)),
                ).length
              : null,
            bookedSeats: internal
              ? seats.filter((s) => s.state === "booked").length
              : null,
            blockedSeats: internal
              ? seats.filter(
                  (s) =>
                    s.state === "blocked" && !s.isDriver && s.number !== "D",
                ).length
              : null,
            quotaSeats: internal
              ? seats.filter((s) => s.state === "quota").length
              : null,
            baseFarePaise:
              internal && seats.length
                ? isSubSegment && segFare
                  ? segFare.farePaise
                  : Math.min(
                      ...seats
                        .filter((s) => !s.isDriver && s.number !== "D")
                        .map((s) => s.farePaise),
                    )
                : null,
            capabilities: {
              inventory: internal,
              quote: internal,
              confirmation: internal && razorpayEnabled(config),
              payment: internal && razorpayEnabled(config),
              externalAdapter: false,
            },
          };
        }),
        {
          page: q.page,
          limit: q.limit,
          total,
          pages: Math.max(1, Math.ceil(total / q.limit)),
        },
      );
    }),
  );
  router.get(
    "/counter/trips/:id/bookings",
    permit("read"),
    asyncRoute(async (req, res) => {
      const trip = await ownedTrip(req);
      const q = z
        .object({
          source: z.enum(sources).optional(),
          page: z.coerce.number().int().min(1).default(1),
          limit: z.coerce.number().int().min(1).max(50).default(10),
        })
        .strict()
        .parse(req.query);
      const filter = {
        ...tenant(req),
        tripId: trip._id,
        ...(q.source ? { source: q.source } : {}),
      };
      const [rows, total, counts] = await Promise.all([
        M.Booking.find(filter)
          .sort({ createdAt: -1, _id: -1 })
          .skip((q.page - 1) * q.limit)
          .limit(q.limit)
          .lean(),
        M.Booking.countDocuments(filter),
        M.Booking.aggregate([
          {
            $match: {
              operatorId: new mongoose.Types.ObjectId(req.auth.operatorId!),
              tripId: trip._id,
            },
          },
          { $group: { _id: "$source", count: { $sum: 1 } } },
        ]),
      ]);
      const pii = req.auth.permissions.includes("manifest:read");
      ok(
        res,
        {
          bookings: rows.map((r) => ({
            id: String(r._id),
            reference: r.reference,
            pnr: r.pnr || null,
            status: r.status,
            paymentStatus: r.paymentStatus,
            source: r.source,
            totalPaise: r.totalPaise,
            version: r.__v || 0,
            passengers: pii
              ? (r.passengers as any[]).map((p) => ({
                  name: p.name,
                  seat: p.seat,
                  phone: p.phone,
                  email: p.email,
                  age: p.age,
                  gender: p.gender,
                  boarding: p.boarding,
                  dropping: p.dropping,
                }))
              : (r.passengers as any[]).map((p) => ({ seat: p.seat })),
            ...(pii ? { contact: r.contact, gst: r.gst } : {}),
          })),
          sourceCounts: Object.fromEntries(
            sources.map((s) => [
              s,
              counts.find((c) => c._id === s)?.count || 0,
            ]),
          ),
        },
        {
          page: q.page,
          limit: q.limit,
          total,
          pages: Math.max(1, Math.ceil(total / q.limit)),
        },
      );
    }),
  );
  router.get(
    "/pricing-policy",
    permit("read"),
    asyncRoute(async (req, res) =>
      ok(res, await M.PricingPolicy.findOne(tenant(req)).lean()),
    ),
  );
  router.put(
    "/pricing-policy",
    permit("pricing:write"),
    asyncRoute(async (req, res) => {
      if (req.auth.agentId || !["operator_admin", "manager"].includes(req.auth.role))
        return fail(403, "FORBIDDEN", "Only authorized operator staff can edit pricing rules");
      if (req.auth.agentId || !["operator_admin", "manager"].includes(req.auth.role))
        return fail(403, "FORBIDDEN", "Only authorized operator staff can edit pricing rules");
      const { expectedVersion, ...values } = policyInput.parse(req.body);
      let result: any;
      await mongoose.connection.transaction(async (session) => {
        if (expectedVersion === 0) {
          if (await M.PricingPolicy.exists(tenant(req)).session(session))
            fail(
              409,
              "VERSION_CONFLICT",
              "Pricing policy already exists. Reload its latest version.",
            );
          [result] = await M.PricingPolicy.create(
            [{ ...tenant(req), ...values, version: 1 }],
            { session },
          );
        } else {
          result = await M.PricingPolicy.findOneAndUpdate(
            { ...tenant(req), version: expectedVersion },
            { $set: values, $inc: { version: 1 } },
            { session, new: true, runValidators: true },
          );
          if (!result)
            fail(
              409,
              "VERSION_CONFLICT",
              "Pricing policy changed. Reload before saving.",
            );
        }
        await record(req, "pricing-policy.update", String(result._id), session);
        await M.Outbox.create(
          [
            {
              ...tenant(req),
              event: "pricing.updated",
              resourceId: String(result._id),
            },
          ],
          { session },
        );
      });
      ok(res, result);
    }),
  );
  router.post(
    "/trips/:id/quote",
    permit("bookings:write"),
    asyncRoute(async (req, res) => {
      const input = pricingOptions
        .extend({ seats: seatList, holdId: z.string().uuid().optional() })
        .strict()
        .parse(req.body);
      ok(
        res,
        await issueQuote(
          req.auth,
          id.parse(req.params.id),
          input.seats,
          input,
          input.holdId,
        ),
        undefined,
        201,
      );
    }),
  );
  router.patch(
    "/trips/:id/schedule",
    permit("routes:write"),
    asyncRoute(async (req, res) => {
      if (req.auth.agentId || req.auth.role !== "operator_admin")
        return fail(403, "FORBIDDEN", "Only operator admins can reschedule departures");
      const tripId = id.parse(req.params.id);
      const { departureAt, arrivalAt, expectedVersion } = z.object({
        departureAt: z.string().datetime({ offset: true }),
        arrivalAt: z.string().datetime({ offset: true }),
        expectedVersion: z.number().int().nonnegative(),
      }).strict().parse(req.body);
      const departure = new Date(departureAt), arrival = new Date(arrivalAt);
      const journeyDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
      }).format(departure);
      if (departure <= new Date() || arrival <= departure)
        return fail(400, "INVALID_SCHEDULE", "Choose a future departure and an arrival after it");
      const owner = tenant(req);
      const result = await mongoose.connection.transaction(async (session) => {
        const trip = await M.Trip.findOne({ _id: tripId, ...owner }).session(session);
        if (!trip) return fail(404, "NOT_FOUND", "Trip not found");
        internalTrip(trip.toObject(), false);
        if (trip.journeyDate !== journeyDate || !trip.carId)
          return fail(409, "INVALID_SCHEDULE", "Change times on the original journey date for a vehicle departure");
        const vehicle = await M.Car.updateOne({ _id: trip.carId, ...owner, status: "Active" },
          { $inc: { schedulingRevision: 1 } }, { session });
        if (!vehicle.matchedCount) return fail(409, "INACTIVE_RESOURCE", "The assigned vehicle is unavailable");
        if (await M.Booking.exists({ ...owner, tripId }).session(session) ||
            (trip.seats as { state: string }[]).some((seat) => seat.state === "held" || seat.state === "booked"))
          return fail(409, "TRIP_HAS_RESERVATIONS", "This departure has bookings or holds and cannot be rescheduled here");
        if (await M.Trip.exists({
          ...owner, _id: { $ne: tripId }, status: { $ne: "Cancelled" },
          departureAt: { $lt: arrival },
          $and: [
            { $or: [{ carId: trip.carId }, { busId: trip.carId }] },
            { $or: [{ arrivalAt: { $gt: departure } }, { arrivalAt: null, departureAt: { $gte: departure } }] },
          ],
        }).session(session))
          return fail(409, "CAR_SCHEDULE_CONFLICT", "The vehicle has an overlapping departure");
        const updated = await M.Trip.findOneAndUpdate({
          _id: tripId, ...owner, __v: expectedVersion,
          departureAt: { $gt: new Date() }, status: "Scheduled",
        }, { $set: { departureAt: departure, arrivalAt: arrival, estimatedArrivalAt: arrival }, $inc: { __v: 1 } },
        { new: true, session });
        if (!updated) return fail(409, "TRIP_CHANGED", "Refresh the trip and try again");
        await record(req, "trip.schedule.update", tripId, session);
        return { departureAt: updated.departureAt, arrivalAt: updated.arrivalAt, version: updated.__v };
      });
      ok(res, result);
    }),
  );
  router.patch(
    "/trips/:id/amenities",
    permit("routes:write"),
    asyncRoute(async (req, res) => {
      if (req.auth.agentId || req.auth.role !== "operator_admin")
        return fail(403, "FORBIDDEN", "Only operator admins can edit trip amenities");
      const { amenities, expectedVersion } = z.object({
        amenities: tripAmenitiesSchema,
        expectedVersion: z.number().int().nonnegative(),
      }).strict().parse(req.body);
      const tripId = id.parse(req.params.id);
      const result = await mongoose.connection.transaction(async (session) => {
        const trip = await M.Trip.findOneAndUpdate({
          _id: tripId, ...tenant(req), inventoryOwner: "internal",
          status: "Scheduled", departureAt: { $gt: new Date() }, __v: expectedVersion,
        }, { $set: { amenities }, $inc: { __v: 1 } }, { new: true, session });
        if (!trip) return fail(409, "TRIP_CHANGED", "Trip is unavailable or changed. Refresh and try again.");
        await record(req, "trip.amenities.update", tripId, session);
        return { amenities: trip.amenities, version: trip.__v };
      });
      ok(res, result);
    }),
  );
  router.patch(
    "/trips/:id/seat-fares",
    permit("pricing:write"),
    asyncRoute(async (req, res) => {
      if (req.auth.agentId || !["operator_admin", "manager"].includes(req.auth.role))
        return fail(403, "FORBIDDEN", "Only authorized operator staff can edit seat fares");
      const tripId = id.parse(req.params.id);
      const segmentFareSchema = z
        .object({
          fromCity: text,
          toCity: text,
          distanceKm: z.coerce.number().min(0).max(5000).optional(),
          farePaise: amount,
          seatFares: z.record(z.string(), amount).optional(),
        })
        .strict();
      const { seatFares, segmentFares } = z
        .object({
          seatFares: z.record(z.string(), amount).optional(),
          segmentFares: z.array(segmentFareSchema).max(200).optional(),
        })
        .strict()
        .refine(
          (v) =>
            (v.seatFares && Object.keys(v.seatFares).length > 0) ||
            (v.segmentFares && v.segmentFares.length > 0),
          "Provide at least one seat fare or segment fare",
        )
        .parse(req.body);

      const updated = await mongoose.connection.transaction(async (session) => {
        const trip = await M.Trip.findOne({ _id: tripId, ...tenant(req) }).session(session);
        if (!trip) return fail(404, "NOT_FOUND", "Trip not found");
        internalTrip(trip.toObject(), false);
        const tripSeats = trip.seats as {
          number: string;
          isDriver?: boolean;
          isBookable?: boolean;
          category?: string;
          state: string;
          farePaise: number;
        }[];
        const ensurePassengerSeat = (seatNum: string) => {
          const seat = tripSeats.find((item) => item.number === seatNum);
          if (
            !seat ||
            seat.isDriver ||
            seat.isBookable === false ||
            seat.number === "D" ||
            seat.category === "driver"
          ) {
            fail(400, "INVALID_SEAT", `Choose a passenger seat for ${seatNum}`);
          }
          return seat!;
        };
        if (seatFares) {
          for (const [seatNum, fare] of Object.entries(seatFares)) {
            const seat = ensurePassengerSeat(seatNum);
            if (seat.state !== "available")
              return fail(
                409,
                "SEAT_UNAVAILABLE",
                `Seat ${seatNum} is no longer available for repricing`,
              );
            seat.farePaise = fare;
          }
        }
        if (segmentFares) {
          for (const seg of segmentFares) {
            if (seg.seatFares) {
              for (const seatNum of Object.keys(seg.seatFares)) {
                ensurePassengerSeat(seatNum);
              }
            }
          }
          trip.set("segmentFares", segmentFares);
        }
        await trip.save({ session });
        await record(req, "trip.seat_fares.update", tripId, session);
        return {
          seats: trip.seats,
          segmentFares: trip.segmentFares || [],
        };
      });
      ok(res, {
        message: "Seat fares updated successfully",
        seats: updated.seats,
        segmentFares: updated.segmentFares,
      });
    }),
  );
  router.patch(
    "/trips/:id/booking-status",
    permit("routes:write"),
    asyncRoute(async (req, res) => {
      const tripId = id.parse(req.params.id),
        { open, expectedVersion } = z
          .object({
            open: z.boolean(),
            expectedVersion: z.number().int().min(0),
          })
          .strict()
          .parse(req.body);
      let result: any;
      await mongoose.connection.transaction(async (session) => {
        const trip = await M.Trip.findOne({ _id: tripId, ...tenant(req) })
          .session(session)
          .lean();
        internalTrip(trip, false);
        result = await M.Trip.findOneAndUpdate(
          { _id: tripId, ...tenant(req), __v: expectedVersion },
          { $set: { bookingOpen: open }, $inc: { __v: 1 } },
          { session, new: true },
        );
        if (!result)
          fail(
            409,
            "VERSION_CONFLICT",
            "Trip changed. Refresh before changing booking status.",
          );
        await record(
          req,
          open ? "trip.booking.resume" : "trip.booking.stop",
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
      ok(res, { tripId, bookingOpen: result.bookingOpen, version: result.__v });
    }),
  );
  router.post(
    "/trips/:id/quota",
    permit("inventory:write"),
    asyncRoute(async (req, res) => {
      const tripId = id.parse(req.params.id),
        input = z
          .object({
            seats: seatList,
            action: z.enum(["assign", "release"]),
            label: text.optional(),
          })
          .strict()
          .parse(req.body);
      if (input.action === "assign" && !input.label)
        fail(400, "QUOTA_LABEL_REQUIRED", "Name the quota allocation");
      await mongoose.connection.transaction(async (session) => {
        const trip = await M.Trip.findOne({ _id: tripId, ...tenant(req) })
          .session(session)
          .lean();
        internalTrip(trip, false);
        const now = new Date();
        const changed = await M.Trip.updateOne(
          {
            _id: tripId,
            ...tenant(req),
            inventoryOwner: "internal",
            $and: input.seats.map((number) => ({
              seats: {
                $elemMatch: {
                  number,
                  ...(input.action === "release"
                    ? { state: "quota" }
                    : {
                        $or: [
                          { state: "available" },
                          { state: "held", holdUntil: { $lte: now } },
                        ],
                      }),
                },
              },
            })),
          },
          {
            $set: {
              "seats.$[seat].state":
                input.action === "assign" ? "quota" : "available",
              ...(input.action === "assign"
                ? { "seats.$[seat].quotaLabel": input.label }
                : {}),
            },
            $unset: {
              "seats.$[seat].bookingId": 1,
              "seats.$[seat].holdId": 1,
              "seats.$[seat].holdUserId": 1,
              "seats.$[seat].holdUntil": 1,
              ...(input.action === "release"
                ? { "seats.$[seat].quotaLabel": 1 }
                : {}),
            },
          },
          { session, arrayFilters: [{ "seat.number": { $in: input.seats } }] },
        );
        if (changed.modifiedCount !== 1)
          fail(
            409,
            "SEAT_UNAVAILABLE",
            "Quota selection conflicts with current inventory",
          );
        await record(req, `inventory.quota.${input.action}`, tripId, session);
        await M.Outbox.create(
          [
            {
              ...tenant(req),
              event: "seat.availability.changed",
              resourceId: tripId,
            },
          ],
          { session },
        );
      });
      ok(res, { updated: true });
    }),
  );
  router.get(
    "/bookings/:id/payments",
    permit("finance:read"),
    asyncRoute(async (req, res) => {
      const booking = await M.Booking.findOne({
        _id: id.parse(req.params.id),
        ...tenant(req),
      }).lean();
      if (!booking) fail(404, "NOT_FOUND", "Booking not found");
      const payments = await M.Payment.find({
        ...tenant(req),
        bookingId: booking!._id,
      })
        .select(
          "providerId externalId amountPaise currency status confirmedAt createdAt",
        )
        .lean();
      ok(res, {
        bookingId: String(booking!._id),
        paymentStatus: booking!.paymentStatus,
        totalPaise: booking!.totalPaise,
        payments,
        providerConfigured: razorpayEnabled(config),
      });
    }),
  );
  router.patch(
    "/bookings/:id/passengers",
    permit("bookings:write"),
    asyncRoute(async (req, res) => {
      const bookingId = id.parse(req.params.id),
        input = z
          .object({
            passengers: z.array(passengerInput).min(1).max(6),
            contact: contactInput.optional(),
            gst: gstInput.optional(),
            expectedVersion: z.number().int().min(0),
          })
          .strict()
          .parse(req.body);
      let updated: any;
      await mongoose.connection.transaction(async (session) => {
        const booking = await M.Booking.findOne({
          _id: bookingId,
          ...tenant(req),
        })
          .session(session)
          .lean();
        if (!booking) fail(404, "NOT_FOUND", "Booking not found");
        if (!["Pending payment", "Confirmed"].includes(String(booking!.status)))
          fail(409, "BOOKING_CLOSED", "This booking cannot be modified");
        const trip = await M.Trip.findOne({
          _id: booking!.tripId,
          ...tenant(req),
        })
          .session(session)
          .lean();
        internalTrip(trip, false);
        if (booking!.providerId) requireCapability("book");
        const existing = booking!.passengers as any[];
        if (
          existing
            .map((p) => p.seat)
            .sort()
            .join("|") !==
            input.passengers
              .map((p) => p.seat)
              .sort()
              .join("|") ||
          new Set(input.passengers.map((p) => p.seat)).size !== existing.length
        )
          fail(
            400,
            "SEAT_CHANGE_FORBIDDEN",
            "Passenger modification cannot change booked seats",
          );
        const pricing =
          (booking!.pricingSnapshot as any) ||
          (await priceTrip(
            req.auth,
            trip,
            existing.map((p) => p.seat),
            {},
            session,
          ));
        await validatePassengers(
          req.auth,
          trip,
          input.passengers,
          pricing,
          input.contact,
          input.gst,
          session,
        );
        const passengers = input.passengers.map((p) => ({
          ...p,
          checkedInAt: existing.find((old) => old.seat === p.seat)?.checkedInAt,
          checkedInBy: existing.find((old) => old.seat === p.seat)?.checkedInBy,
        }));
        updated = await M.Booking.findOneAndUpdate(
          { _id: bookingId, ...tenant(req), __v: input.expectedVersion },
          {
            $set: {
              passengers,
              ...(input.contact ? { contact: input.contact } : {}),
              ...(input.gst ? { gst: input.gst } : {}),
            },
            $inc: { __v: 1 },
          },
          { new: true, session, runValidators: true },
        );
        if (!updated)
          fail(
            409,
            "VERSION_CONFLICT",
            "Booking changed. Reload before modifying it.",
          );
        await record(req, "booking.passengers.modify", bookingId, session);
        await M.Outbox.create(
          [{ ...tenant(req), event: "booking.updated", resourceId: bookingId }],
          { session },
        );
      });
      ok(res, { id: bookingId, version: updated.__v, status: updated.status });
    }),
  );
  router.post(
    "/bookings/:id/cancel-pending",
    permit("bookings:write"),
    asyncRoute(async (req, res) => {
      const bookingId = id.parse(req.params.id);
      const { reason } = z.object({ reason: text }).strict().parse(req.body);
      await mongoose.connection.transaction(async (session) => {
        const booking = await M.Booking.findOne({
          _id: bookingId,
          ...tenant(req),
        }).session(session);
        if (!booking) fail(404, "NOT_FOUND", "Booking not found");
        if (booking!.status === "Cancelled") return;
        if (
          booking!.status !== "Pending payment" ||
          booking!.paymentStatus !== "Pending"
        )
          fail(
            409,
            "CANCELLATION_REQUIRES_REVIEW",
            "Paid or confirmed bookings require the cancellation/refund workflow",
          );
        const trip = await M.Trip.findOne({
          _id: booking!.tripId,
          ...tenant(req),
        })
          .session(session)
          .lean();
        if (trip?.inventoryOwner !== "internal") requireCapability("cancel");
        booking!.status = "Cancelled";
        await booking!.save({ session });
        await M.Hold.updateOne(
          { ...tenant(req), holdId: booking!.holdId },
          { $set: { status: "released" } },
          { session },
        );
        await M.Trip.updateOne(
          { _id: booking!.tripId, ...tenant(req) },
          {
            $set: { "seats.$[seat].state": "available" },
            $unset: {
              "seats.$[seat].bookingId": 1,
              "seats.$[seat].holdId": 1,
              "seats.$[seat].holdUserId": 1,
              "seats.$[seat].holdUntil": 1,
            },
          },
          {
            session,
            arrayFilters: [
              {
                "seat.bookingId": booking!._id,
                "seat.holdId": booking!.holdId,
                "seat.holdUserId": booking!.userId,
                "seat.state": "held",
              },
            ],
          },
        );
        await M.Audit.create(
          [
            {
              ...tenant(req),
              actorId: req.auth.userId,
              action: "booking.pending.cancel",
              resourceId: bookingId,
              requestId: req.requestId,
              metadata: { reason },
            },
          ],
          { session },
        );
        await M.Outbox.create(
          [
            {
              ...tenant(req),
              event: "booking.cancelled",
              resourceId: bookingId,
            },
            {
              ...tenant(req),
              event: "seat.availability.changed",
              resourceId: String(booking!.tripId),
            },
          ],
          { session, ordered: true },
        );
      });
      ok(res, { bookingId, status: "Cancelled", refundCompleted: false });
    }),
  );
  router.get(
    "/bookings/:id/ticket.html",
    permit("manifest:read"),
    asyncRoute(async (req, res) => {
      const booking = await M.Booking.findOne({
        _id: id.parse(req.params.id),
        ...tenant(req),
        status: "Confirmed",
        paymentStatus: "Paid",
      }).lean();
      if (!booking)
        fail(
          409,
          "TICKET_NOT_CONFIRMED",
          "Only confirmed bookings have a printable ticket",
        );
      const ticket = await M.Ticket.findOne({
        ...tenant(req),
        bookingId: booking!._id,
        status: "valid",
      }).lean();
      if (!ticket || !booking!.pnr)
        fail(
          409,
          "TICKET_NOT_CONFIRMED",
          "A valid authoritative ticket has not been issued",
        );
      const trip = await M.Trip.findOne({
          _id: booking!.tripId,
          ...tenant(req),
        }).lean(),
        route = trip
          ? await M.Route.findOne({ _id: trip.routeId, ...tenant(req) }).lean()
          : null;
      const company = await M.Operator.findOne({
        _id: req.auth.operatorId,
      }).lean();
      res.setHeader("Cache-Control", "no-store");
      res.type("html").send(ticketHtml(booking!, trip, route, company));
    }),
  );
  return router;
}
function escape(value: unknown) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
function ticketHtml(booking: any, trip: any, route: any, company: any) {
  const currency = (n: number) =>
    `INR ${(n / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Aibus ticket ${escape(booking.pnr)}</title><style>body{font:14px Arial,sans-serif;color:#203e48;max-width:800px;margin:40px auto;padding:24px}header{display:flex;justify-content:space-between;border-bottom:3px solid #146c74;padding-bottom:20px}.brand{font-size:32px;color:#146c74;font-weight:bold}h1{font-size:24px}table{border-collapse:collapse;width:100%;margin:25px 0}th,td{text-align:left;padding:12px;border-bottom:1px solid #e4ebee}small{color:#647b86}.summary{background:#f3f7f7;padding:20px;line-height:1.9}@media print{body{margin:0;padding:20px}}</style></head><body><header><span class="brand">aibus</span><div><strong>CONFIRMED E-TICKET</strong><br>PNR ${escape(booking.pnr)}</div></header><h1>${escape(route?.source)} → ${escape(route?.destination)}</h1><p>${escape(company?.company)} · ${escape(trip?.journeyDate)}</p><p>Departure ${escape(trip?.departureAt ? new Date(trip.departureAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "")} IST</p><table><thead><tr><th>Passenger</th><th>Seat</th><th>Boarding</th><th>Dropping</th></tr></thead><tbody>${(booking.passengers || []).map((p: any) => `<tr><td>${escape(p.name)}</td><td>${escape(p.seat)}</td><td>${escape(p.boarding)}</td><td>${escape(p.dropping)}</td></tr>`).join("")}</tbody></table><div class="summary">Reference: ${escape(booking.reference)}<br>Base fare: ${currency(booking.grossPaise)}<br>Discount: ${currency(booking.discountPaise || 0)}<br>Tax: ${currency(booking.taxPaise || 0)}<br>Additional charges: ${currency(booking.chargePaise || 0)}<br><strong>Total paid: ${currency(booking.totalPaise)}</strong><br>Payment status: ${escape(booking.paymentStatus)}</div><p><small>Issued by the authoritative reservation system. Carry valid identification for your journey.</small></p></body></html>`;
}
