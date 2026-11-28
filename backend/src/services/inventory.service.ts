import { phoneNumber } from "../validators/account-input.schemas.js";
import { postDuplicateCapture } from "./payment-exception.service.js";
import { partnerCommission } from "./commission.service.js";
import { postCapturedBooking, type AccountSpec } from "./ledger.service.js";
import { authorizeAgent } from "./agent.service.js";
import mongoose from "mongoose";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { requireCapability } from "../integrations/providers.js";
import {
  Audit,
  Operator,
  Booking,
  Hold,
  Offer,
  Outbox,
  Payment,
  Quote,
  Ticket,
  Trip,
  WebhookEvent,
  Cancellation,
  RefundIntent,
  PaymentOrder,
  FinanceException,
} from "../models/index.js";
import { fail, type Principal } from "../utils/core.js";
import {
  contactInput,
  gstInput,
  priceTrip,
  resolveSeatFares,
  validatePassengers,
} from "./pricing.service.js";
export const seatList = z
  .array(z.string().trim().min(1).max(12))
  .min(1)
  .max(6)
  .refine((v) => new Set(v).size === v.length, "Duplicate seats");
export function internalTrip(
  trip: Record<string, unknown> | null,
  reservation = true,
) {
  if (!trip) fail(404, "NOT_FOUND", "Trip not found");
  if (trip!.inventoryOwner !== "internal") {
    requireCapability("availability");
    fail(503, "PROVIDER_UNAVAILABLE", "Provider adapter is not configured");
  }
  if (
    trip!.status !== "Scheduled" ||
    new Date(trip!.departureAt as string) <= new Date()
  )
    fail(409, "TRIP_CLOSED", "Trip is not open for reservation");
  if (reservation && trip!.bookingOpen === false)
    fail(
      409,
      "BOOKING_STOPPED",
      "New bookings have been stopped for this trip",
    );
}
const available = (number: string, now: Date) => ({
  $elemMatch: {
    number,
    isDriver: { $ne: true },
    isBookable: { $ne: false },
    $or: [{ state: "available" }, { state: "held", holdUntil: { $lte: now } }],
  },
});
async function newSalesAllowed(
  operatorId: string | null,
  session: mongoose.ClientSession,
) {
  const owner = await Operator.findOneAndUpdate(
    { _id: operatorId, status: "approved", salesBlocked: { $ne: true } },
    { $inc: { salesRevision: 1 } },
    { session },
  );
  if (!owner)
    fail(
      409,
      "OPERATOR_SALES_BLOCKED",
      "New reservations are blocked by operator policy; existing bookings are preserved",
    );
}
export async function createHold(
  auth: Principal,
  tripId: string,
  numbers: string[],
  trustedHoldId?: string,
  segment?: { fromCity?: string; toCity?: string },
) {
  if (!auth.permissions.includes("bookings:write"))
    fail(403, "FORBIDDEN", "Booking permission is required to hold seats");
  const holdId = trustedHoldId || randomUUID();
  let result: unknown;
  await mongoose.connection.transaction(async (session) => {
    await newSalesAllowed(auth.operatorId, session);
    const now = new Date(),
      expiresAt = new Date(+now + 5 * 60000);
    const trip = await Trip.findOne({
      _id: tripId,
      operatorId: auth.operatorId,
    })
      .session(session)
      .lean();
    internalTrip(trip);
    if (auth.agentId) await authorizeAgent(auth, "book", session, trip);
    const existing = trip!.seats as { number: string; farePaise: number }[];
    if (numbers.some((n) => !existing.some((s) => s.number === n)))
      fail(400, "INVALID_SEAT", "One or more seats do not exist");
    const resolved = resolveSeatFares(
      trip,
      numbers,
      segment?.fromCity,
      segment?.toCity,
    );
    const amountPaise = resolved.reduce((sum, s) => sum + s.farePaise, 0);
    const updated = await Trip.updateOne(
      {
        _id: tripId,
        operatorId: auth.operatorId,
        status: "Scheduled",
        inventoryOwner: "internal",
        bookingOpen: { $ne: false },
        $and: numbers.map((n) => ({ seats: available(n, now) })),
      },
      {
        $set: {
          "seats.$[seat].state": "held",
          "seats.$[seat].holdId": holdId,
          "seats.$[seat].holdUserId": auth.userId,
          "seats.$[seat].holdUntil": expiresAt,
        },
        // A replacement hold must never inherit the previous checkout's owner.
        $unset: {
          "seats.$[seat].bookingId": 1,
          "seats.$[seat].quotaLabel": 1,
        },
      },
      { session, arrayFilters: [{ "seat.number": { $in: numbers } }] },
    );
    if (updated.modifiedCount !== 1)
      fail(
        409,
        "SEAT_UNAVAILABLE",
        "A selected seat is no longer available. Refresh the layout.",
      );
    const [hold] = await Hold.create(
      [
        {
          operatorId: auth.operatorId,
          tripId,
          userId: auth.userId,
          holdId,
          seats: numbers,
          amountPaise,
          expiresAt,
        },
      ],
      { session },
    );
    result = hold.toObject();
    await Audit.create(
      [
        {
          operatorId: auth.operatorId,
          actorId: auth.userId,
          action: "inventory.hold",
          resource: "trip",
          resourceId: tripId,
        },
      ],
      { session },
    );
    await Outbox.create(
      [
        {
          operatorId: auth.operatorId,
          event: "seat.availability.changed",
          resourceId: tripId,
        },
      ],
      { session },
    );
  });
  return result;
}

export async function releaseHold(
  auth: Principal,
  tripId: string,
  holdId: string,
) {
  await mongoose.connection.transaction(async (session) => {
    const hold = await Hold.findOneAndUpdate(
      {
        operatorId: auth.operatorId,
        tripId,
        holdId,
        userId: auth.userId,
        status: "held",
      },
      { $set: { status: "released" } },
      { session, new: true },
    );
    if (!hold) fail(404, "NOT_FOUND", "Active hold not found");
    await Trip.updateOne(
      { _id: tripId, operatorId: auth.operatorId, inventoryOwner: "internal" },
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
        arrayFilters: [{ "seat.holdId": holdId, "seat.state": "held" }],
      },
    );
    await Outbox.create(
      [
        {
          operatorId: auth.operatorId,
          event: "seat.availability.changed",
          resourceId: tripId,
        },
      ],
      { session },
    );
  });
}
export async function blockSeats(
  auth: Principal,
  tripId: string,
  numbers: string[],
  block: boolean,
) {
  if (!auth.permissions.includes("inventory:write"))
    fail(
      403,
      "FORBIDDEN",
      "Inventory permission is required to change seat states",
    );
  await mongoose.connection.transaction(async (session) => {
    const trip = await Trip.findOne({
      _id: tripId,
      operatorId: auth.operatorId,
    })
      .session(session)
      .lean();
    internalTrip(trip, false);
    const updated = await Trip.updateOne(
      {
        _id: tripId,
        operatorId: auth.operatorId,
        inventoryOwner: "internal",
        status: "Scheduled",
        $and: numbers.map((number) => ({
          seats: block
            ? available(number, new Date())
            : { $elemMatch: { number, state: "blocked" } },
        })),
      },
      {
        $set: { "seats.$[seat].state": block ? "blocked" : "available" },
        $unset: {
          "seats.$[seat].bookingId": 1,
          "seats.$[seat].holdId": 1,
          "seats.$[seat].holdUserId": 1,
          "seats.$[seat].holdUntil": 1,
        },
      },
      { session, arrayFilters: [{ "seat.number": { $in: numbers } }] },
    );
    if (updated.modifiedCount !== 1)
      fail(
        409,
        "SEAT_UNAVAILABLE",
        "Seat state changed or selection is invalid",
      );
    await Audit.create(
      [
        {
          operatorId: auth.operatorId,
          actorId: auth.userId,
          action: block ? "inventory.block" : "inventory.release",
          resource: "trip",
          resourceId: tripId,
        },
      ],
      { session },
    );
    await Outbox.create(
      [
        {
          operatorId: auth.operatorId,
          event: "seat.availability.changed",
          resourceId: tripId,
        },
      ],
      { session },
    );
  });
}
export const passengerInput = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((v) => !/[<>\x00]/.test(v)),
    phone: phoneNumber
      .optional(),
    seat: z.string().min(1).max(12),
    boarding: z.string().max(200).optional(),
    dropping: z.string().max(200).optional(),
    email: z.string().email().max(254).optional(),
    age: z.number().int().min(0).max(120).optional(),
    gender: z.enum(["female", "male", "other", "unspecified"]).optional(),
  })
  .strict();
export async function createBooking(
  auth: Principal,
  input: {
    tripId: string;
    salesPartnerId?: string;
    holdId: string;
    passengers: z.infer<typeof passengerInput>[];
    promoCode?: string;
    operatorDiscountPaise?: number;
    quoteId?: string;
    fromCity?: string;
    toCity?: string;
    contact?: z.infer<typeof contactInput>;
    gst?: z.infer<typeof gstInput>;
  },
  key: string,
  channel: "operator" | "customer" | "agent" | "external" = "operator",
) {
  if (!auth.permissions.includes("bookings:write"))
    fail(403, "FORBIDDEN", "Booking permission is required");
  channel = z
    .enum(["operator", "customer", "agent", "external"])
    .parse(channel);
  if (auth.agentId) {
    await authorizeAgent(auth, "book");
    if (input.salesPartnerId)
      fail(
        400,
        "AGENT_ID_FORBIDDEN",
        "Agency identity is derived from your session",
      );
    channel = "agent";
  }
  input = {
    ...input,
    passengers: z.array(passengerInput).min(1).max(6).parse(input.passengers),
    ...(input.contact ? { contact: contactInput.parse(input.contact) } : {}),
    ...(input.gst ? { gst: gstInput.parse(input.gst) } : {}),
  };
  const requestHash = createHash("sha256")
    .update(JSON.stringify({ channel, input }))
    .digest("hex");
  const prior = await Booking.findOne({
    operatorId: auth.operatorId,
    idempotencyKey: key,
  }).lean();
  if (prior) {
    if (auth.agentId && String(prior.agentId) !== auth.agentId)
      fail(
        409,
        "IDEMPOTENCY_CONFLICT",
        "This booking request key is unavailable",
      );
    if (prior.requestHash !== requestHash)
      fail(
        409,
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with different booking details",
      );
    return prior;
  }
  let result: unknown;
  try {
    await mongoose.connection.transaction(async (session) => {
      await newSalesAllowed(auth.operatorId, session);
      const trip = await Trip.findOne({
        _id: input.tripId,
        operatorId: auth.operatorId,
      })
        .session(session)
        .lean();
      internalTrip(trip);
      if (auth.agentId) {
        await authorizeAgent(auth, "book", session, trip);
        if (input.salesPartnerId)
          fail(
            400,
            "AGENT_ID_FORBIDDEN",
            "Agency identity is derived from your session",
          );
      }
      const hold = await Hold.findOneAndUpdate(
        {
          operatorId: auth.operatorId,
          tripId: input.tripId,
          holdId: input.holdId,
          userId: auth.userId,
          status: "held",
          expiresAt: { $gt: new Date() },
        },
        { $set: { status: "consumed" } },
        { new: true, session },
      );
      if (!hold)
        fail(
          409,
          "HOLD_EXPIRED",
          "Seat hold expired, was already used, or belongs to another user",
        );
      const seats = hold!.seats as string[];
      if (
        input.passengers.length !== seats.length ||
        new Set(input.passengers.map((p) => p.seat)).size !== seats.length ||
        input.passengers.some((p) => !seats.includes(p.seat))
      )
        fail(
          400,
          "PASSENGER_SEATS_MISMATCH",
          "Provide one passenger for every held seat",
        );
      const pricing = await priceTrip(
        auth,
        trip,
        seats,
        {
          promoCode: input.promoCode,
          operatorDiscountPaise: input.operatorDiscountPaise,
          fromCity: input.fromCity,
          toCity: input.toCity,
        },
        session,
      );
      if (pricing.grossPaise !== hold!.amountPaise)
        fail(
          409,
          "FARE_CHANGED",
          "Seat pricing changed. Release the hold and request a new quote.",
        );
      if (input.quoteId) {
        const quoted = await Quote.findOneAndUpdate(
          {
            _id: input.quoteId,
            operatorId: auth.operatorId,
            userId: auth.userId,
            tripId: input.tripId,
            holdId: input.holdId,
            status: "quoted",
            expiresAt: { $gt: new Date() },
          },
          { $set: { status: "consumed" } },
          { session, new: true },
        ).lean();
        if (
          !quoted ||
          [...(quoted.seats as string[])].sort().join("|") !==
            [...seats].sort().join("|")
        )
          fail(
            409,
            "QUOTE_EXPIRED",
            "Quote expired or does not match this hold",
          );
        const old = quoted!.pricing as any;
        if (
          old.rulesFingerprint !== pricing.rulesFingerprint ||
          old.totalPaise !== pricing.totalPaise ||
          old.operatorDiscountPaise !== pricing.operatorDiscountPaise ||
          old.promoCode !== pricing.promoCode
        )
          fail(
            409,
            "REQUOTE_REQUIRED",
            "Pricing rules changed. Review a fresh quote before continuing.",
          );
      }
      await validatePassengers(
        auth,
        trip,
        input.passengers,
        pricing,
        input.contact,
        input.gst,
        session,
      );
      if (
        input.quoteId &&
        input.passengers.some((p) => !p.boarding || !p.dropping)
      )
        fail(
          400,
          "STOPS_REQUIRED",
          "Choose boarding and dropping points for every counter passenger",
        );
      const commission = await partnerCommission(
        auth,
        trip,
        pricing,
        input.salesPartnerId,
        session,
      );
      const [booking] = await Booking.create(
        [
          {
            operatorId: auth.operatorId,
            tripId: input.tripId,
            userId: auth.userId,
            holdId: input.holdId,
            reference: `AB-${randomUUID()}`,
            status: "Pending payment",
            paymentStatus: "Pending",
            source: auth.agentId ? "agent" : channel,
            createdByUserId: auth.userId,
            ...(auth.agentId ? { agentId: auth.agentId } : {}),
            ...commission,
            ...(commission.salesPartnerId &&
            commission.commissionSnapshot?.partnerKind === "Agent"
              ? { agentId: commission.salesPartnerId }
              : {}),
            passengers: input.passengers,
            grossPaise: hold!.amountPaise,
            totalPaise: pricing.totalPaise,
            discountPaise: pricing.discountPaise,
            taxPaise: pricing.taxPaise,
            chargePaise: pricing.chargePaise,
            offerId: pricing.offerId,
            pricingSnapshot: pricing,
            quoteId: input.quoteId,
            contact: input.contact,
            gst: input.gst,
            promoCode: input.promoCode,
            idempotencyKey: key,
            requestHash,
          },
        ],
        { session },
      );
      // The trip is written as part of this transaction so a competing expiry/block
      // operation conflicts rather than committing a booking against stolen seats.
      const locked = await Trip.updateOne(
        {
          _id: input.tripId,
          operatorId: auth.operatorId,
          bookingOpen: { $ne: false },
          $and: seats.map((number) => ({
            seats: {
              $elemMatch: {
                number,
                state: "held",
                holdId: input.holdId,
                holdUserId: auth.userId,
                holdUntil: { $gt: new Date() },
              },
            },
          })),
        },
        {
          $set: { "seats.$[seat].bookingId": booking._id },
        },
        {
          session,
          arrayFilters: [
            {
              "seat.holdId": input.holdId,
              "seat.holdUserId": auth.userId,
              "seat.state": "held",
            },
          ],
        },
      );
      if (locked.modifiedCount !== 1)
        fail(409, "HOLD_EXPIRED", "Held seats are no longer available");

      result = booking.toObject();
      await Audit.create(
        [
          {
            operatorId: auth.operatorId,
            actorId: auth.userId,
            action: "booking.create.pending_payment",
            resource: "booking",
            resourceId: String(booking._id),
          },
        ],
        { session },
      );
      await Outbox.create(
        [
          {
            operatorId: auth.operatorId,
            event: "booking.created",
            resourceId: String(booking._id),
          },
        ],
        { session },
      );
    });
  } catch (error) {
    if (
      (error as { code?: number | string }).code === 11000 ||
      (error as { code?: string }).code === "HOLD_EXPIRED"
    ) {
      const duplicate = await Booking.findOne({
        operatorId: auth.operatorId,
        idempotencyKey: key,
      }).lean();
      if (
        duplicate &&
        auth.agentId &&
        String(duplicate.agentId) !== auth.agentId
      )
        fail(
          409,
          "IDEMPOTENCY_CONFLICT",
          "This booking request key is unavailable",
        );
      if (duplicate?.requestHash === requestHash) return duplicate;
    }
    throw error;
  }
  return result;
}

// Callable only by a future server-side adapter after signature verification and
// authoritative amount/status verification. No public endpoint trusts this shape.
export async function confirmDirectBooking(auth: Principal, bookingId: string) {
  if (!auth.permissions.includes("bookings:write"))
    fail(403, "FORBIDDEN", "Booking confirmation permission is required");
  if (auth.agentId || ["agent", "booking_staff"].includes(auth.role))
    fail(
      403,
      "OPERATOR_REQUIRED",
      "Cash confirmation requires operator staff; agents must use verified wallet or credit funding",
    );
  let result: any;
  await mongoose.connection.transaction(async (session) => {
    await newSalesAllowed(auth.operatorId, session);
    const booking = await Booking.findOne({
      _id: bookingId,
      operatorId: auth.operatorId,
    }).session(session);
    if (!booking) fail(404, "NOT_FOUND", "Booking not found");
    const b = booking!;
    if (b.status === "Confirmed") {
      result = {
        status: b.status,
        paymentStatus: b.paymentStatus,
        reference: b.reference,
        pnr: b.pnr,
      };
      return;
    }
    if (b.status !== "Pending payment")
      fail(
        409,
        "INVALID_STATE",
        "Only a pending booking can accept counter cash",
      );
    if (
      await PaymentOrder.exists({
        bookingId: b._id,
        operatorId: auth.operatorId,
      }).session(session)
    )
      fail(
        409,
        "PAYMENT_IN_PROGRESS",
        "Reconcile the existing gateway payment before accepting cash",
      );
    await applyVerifiedPayment(
      {
        verified: true,
        providerId: "counter_cash",
        eventId: "cash:" + bookingId,
        externalId: "cash:" + bookingId,
        operatorId: auth.operatorId!,
        bookingId,
        amountPaise: Number(b.totalPaise),
        currency: "INR",
        status: "captured",
      },
      0,
      {
        session,
        debitAccount: {
          ownerType: "Operator",
          ownerId: auth.operatorId!,
          code: "counter-cash-clearing",
        },
      },
    );
    await Booking.updateOne(
      { _id: b._id, operatorId: auth.operatorId, status: "Confirmed" },
      { $set: { fundingMethod: "counter_cash" } },
      { session },
    );
    await Audit.create(
      [
        {
          operatorId: auth.operatorId,
          actorId: auth.userId,
          action: "booking.confirm.counter_cash",
          resource: "booking",
          resourceId: bookingId,
        },
      ],
      { session },
    );
    const confirmed = await Booking.findById(b._id).session(session).lean();
    result = {
      status: confirmed!.status,
      paymentStatus: confirmed!.paymentStatus,
      reference: confirmed!.reference,
      pnr: confirmed!.pnr,
    };
  });
  return result;
}

export async function applyVerifiedPayment(
  event: {
    verified: true;
    providerId: string;
    eventId: string;
    externalId: string;
    operatorId: string;
    bookingId: string;
    amountPaise: number;
    currency: "INR";
    status: "captured" | "failed";
  },
  ledgerRetry = 0,
  fundingContext?: {
    session: mongoose.ClientSession;
    debitAccount: AccountSpec;
  },
) {
  const payloadHash = createHash("sha256")
    .update(JSON.stringify(event))
    .digest("hex");
  const previous = await WebhookEvent.findOne({
    providerId: event.providerId,
    eventId: event.eventId,
  })
    .session(fundingContext?.session || null)
    .lean();
  if (previous) {
    if (previous.payloadHash !== payloadHash)
      fail(409, "EVENT_CONFLICT", "Webhook identifier has conflicting content");
    return { duplicate: true };
  }
  try {
    const transact = fundingContext
      ? async (
          fn: (session: mongoose.ClientSession) => Promise<void>,
          _options: unknown,
        ) => fn(fundingContext.session)
      : mongoose.connection.transaction.bind(mongoose.connection);
    await transact(
      async (session: mongoose.ClientSession) => {
        await WebhookEvent.create(
          [
            {
              providerId: event.providerId,
              eventId: event.eventId,
              payloadHash,
              status: "processing",
            },
          ],
          { session },
        );
        const booking = await Booking.findOne({
          _id: event.bookingId,
          operatorId: event.operatorId,
        }).session(session);
        if (!booking) fail(404, "NOT_FOUND", "Booking not found");
        if (
          event.currency !== "INR" ||
          event.amountPaise !== booking!.totalPaise
        )
          fail(
            409,
            "PAYMENT_MISMATCH",
            "Payment amount does not match booking",
          );
        if (
          ![
            "Pending payment",
            "Confirmed",
            "Reconciliation required",
            "Failed",
            "Cancelled",
          ].includes(String(booking!.status))
        )
          fail(409, "BOOKING_CLOSED", "Booking cannot accept a payment");
        const captured = await Payment.findOne({
          operatorId: event.operatorId,
          bookingId: event.bookingId,
          status: { $in: ["captured", "refunded"] },
        })
          .session(session)
          .lean();
        const priorPayment = await Payment.findOne({
          providerId: event.providerId,
          externalId: event.externalId,
        })
          .session(session)
          .lean();
        const newCapture =
          event.status === "captured" &&
          !["captured", "refunded"].includes(String(priorPayment?.status));
        const additionalCapture =
          event.status === "captured" &&
          captured &&
          (captured.externalId !== event.externalId ||
            captured.providerId !== event.providerId);
        const payment = await Payment.findOneAndUpdate(
          { providerId: event.providerId, externalId: event.externalId },
          {
            $setOnInsert: {
              operatorId: event.operatorId,
              bookingId: event.bookingId,
              amountPaise: event.amountPaise,
              currency: "INR",
              status: event.status === "captured" ? "captured" : "failed",
              confirmedAt: new Date(),
            },
          },
          { session, upsert: true, new: true },
        );
        if (
          String(payment!.bookingId) !== event.bookingId ||
          String(payment!.operatorId) !== event.operatorId
        )
          fail(409, "PAYMENT_CONFLICT", "Payment belongs to another booking");
        if (event.status === "captured" && payment!.status === "failed") {
          payment!.status = "captured";
          payment!.confirmedAt = new Date();
          await payment!.save({ session });
        }
        if (
          event.status === "failed" &&
          ["captured", "refunded"].includes(String(payment!.status))
        )
          fail(
            409,
            "PAYMENT_CONFLICT",
            "A captured payment cannot be downgraded by a failure event",
          );
        const approvedCancellation = await Cancellation.findOne({
          operatorId: event.operatorId,
          bookingId: event.bookingId,
          status: "Approved",
          accountingJournalId: { $exists: true },
        })
          .session(session)
          .lean();
        const completedRefund = await RefundIntent.exists({
          operatorId: event.operatorId,
          paymentId: payment!._id,
          status: "Processed",
        }).session(session);
        if (additionalCapture && fundingContext)
          fail(
            409,
            "FUNDING_CONFLICT",
            "Booking already has another captured payment",
          );
        if (additionalCapture) {
          await postDuplicateCapture(
            booking,
            payment,
            event.eventId,
            session,
            newCapture,
          );
          await WebhookEvent.updateOne(
            { providerId: event.providerId, eventId: event.eventId },
            { $set: { status: "processed", processedAt: new Date() } },
            { session },
          );
          return;
        }
        if (
          event.status === "captured" &&
          (approvedCancellation || completedRefund)
        ) {
          await WebhookEvent.updateOne(
            { providerId: event.providerId, eventId: event.eventId },
            { $set: { status: "processed", processedAt: new Date() } },
            { session },
          );
          return;
        }
        if (booking!.status === "Confirmed") {
          if (event.status !== "captured" || payment!.status !== "captured")
            fail(
              409,
              "PAYMENT_CONFLICT",
              "Payment status conflicts with confirmation",
            );
        } else if (event.status === "failed") {
          booking!.paymentStatus = "Failed";
          booking!.status = "Failed";
          await Trip.updateOne(
            { _id: booking!.tripId, operatorId: event.operatorId },
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
        } else {
          booking!.paymentStatus = "Paid";
          booking!.paidAt = booking!.paidAt || new Date();
          const now = new Date();
          const trip = await Trip.findOne({
            _id: booking!.tripId,
            operatorId: event.operatorId,
          })
            .session(session)
            .lean();
          const passengers = booking!.passengers as { seat: string }[];
          // Serialize with hold expiry/release as well as the trip seat update.
          // The original hold record is authoritative; a newer seat expiry must
          // never extend the life of an older checkout.
          const currentHold =
            booking!.status !== "Cancelled" &&
            trip?.inventoryOwner === "internal" &&
            trip.status === "Scheduled" &&
            new Date(trip.departureAt as Date) > now
              ? await Hold.updateOne(
                  {
                    operatorId: event.operatorId,
                    tripId: booking!.tripId,
                    holdId: booking!.holdId,
                    userId: booking!.userId,
                    status: "consumed",
                    expiresAt: { $gt: now },
                    seats: {
                      $size: passengers.length,
                      $all: passengers.map((p) => p.seat),
                    },
                  },
                  { $inc: { __v: 1 } },
                  { session },
                )
              : null;
          const changed =
            currentHold?.matchedCount === 1
              ? await Trip.updateOne(
                  {
                    _id: trip!._id,
                    operatorId: event.operatorId,
                    inventoryOwner: "internal",
                    status: "Scheduled",
                    $and: passengers.map((p) => ({
                      seats: {
                        $elemMatch: {
                          number: p.seat,
                          state: "held",
                          bookingId: booking!._id,
                          holdId: booking!.holdId,
                          holdUserId: booking!.userId,
                          holdUntil: { $gt: now },
                        },
                      },
                    })),
                  },
                  {
                    $set: { "seats.$[seat].state": "booked" },
                    $unset: {
                      "seats.$[seat].holdUntil": 1,
                      "seats.$[seat].holdUserId": 1,
                    },
                  },
                  {
                    session,
                    arrayFilters: [
                      {
                        "seat.number": { $in: passengers.map((p) => p.seat) },
                        "seat.bookingId": booking!._id,
                        "seat.holdId": booking!.holdId,
                        "seat.holdUserId": booking!.userId,
                        "seat.holdUntil": { $gt: now },
                        "seat.state": "held",
                      },
                    ],
                  },
                )
              : null;
          if (changed?.modifiedCount === 1) {
            booking!.status = "Confirmed";
            if (booking!.offerId)
              await Offer.updateOne(
                { _id: booking!.offerId, operatorId: event.operatorId },
                { $inc: { usage: 1 } },
                { session },
              );
            booking!.pnr = `AI-${randomUUID().replaceAll("-", "").toUpperCase()}`;
            await Ticket.create(
              [
                {
                  operatorId: event.operatorId,
                  bookingId: booking!._id,
                  pnr: booking!.pnr,
                  issuedAt: new Date(),
                },
              ],
              { session },
            );
            await Outbox.create(
              [
                {
                  operatorId: event.operatorId,
                  event: "booking.confirmed",
                  resourceId: String(booking!._id),
                },
              ],
              { session },
            );
          } else {
            booking!.status = "Reconciliation required";
          }
        }
        await booking!.save({ session });
        if (fundingContext && booking!.status !== "Confirmed")
          fail(
            409,
            "HOLD_EXPIRED",
            "Funding was not consumed because seat ownership expired",
          );
        if (newCapture)
          await postCapturedBooking(
            booking,
            payment,
            event.eventId,
            session,
            fundingContext?.debitAccount,
          );
        if (
          event.status === "captured" &&
          booking!.status === "Reconciliation required"
        )
          await FinanceException.findOneAndUpdate(
            {
              operatorId: event.operatorId,
              kind: "Late capture",
              resourceKey: String(payment!._id),
            },
            {
              $setOnInsert: {
                operatorId: event.operatorId,
                bookingId: booking!._id,
                paymentId: payment!._id,
                kind: "Late capture",
                resourceKey: String(payment!._id),
                code: "CAPTURE_WITHOUT_TICKET",
                status: "Open",
              },
              $set: { lastSeenAt: new Date() },
            },
            { upsert: true, session },
          );
        await WebhookEvent.updateOne(
          { providerId: event.providerId, eventId: event.eventId },
          { $set: { status: "processed", processedAt: new Date() } },
          { session },
        );
        await Outbox.create(
          [
            {
              operatorId: event.operatorId,
              event: "seat.availability.changed",
              resourceId: String(booking!.tripId),
            },
          ],
          { session },
        );
      },
      { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
    );
    return { duplicate: false };
  } catch (error) {
    if (fundingContext) throw error;
    if ((error as { code?: number }).code === 11000) {
      const found = await WebhookEvent.findOne({
        providerId: event.providerId,
        eventId: event.eventId,
      }).lean();
      if (found?.payloadHash === payloadHash) return { duplicate: true };
      if (!found && ledgerRetry < 3)
        return applyVerifiedPayment(event, ledgerRetry + 1);
    }
    throw error;
  }
}
