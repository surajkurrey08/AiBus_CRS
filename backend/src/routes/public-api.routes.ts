import { Router } from "express";
import { z } from "zod";
import * as M from "../models/index.js";
import * as P from "../models/public-api.model.js";
import type { Config } from "../config/env.js";
import { asyncRoute, dateOnly, ok, fail } from "../utils/core.js";
import { rateLimit, type Limiter } from "../middleware/auth.middleware.js";
import {
  authenticatePartner,
  partnerFromToken,
  publicIndexesReady,
  requirePublicScope,
  sandboxReady,
  type PartnerIdentity,
} from "../services/public-auth.service.js";
import {
  authorizedTrip,
  authorizedTrips,
  publicTrip,
  resourceId,
  internalResource,
  partnerCommand,
} from "../services/public-inventory.service.js";
import {
  publicHold,
  createPublicBooking,
  ownedPublicBooking,
  bookingView,
} from "../services/public-booking.service.js";
import { passengerInput, seatList } from "../services/inventory.service.js";
import { issueQuote, contactInput } from "../services/pricing.service.js";
import {
  quoteCancellation,
  refundStatus,
} from "../services/refund-workflow.service.js";
import { requestCancellation } from "../services/cancellation.service.js";
import {
  startRazorpayPayment,
  verifyRazorpayPayment,
  reconcileRazorpayPayment,
} from "../services/razorpay.service.js";
import { razorpayEnabled } from "../integrations/razorpay.js";
import { createHash } from "node:crypto";
import { publicApiSpec } from "../docs/public-api.openapi.js";
const pid = z.string().regex(/^[a-z]+_[A-Za-z0-9_-]{16,100}$/),
  requestKey = z
    .string()
    .min(16)
    .max(100)
    .regex(/^[A-Za-z0-9_.:-]+$/);
const page = z.coerce.number().int().min(1).max(10000).default(1),
  limit = z.coerce.number().int().min(1).max(100).default(25);
type PartnerRequest = { publicIdentity: PartnerIdentity };
export function publicApiRouter(config: Config, limiter: Limiter) {
  const router = Router();
  router.get("/openapi.json", (_req, res) => res.json(publicApiSpec));
  router.use(
    asyncRoute(async (req, res, next) => {
      sandboxReady(config);
      if (req.headers.origin || req.headers.cookie)
        fail(
          403,
          "SERVER_TO_SERVER_ONLY",
          "Public credentials are for server-to-server use only",
        );
      res.set("Cache-Control", "no-store");
      await publicIndexesReady();
      next();
    }),
  );
  router.post(
    "/auth/token",
    rateLimit(limiter, "public-auth", 20, 60),
    asyncRoute(async (req, res) => {
      z.object({}).strict().parse(req.body);
      ok(
        res,
        await authenticatePartner(
          config,
          (req.get("Authorization") || "").replace(/^Bearer /, ""),
        ),
      );
    }),
  );
  router.use(
    asyncRoute(async (req, res, next) => {
      const identity = await partnerFromToken(
        config,
        (req.get("Authorization") || "").replace(/^Bearer /, ""),
      );
      (req as any as PartnerRequest).publicIdentity = identity;
      const start = performance.now();
      res.once("finish", () => {
        void P.PartnerApiUsage.create({
          partnerId: identity.partnerId,
          credentialId: identity.credentialId,
          requestId: req.requestId,
          operation: req.method + " " + (req.route?.path || "unmatched"),
          status: res.statusCode,
          durationMs: Math.round(performance.now() - start),
        }).catch(() => {
          /* Operational logs already retain request IDs; never log credentials or bodies. */
        });
      });
      const policy = await P.ApiPartner.findById(identity.partnerId).select("requestsPerMinute").lean();
      if (
        !(await limiter.check("public-partner:" + identity.partnerId, policy?.requestsPerMinute || 120, 60))
      )
        fail(429, "PARTNER_RATE_LIMIT", "Partner rate limit exceeded");
      next();
    }),
  );
  const auth = (req: any, scope?: string) => {
    const value = req.publicIdentity as PartnerIdentity;
    if (scope) requirePublicScope(value, scope);
    return value;
  };
  const empty = (q: unknown) => z.object({}).strict().parse(q);
  router.get(
    "/capabilities",
    asyncRoute(async (req, res) => {
      empty(req.query);
      ok(res, {
        version: "1",
        environment: "sandbox",
        inventory: true,
        holds: true,
        funding: razorpayEnabled(config)
          ? "Razorpay Test Mode; no real money"
          : "Razorpay Test Mode is not configured",
        paymentMode: razorpayEnabled(config) ? "razorpay_test" : "unavailable",
        livePayments: false,
        liveRefunds: false,
        testRefunds:
          config.FINANCE_TEST_MODE &&
          config.NODE_ENV !== "production" &&
          razorpayEnabled(config),
        liveTicketIssuance: false,
        productionCredentials: false,
        reschedule: false,
        partnerWallet: false,
        cancellation:
          "Full booking request, policy-dependent; no automatic refund",
        webhooks:
          "Signed sandbox delivery to server-allowlisted HTTPS destinations",
      });
    }),
  );
  router.get(
    "/cities",
    asyncRoute(async (req, res) => {
      const identity = auth(req, "inventory:read"),
        q = z.object({ page, limit }).strict().parse(req.query),
        trips = await authorizedTrips(identity);
      const cities = [
        ...new Map(
          trips
            .flatMap((t) => [t.route.from, t.route.to])
            .map((c) => [c.id, { ...c, CityId: c.id, City: c.name }]),
        ).values(),
      ].sort((a, b) => a.name.localeCompare(b.name));
      res.json({ success: true, data: cities.slice((q.page - 1) * q.limit, q.page * q.limit), meta: {
        page: q.page,
        limit: q.limit,
        total: cities.length,
      } });
    }),
  );
  router.get(
    "/trips",
    asyncRoute(async (req, res) => {
      const identity = auth(req, "inventory:read"),
        q = z
          .object({ from: pid, to: pid, journeyDate: dateOnly, page, limit })
          .strict()
          .parse(req.query);
      const trips = (await authorizedTrips(identity, q.journeyDate)).filter(
        (t) => t.route.from.id === q.from && t.route.to.id === q.to,
      );
      ok(res, trips.slice((q.page - 1) * q.limit, q.page * q.limit), {
        page: q.page,
        limit: q.limit,
        total: trips.length,
      });
    }),
  );
  router.get(
    "/trips/:id",
    asyncRoute(async (req, res) => {
      empty(req.query);
      ok(
        res,
        await publicTrip(auth(req, "inventory:read"), pid.parse(req.params.id)),
      );
    }),
  );
  router.get(
    "/trips/:id/seats",
    asyncRoute(async (req, res) => {
      empty(req.query);
      const identity = auth(req, "inventory:read"),
        { trip } = await authorizedTrip(identity, pid.parse(req.params.id)),
        now = new Date();
      ok(res, {
        tripId: req.params.id,
        seats: trip.seats.map((s: any) => ({
          number: s.number,
          deck: s.deck,
          row: s.row,
          column: s.column,
          category: s.category,
          baseFarePaise: s.farePaise,
          state:
            s.state === "held" && new Date(s.holdUntil) <= now
              ? "available"
              : s.state,
          ownedHold:
            s.state === "held" &&
            String(s.holdUserId) === identity.partnerId &&
            new Date(s.holdUntil) > now,
        })),
        currency: "INR",
      });
    }),
  );
  router.get(
    "/trips/:id/stops",
    asyncRoute(async (req, res) => {
      empty(req.query);
      const { route } = await authorizedTrip(
          auth(req, "inventory:read"),
          pid.parse(req.params.id),
        ),
        stops = (rows: any[]) =>
          rows.map((s) => ({
            name: s.name,
            time: s.time || null,
            address: s.address || null,
          }));
      ok(res, {
        boarding: stops(route.boarding),
        dropping: stops(route.dropping),
        timeZone: "Asia/Kolkata",
      });
    }),
  );
  router.get(
    "/trips/:id/cancellation-policy",
    asyncRoute(async (req, res) => {
      empty(req.query);
      const { trip } = await authorizedTrip(
          auth(req, "inventory:read"),
          pid.parse(req.params.id),
        ),
        policy: any = await M.Policy.findOne({ operatorId: trip.operatorId })
          .select("version rules")
          .lean();
      ok(res, {
        configured: !!policy,
        version: policy?.version || null,
        rules:
          policy?.rules.map((r: any) => ({
            hoursBefore: r.hoursBefore,
            refundPercent: r.refundPercent,
          })) || [],
        partialSupported: false,
        eligibility:
          "Server checks current policy, departure cutoff, payment and accounting evidence for each booking",
      });
    }),
  );
  router.post(
    "/trips/:id/quotes",
    asyncRoute(async (req, res) => {
      const identity = auth(req, "inventory:read"),
        input = z
          .object({ seats: seatList, holdId: pid.optional() })
          .strict()
          .parse(req.body),
        { trip, auth: principal } = await authorizedTrip(
          identity,
          pid.parse(req.params.id),
        ),
        quote = await issueQuote(
          principal,
          String(trip._id),
          input.seats,
          {},
          input.holdId,
        );
      const { pricing } = quote;
      ok(res, {
        id: await resourceId("quote", quote.quoteId),
        holdId: quote.holdId || null,
        expiresAt: quote.expiresAt,
        seatFares: pricing.seatFares,
        grossPaise: pricing.grossPaise,
        discountPaise: pricing.discountPaise,
        taxPaise: pricing.taxPaise,
        chargePaise: pricing.chargePaise,
        totalPaise: pricing.totalPaise,
        currency: "INR",
        requirements: pricing.requirements,
        binding: input.holdId
          ? "Hold-bound booking quote"
          : "Recheck with holdId after holding seats before creating a booking",
      });
    }),
  );
  router.post(
    "/trips/:id/holds",
    asyncRoute(async (req, res) => {
      const identity = auth(req, "holds:write"),
        input = z.object({ seats: seatList }).strict().parse(req.body);
      ok(
        res,
        await publicHold(
          identity,
          pid.parse(req.params.id),
          input.seats,
          requestKey.parse(req.get("Idempotency-Key")),
        ),
        undefined,
        201,
      );
    }),
  );
  router.post(
    "/bookings",
    asyncRoute(async (req, res) => {
      const input = z
        .object({
          tripId: pid,
          holdId: pid,
          quoteId: pid,
          partnerReference: z
            .string()
            .min(1)
            .max(80)
            .regex(/^[A-Za-z0-9_.:-]+$/),
          passengers: z.array(passengerInput).min(1).max(6),
          contact: contactInput.optional(),
        })
        .strict()
        .parse(req.body);
      ok(
        res,
        await createPublicBooking(
          auth(req, "bookings:write"),
          input,
          requestKey.parse(req.get("Idempotency-Key")),
        ),
        undefined,
        201,
      );
    }),
  );
  router.post(
    "/bookings/:id/payment",
    asyncRoute(async (req, res) => {
      empty(req.body);
      const identity = auth(req, "bookings:write"),
        id = pid.parse(req.params.id),
        key = requestKey.parse(req.get("Idempotency-Key")),
        { auth: principal, booking } = await ownedPublicBooking(identity, id);
      await partnerCommand(
        identity,
        key,
        "payment-start",
        createHash("sha256").update(JSON.stringify({ id })).digest("hex"),
      );
      ok(
        res,
        await startRazorpayPayment(config, principal, String(booking._id)),
      );
    }),
  );
  router.post(
    "/bookings/:id/payment/verify",
    asyncRoute(async (req, res) => {
      const input = z
          .object({
            razorpay_order_id: z.string().regex(/^order_[A-Za-z0-9]+$/),
            razorpay_payment_id: z.string().regex(/^pay_[A-Za-z0-9]+$/),
            razorpay_signature: z.string().regex(/^[a-fA-F0-9]{64}$/),
          })
          .strict()
          .parse(req.body),
        identity = auth(req, "bookings:write"),
        id = pid.parse(req.params.id),
        key = requestKey.parse(req.get("Idempotency-Key")),
        { auth: principal, booking } = await ownedPublicBooking(identity, id);
      await partnerCommand(
        identity,
        key,
        "payment-verify",
        createHash("sha256")
          .update(JSON.stringify({ id, input }))
          .digest("hex"),
      );
      await verifyRazorpayPayment(
        config,
        principal,
        String(booking._id),
        input,
      );
      ok(res, await bookingView(identity, id));
    }),
  );
  router.post(
    "/bookings/:id/payment/reconcile",
    asyncRoute(async (req, res) => {
      empty(req.body);
      const identity = auth(req, "bookings:write"),
        id = pid.parse(req.params.id),
        key = requestKey.parse(req.get("Idempotency-Key")),
        { auth: principal, booking } = await ownedPublicBooking(identity, id);
      await partnerCommand(
        identity,
        key,
        "payment-reconcile",
        createHash("sha256").update(JSON.stringify({ id })).digest("hex"),
      );
      await reconcileRazorpayPayment(
        config,
        principal,
        String(booking._id),
      );
      ok(res, await bookingView(identity, id));
    }),
  );
  router.get(
    "/bookings/:id",
    asyncRoute(async (req, res) => {
      empty(req.query);
      ok(
        res,
        await bookingView(auth(req, "bookings:read"), pid.parse(req.params.id)),
      );
    }),
  );
  router.get(
    "/bookings/:id/ticket",
    asyncRoute(async (req, res) => {
      empty(req.query);
      const { ref, booking } = await ownedPublicBooking(
          auth(req, "tickets:read"),
          pid.parse(req.params.id),
        ),
        ticket = await M.Ticket.findOne({
          bookingId: booking._id,
          operatorId: ref.operatorId,
        }).lean();
      if (!ticket)
        fail(409, "TICKET_NOT_ISSUED", "No confirmed ticket has been issued");
      ok(res, {
        bookingId: ref.publicId,
        pnr: ticket!.pnr,
        status: ticket!.status,
        issuedAt: ticket!.issuedAt,
        passengers: booking.passengers.map((p: any) => ({
          name: p.name,
          seat: p.seat,
          boarding: p.boarding,
          dropping: p.dropping,
        })),
        environment: "sandbox",
      });
    }),
  );
  router.post(
    "/bookings/:id/cancellation-quotes",
    asyncRoute(async (req, res) => {
      empty(req.body);
      const { auth: principal, booking } = await ownedPublicBooking(
          auth(req, "cancellations:write"),
          pid.parse(req.params.id),
        ),
        quote: any = await quoteCancellation(principal, String(booking._id));
      ok(res, {
        id: await resourceId("cquote", String(quote._id)),
        expiresAt: quote.expiresAt,
        refundPaise: quote.refundPaise,
        retainedPaise: quote.retainedPaise,
        currency: "INR",
        partialSupported: false,
      });
    }),
  );
  router.post(
    "/bookings/:id/cancellations",
    asyncRoute(async (req, res) => {
      const identity = auth(req, "cancellations:write"),
        input = z
          .object({ quoteId: pid, reason: z.string().trim().min(5).max(200) })
          .strict()
          .parse(req.body),
        id = pid.parse(req.params.id);
      await partnerCommand(
        identity,
        requestKey.parse(req.get("Idempotency-Key")),
        "cancel",
        createHash("sha256")
          .update(JSON.stringify({ id, input }))
          .digest("hex"),
      );
      const { auth: principal, booking } = await ownedPublicBooking(
          identity,
          id,
        ),
        prior = await M.Cancellation.findOne({
          bookingId: booking._id,
          operatorId: booking.operatorId,
        }).lean();
      if (!prior) {
        const quoteId = await internalResource("cquote", input.quoteId);
        if (
          !(await M.CancellationQuote.exists({
            _id: quoteId,
            bookingId: booking._id,
            operatorId: booking.operatorId,
            requestedBy: identity.partnerId,
            expiresAt: { $gt: new Date() },
          }))
        )
          fail(
            409,
            "CANCELLATION_QUOTE_EXPIRED",
            "Current owned cancellation quote required",
          );
        await requestCancellation(
          principal,
          String(booking._id),
          input.reason,
          req.requestId,
        );
      }
      ok(res, await bookingView(identity, id));
    }),
  );
  router.get(
    "/bookings/:id/refund",
    asyncRoute(async (req, res) => {
      empty(req.query);
      const { auth: principal, booking } = await ownedPublicBooking(
          auth(req, "refunds:read"),
          pid.parse(req.params.id),
        ),
        status = await refundStatus(
          {
            ...principal,
            permissions: [...principal.permissions, "finance:read"],
          },
          String(booking._id),
        );
      ok(res, {
        bookingStatus: status.bookingStatus,
        paymentStatus: status.paymentStatus,
        refund: status.refund
          ? {
              status: status.refund.status,
              amountPaise: status.refund.amountPaise,
              completed: status.refund.completed,
            }
          : null,
        intents: status.intents.map((i) => ({
          status: i.status,
          amountPaise: i.amountPaise,
          processedAt: i.processedAt || null,
        })),
        partialSupported: false,
        liveRefunds: false,
        testRefunds:
          config.FINANCE_TEST_MODE &&
          config.NODE_ENV !== "production" &&
          razorpayEnabled(config),
      });
    }),
  );
  router.get(
    "/webhook-deliveries",
    asyncRoute(async (req, res) => {
      const identity = auth(req, "webhooks:read"),
        q = z.object({ page, limit }).strict().parse(req.query);
      const total = await P.PartnerWebhookDelivery.countDocuments({
        partnerId: identity.partnerId,
      });
      ok(
        res,
        await P.PartnerWebhookDelivery.find({ partnerId: identity.partnerId })
          .select("status attempts lastCode createdAt updatedAt -_id")
          .sort({ createdAt: -1 })
          .skip((q.page - 1) * q.limit)
          .limit(q.limit)
          .lean(),
        { page: q.page, limit: q.limit, total },
      );
    }),
  );
  for (const path of ["/reschedule", "/wallet"])
    router.all(
      path,
      asyncRoute(async (_req, _res) =>
        fail(
          501,
          "CAPABILITY_UNAVAILABLE",
          "Partner wallets and rescheduling have no approved business contract; capability unavailable",
        ),
      ),
    );
  return router;
}
