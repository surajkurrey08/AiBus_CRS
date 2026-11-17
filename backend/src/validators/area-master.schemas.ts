import { z } from "zod";
import { id, text } from "../utils/core.js";
import { status, time } from "./operator.schemas.js";
import { contactInput } from "../services/pricing.service.js";
const coordinates = {
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
};
const coordinatePair = (value: { latitude?: number; longitude?: number }) =>
  (value.latitude === undefined) === (value.longitude === undefined);
export const cityInput = z
  .object({ name: text, state: text, country: text.default("India"), status })
  .strict();
export const locationInput = z
  .object({
    cityId: id,
    name: text,
    usage: z.enum(["Pickup", "Drop", "Both"]),
    address: text.optional(),
    landmarkId: id.optional(),
    phone: contactInput.shape.phone.optional(),
    ...coordinates,
    status,
  })
  .strict()
  .refine(coordinatePair, "Enter both latitude and longitude");
export const poiInput = z
  .object({
    cityId: id,
    name: text,
    category: z.enum(["Bus stand", "Railway station", "Landmark", "Other"]),
    address: text.optional(),
    ...coordinates,
    status,
  })
  .strict()
  .refine(coordinatePair, "Enter both latitude and longitude");
const mappedStop = z.object({ locationId: id, time: time.optional() }).strict();
export const routeStopInput = z
  .object({
    sourceCityId: id,
    destinationCityId: id,
    boarding: z.array(mappedStop).min(1).max(40),
    dropping: z.array(mappedStop).min(1).max(40),
    expectedVersion: z.number().int().min(0),
  })
  .strict()
  .refine(
    (v) =>
      [v.boarding, v.dropping].every(
        (stops) =>
          new Set(stops.map((stop) => stop.locationId)).size === stops.length,
      ),
    "Each stop can appear only once in a list",
  );
