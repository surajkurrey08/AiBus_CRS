import { model, objectId, tenantFields } from "./shared/schema.js";

export const Payment = model(
  "Payment",
  {
    ...tenantFields,
    bookingId: { type: objectId, required: true },
    providerId: { type: String, required: true },
    externalId: { type: String, required: true },
    amountPaise: { type: Number, required: true },
    currency: { type: String, enum: ["INR"], default: "INR" },
    status: {
      type: String,
      enum: ["pending", "captured", "failed", "refunded"],
      default: "pending",
    },
    confirmedAt: Date,
    refundedPaise: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
  },
  [{ keys: { providerId: 1, externalId: 1 }, options: { unique: true } }],
);
