import mongoose from "mongoose";
import { CarTrip } from "../models/car-trip.model.js";
import { CarRoute } from "../models/car-route.model.js";
import { Car } from "../models/car.model.js";
import { fail } from "../utils/response.js";
import {
  searchOneWayTripsSchema,
  searchRoundTripsSchema,
  fareQuoteSchema,
} from "../validators/car-trip.validators.js";
import { z } from "zod";

const objectIdRegex = /^[a-fA-F0-9]{24}$/;

function assertValidObjectId(id: string, name = "id"): void {
  if (!id || !objectIdRegex.test(id)) {
    fail(400, "INVALID_ID", `Invalid ObjectId provided for ${name}`);
  }
}

/**
 * Lists all active departure and arrival cities across active car routes.
 */
export async function getCarCities() {
  const routes = await CarRoute.find({ status: "Active" }, "source destination").lean();
  const citySet = new Set<string>();
  for (const r of routes) {
    if (r.source) citySet.add(r.source.trim());
    if (r.destination) citySet.add(r.destination.trim());
  }
  return Array.from(citySet).sort();
}

/**
 * Lists active car routes with boarding and dropping points.
 */
export async function getCarRoutes(query: { source?: string; destination?: string }) {
  const filter: Record<string, any> = { status: "Active" };
  if (query.source) {
    filter.source = { $regex: new RegExp(`^${query.source.trim()}$`, "i") };
  }
  if (query.destination) {
    filter.destination = { $regex: new RegExp(`^${query.destination.trim()}$`, "i") };
  }

  return await CarRoute.find(filter)
    .sort({ source: 1, destination: 1 })
    .lean();
}

/**
 * Searches available scheduled car trips for One Way travel.
 */
export async function searchOneWayTrips(params: z.infer<typeof searchOneWayTripsSchema>) {
  const validated = searchOneWayTripsSchema.parse(params);

  // 1. Find matching active routes
  const routes = await CarRoute.find({
    source: { $regex: new RegExp(`^${validated.source.trim()}$`, "i") },
    destination: { $regex: new RegExp(`^${validated.destination.trim()}$`, "i") },
    status: "Active",
  }).lean();

  if (routes.length === 0) {
    return {
      data: [],
      meta: { total: 0, page: validated.page, limit: validated.limit, totalPages: 0 },
    };
  }

  const routeIds = routes.map((r) => r._id);
  const routeMap = new Map(routes.map((r: any) => [r._id.toString(), r]));

  // 2. Query scheduled trips
  const tripFilter: Record<string, any> = {
    routeId: { $in: routeIds },
    journeyDate: validated.journeyDate,
    status: "Scheduled",
    bookingOpen: true,
    departureAt: { $gt: new Date() },
  };

  if (validated.vehicleCategory) {
    tripFilter.vehicleCategory = validated.vehicleCategory;
  }

  const trips: any = await CarTrip.find(tripFilter)
    .populate("carId", "registration make modelName category driveOrientation bookablePassengerCapacity")
    .sort({ departureAt: 1 })
    .lean();

  // 3. Filter and enrich with available seat metrics
  const passengerCount = validated.passengerCount || 1;
  const enrichedTrips: any[] = [];

  for (const t of trips) {
    const bookableAvailableSeats = t.seats.filter(
      (s: any) => s.isBookable && !s.isDriver && s.state === "available"
    );

    if (bookableAvailableSeats.length >= passengerCount) {
      const minFare = bookableAvailableSeats.reduce(
        (min: number, s: any) => (s.farePaise < min ? s.farePaise : min),
        bookableAvailableSeats[0].farePaise
      );
      const maxFare = bookableAvailableSeats.reduce(
        (max: number, s: any) => (s.farePaise > max ? s.farePaise : max),
        bookableAvailableSeats[0].farePaise
      );

      const routeInfo = routeMap.get(t.routeId.toString()) || t.routeId;

      enrichedTrips.push({
        _id: t._id,
        tripNumber: t.tripNumber,
        journeyDate: t.journeyDate,
        departureAt: t.departureAt,
        estimatedArrivalAt: t.estimatedArrivalAt,
        vehicleCategory: t.vehicleCategory,
        totalPhysicalSeats: t.totalPhysicalSeats,
        bookableCapacity: t.bookableCapacity,
        availableSeatsCount: bookableAvailableSeats.length,
        minFarePaise: minFare,
        maxFarePaise: maxFare,
        car: t.carId,
        route: {
          _id: routeInfo._id,
          source: routeInfo.source,
          destination: routeInfo.destination,
          distanceKm: routeInfo.distanceKm,
          estimatedDurationMinutes: routeInfo.estimatedDurationMinutes,
          boarding: routeInfo.boarding || [],
          dropping: routeInfo.dropping || [],
        },
      });
    }
  }

  // 4. Paginate
  const total = enrichedTrips.length;
  const skip = (validated.page - 1) * validated.limit;
  const paged = enrichedTrips.slice(skip, skip + validated.limit);

  return {
    data: paged,
    meta: {
      total,
      page: validated.page,
      limit: validated.limit,
      totalPages: Math.ceil(total / validated.limit),
    },
  };
}

/**
 * Searches available scheduled car trips for Round Trip travel with separate outbound and return options.
 */
export async function searchRoundTrips(params: z.infer<typeof searchRoundTripsSchema>) {
  const validated = searchRoundTripsSchema.parse(params);

  // Search outbound leg: source -> destination on outboundDate
  const outboundResult = await searchOneWayTrips({
    source: validated.source,
    destination: validated.destination,
    journeyDate: validated.outboundDate,
    passengerCount: validated.passengerCount,
    vehicleCategory: validated.vehicleCategory,
    page: validated.page,
    limit: validated.limit,
  });

  // Search return leg: destination -> source on returnDate
  const returnResult = await searchOneWayTrips({
    source: validated.destination,
    destination: validated.source,
    journeyDate: validated.returnDate,
    passengerCount: validated.passengerCount,
    vehicleCategory: validated.vehicleCategory,
    page: validated.page,
    limit: validated.limit,
  });

  // Filter return trips: if outboundDate === returnDate, return trip departure must be after earliest outbound arrival
  let validReturnTrips = returnResult.data;
  if (validated.outboundDate === validated.returnDate && outboundResult.data.length > 0) {
    const earliestOutboundArrival = new Date(
      Math.min(...outboundResult.data.map((t: any) => +new Date(t.estimatedArrivalAt)))
    );
    validReturnTrips = returnResult.data.filter(
      (t: any) => new Date(t.departureAt) > earliestOutboundArrival
    );
  }

  return {
    data: {
      outboundTrips: outboundResult.data,
      returnTrips: validReturnTrips,
    },
    meta: {
      outboundTotal: outboundResult.meta.total,
      returnTotal: validReturnTrips.length,
      outboundDate: validated.outboundDate,
      returnDate: validated.returnDate,
    },
  };
}

/**
 * Retrieves public trip details.
 */
export async function getTripPublicById(tripId: string) {
  assertValidObjectId(tripId, "tripId");

  const trip: any = await CarTrip.findOne({ _id: tripId, status: "Scheduled" })
    .populate("carId", "registration make modelName category bookablePassengerCapacity driveOrientation")
    .populate("routeId", "source destination distanceKm estimatedDurationMinutes boarding dropping")
    .lean();

  if (!trip) {
    fail(404, "TRIP_NOT_FOUND", "Scheduled car trip not found or booking closed");
  }

  const bookableSeats = trip.seats.filter((s: any) => s.isBookable && !s.isDriver);
  const availableSeats = bookableSeats.filter((s: any) => s.state === "available");

  return {
    _id: trip._id,
    tripNumber: trip.tripNumber,
    journeyDate: trip.journeyDate,
    departureAt: trip.departureAt,
    estimatedArrivalAt: trip.estimatedArrivalAt,
    vehicleCategory: trip.vehicleCategory,
    totalPhysicalSeats: trip.totalPhysicalSeats,
    bookableCapacity: trip.bookableCapacity,
    availableSeatsCount: availableSeats.length,
    bookingOpen: trip.bookingOpen,
    car: trip.carId,
    route: trip.routeId,
  };
}

/**
 * Retrieves real-time seat inventory availability for passenger seat selection.
 * Driver seat is strictly marked non-bookable.
 */
export async function getTripSeatsPublic(tripId: string) {
  assertValidObjectId(tripId, "tripId");

  const trip: any = await CarTrip.findById(tripId)
    .populate("carId", "registration make modelName category driveOrientation")
    .lean();

  if (!trip) {
    fail(404, "TRIP_NOT_FOUND", "Car trip not found");
  }

  const cleanSeats = trip.seats.map((s: any) => ({
    seatId: s.seatId,
    label: s.label,
    row: s.row,
    column: s.column,
    isDriver: s.isDriver,
    isBookable: s.isBookable,
    category: s.category,
    farePaise: s.farePaise,
    state: s.isDriver ? "non_bookable" : s.state,
  }));

  return {
    tripId: trip._id,
    tripNumber: trip.tripNumber,
    vehicleCategory: trip.vehicleCategory,
    driveOrientation: trip.carId?.driveOrientation || "RHD",
    totalPhysicalSeats: trip.totalPhysicalSeats,
    bookableCapacity: trip.bookableCapacity,
    bookingOpen: trip.bookingOpen && trip.status === "Scheduled",
    seats: cleanSeats,
  };
}

/**
 * Authoritative backend fare quotation calculation in integer paise.
 */
export async function quoteTripFare(params: z.infer<typeof fareQuoteSchema>) {
  const validated = fareQuoteSchema.parse(params);

  // 1. Validate outbound trip & seats
  const outboundTrip: any = await CarTrip.findById(validated.outboundTripId).lean();
  if (!outboundTrip) {
    fail(404, "TRIP_NOT_FOUND", "Outbound car trip not found");
  }
  if (outboundTrip.status !== "Scheduled" || !outboundTrip.bookingOpen) {
    fail(400, "BOOKING_CLOSED", "Outbound trip is not open for booking");
  }

  const outboundSeatsBreakdown: any[] = [];
  let outboundTotalPaise = 0;

  for (const seatId of validated.outboundSeatIds) {
    const seat = outboundTrip.seats.find((s: any) => s.seatId === seatId);
    if (!seat) {
      fail(404, "SEAT_NOT_FOUND", `Seat '${seatId}' does not exist on outbound trip`);
    }
    if (seat.isDriver || !seat.isBookable) {
      fail(400, "SEAT_NOT_BOOKABLE", `Seat '${seatId}' is the driver seat and cannot be booked`);
    }
    if (seat.state !== "available") {
      fail(409, "SEAT_UNAVAILABLE", `Seat '${seatId}' is currently ${seat.state}`);
    }

    outboundSeatsBreakdown.push({
      seatId: seat.seatId,
      category: seat.category,
      farePaise: seat.farePaise,
    });
    outboundTotalPaise += seat.farePaise;
  }

  // 2. Validate return trip if Round Trip
  let returnSeatsBreakdown: any[] | undefined;
  let returnTotalPaise = 0;

  if (validated.returnTripId && validated.returnSeatIds) {
    const returnTrip: any = await CarTrip.findById(validated.returnTripId).lean();
    if (!returnTrip) {
      fail(404, "RETURN_TRIP_NOT_FOUND", "Return car trip not found");
    }
    if (returnTrip.status !== "Scheduled" || !returnTrip.bookingOpen) {
      fail(400, "BOOKING_CLOSED", "Return trip is not open for booking");
    }

    if (new Date(returnTrip.departureAt) <= new Date(outboundTrip.estimatedArrivalAt)) {
      fail(
        400,
        "INVALID_RETURN_TIMING",
        "Return trip departure must be strictly after outbound trip arrival"
      );
    }

    returnSeatsBreakdown = [];
    for (const seatId of validated.returnSeatIds) {
      const seat = returnTrip.seats.find((s: any) => s.seatId === seatId);
      if (!seat) {
        fail(404, "SEAT_NOT_FOUND", `Seat '${seatId}' does not exist on return trip`);
      }
      if (seat.isDriver || !seat.isBookable) {
        fail(400, "SEAT_NOT_BOOKABLE", `Seat '${seatId}' is the driver seat and cannot be booked`);
      }
      if (seat.state !== "available") {
        fail(409, "SEAT_UNAVAILABLE", `Seat '${seatId}' on return trip is currently ${seat.state}`);
      }

      returnSeatsBreakdown.push({
        seatId: seat.seatId,
        category: seat.category,
        farePaise: seat.farePaise,
      });
      returnTotalPaise += seat.farePaise;
    }
  }

  const grandTotalPaise = outboundTotalPaise + returnTotalPaise;

  return {
    bookingType: validated.returnTripId ? "ROUND_TRIP" : "ONE_WAY",
    outbound: {
      tripId: outboundTrip._id,
      tripNumber: outboundTrip.tripNumber,
      seats: outboundSeatsBreakdown,
      subtotalPaise: outboundTotalPaise,
    },
    return: validated.returnTripId
      ? {
          tripId: validated.returnTripId,
          seats: returnSeatsBreakdown,
          subtotalPaise: returnTotalPaise,
        }
      : undefined,
    grandTotalPaise,
  };
}
