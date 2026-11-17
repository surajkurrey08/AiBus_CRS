import { model, tenantFields, objectId } from "./shared/schema.js";
export const TripFuel = model(
  "TripFuel",
  {
    ...tenantFields,
    tripId: { type: objectId, required: true },
    busId: { type: objectId, required: true },
    litresMillilitres: { type: Number, required: true },
    amountPaise: { type: Number, required: true },
    at: Date,
    odometerKm: Number,
    pump: String,
    receipt: String,
    requestKey: { type: String, required: true },
    requestHash: String,
    status: { type: String, default: "Recorded" },
    voidReason: String,
  },
  [{ keys: { operatorId: 1, requestKey: 1 }, options: { unique: true } }],
);
