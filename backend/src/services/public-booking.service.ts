import mongoose from "mongoose";
import { createHash } from "node:crypto";
import * as M from "../models/index.js";
import * as P from "../models/public-api.model.js";
import {
  authorizedTrip,
  partnerPrincipal,
  partnerCommand,
  internalResource,
} from "./public-inventory.service.js";
import {
  type PartnerIdentity,
  sandboxReady,
  publicIndexesReady,
} from "./public-auth.service.js";
import {
  createHold,
  createBooking,
  applyVerifiedPayment,
} from "./inventory.service.js";
import { fail } from "../utils/core.js";
import type { Config } from "../config/env.js";
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
export async function publicHold(
  identity: PartnerIdentity,
  tripId: string,
  seats: string[],
  key: string,
) {
  const { trip, auth } = await authorizedTrip(identity, tripId),
    command = await partnerCommand(
      identity,
      key,
      "hold",
      hash({ tripId, seats: [...seats].sort() }),
    );
  let hold: any = await M.Hold.findOne({
    operatorId: trip.operatorId,
    userId: identity.partnerId,
    holdId: command.resourceId,
  }).lean();
  if (!hold && Date.now() - +new Date(command.createdAt) >= 300000)
    fail(410, "HOLD_EXPIRED", "The original hold request has expired");
  if (!hold) {
    try {
      hold = await createHold(
        auth,
        String(trip._id),
        seats,
        command.resourceId,
      );
    } catch (error) {
      hold = await M.Hold.findOne({
        operatorId: trip.operatorId,
        userId: identity.partnerId,
        holdId: command.resourceId,
      }).lean();
      if (!hold) throw error;
    }
  }
  if (hold.status !== "held" || new Date(hold.expiresAt) <= new Date())
    fail(
      410,
      "HOLD_EXPIRED",
      "The original hold is no longer usable; use a new request key",
    );
  return {
    id: hold.holdId,
    tripId,
    seats: hold.seats,
    expiresAt: hold.expiresAt,
    baseFarePaise: hold.amountPaise,
    currency: "INR",
    environment: "sandbox",
  };
}
export async function ownedPublicBooking(
  identity: PartnerIdentity,
  id: string,
  session?: mongoose.ClientSession,
) {
  const ref = await P.PartnerBookingReference.findOne({
    partnerId: identity.partnerId,
    publicId: id,
  })
    .session(session || null)
    .lean();
  const booking: any =
    ref?.bookingId &&
    (await M.Booking.findOne({
      _id: ref.bookingId,
      operatorId: ref.operatorId,
      userId: identity.partnerId,
      source: "external",
    })
      .session(session || null)
      .lean());
  if (!ref || !booking)
    fail(404, "BOOKING_NOT_FOUND", "Partner booking not found");
  return {
    ref: ref!,
    booking: booking!,
    auth: partnerPrincipal(identity, String(ref!.operatorId)),
  };
}
export async function bookingView(identity: PartnerIdentity, id: string) {
  const { ref, booking } = await ownedPublicBooking(identity, id),
    cancellation = await M.Cancellation.findOne({
      operatorId: ref.operatorId,
      bookingId: booking._id,
    })
      .select("status")
      .lean();
  return {
    id: ref.publicId,
    partnerReference: ref.reference,
    status: booking.status,
    paymentStatus: booking.paymentStatus,
    pnr: booking.pnr || null,
    seats: booking.passengers.map((p: any) => p.seat),
    totalPaise: booking.totalPaise,
    currency: "INR",
    cancellationStatus: cancellation?.status || "None",
    environment: "sandbox",
    simulated: true,
  };
}
export async function createPublicBooking(
  identity: PartnerIdentity,
  input: {
    tripId: string;
    holdId: string;
    quoteId: string;
    partnerReference: string;
    passengers: any[];
    contact?: any;
  },
  key: string,
) {
  const command = await partnerCommand(identity, key, "booking", hash(input));
  const prior = await P.PartnerBookingReference.findOne({
    partnerId: identity.partnerId,
    reference: input.partnerReference,
  }).lean();
  if (prior?.publicId !== undefined && prior.publicId !== command.resourceId)
    fail(
      409,
      "PARTNER_REFERENCE_CONFLICT",
      "Partner reference belongs to another booking request",
    );
  if (prior?.bookingId) return bookingView(identity, prior.publicId);
  if (prior) {
    const existing = await M.Booking.findOne({
      operatorId: prior.operatorId,
      userId: identity.partnerId,
      source: "external",
      idempotencyKey: hash({ partner: identity.partnerId, key }),
    }).lean();
    if (existing) {
      await P.PartnerBookingReference.updateOne(
        { _id: prior._id, partnerId: identity.partnerId },
        { $set: { bookingId: existing._id } },
      );
      return bookingView(identity, prior.publicId);
    }
  }
  const { trip, auth } = await authorizedTrip(identity, input.tripId),
    quoteId = await internalResource("quote", input.quoteId);
  await P.PartnerBookingReference.updateOne(
    { publicId: command.resourceId, partnerId: identity.partnerId },
    {
      $setOnInsert: {
        reference: input.partnerReference,
        operatorId: trip.operatorId,
      },
    },
    { upsert: true },
  );
  const booking: any = await createBooking(
    auth,
    {
      tripId: String(trip._id),
      holdId: input.holdId,
      quoteId,
      passengers: input.passengers,
      ...(input.contact ? { contact: input.contact } : {}),
    },
    hash({ partner: identity.partnerId, key }),
    "external",
  );
  await P.PartnerBookingReference.updateOne(
    {
      publicId: command.resourceId,
      partnerId: identity.partnerId,
      operatorId: trip.operatorId,
    },
    { $set: { bookingId: booking._id } },
  );
  return bookingView(identity, command.resourceId);
}
export async function authorizeSandboxBooking(
  config: Config,
  identity: PartnerIdentity,
  id: string,
  key: string,
) {
  sandboxReady(config);
  await publicIndexesReady();
  await partnerCommand(
    identity,
    key,
    "confirm",
    hash({ id, funding: "sandbox-allowance" }),
  );
  await mongoose.connection.transaction(async (session) => {
    const { ref, booking } = await ownedPublicBooking(identity, id, session);
    if (ref.funded) return;
    if (booking.status !== "Pending payment")
      fail(
        409,
        "BOOKING_STATE",
        "Only a pending owned booking can receive sandbox authorization",
      );
    const partner = await P.ApiPartner.findOneAndUpdate(
      {
        _id: identity.partnerId,
        status: "Active",
        sandboxAllowancePaise: { $gte: booking.totalPaise },
      },
      { $inc: { sandboxAllowancePaise: -booking.totalPaise, revision: 1 } },
      { new: true, session },
    );
    if (!partner)
      fail(
        402,
        "SANDBOX_ALLOWANCE_REQUIRED",
        "Server-provisioned sandbox allowance is insufficient; a payment claim does not authorize confirmation",
      );
    await applyVerifiedPayment(
      {
        verified: true,
        providerId: "aibus-public-sandbox",
        eventId: ref.publicId,
        externalId: ref.publicId,
        operatorId: String(ref.operatorId),
        bookingId: String(booking._id),
        amountPaise: booking.totalPaise,
        currency: "INR",
        status: "captured",
      },
      0,
      {
        session,
        debitAccount: {
          ownerType: "Platform",
          ownerId: "aibus",
          code: "simulated-bank-clearing",
        },
      },
    );
    await P.PartnerBookingReference.updateOne(
      { _id: ref._id, funded: false },
      { $set: { funded: true } },
      { session },
    );
    await M.Audit.create(
      [
        {
          operatorId: ref.operatorId,
          actorId: identity.partnerId,
          action: "public.sandbox.authorized",
          resourceId: String(booking._id),
          metadata: { simulated: true, reference: ref.publicId },
          expiresAt: null,
        },
      ],
      { session },
    );
  });
  return bookingView(identity, id);
}
