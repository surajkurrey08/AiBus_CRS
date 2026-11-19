import { model, tenantFields, objectId } from "./shared/schema.js";

export const Settlement = model(
  "Settlement",
  {
    ...tenantFields,
    workflowVersion: Number,
    mode: { type: String, enum: ["Test"] },
    kind: { type: String, enum: ["Operator", "Agency"] },
    agentId: objectId,
    periodFrom: String,
    periodTo: String,
    workflowStatus: {
      type: String,
      enum: [
        "Calculated",
        "Under review",
        "Approved",
        "Payment processing",
        "Paid",
        "Reconciliation required",
      ],
    },
    preparedBy: objectId,
    approvedBy: objectId,
    policyVersion: Number,
    requestHash: String,
    idempotencyKey: String,
    payoutIntentId: objectId,
    externalId: { type: String, required: true, unique: true },
    grossPaise: Number,
    commissionPaise: Number,
    refundPaise: Number,
    netPaise: Number,
    currency: { type: String, default: "INR" },
    settledAt: Date,
    status: { type: String, enum: ["pending", "settled"], default: "pending" },
  },
  [
    {
      keys: { operatorId: 1, idempotencyKey: 1 },
      options: {
        unique: true,
        partialFilterExpression: { idempotencyKey: { $type: "string" } },
      },
    },
  ],
);
