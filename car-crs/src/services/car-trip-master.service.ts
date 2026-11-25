import mongoose from "mongoose";
import { CarTrip } from "../models/car-trip.model.js";
import { Car } from "../models/car.model.js";
import { CarRoute } from "../models/car-route.model.js";
import { CarSeatLayout } from "../models/car-seat-layout.model.js";
import { fail } from "../utils/response.js";
import { assertNoTripOverlap } from "./car-scheduling.service.js";
import {
  createCarTripSchema,
  updateCarTripSchema,
  cancelCarTripSchema,
} from "../validators/car-trip.validators.js";
import { z } from "zod";

const objectIdRegex = /^[a-fA-F0-9]{24}$/;

function assertValidObjectId(id: string, name = "id"): void {
  if (!id || !objectIdRegex.test(id)) {
    fail(400, "INVALID_ID", `Invalid ObjectId provided for ${name}`);
  }
}

async function runWithTransientRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      attempt++;
      const isTransient =
        err?.hasErrorLabel?.("TransientTransactionError") ||
        err?.message?.includes("WriteConflict") ||
        err?.code === 112;
      if (isTransient && attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Creates a scheduled car trip with physical layout snapshot and atomic concurrency write lock.
 */
export async function createCarTrip(
  operatorId: string,
  input: z.infer<typeof createCarTripSchema>
) {
  assertValidObjectId(operatorId, "operatorId");
  const validated = createCarTripSchema.parse(input);

  return await runWithTransientRetry(async () => {
    let createdTrip: any;

    await mongoose.connection.transaction(async (session) => {
      // 1. Acquire exclusive write lock on Car document for this transaction
      const car: any = await Car.findOneAndUpdate(
        { _id: validated.carId, operatorId, status: "Active" },
        { $inc: { revision: 1 } },
        { session, new: true }
      );

      if (!car) {
        fail(404, "CAR_NOT_FOUND", "Active car record not found for this operator");
      }

      if (car.status === "Under Maintenance") {
        fail(400, "CAR_UNDER_MAINTENANCE", "Vehicle is currently Under Maintenance and cannot be scheduled");
      }

      if (!car.activeLayoutId) {
        fail(400, "CAR_MISSING_LAYOUT", "Vehicle does not have an active seat layout assigned");
      }

      // 2. Validate route
      const route: any = await CarRoute.findOne({
        _id: validated.routeId,
        operatorId,
        status: "Active",
      }).session(session);

      if (!route) {
        fail(404, "ROUTE_NOT_FOUND", "Active route not found for this operator");
      }

      // 3. Load active seat layout for snapshot
      const layout: any = await CarSeatLayout.findOne({
        _id: car.activeLayoutId,
        operatorId,
        status: "Active",
      }).session(session);

      if (!layout) {
        fail(404, "LAYOUT_NOT_FOUND", "Active layout record not found for vehicle");
      }

      if (layout.bookablePassengerCapacity !== car.bookablePassengerCapacity) {
        fail(
          400,
          "CAPACITY_MISMATCH",
          `Layout capacity (${layout.bookablePassengerCapacity}) must match vehicle capacity (${car.bookablePassengerCapacity})`
        );
      }

      // 4. Overlap & turnaround buffer check inside transaction
      await assertNoTripOverlap(
        {
          carId: validated.carId,
          departureAt: validated.departureAt,
          estimatedArrivalAt: validated.estimatedArrivalAt,
          turnaroundBufferMinutes: validated.turnaroundBufferMinutes || 30,
        },
        session
      );

      // 5. Generate inventory seats snapshot with seat-wise fare pricing
      const baseFare = validated.baseFarePaise || 50000;
      const overridesMap = new Map(
        (validated.seatFareOverrides || []).map((o) => [o.seatId, o.farePaise])
      );

      const inventorySeats = layout.seats.map((s: any) => {
        let farePaise = s.baseFarePaise || baseFare;

        if (s.isDriver) {
          farePaise = 0;
        } else if (overridesMap.has(s.seatId)) {
          farePaise = overridesMap.get(s.seatId)!;
        } else if (s.category === "front_passenger") {
          farePaise = Math.round(baseFare * 1.1);
        } else if (s.category === "middle") {
          farePaise = Math.round(baseFare * 0.9);
        } else if (s.category === "rear_window") {
          farePaise = Math.round(baseFare * 0.95);
        } else {
          farePaise = baseFare;
        }

        return {
          seatId: s.seatId,
          label: s.label,
          row: s.row,
          column: s.column,
          isDriver: s.isDriver,
          isBookable: s.isBookable,
          category: s.category,
          baseFarePaise: s.baseFarePaise || baseFare,
          farePaise,
          state: "available",
        };
      });

      const cleanReg = car.registration.replace(/[^A-Za-z0-9]/g, "");
      const datePart = validated.journeyDate.replace(/-/g, "");
      const randPart = Math.floor(1000 + Math.random() * 9000);
      const tripNumber = `TRIP-${datePart}-${cleanReg.slice(-4)}-${randPart}`;

      const [trip] = await CarTrip.create(
        [
          {
            operatorId,
            tripNumber,
            tripType: validated.tripType,
            carId: car._id,
            routeId: route._id,
            layoutId: layout._id,
            vehicleCategory: car.category,
            totalPhysicalSeats: car.totalPhysicalSeats,
            bookableCapacity: car.bookablePassengerCapacity,
            journeyDate: validated.journeyDate,
            departureAt: validated.departureAt,
            estimatedArrivalAt: validated.estimatedArrivalAt,
            turnaroundBufferMinutes: validated.turnaroundBufferMinutes || 30,
            status: validated.status,
            bookingOpen: validated.status === "Scheduled",
            publishedAt: validated.status === "Scheduled" ? new Date() : undefined,
            fareRules: {
              baseFarePaise: baseFare,
              frontPassengerPremiumPaise: Math.round(baseFare * 0.1),
              windowSeatPaise: baseFare,
              middleDiscountPaise: Math.round(baseFare * 0.1),
            },
            seats: inventorySeats,
          },
        ],
        { session }
      );

      createdTrip = trip.toObject();
    });

    return createdTrip;
  });
}

/**
 * Transitions a Draft trip to Scheduled and opens bookings.
 */
export async function publishCarTrip(operatorId: string, tripId: string) {
  assertValidObjectId(operatorId, "operatorId");
  assertValidObjectId(tripId, "tripId");

  const trip = await CarTrip.findOne({ _id: tripId, operatorId });
  if (!trip) {
    fail(404, "TRIP_NOT_FOUND", "Trip record not found for this operator");
  }

  if (trip.status === "Cancelled") {
    fail(400, "CANNOT_PUBLISH_CANCELLED", "Cannot publish a cancelled trip");
  }

  if (trip.status === "Completed") {
    fail(400, "CANNOT_PUBLISH_COMPLETED", "Cannot publish an already completed trip");
  }

  trip.status = "Scheduled";
  trip.bookingOpen = true;
  trip.publishedAt = new Date();
  await trip.save();

  return trip.toObject();
}

/**
 * Closes sales for a trip without cancelling it.
 */
export async function closeCarTripSales(operatorId: string, tripId: string) {
  assertValidObjectId(operatorId, "operatorId");
  assertValidObjectId(tripId, "tripId");

  const trip = await CarTrip.findOne({ _id: tripId, operatorId });
  if (!trip) {
    fail(404, "TRIP_NOT_FOUND", "Trip record not found for this operator");
  }

  trip.bookingOpen = false;
  trip.closedSalesAt = new Date();
  await trip.save();

  return trip.toObject();
}

/**
 * Cancels a scheduled trip with audit reason.
 */
export async function cancelCarTrip(
  operatorId: string,
  tripId: string,
  input: z.infer<typeof cancelCarTripSchema>
) {
  assertValidObjectId(operatorId, "operatorId");
  assertValidObjectId(tripId, "tripId");
  const validated = cancelCarTripSchema.parse(input);

  const trip = await CarTrip.findOne({ _id: tripId, operatorId });
  if (!trip) {
    fail(404, "TRIP_NOT_FOUND", "Trip record not found for this operator");
  }

  if (trip.status === "Cancelled") {
    fail(400, "ALREADY_CANCELLED", "Trip is already cancelled");
  }

  if (trip.status === "Completed") {
    fail(400, "CANNOT_CANCEL_COMPLETED", "Cannot cancel an already completed trip");
  }

  trip.status = "Cancelled";
  trip.bookingOpen = false;
  trip.cancellationReason = validated.reason;
  await trip.save();

  return trip.toObject();
}

/**
 * Lists trips for an operator with comprehensive filtering and pagination.
 */
export async function listOperatorTrips(
  operatorId: string,
  query: {
    page?: number | string;
    limit?: number | string;
    status?: string;
    routeId?: string;
    carId?: string;
    journeyDate?: string;
    dateFrom?: string;
    dateTo?: string;
  }
) {
  assertValidObjectId(operatorId, "operatorId");
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter: Record<string, any> = { operatorId };

  if (query.status) {
    filter.status = query.status;
  }

  if (query.routeId) {
    assertValidObjectId(query.routeId, "routeId");
    filter.routeId = query.routeId;
  }

  if (query.carId) {
    assertValidObjectId(query.carId, "carId");
    filter.carId = query.carId;
  }

  if (query.journeyDate) {
    filter.journeyDate = query.journeyDate;
  } else if (query.dateFrom || query.dateTo) {
    filter.departureAt = {};
    if (query.dateFrom) filter.departureAt.$gte = new Date(query.dateFrom);
    if (query.dateTo) filter.departureAt.$lte = new Date(query.dateTo);
  }

  const [trips, total] = await Promise.all([
    CarTrip.find(filter)
      .populate("carId", "registration make modelName category bookablePassengerCapacity")
      .populate("routeId", "source destination distanceKm estimatedDurationMinutes")
      .sort({ departureAt: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    CarTrip.countDocuments(filter),
  ]);

  return {
    data: trips,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Gets trip details including seat inventory and populated vehicle/route info.
 */
export async function getCarTripDetails(operatorId: string, tripId: string) {
  assertValidObjectId(operatorId, "operatorId");
  assertValidObjectId(tripId, "tripId");

  const trip: any = await CarTrip.findOne({ _id: tripId, operatorId })
    .populate("carId")
    .populate("routeId")
    .lean();

  if (!trip) {
    fail(404, "TRIP_NOT_FOUND", "Trip record not found for this operator");
  }

  return trip;
}

/**
 * Updates trip attributes (times, buffer, fares).
 */
export async function updateCarTrip(
  operatorId: string,
  tripId: string,
  input: z.infer<typeof updateCarTripSchema>
) {
  assertValidObjectId(operatorId, "operatorId");
  assertValidObjectId(tripId, "tripId");
  const validated = updateCarTripSchema.parse(input);

  const trip = await CarTrip.findOne({ _id: tripId, operatorId });
  if (!trip) {
    fail(404, "TRIP_NOT_FOUND", "Trip record not found for this operator");
  }

  if (["Completed", "Cancelled"].includes(trip.status)) {
    fail(400, "CANNOT_UPDATE_TERMINAL_TRIP", `Cannot update a trip in status '${trip.status}'`);
  }

  // If departure or arrival changed, re-check overlap with other trips
  if (validated.departureAt || validated.estimatedArrivalAt || validated.turnaroundBufferMinutes) {
    const newDep = validated.departureAt || trip.departureAt;
    const newArr = validated.estimatedArrivalAt || trip.estimatedArrivalAt;
    const newBuffer = validated.turnaroundBufferMinutes ?? trip.turnaroundBufferMinutes;

    await assertNoTripOverlap({
      carId: trip.carId.toString(),
      departureAt: newDep,
      estimatedArrivalAt: newArr,
      turnaroundBufferMinutes: newBuffer,
      excludeTripId: trip._id.toString(),
    });

    trip.departureAt = newDep;
    trip.estimatedArrivalAt = newArr;
    trip.turnaroundBufferMinutes = newBuffer;
  }

  if (validated.bookingOpen !== undefined) {
    trip.bookingOpen = validated.bookingOpen;
  }

  if (validated.baseFarePaise !== undefined) {
    const baseFare = validated.baseFarePaise;
    trip.seats.forEach((s: any) => {
      if (!s.isDriver && s.state === "available") {
        if (s.category === "front_passenger") s.farePaise = Math.round(baseFare * 1.1);
        else if (s.category === "middle") s.farePaise = Math.round(baseFare * 0.9);
        else if (s.category === "rear_window") s.farePaise = Math.round(baseFare * 0.95);
        else s.farePaise = baseFare;
      }
    });
  }

  await trip.save();
  return trip.toObject();
}

/**
 * Operator controls: Blocks or unblocks a specific passenger seat.
 */
export async function setSeatBlockStatus(
  operatorId: string,
  tripId: string,
  seatId: string,
  block: boolean,
  reason?: string
) {
  assertValidObjectId(operatorId, "operatorId");
  assertValidObjectId(tripId, "tripId");

  const trip = await CarTrip.findOne({ _id: tripId, operatorId });
  if (!trip) {
    fail(404, "TRIP_NOT_FOUND", "Trip record not found for this operator");
  }

  const seatIndex = trip.seats.findIndex((s: any) => s.seatId === seatId);
  if (seatIndex === -1) {
    fail(404, "SEAT_NOT_FOUND", `Seat '${seatId}' not found in trip inventory`);
  }

  const seat = trip.seats[seatIndex];
  if (seat.isDriver) {
    fail(400, "CANNOT_MODIFY_DRIVER_SEAT", "Driver seat is permanently non-bookable and cannot be altered");
  }

  if (block) {
    if (seat.state === "booked" || seat.state === "held") {
      fail(409, "SEAT_OCCUPIED", `Cannot block seat '${seatId}' because it is currently ${seat.state}`);
    }
    seat.state = "blocked";
  } else {
    if (seat.state === "blocked") {
      seat.state = "available";
    }
  }

  trip.markModified("seats");
  await trip.save();

  return {
    seatId: seat.seatId,
    state: seat.state,
    reason,
  };
}
