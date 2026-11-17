import { Schema } from "mongoose";
import { model, objectId, tenantFields } from "./shared/schema.js";

export const Quote = model(
  "SeatQuote",
  {
    ...tenantFields,
    userId: { type: objectId, required: true },
    tripId: { type: objectId, required: true },
    holdId: String,
    seats: [String],
    pricing: { type: Schema.Types.Mixed, required: true },
    expiresAt: { type: Date, required: true },
    status: { type: String, enum: ["quoted", "consumed"], default: "quoted" },
  },
  [{ keys: { expiresAt: 1 }, options: { expireAfterSeconds: 3600 } }],
);
