import { model, tenantFields, objectId } from "./shared/schema.js";
export const TripStopRecord = model(
  "TripStopRecord",
  {
    ...tenantFields,
    tripId: { type: objectId, required: true },
    locationId: objectId,
    poiId: objectId,
    name: String,
    kind: String,
    arrivedAt: Date,
    departedAt: Date,
    notes: String,
    requestKey: { type: String, required: true },
    requestHash: String,
  },
  [{ keys: { operatorId: 1, requestKey: 1 }, options: { unique: true } }],
);
