import { z } from "zod";
import { dateOnly, id, text } from "../utils/core.js";
import { busInput, layoutInput, status } from "./operator.schemas.js";
import { contactInput } from "../services/pricing.service.js";
export const coachInput = z
  .object({
    name: text,
    type: busInput.shape.type,
    arrangement: z.enum(["2+1", "2+2"]),
    decks: z.coerce.number().int().min(1).max(2),
    amenities: z.array(text).max(30).default([]),
    status,
  })
  .strict();
export const ownerInput = z
  .object({
    name: text,
    phone: contactInput.shape.phone,
    email: z.string().email().optional(),
    address: text.optional(),
    status,
  })
  .strict();
export const crewInput = z
  .object({
    name: text,
    role: z.enum(["Driver", "Conductor", "Pickup staff"]),
    phone: contactInput.shape.phone,
    licenceNumber: text.optional(),
    licenceExpiry: dateOnly.optional(),
    pickupPoint: text.optional(),
    status,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.role === "Driver" && (!v.licenceNumber || !v.licenceExpiry))
      ctx.addIssue({
        code: "custom",
        message: "Driver licence number and expiry are required",
      });
  });
export const chartInput = layoutInput.extend({ status }).strict();
export const vehicleDocumentInput = z
  .object({
    busId: id,
    kind: z.enum([
      "Registration",
      "Insurance",
      "Permit",
      "Fitness",
      "PUC",
      "Service",
    ]),
    reference: text,
    issuedOn: dateOnly.optional(),
    expiresOn: dateOnly.optional(),
    notes: text.optional(),
  })
  .strict()
  .refine(
    (v) => !v.issuedOn || !v.expiresOn || v.expiresOn >= v.issuedOn,
    "Expiry must be on or after the issue date",
  );
export const gpsInput = z
  .object({ busId: id, provider: text, deviceId: text, status })
  .strict();
export const busMasterAssignmentInput = z
  .object({
    coachTypeId: id.nullable().optional(),
    ownerId: id.nullable().optional(),
  })
  .strict()
  .refine(
    (v) => Object.keys(v).length > 0,
    "Select an owner or coach to update",
  );
