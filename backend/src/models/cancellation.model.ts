import { Schema } from "mongoose";
import { model, objectId, tenantFields } from "./shared/schema.js";

export const Cancellation = model("Cancellation", {
  ...tenantFields,
  bookingId: { type: objectId, required: true, unique: true },
  requestedBy: objectId,
  reason: String,
  status: {
    type: String,
    enum: ["Requested", "Provider pending", "Approved", "Rejected"],
    default: "Requested",
  },
  policySnapshot: Schema.Types.Mixed,
  refundPaise: Number,
  idempotencyKey: String,
  acceptedQuoteId: objectId,
  accountingJournalId: objectId,
  reviewedBy: objectId,
  reviewedAt: Date,
  reviewReason: String,
});
