import {
  mapping,
  model,
  objectId,
  stop,
  tenantFields,
} from "./shared/schema.js";

export const Route = model(
  "Route",
  {
    ...tenantFields,
    source: { type: String, required: true },
    destination: { type: String, required: true },
    sourceCityId: objectId,
    destinationCityId: objectId,
    boarding: { type: [stop], required: true },
    dropping: { type: [stop], required: true },
    departure: { type: String, required: true },
    arrival: { type: String, required: true },
    durationMinutes: { type: Number, required: true },
    distanceKm: Number,
    status: { type: String, enum: ["Active", "Inactive"], default: "Active" },
    ...mapping,
  },
  [{ keys: { operatorId: 1, status: 1 } }],
);
