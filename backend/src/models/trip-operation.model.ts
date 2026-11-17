import { model, tenantFields, objectId } from "./shared/schema.js";
export const TripOperation = model(
  "TripOperation",
  {
    ...tenantFields,
    tripId: { type: objectId, required: true },
    stage: String,
    at: Date,
    odometerKm: Number,
    fuelConsumedMillilitres: Number,
    requestKey: { type: String, required: true },
    requestHash: String,
    actorId: objectId,
  },
  [
    { keys: { operatorId: 1, requestKey: 1 }, options: { unique: true } },
    { keys: { operatorId: 1, tripId: 1, at: 1 } },
  ],
);
