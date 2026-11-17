import { model, objectId, tenantFields } from "./shared/schema.js";

export const Hold = model(
  "SeatHold",
  {
    ...tenantFields,
    tripId: { type: objectId, required: true },
    userId: { type: objectId, required: true },
    holdId: { type: String, required: true, unique: true },
    seats: [String],
    amountPaise: Number,
    expiresAt: Date,
    status: {
      type: String,
      enum: ["held", "released", "consumed", "expired"],
      default: "held",
    },
  },
  [{ keys: { expiresAt: 1 }, options: { expireAfterSeconds: 604800 } }],
);
