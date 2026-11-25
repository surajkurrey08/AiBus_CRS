import { z } from "zod";

const objectIdRegex = /^[a-fA-F0-9]{24}$/;

export const createCarTripSchema = z
  .object({
    carId: z.string().regex(objectIdRegex, "Invalid ObjectId for carId"),
    routeId: z.string().regex(objectIdRegex, "Invalid ObjectId for routeId"),
    journeyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "journeyDate format must be YYYY-MM-DD"),
    departureAt: z.coerce.date(),
    estimatedArrivalAt: z.coerce.date(),
    turnaroundBufferMinutes: z.number().int().min(0).max(240).default(30),
    tripType: z.enum(["ONE_WAY", "ROUND_TRIP"]).default("ONE_WAY"),
    status: z.enum(["Draft", "Scheduled"]).default("Scheduled"),
    baseFarePaise: z.number().int().min(100).optional(),
    seatFareOverrides: z
      .array(
        z.object({
          seatId: z.string().min(1).max(4),
          farePaise: z.number().int().min(0),
        })
      )
      .optional(),
  })
  .strict()
  .refine((data) => data.estimatedArrivalAt > data.departureAt, {
    message: "estimatedArrivalAt must be strictly after departureAt",
    path: ["estimatedArrivalAt"],
  });

export const updateCarTripSchema = z
  .object({
    departureAt: z.coerce.date().optional(),
    estimatedArrivalAt: z.coerce.date().optional(),
    turnaroundBufferMinutes: z.number().int().min(0).max(240).optional(),
    bookingOpen: z.boolean().optional(),
    baseFarePaise: z.number().int().min(100).optional(),
  })
  .strict()
  .refine(
    (data) => {
      if (data.departureAt && data.estimatedArrivalAt) {
        return data.estimatedArrivalAt > data.departureAt;
      }
      return true;
    },
    {
      message: "estimatedArrivalAt must be strictly after departureAt",
      path: ["estimatedArrivalAt"],
    }
  );

export const cancelCarTripSchema = z.object({
  reason: z.string().trim().min(3, "Cancellation reason must be at least 3 characters").max(200),
});

export const searchOneWayTripsSchema = z.object({
  source: z.string().trim().min(2),
  destination: z.string().trim().min(2),
  journeyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "journeyDate must be YYYY-MM-DD"),
  passengerCount: z.coerce.number().int().min(1).max(7).default(1),
  vehicleCategory: z
    .enum(["4-Passenger Sedan", "4-Passenger Hatchback", "6-Passenger SUV", "7-Passenger MUV"])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const searchRoundTripsSchema = z
  .object({
    source: z.string().trim().min(2),
    destination: z.string().trim().min(2),
    outboundDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "outboundDate must be YYYY-MM-DD"),
    returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "returnDate must be YYYY-MM-DD"),
    passengerCount: z.coerce.number().int().min(1).max(7).default(1),
    vehicleCategory: z
      .enum(["4-Passenger Sedan", "4-Passenger Hatchback", "6-Passenger SUV", "7-Passenger MUV"])
      .optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict()
  .refine((data) => data.outboundDate <= data.returnDate, {
    message: "returnDate must be on or after outboundDate",
    path: ["returnDate"],
  })
  .refine((data) => data.source.trim().toLowerCase() !== data.destination.trim().toLowerCase(), {
    message: "source and destination cities must be different",
    path: ["destination"],
  });

export const fareQuoteSchema = z
  .object({
    outboundTripId: z.string().regex(objectIdRegex, "Invalid outboundTripId"),
    outboundSeatIds: z.array(z.string().min(1).max(4)).min(1).max(7),
    returnTripId: z.string().regex(objectIdRegex, "Invalid returnTripId").optional(),
    returnSeatIds: z.array(z.string().min(1).max(4)).min(1).max(7).optional(),
  })
  .strict()
  .refine(
    (data) => {
      if (data.returnTripId && (!data.returnSeatIds || data.returnSeatIds.length === 0)) {
        return false;
      }
      if (data.returnSeatIds && !data.returnTripId) {
        return false;
      }
      return true;
    },
    {
      message: "Both returnTripId and returnSeatIds must be provided for Round Trip quote",
      path: ["returnSeatIds"],
    }
  );
