import { z } from "zod";
import { amount, dateOnly, id, text } from "../utils/core.js";
import { status, time } from "./operator.schemas.js";
import { contactInput } from "../services/pricing.service.js";
const ids = z
  .array(id)
  .max(10)
  .refine(
    (values) => new Set(values).size === values.length,
    "Select each item once",
  );
const km = z.number().finite().min(0).max(10_000_000);
export const busServiceInput = z
  .object({
    name: text,
    code: text.transform((v) => v.toUpperCase().replace(/\s+/g, "-")),
    routeId: id,
    busId: id,
    departure: time,
    daysOfWeek: z
      .array(z.number().int().min(0).max(6))
      .min(1)
      .max(7)
      .refine(
        (days) => new Set(days).size === days.length,
        "Weekdays must be unique",
      ),
    crewIds: ids.default([]),
    doublePaise: amount.refine((v) => v > 0),
    singlePaise: amount.refine((v) => v > 0),
    status,
  })
  .strict();
export const multiScheduleInput = z
  .object({
    serviceIds: z
      .array(id)
      .min(1)
      .max(20)
      .refine(
        (values) => new Set(values).size === values.length,
        "Services must be unique",
      ),
    from: dateOnly,
    to: dateOnly,
  })
  .strict()
  .refine(
    (v) =>
      v.to >= v.from && +new Date(v.to) - +new Date(v.from) <= 365 * 86400000,
    "Choose a date range of up to one year",
  );
export const operationInput = z
  .object({
    stage: z.enum(["Boarding", "Departed", "Arrived", "Completed"]),
    at: z.string().datetime({ offset: true }),
    odometerKm: km.optional(),
    fuelConsumedMillilitres: z
      .number()
      .int()
      .positive()
      .max(1_000_000)
      .optional(),
    expectedVersion: z.number().int().min(0),
  })
  .strict();
export const fuelInput = z
  .object({
    tripId: id,
    litresMillilitres: z.number().int().positive().max(1_000_000),
    amountPaise: amount.refine((v) => v > 0),
    at: z.string().datetime({ offset: true }),
    odometerKm: km.optional(),
    pump: text.optional(),
    receipt: text.optional(),
  })
  .strict();
export const stopRecordInput = z
  .object({
    tripId: id,
    kind: z.enum(["Pickup", "Drop", "POI", "Other"]),
    locationId: id.optional(),
    poiId: id.optional(),
    name: text.optional(),
    arrivedAt: z.string().datetime({ offset: true }),
    departedAt: z.string().datetime({ offset: true }),
    notes: text.optional(),
  })
  .strict()
  .refine(
    (v) => new Date(v.departedAt) >= new Date(v.arrivedAt),
    "Stop departure must follow arrival",
  )
  .refine(
    (v) =>
      v.kind === "POI"
        ? !!v.poiId && !v.locationId
        : v.kind === "Other"
          ? !!v.name && !v.poiId && !v.locationId
          : !!v.locationId && !v.poiId,
    "Select a location or provide the stop name",
  );
export const tabletInput = z
  .object({ name: text, serialNumber: text, status })
  .strict();
export const tabletAssignmentInput = z
  .object({ tabletId: id, tripId: id, crewId: id.optional() })
  .strict();
export const partnerInput = z
  .object({
    name: text,
    kind: z.enum(["Agent", "Branch"]),
    parentPartnerId: id.nullable().optional(),
    phone: contactInput.shape.phone,
    email: z.string().email().optional(),
    status,
  })
  .strict();
export const commissionInput = z
  .object({
    partnerId: id,
    serviceId: id.optional(),
    tripId: id.optional(),
    basis: z.enum(["Base fare", "Grand total"]).default("Base fare"),
    kind: z.enum(["Percent", "Fixed"]),
    basisPoints: z.number().int().min(0).max(10000).optional(),
    fixedPaise: amount.optional(),
    status,
  })
  .strict()
  .refine(
    (v) => !!v.tripId !== !!v.serviceId,
    "Select either a service or a trip for this rule",
  )
  .refine(
    (v) =>
      v.kind === "Percent"
        ? v.basisPoints !== undefined && v.fixedPaise === undefined
        : v.fixedPaise !== undefined && v.basisPoints === undefined,
    "Enter only the amount matching the commission type",
  );
export const tripLinkInput = z
  .object({
    fromTripId: id,
    toTripId: id,
    kind: z.enum(["Related", "Connection"]),
    transferMinutes: z.number().int().min(0).max(1440).default(0),
    notes: text.optional(),
    status,
  })
  .strict()
  .refine((v) => v.fromTripId !== v.toTripId, "Select two different trips");
