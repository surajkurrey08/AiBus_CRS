import { partnerCommission } from "./commission.service.js";
import mongoose from "mongoose";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { requireCapability } from "../integrations/providers.js";
import {
  Audit,
  Booking,
  Hold,
  Offer,
  Outbox,
  Payment,
  Quote,
  Ticket,
  Trip,
  WebhookEvent,
} from "../models/index.js";
import { fail, type Principal } from "../utils/core.js";
import {
  contactInput,
  gstInput,
  priceTrip,
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
    $or: [{ state: "available" }, { state: "held", holdUntil: { $lte: now } }],
  },
});
export async function createHold(
  auth: Principal,
  tripId: string,
  numbers: string[],
) {
  if (!auth.permissions.includes("bookings:write"))
    fail(403, "FORBIDDEN", "Booking permission is required to hold seats");
  const holdId = randomUUID(),
    now = new Date(),
    expiresAt = new Date(Date.now() + 5 * 60000);
  let result: unknown;
  await mongoose.connection.transaction(async (session) => {
    const trip = await Trip.findOne({
      _id: tripId,
      operatorId: auth.operatorId,
    })
      .session(session)
      .lean();
    internalTrip(trip);
    const existing = trip!.seats as { number: string; farePaise: number }[];
    if (numbers.some((n) => !existing.some((s) => s.number === n)))
      fail(400, "INVALID_SEAT", "One or more seats do not exist");
    const amountPaise = existing
      .filter((s) => numbers.includes(s.number))
      .reduce((sum, s) => sum + s.farePaise, 0);
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
    phone: z
      .string()
      .regex(/^\+?[\d\s-]{10,16}$/)
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
      const trip = await Trip.findOne({
        _id: input.tripId,
        operatorId: auth.operatorId,
      })
        .session(session)
        .lean();
      internalTrip(trip);
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
            source: channel,
            ...commission,
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
                holdUntil: { $gt: new Date() },
              },
            },
          })),
        },
        { $set: { "seats.$[seat].bookingId": booking._id } },
        {
          session,
          arrayFilters: [{ "seat.holdId": input.holdId, "seat.state": "held" }],
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
      if (duplicate?.requestHash === requestHash) return duplicate;
    }
    throw error;
  }
  return result;
}
// Callable only by a future server-side adapter after signature verification and
// authoritative amount/status verification. No public endpoint trusts this shape.
export async function applyVerifiedPayment(event: {
  verified: true;
  providerId: string;
  eventId: string;
  externalId: string;
  operatorId: string;
  bookingId: string;
  amountPaise: number;
  currency: "INR";
  status: "captured" | "failed";
}) {
  const payloadHash = createHash("sha256")
    .update(JSON.stringify(event))
    .digest("hex");
  const previous = await WebhookEvent.findOne({
    providerId: event.providerId,
    eventId: event.eventId,
  }).lean();
  if (previous) {
    if (previous.payloadHash !== payloadHash)
      fail(409, "EVENT_CONFLICT", "Webhook identifier has conflicting content");
    return { duplicate: true };
  }
  try {
    await mongoose.connection.transaction(async (session) => {
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
      if (event.currency !== "INR" || event.amountPaise !== booking!.totalPaise)
        fail(409, "PAYMENT_MISMATCH", "Payment amount does not match booking");
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
        status: "captured",
      })
        .session(session)
        .lean();
      if (captured && captured.externalId !== event.externalId)
        fail(
          409,
          "DUPLICATE_PAYMENT",
          "A different payment has already been captured for this booking",
        );
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
      if (event.status === "failed" && payment!.status === "captured")
        fail(
          409,
          "PAYMENT_CONFLICT",
          "A captured payment cannot be downgraded by a failure event",
        );
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
              { "seat.bookingId": booking!._id, "seat.state": "held" },
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
        const changed =
          booking!.status !== "Cancelled" &&
          trip?.inventoryOwner === "internal" &&
          trip.status === "Scheduled" &&
          new Date(trip.departureAt as Date) > now
            ? await Trip.updateOne(
                {
                  _id: trip._id,
                  operatorId: event.operatorId,
                  inventoryOwner: "internal",
                  status: "Scheduled",
                  $and: passengers.map((p) => ({
                    seats: {
                      $elemMatch: {
                        number: p.seat,
                        state: "held",
                        bookingId: booking!._id,
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
                    { "seat.bookingId": booking!._id, "seat.state": "held" },
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
    });
    return { duplicate: false };
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      const found = await WebhookEvent.findOne({
        providerId: event.providerId,
        eventId: event.eventId,
      }).lean();
      if (found?.payloadHash === payloadHash) return { duplicate: true };
    }
    throw error;
  }
}
