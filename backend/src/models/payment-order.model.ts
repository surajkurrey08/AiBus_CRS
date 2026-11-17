import { model, objectId, tenantFields } from "./shared/schema.js";

export const PaymentOrder = model(
  "PaymentOrder",
  {
    ...tenantFields,
    bookingId: { type: objectId, required: true },
    providerId: { type: String, required: true },
    keyId: { type: String, required: true },
    receipt: { type: String, required: true },
    amountPaise: { type: Number, required: true },
    currency: { type: String, enum: ["INR"], default: "INR" },
    state: {
      type: String,
      enum: ["new", "creating", "ready", "uncertain"],
      default: "new",
    },
    externalOrderId: String,
    creationStartedAt: Date,
    expiresAt: { type: Date, required: true },
    captureStartedAt: Date,
    capturePaymentId: String,
    settledAt: Date,
    lastCheckedAt: Date,
  },
  [
    { keys: { providerId: 1, bookingId: 1 }, options: { unique: true } },
    { keys: { externalOrderId: 1 }, options: { unique: true, sparse: true } },
  ],
);
