import mongoose from "mongoose";
import { CarTrip } from "../models/car-trip.model.js";
import { Car } from "../models/car.model.js";

export interface SchedulingInterval {
  carId: string | mongoose.Types.ObjectId;
  departureAt: Date;
  estimatedArrivalAt: Date;
  turnaroundBufferMinutes?: number;
  excludeTripId?: string | mongoose.Types.ObjectId;
}

export interface OverlapDetectionResult {
  hasOverlap: boolean;
  conflictingTrip?: any;
  reason?: string;
}

/**
 * Detects overlapping trips for a car.
 * A car cannot be scheduled for two trips whose operational intervals overlap.
 * Operational Interval = [departureAt, estimatedArrivalAt + turnaroundBufferMinutes]
 */
export async function detectTripOverlap(
  interval: SchedulingInterval,
  session?: mongoose.ClientSession
): Promise<OverlapDetectionResult> {
  const {
    carId,
    departureAt,
    estimatedArrivalAt,
    turnaroundBufferMinutes = 30,
    excludeTripId,
  } = interval;

  const depTime = new Date(departureAt);
  const arrTime = new Date(estimatedArrivalAt);

  if (arrTime <= depTime) {
    return {
      hasOverlap: true,
      reason: "Invalid interval: estimatedArrivalAt must be strictly after departureAt",
    };
  }

  // Effective arrival includes turnaround buffer (cleaning, refueling, rest)
  const effectiveArrival = new Date(+arrTime + turnaroundBufferMinutes * 60000);

  // Overlap query logic:
  // Existing trip interval [E_dep, E_effArr] overlaps with proposed [P_dep, P_effArr] if:
  // E_dep < P_effArr AND E_effArr > P_dep
  const query: Record<string, any> = {
    carId,
    status: { $in: ["Scheduled", "Boarding", "On Road"] },
    departureAt: { $lt: effectiveArrival },
    effectiveArrivalAt: { $gt: depTime },
  };

  if (excludeTripId) {
    query._id = { $ne: excludeTripId };
  }

  const conflictingTrip: any = await CarTrip.findOne(query)
    .session(session || null)
    .lean();

  if (conflictingTrip) {
    return {
      hasOverlap: true,
      conflictingTrip,
      reason:
        `Trip interval overlaps with existing trip (${conflictingTrip._id}) ` +
        `scheduled from ${new Date(conflictingTrip.departureAt).toISOString()} ` +
        `to ${new Date(conflictingTrip.effectiveArrivalAt).toISOString()} ` +
        `(including ${conflictingTrip.turnaroundBufferMinutes || 30}m turnaround buffer).`,
    };
  }

  return { hasOverlap: false };
}

/**
 * Asserts no trip overlap exists, throwing an actionable Error if one does.
 */
export async function assertNoTripOverlap(
  interval: SchedulingInterval,
  session?: mongoose.ClientSession
): Promise<void> {
  const result = await detectTripOverlap(interval, session);
  if (result.hasOverlap) {
    const error = new Error(`TRIP_SCHEDULING_CONFLICT: ${result.reason}`);
    (error as any).code = "TRIP_SCHEDULING_CONFLICT";
    (error as any).status = 409;
    (error as any).conflictingTrip = result.conflictingTrip;
    throw error;
  }
}

/**
 * Concurrency-safe trip scheduling inside an atomic MongoDB transaction.
 * Serializes concurrent requests per vehicle using an atomic revision lock on Car.
 */
export async function scheduleCarTripConcurrencySafe(
  operatorId: string,
  tripData: {
    carId: string | mongoose.Types.ObjectId;
    routeId: string | mongoose.Types.ObjectId;
    journeyDate: string;
    departureAt: Date;
    estimatedArrivalAt: Date;
    turnaroundBufferMinutes?: number;
    seats: any[];
    fareOverridePaise?: number;
  }
) {
  let createdTrip: any;

  await mongoose.connection.transaction(async (session) => {
    // 1. Acquire exclusive write lock on Car document for this transaction
    const car = await Car.findOneAndUpdate(
      { _id: tripData.carId, operatorId, status: "Active" },
      { $inc: { revision: 1 } },
      { session, new: true }
    );

    if (!car) {
      const err: any = new Error("Active car not found for this operator");
      err.status = 404;
      err.code = "CAR_NOT_FOUND";
      throw err;
    }

    // 2. Run interval overlap check inside transaction session
    await assertNoTripOverlap(
      {
        carId: tripData.carId,
        departureAt: tripData.departureAt,
        estimatedArrivalAt: tripData.estimatedArrivalAt,
        turnaroundBufferMinutes: tripData.turnaroundBufferMinutes || 30,
      },
      session
    );

    // 3. Create the trip atomically
    const [trip] = await CarTrip.create(
      [
        {
          operatorId,
          carId: tripData.carId,
          routeId: tripData.routeId,
          journeyDate: tripData.journeyDate,
          departureAt: tripData.departureAt,
          estimatedArrivalAt: tripData.estimatedArrivalAt,
          turnaroundBufferMinutes: tripData.turnaroundBufferMinutes || 30,
          seats: tripData.seats,
          fareOverridePaise: tripData.fareOverridePaise,
          status: "Scheduled",
          bookingOpen: true,
        },
      ],
      { session }
    );

    createdTrip = trip.toObject();
  });

  return createdTrip;
}
