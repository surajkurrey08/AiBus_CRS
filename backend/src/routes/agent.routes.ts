import { Router, type Request } from "express";
import { z } from "zod";
import type { Config } from "../config/env.js";
import * as M from "../models/index.js";
import {
  asyncRoute,
  dateOnly,
  fail,
  id,
  literalRegex,
  ok,
  text,
} from "../utils/core.js";
import {
  agentPerformance,
  agencyBookingScope,
  authorizeAgent,
} from "../services/agent.service.js";
import { getAgentDailySettlements } from "../services/agent-settlement.service.js";
import type { AgentCapability } from "../types/agent.js";
import {
  createBooking,
  createHold,
  releaseHold,
  passengerInput,
  seatList,
} from "../services/inventory.service.js";
import {
  contactInput,
  gstInput,
  issueQuote,
} from "../services/pricing.service.js";
import { paymentRouter } from "./payment.routes.js";
import { requestCancellation } from "../services/cancellation.service.js";
import {
  agentCities,
  agentDashboard,
  agentBookingTotals,
  ticketJourney,
} from "../services/agent-dashboard.service.js";
import {
  agentBookingQuery,
  agentPeriod,
  createdDuring,
  indiaToday,
} from "../validators/agent-dashboard.schemas.js";
import { resolveAreaRoutes } from "../services/area-master.service.js";
const requireCapability = (capability: AgentCapability) =>
  asyncRoute(async (req, _res, next) => {
    await authorizeAgent(req.auth, capability);
    next();
  });
async function ownedBooking(req: Request) {
  const booking: any = await M.Booking.findOne({
    _id: id.parse(req.params.id),
    ...agencyBookingScope(req.auth.operatorId!, req.auth.agentId!),
  }).lean();
  if (!booking) fail(404, "NOT_FOUND", "Booking not found");
  return booking;
}
async function ownedTrip(req: Request) {
  const trip: any = await M.Trip.findOne({
    _id: id.parse(req.params.id),
    operatorId: req.auth.operatorId,
    inventoryOwner: "internal",
  }).lean();
  if (!trip) fail(404, "NOT_FOUND", "Trip not found");
  await authorizeAgent(req.auth, "inventory", undefined, trip);
  return trip;
}
const publicSeats = (seats: any[]) =>
  seats.map((s) => ({
    number: s.number,
    deck: s.deck,
    row: s.row,
    column: s.column,
    category: s.category,
    farePaise: s.farePaise,
    state:
      s.state === "held" && new Date(s.holdUntil) <= new Date()
        ? "available"
        : s.state,
  }));
export function agentRouter(config: Config) {
  const router = Router();
  router.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!req.auth.agentId || req.auth.role !== "agent")
      fail(403, "AGENT_REQUIRED", "An agent account is required");
    next();
  });
  router.get(
    "/dashboard",
    requireCapability("bookings"),
    asyncRoute(async (req, res) => {
      const { date } = z
        .object({ date: dateOnly.default(indiaToday()) })
        .strict()
        .parse(req.query);
      ok(res, await agentDashboard(req.auth, date));
    }),
  );
  router.get(
    "/cities",
    requireCapability("search"),
    asyncRoute(async (req, res) => {
      const q = z
        .object({
          search: z.string().trim().max(80).default(""),
          page: z.coerce.number().int().min(1).max(100000).default(1),
          limit: z.coerce.number().int().min(1).max(100).default(25),
        })
        .strict()
        .parse(req.query);
      const result = await agentCities(req.auth, q.search, q.page, q.limit);
      ok(res, result.cities, {
        page: q.page,
        limit: q.limit,
        total: result.total,
        pages: Math.max(1, Math.ceil(result.total / q.limit)),
      });
    }),
  );
  router.get(
    "/me",
    asyncRoute(async (req, res) => {
      const agency = await M.SalesPartner.findOne({
        _id: req.auth.agentId,
        operatorId: req.auth.operatorId,
        kind: "Agent",
      }).lean();
      if (!agency) fail(404, "NOT_FOUND", "Agent not found");
      // Account membership is private; agent self-service does not enumerate staff users.
      ok(res, {
        id: String(agency!._id),
        name: agency!.name,
        status: agency!.status,
        permissions: agency!.permissions,
        ...((agency!.permissions as string[]).includes("commissions")
          ? {
              commissionType: agency!.commissionType,
              commissionRate: agency!.commissionRate,
            }
          : {}),
      });
    }),
  );
  router.get(
    "/trips",
    requireCapability("search"),
    asyncRoute(async (req, res) => {
      const q = z
        .object({
          from: z.string().trim().min(1).max(80),
          to: z.string().trim().min(1).max(80),
          journeyDate: dateOnly,
          page: z.coerce.number().int().min(1).default(1),
          limit: z.coerce.number().int().min(1).max(50).default(20),
        })
        .strict()
        .parse(req.query);
      const agency = await authorizeAgent(req.auth, "search");
      const routes: any[] = await resolveAreaRoutes(
        req.auth.operatorId!,
        await M.Route.find({
          operatorId: req.auth.operatorId,
          source: literalRegex(q.from),
          destination: literalRegex(q.to),
          status: "Active",
        }).lean(),
      );
      const filter = {
        operatorId: req.auth.operatorId,
        routeId: { $in: routes.map((r) => r._id) },
        journeyDate: q.journeyDate,
        status: "Scheduled",
        bookingOpen: { $ne: false },
        inventoryOwner: "internal",
        departureAt: { $gt: new Date() },
        ...(agency.allowedBusIds?.length
          ? { busId: { $in: agency.allowedBusIds } }
          : {}),
      };
      const [trips, total] = await Promise.all([
        M.Trip.find(filter)
          .sort({ departureAt: 1, _id: 1 })
          .skip((q.page - 1) * q.limit)
          .limit(q.limit)
          .lean(),
        M.Trip.countDocuments(filter),
      ]);
      ok(
        res,
        trips.map((t: any) => ({
          id: String(t._id),
          busId: t.busId,
          journeyDate: t.journeyDate,
          departureAt: t.departureAt,
          arrivalAt: t.arrivalAt,
          route: routes.find((r) => String(r._id) === String(t.routeId)),
          availableSeats: publicSeats(t.seats).filter(
            (s) => s.state === "available",
          ).length,
        })),
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
    "/trips/:id/cancellation-policy",
    requireCapability("inventory"),
    asyncRoute(async (req, res) => {
      await ownedTrip(req);
      const policy = await M.Policy.findOne({
        operatorId: req.auth.operatorId,
      }).lean();
      ok(res, {
        available: !!policy,
        version: policy?.version,
        rules: policy?.rules || [],
        refundExecutionAvailable: false,
        timezone: "Asia/Kolkata",
      });
    }),
  );
  router.get(
    "/trips/:id/seats",
    requireCapability("inventory"),
    asyncRoute(async (req, res) => {
      const trip = await ownedTrip(req);
      ok(res, { tripId: String(trip._id), seats: publicSeats(trip.seats) });
    }),
  );
  router.post(
    "/trips/:id/holds",
    requireCapability("book"),
    asyncRoute(async (req, res) => {
      const { seats } = z.object({ seats: seatList }).strict().parse(req.body);
      ok(
        res,
        await createHold(req.auth, id.parse(req.params.id), seats),
        undefined,
        201,
      );
    }),
  );
  router.delete(
    "/trips/:id/holds/:holdId",
    requireCapability("book"),
    asyncRoute(async (req, res) => {
      await releaseHold(
        req.auth,
        id.parse(req.params.id),
        z.string().uuid().parse(req.params.holdId),
      );
      ok(res, { released: true });
    }),
  );
  router.post(
    "/trips/:id/quote",
    requireCapability("book"),
    asyncRoute(async (req, res) => {
      const input = z
        .object({
          seats: seatList,
          holdId: z.string().uuid().optional(),
          promoCode: z
            .string()
            .regex(/^[A-Z\d_-]{3,24}$/)
            .optional(),
        })
        .strict()
        .parse(req.body);
      await ownedTrip(req);
      ok(
        res,
        await issueQuote(
          req.auth,
          id.parse(req.params.id),
          input.seats,
          { promoCode: input.promoCode },
          input.holdId,
        ),
        undefined,
        201,
      );
    }),
  );
  router.post(
    "/bookings",
    requireCapability("book"),
    asyncRoute(async (req, res) => {
      const input = z
        .object({
          tripId: id,
          holdId: z.string().uuid(),
          passengers: z.array(passengerInput).min(1).max(6),
          quoteId: id.optional(),
          contact: contactInput.optional(),
          gst: gstInput.optional(),
          promoCode: z
            .string()
            .regex(/^[A-Z\d_-]{3,24}$/)
            .optional(),
        })
        .strict()
        .parse(req.body);
      const booking: any = await createBooking(
        req.auth,
        input,
        z.string().min(16).max(100).parse(req.get("Idempotency-Key")),
        "agent",
      );
      ok(
        res,
        {
          id: String(booking._id),
          reference: booking.reference,
          pnr: booking.pnr,
          agentId: booking.agentId,
          source: booking.source,
          createdByUserId: booking.createdByUserId,
          tripId: booking.tripId,
          passengers: booking.passengers,
          totalPaise: booking.totalPaise,
          status: booking.status,
          paymentStatus: booking.paymentStatus,
        },
        undefined,
        201,
      );
    }),
  );
  router.use(paymentRouter(config));
  router.get(
    "/bookings",
    requireCapability("bookings"),
    asyncRoute(async (req, res) => {
      const p = agentBookingQuery.parse(req.query),
        filter = {
          ...agencyBookingScope(req.auth.operatorId!, req.auth.agentId!),
          ...createdDuring(p),
          ...(p.status ? { status: p.status } : {}),
          ...(p.paymentStatus ? { paymentStatus: p.paymentStatus } : {}),
          ...(p.search
            ? {
                $and: [
                  {
                    $or: [
                      { reference: literalRegex(p.search) },
                      { pnr: literalRegex(p.search) },
                    ],
                  },
                ],
              }
            : {}),
        };
      const [bookings, total] = await Promise.all([
        M.Booking.find(filter)
          .sort({ createdAt: -1, _id: -1 })
          .skip((p.page - 1) * p.limit)
          .limit(p.limit)
          .lean(),
        M.Booking.countDocuments(filter),
      ]);
      // Booking passengers belong to this agency; internal authentication/idempotency fields are omitted.
      ok(
        res,
        bookings.map((b: any) => ({
          id: b._id,
          reference: b.reference,
          pnr: b.pnr,
          tripId: b.tripId,
          passengers: b.passengers,
          totalPaise: b.totalPaise,
          status: b.status,
          paymentStatus: b.paymentStatus,
          createdAt: b.createdAt,
        })),
        {
          page: p.page,
          limit: p.limit,
          total,
          pages: Math.max(1, Math.ceil(total / p.limit)),
        },
      );
    }),
  );
  router.get(
    "/bookings/:id",
    requireCapability("bookings"),
    asyncRoute(async (req, res) => {
      const b = await ownedBooking(req);
      ok(res, {
        id: b._id,
        reference: b.reference,
        pnr: b.pnr,
        tripId: b.tripId,
        passengers: b.passengers,
        contact: b.contact,
        status: b.status,
        paymentStatus: b.paymentStatus,
        totalPaise: b.totalPaise,
        createdAt: b.createdAt,
        pricing: {
          currency: "INR",
          grossPaise: b.grossPaise,
          discountPaise: b.discountPaise,
          taxPaise: b.taxPaise,
          chargePaise: b.chargePaise,
          totalPaise: b.totalPaise,
        },
      });
    }),
  );
  router.get(
    "/bookings/:id/ticket",
    requireCapability("tickets"),
    asyncRoute(async (req, res) => {
      const booking = await ownedBooking(req);
      const ticket = await M.Ticket.findOne({
        operatorId: req.auth.operatorId,
        bookingId: booking._id,
        status: "valid",
      }).lean();
      if (booking.status !== "Confirmed" || !booking.pnr || !ticket)
        fail(
          409,
          "TICKET_NOT_CONFIRMED",
          "Ticket is available after confirmed payment",
        );
      ok(res, {
        ticket,
        journey: await ticketJourney(req.auth.operatorId!, booking),
        booking: {
          reference: booking.reference,
          pnr: booking.pnr,
          passengers: booking.passengers,
          totalPaise: booking.totalPaise,
        },
      });
    }),
  );
  router.post(
    "/bookings/:id/cancellation",
    requireCapability("cancel"),
    asyncRoute(async (req, res) => {
      const { reason } = z.object({ reason: text }).strict().parse(req.body);
      ok(
        res,
        await requestCancellation(
          req.auth,
          id.parse(req.params.id),
          reason,
          req.requestId,
        ),
        undefined,
        201,
      );
    }),
  );
  router.get(
    "/bookings/:id/cancellation",
    requireCapability("cancel"),
    asyncRoute(async (req, res) => {
      const booking = await ownedBooking(req);
      const [cancellation, refund] = await Promise.all([
        M.Cancellation.findOne({
          operatorId: req.auth.operatorId,
          bookingId: booking._id,
        }).lean(),
        M.Refund.findOne({
          operatorId: req.auth.operatorId,
          bookingId: booking._id,
        }).lean(),
      ]);
      ok(res, {
        bookingId: String(booking._id),
        cancellation: cancellation
          ? {
              id: String(cancellation._id),
              status: cancellation.status,
              refundPaise: cancellation.refundPaise,
              policySnapshot: cancellation.policySnapshot,
            }
          : null,
        refund: refund
          ? {
              status: refund.status,
              amountPaise: refund.amountPaise,
              completed: refund.status === "Refunded",
            }
          : null,
        refundExecutionAvailable: false,
      });
    }),
  );
  router.get(
    "/commissions",
    requireCapability("commissions"),
    asyncRoute(async (req, res) => {
      const report = await agentPerformance(
        req.auth.operatorId!,
        req.auth.agentId,
      );
      const period = agentPeriod.parse(req.query);
      ok(res, {
        ...report.agents[0],
        ...(await agentBookingTotals(req.auth, period)),
      });
    }),
  );
  router.get(
    "/settlements",
    requireCapability("settlements"),
    asyncRoute(async (req, res) => {
      const q = agentBookingQuery.parse(req.query);
      const filter = { operatorId: req.auth.operatorId!, agentId: req.auth.agentId!, workflowVersion: 1, ...createdDuring(q) };
      const rows = await M.Settlement.find(filter).select("externalId kind workflowStatus netPaise currency mode periodFrom periodTo settledAt").sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean();
      ok(res, { available: true, settlements: rows, livePayoutAvailable: false }, { page: q.page, limit: q.limit, total: await M.Settlement.countDocuments(filter) });
    }),
  );
  router.get(
    "/daily-settlements",
    asyncRoute(async (req, res) => {
      if (!req.auth.agentId) {
        fail(403, "AGENT_REQUIRED", "Agent session required");
      }
      const settlements = await getAgentDailySettlements(
        req.auth.operatorId!,
        req.auth.agentId!,
      );
      ok(res, { settlements });
    }),
  );
  return router;
}
