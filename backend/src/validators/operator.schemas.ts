import { phoneNumber } from "./account-input.schemas.js";
import { z } from "zod";
import { amount, dateOnly, id, text } from "../utils/core.js";
export const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const status = z.enum(["Active", "Inactive"]).default("Active");

export const busInput = z
  .object({
    registration: text
      .transform((v) => v.toUpperCase().replace(/[\s-]/g, ""))
      .pipe(z.string().regex(/^[A-Z\d]{5,20}$/)),
    name: text,
    type: z.enum([
      "AC Sleeper",
      "Non-AC Sleeper",
      "AC Seater",
      "Non-AC Seater",
      "Semi Sleeper",
      "Mixed Seater/Sleeper",
    ]),
    capacity: z.coerce.number().int().min(1).max(100),
    amenities: z.array(text).max(30).default([]),
    status,
    insuranceExpiry: dateOnly.optional(),
    permitExpiry: dateOnly.optional(),
    insuranceNumber: text.optional(),
    permitNumber: text.optional(),
  })
  .strict();

export const carInput = z
  .object({
    registrationNumber: text.optional(),
    registration: text.optional(),
    make: text,
    model: text.optional(),
    modelName: text.optional(),
    year: z.coerce.number().int().min(1900).max(2100).optional().default(() => new Date().getFullYear()),
    vehicleCategory: z
      .enum(["4-Passenger Sedan", "7-Passenger MUV", "4-Passenger Hatchback", "6-Passenger SUV"])
      .optional()
      .default("4-Passenger Sedan"),
    category: z
      .enum(["4-Passenger Sedan", "7-Passenger MUV", "4-Passenger Hatchback", "6-Passenger SUV"])
      .optional(),
    totalPhysicalSeats: z.coerce.number().int().min(5).max(9),
    bookablePassengerCapacity: z.coerce.number().int().min(1).max(8),
    color: z.string().optional().default(""),
    status: z
      .enum(["Active", "Inactive", "Maintenance", "Under Maintenance", "Archived"])
      .default("Active"),
  });

export const point = z
  .object({ name: text, time: time.optional(), address: text.optional() })
  .strict();

export const routeInput = z
  .object({
    source: text,
    destination: text,
    sourceCityId: id.optional(),
    destinationCityId: id.optional(),
    boarding: z.array(point).min(1).max(40),
    dropping: z.array(point).min(1).max(40),
    departure: time,
    arrival: time,
    durationMinutes: z.coerce.number().int().min(1).max(4320),
    distanceKm: z.coerce.number().positive().max(5000).optional(),
    status,
  })
  .strict();

export const seatInput = z
  .object({
    number: z.string().regex(/^[a-z\d-]{1,12}$/i),
    deck: z.enum(["lower", "upper"]),
    row: z.number().int().min(0).max(50),
    column: z.number().int().min(0).max(10),
    category: z.enum(["sleeper", "seater"]),
    farePaise: amount,
  })
  .strict();

export const layoutInput = z
  .object({
    name: text,
    seats: z
      .array(seatInput)
      .min(1)
      .max(100)
      .refine(
        (seats) => new Set(seats.map((s) => s.number)).size === seats.length,
        "Seat numbers must be unique",
      )
      .refine(
        (seats) =>
          new Set(seats.map((s) => `${s.deck}:${s.row}:${s.column}`)).size ===
          seats.length,
        "Seat positions must be unique",
      ),
  })
  .strict();

export const scheduleInput = z
  .object({
    routeId: id,
    busId: id,
    daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    specialDates: z.array(dateOnly).max(366).default([]),
    startDate: dateOnly,
    endDate: dateOnly,
    status,
  })
  .strict();

export const tripInput = z
  .object({
    routeId: id.optional(),
    carId: z.string().optional(),
    busId: z.string().optional(),
    tripNumber: z.string().optional(),
    tripType: z.enum(["ONE_WAY", "ROUND_TRIP"]).default("ONE_WAY"),
    vehicleCategory: z
      .enum(["4-Passenger Sedan", "7-Passenger MUV", "4-Passenger Hatchback", "6-Passenger SUV"])
      .optional(),
    carRegistration: z.string().optional(),
    routeName: z.string().optional(),
    bookableCapacity: z.coerce.number().int().optional(),
    totalPhysicalSeats: z.coerce.number().int().optional(),
    scheduleId: id.optional(),
    serviceId: id.optional(),
    crewIds: z
      .array(id)
      .max(10)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Crew members must be unique",
      )
      .optional(),
    journeyDate: dateOnly,
    departureAt: z.string().datetime({offset:true}),
    arrivalAt: z.string().datetime({offset:true}).optional(),
    estimatedArrivalAt: z.string().datetime({offset:true}).optional(),
    baseFarePaise: amount.optional(),
    baseFareRupees: z.coerce.number().optional(),
    status: z.enum(["Draft", "Scheduled", "Cancelled"]).optional().default("Scheduled"),
    bookingOpen: z.boolean().optional().default(true),
    availableSeatsCount: z.coerce.number().int().optional(),
    _id: z.string().optional(),
    seatSideFares: z
      .object({
        doublePaise: amount.refine(
          (v) => v > 0,
          "Double-side fare must be positive",
        ),
        singlePaise: amount.refine(
          (v) => v > 0,
          "Single-side fare must be positive",
        ),
      })
      .strict()
      .optional(),
  })
  .passthrough();

export const fareInput = z
  .object({
    routeId: id,
    basePaise: amount,
    weekendPaise: amount.optional(),
    singlePaise: amount.optional(),
    singleWeekendPaise: amount.optional(),
    specialDates: z
      .array(z.object({ date: dateOnly, amountPaise: amount }).strict())
      .max(366)
      .default([]),
    seatFares: z
      .array(
        z.object({ number: z.string().max(12), amountPaise: amount }).strict(),
      )
      .max(100)
      .default([]),
  })
  .strict();

export const offerInput = z
  .object({
    code: z.string().regex(/^[A-Z\d_-]{3,24}$/),
    name: text,
    percent: z.coerce.number().int().min(1).max(100),
    maxDiscountPaise: amount.optional(),
    routeIds: z.array(id).max(100).default([]),
    startDate: dateOnly,
    endDate: dateOnly,
    status: z.enum(["Active", "Inactive", "Scheduled"]).default("Active"),
  })
  .strict();

export const profileInput = z
  .object({
    company: text,
    email: z.string().email().max(254),
    phone: phoneNumber,
    address: text,
  })
  .strict();
