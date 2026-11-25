import { carStopSchema, createCarModel, objectId, tenantFields } from "./shared/car-schema.js";

export const CarRoute = createCarModel(
  "CarRoute",
  {
    ...tenantFields,
    name: { type: String, trim: true },
    source: { type: String, required: true, trim: true },
    destination: { type: String, required: true, trim: true },
    sourceCityId: objectId,
    destinationCityId: objectId,
    boarding: { type: [carStopSchema], default: [] },
    dropping: { type: [carStopSchema], default: [] },
    estimatedDurationMinutes: { type: Number, required: true, min: 10, max: 2880 },
    distanceKm: { type: Number, min: 0 },
    status: { type: String, enum: ["Active", "Inactive", "Archived"], default: "Active" },
  },
  [
    { keys: { operatorId: 1, source: 1, destination: 1 } },
    { keys: { operatorId: 1, status: 1 } },
  ]
);
