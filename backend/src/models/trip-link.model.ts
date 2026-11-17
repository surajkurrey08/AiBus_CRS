import { model, tenantFields, objectId } from "./shared/schema.js";
export const TripLink = model(
  "TripLink",
  {
    ...tenantFields,
    fromTripId: { type: objectId, required: true },
    toTripId: { type: objectId, required: true },
    kind: String,
    transferMinutes: Number,
    notes: String,
    status: { type: String, default: "Active" },
  },
  [
    {
      keys: { operatorId: 1, fromTripId: 1, toTripId: 1 },
      options: { unique: true },
    },
  ],
);
