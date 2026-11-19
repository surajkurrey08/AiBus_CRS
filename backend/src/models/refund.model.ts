import { model, objectId, tenantFields } from "./shared/schema.js";

export const Refund = model("Refund", {
  ...tenantFields,
  bookingId: { type: objectId, required: true, unique: true },
  cancellationId: objectId,
  paymentId: objectId,
  amountPaise: Number,
  status: {
    type: String,
    enum: ["Requested", "Provider pending", "Refunded", "Failed", "Not due"],
    default: "Requested",
  },
  externalId: String,
  workflowIntentId: objectId,
  liabilityJournalId: objectId,
  confirmedAt: Date,
});
