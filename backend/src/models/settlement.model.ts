import { model, tenantFields } from "./shared/schema.js";

export const Settlement = model("Settlement", {
  ...tenantFields,
  externalId: { type: String, required: true, unique: true },
  grossPaise: Number,
  commissionPaise: Number,
  refundPaise: Number,
  netPaise: Number,
  currency: { type: String, default: "INR" },
  settledAt: Date,
  status: { type: String, enum: ["pending", "settled"], default: "pending" },
});
