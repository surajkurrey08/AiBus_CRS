import mongoose from "mongoose";
import { CarTrip } from "../models/car-trip.model.js";
import { CarSeatHold } from "../models/car-hold.model.js";
import { fail } from "../utils/response.js";
import crypto from "node:crypto";

const objectIdRegex = /^[a-fA-F0-9]{24}$/;

function assertValidObjectId(id: string, name = "id"): void {
  if (!id || !objectIdRegex.test(id)) {
    fail(400, "INVALID_ID", `Invalid ObjectId provided for ${name}`);
  }
}

export interface CreateHoldParams {
  operatorId: string;
  userId: string;
  tripId: string;
  seatIds: string[];
  legType?: "outbound" | "return" | "single";
  holdDurationSeconds?: number;
}

export interface CreateRoundTripHoldParams {
  operatorId: string;
  userId: string;
  outboundTripId: string;
  outboundSeatIds: string[];
  returnTripId: string;
  returnSeatIds: string[];
  holdDurationSeconds?: number;
}

/**
 * Creates a concurrency-safe, server-controlled seat hold for a scheduled car trip.
 * Invariants:
 * 1. Driver seat 'D' is NEVER holdable.
 * 2. A seat cannot have two active holds simultaneously.
 * 3. Server controls expiry time (default 10 minutes).
 * 4. Trip must be Scheduled and bookingOpen.
 */
export async function createSeatHold(params: CreateHoldParams) {
  const {
    operatorId,
    userId,
    tripId,
    seatIds,
    legType = "single",
    holdDurationSeconds = 600, // 10 minutes
  } = params;

  assertValidObjectId(tripId, "tripId");

  if (!seatIds || !Array.isArray(seatIds) || seatIds.length === 0) {
    fail(400, "INVALID_SEATS", "Hold request must include at least one passenger seat");
  }

  // Invariant: Driver seat D is NEVER bookable or holdable
  if (seatIds.includes("D")) {
    fail(400, "DRIVER_SEAT_NOT_BOOKABLE", "Driver seat ('D') is physical only and cannot be held or booked");
  }

  // De-duplicate requested seats
  const uniqueSeatIds = Array.from(new Set(seatIds));

  // 1. Fetch trip and verify publication & sales status
  const trip = await CarTrip.findOne({ _id: tripId, operatorId });
  if (!trip) {
    fail(404, "TRIP_NOT_FOUND", "Scheduled car trip not found");
  }

  if (trip.status !== "Scheduled" || !trip.bookingOpen) {
    fail(400, "BOOKING_CLOSED", "Scheduled car trip is not currently open for booking");
  }

  if (new Date(trip.departureAt) <= new Date()) {
    fail(400, "TRIP_DEPARTED", "Cannot hold seats on a trip that has already departed");
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + holdDurationSeconds * 1000);
  const holdId = `HOLD-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

  // 2. Validate seat availability in memory first
  let totalAmountPaise = 0;
  const seatsToUpdate: string[] = [];

  for (const sId of uniqueSeatIds) {
    const seat: any = trip.seats.find((s: any) => s.seatId === sId);
    if (!seat) {
      fail(404, "SEAT_NOT_FOUND", `Seat '${sId}' does not exist on this car layout`);
    }

    if (seat.isDriver || !seat.isBookable) {
      fail(400, "SEAT_NOT_BOOKABLE", `Seat '${sId}' cannot be booked`);
    }

    // Check if currently available or hold has expired
    const isAvailable =
      seat.state === "available" ||
      (seat.state === "held" && seat.holdUntil && new Date(seat.holdUntil) <= now);

    if (!isAvailable) {
      fail(
        409,
        "SEAT_UNAVAILABLE",
        `Seat '${sId}' is currently ${seat.state} and cannot be held`
      );
    }

    totalAmountPaise += seat.farePaise;
    seatsToUpdate.push(sId);
  }

  // 3. Concurrency-safe atomic update
  // We use findOneAndUpdate with condition that all requested seats are either 'available'
  // or their hold has expired, and check revision
  const condition: any = {
    _id: trip._id,
    status: "Scheduled",
    bookingOpen: true,
  };

  // For each seat, it must either be available or have holdUntil <= now
  for (const sId of seatsToUpdate) {
    condition.$and = condition.$and || [];
    condition.$and.push({
      seats: {
        $elemMatch: {
          seatId: sId,
          $or: [
            { state: "available" },
            { state: "held", holdUntil: { $lte: now } },
          ],
        },
      },
    });
  }

  // Prepare arrayFilters and update
  const arrayFilters: any[] = [];
  const setFields: Record<string, any> = {
    $inc: { revision: 1 },
  };

  seatsToUpdate.forEach((sId, idx) => {
    const filterKey = `s${idx}`;
    arrayFilters.push({ [`${filterKey}.seatId`]: sId });
    setFields.$set = setFields.$set || {};
    setFields.$set[`seats.$[${filterKey}].state`] = "held";
    setFields.$set[`seats.$[${filterKey}].holdId`] = holdId;
    setFields.$set[`seats.$[${filterKey}].holdUserId`] = new mongoose.Types.ObjectId(userId);
    setFields.$set[`seats.$[${filterKey}].holdUntil`] = expiresAt;
  });

  const updatedTrip = await CarTrip.findOneAndUpdate(condition, setFields, {
    arrayFilters,
    new: true,
  });

  if (!updatedTrip) {
    fail(
      409,
      "SEAT_CONCURRENCY_CONFLICT",
      "One or more selected seats were locked by another passenger. Please select available seats."
    );
  }

  // 4. Create CarSeatHold record
  const hold = await CarSeatHold.create({
    operatorId,
    tripId: trip._id,
    userId: new mongoose.Types.ObjectId(userId),
    holdId,
    legType,
    seatIds: uniqueSeatIds,
    amountPaise: totalAmountPaise,
    expiresAt,
    status: "held",
  });

  return {
    holdId: hold.holdId,
    tripId: trip._id.toString(),
    tripNumber: trip.tripNumber,
    legType,
    seatIds: uniqueSeatIds,
    heldSeats: uniqueSeatIds,
    amountPaise: totalAmountPaise,
    expiresAt: hold.expiresAt,
    status: hold.status,
  };
}

/**
 * Creates an atomic-like round-trip seat hold across two independent car trips.
 * Invariant: If the return leg hold fails, the outbound hold is immediately rolled back!
 */
export async function createRoundTripSeatHold(params: CreateRoundTripHoldParams) {
  const {
    operatorId,
    userId,
    outboundTripId,
    outboundSeatIds,
    returnTripId,
    returnSeatIds,
    holdDurationSeconds = 600,
  } = params;

  // 1. Hold Outbound Leg
  const outboundHold = await createSeatHold({
    operatorId,
    userId,
    tripId: outboundTripId,
    seatIds: outboundSeatIds,
    legType: "outbound",
    holdDurationSeconds,
  });

  // 2. Hold Return Leg
  try {
    const returnHold = await createSeatHold({
      operatorId,
      userId,
      tripId: returnTripId,
      seatIds: returnSeatIds,
      legType: "return",
      holdDurationSeconds,
    });

    return {
      bookingType: "ROUND_TRIP",
      outboundHold,
      returnHold,
      outboundHoldId: outboundHold.holdId,
      returnHoldId: returnHold.holdId,
      combinedAmountPaise: outboundHold.amountPaise + returnHold.amountPaise,
      expiresAt: new Date(
        Math.min(+new Date(outboundHold.expiresAt), +new Date(returnHold.expiresAt))
      ),
    };
  } catch (err) {
    // Compensating rollback: release outbound hold if return leg fails
    await releaseSeatHold(outboundHold.holdId, userId, operatorId).catch(() => {});
    throw err;
  }
}

/**
 * Retrieves hold details and lazily updates status if expired.
 */
export async function getSeatHold(holdId: string, owner: { operatorId: string; userId: string }) {
  const hold: any = await CarSeatHold.findOne({ holdId, ...owner }).lean();
  if (!hold) {
    fail(404, "HOLD_NOT_FOUND", `Seat hold '${holdId}' was not found`);
  }

  const isExpired = new Date(hold.expiresAt) <= new Date();
  if (isExpired && hold.status === "held") {
    await CarSeatHold.updateOne({ _id: hold._id }, { status: "expired" });
    hold.status = "expired";
  }

  return hold;
}

/**
 * Releases a seat hold early, restoring seats to 'available'.
 */
export async function releaseSeatHold(holdId: string, userId: string, operatorId: string) {
  const filter = { holdId, userId, operatorId, status: "held" };

  const hold = await CarSeatHold.findOne(filter);
  if (!hold) {
    // If already released, return existing state
    const existing = await CarSeatHold.findOne({ holdId, userId, operatorId });
    if (existing) {
      return { holdId, status: existing.status, released: false };
    }
    fail(404, "HOLD_NOT_FOUND", "Seat hold not found or already consumed");
  }

  // 1. Mark hold as released
  hold.status = "released";
  await hold.save();

  // 2. Restore seat inventory on CarTrip
  const trip = await CarTrip.findById(hold.tripId);
  if (trip) {
    const seatsToFree = new Set(hold.seatIds);
    let modified = false;

    for (const s of trip.seats) {
      if (seatsToFree.has(s.seatId) && s.holdId === holdId && s.state === "held") {
        s.state = "available";
        s.holdId = undefined as any;
        s.holdUserId = undefined as any;
        s.holdUntil = undefined as any;
        modified = true;
      }
    }

    if (modified) {
      trip.markModified("seats");
      await trip.save();
    }
  }

  return {
    holdId: hold.holdId,
    status: "released",
    released: true,
  };
}

/**
 * Validates that a hold is active, valid, and covers the requested seats for a booking.
 */
export async function validateHoldForBooking(tripId: string, holdId: string, seatIds: string[]) {
  const hold = await CarSeatHold.findOne({
    tripId: new mongoose.Types.ObjectId(tripId),
    holdId,
    status: "held",
  });

  if (!hold) {
    fail(404, "HOLD_NOT_FOUND", `Active hold '${holdId}' not found for trip`);
  }

  if (new Date(hold.expiresAt) <= new Date()) {
    hold.status = "expired";
    await hold.save();
    fail(410, "HOLD_EXPIRED", "Seat hold has expired. Please select seats and re-hold.");
  }

  // Check seat coverage
  const heldSet = new Set(hold.seatIds);
  for (const s of seatIds) {
    if (!heldSet.has(s)) {
      fail(400, "HOLD_MISMATCH", `Seat '${s}' is not covered by hold '${holdId}'`);
    }
  }

  return hold;
}
