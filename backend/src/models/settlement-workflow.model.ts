import { Schema } from "mongoose";
import { model, objectId, tenantFields } from "./shared/schema.js";
import { financialModel, safePaise } from "./shared/financial-schema.js";
export const SettlementPolicy = model(
  "SettlementPolicy",
  {
    operatorId: { type: objectId, required: true, immutable: true },
    enabled: { type: Boolean, default: false },
    treatment: {
      type: String,
      enum: ["Unconfigured", "Existing capture liabilities"],
      default: "Unconfigured",
    },
    funding: {
      type: String,
      enum: ["Unconfigured", "Simulated gateway receipts"],
      default: "Unconfigured",
    },
    version: { type: Number, default: 1 },
    updatedBy: objectId,
  },
  [{ keys: { operatorId: 1 }, options: { unique: true } }],
);
const history = (
  name: string,
  fields: Record<string, unknown>,
  indexes: any[] = [],
) => {
  const schema = new Schema(
    { ...tenantFields, ...fields },
    { strict: "throw", timestamps: { createdAt: true, updatedAt: false } },
  );
  for (const index of indexes) schema.index(index.keys, index.options);
  return financialModel(name, schema);
};
export const SettlementLine = history(
  "SettlementLine",
  {
    settlementId: { type: objectId, required: true },
    journalId: { type: objectId, required: true },
    accountId: { type: objectId, required: true },
    bookingId: { type: objectId, required: true },
    paymentId: { type: objectId, required: true },
    agentId: objectId,
    amountPaise: safePaise,
    kind: {
      type: String,
      enum: ["Ticket payable", "Retained cancellation"],
      required: true,
    },
  },
  [
    { keys: { journalId: 1, accountId: 1 }, options: { unique: true } },
    { keys: { operatorId: 1, settlementId: 1 } },
  ],
);
export const SettlementApproval = history(
  "SettlementApproval",
  {
    settlementId: { type: objectId, required: true },
    actorId: { type: objectId, required: true },
    action: {
      type: String,
      enum: ["Prepared", "Submitted", "Approved", "Payout authorized"],
      required: true,
    },
    reason: { type: String, required: true },
  },
  [{ keys: { settlementId: 1, action: 1 }, options: { unique: true } }],
);
export const TestSettlementReceipt = history(
  "TestSettlementReceipt",
  {
    paymentId: { type: objectId, required: true },
    amountPaise: safePaise,
    journalId: { type: objectId, required: true },
    provider: { type: String, enum: ["aibus-isolated-test"], required: true },
    reference: { type: String, required: true },
    verifiedAt: { type: Date, required: true },
  },
  [
    { keys: { paymentId: 1 }, options: { unique: true } },
    { keys: { reference: 1 }, options: { unique: true } },
  ],
);
export const PayoutIntent = model(
  "PayoutIntent",
  {
    ...tenantFields,
    settlementId: { type: objectId, required: true, immutable: true },
    amountPaise: { ...safePaise, immutable: true },
    currency: { type: String, enum: ["INR"], default: "INR" },
    provider: { type: String, enum: ["aibus-isolated-test"], required: true },
    idempotencyKey: { type: String, required: true, immutable: true },
    status: {
      type: String,
      enum: [
        "Ready",
        "Processing",
        "Paid",
        "Uncertain",
        "Failed",
        "Manual review",
      ],
      default: "Ready",
    },
    authorizedBy: { type: objectId, required: true },
    leaseOwner: String,
    leaseUntil: Date,
    attempts: { type: Number, default: 0 },
    externalId: String,
    journalId: objectId,
    processedAt: Date,
  },
  [
    { keys: { settlementId: 1 }, options: { unique: true } },
    { keys: { idempotencyKey: 1 }, options: { unique: true } },
  ],
);
export const TestPayoutRecord = history(
  "TestPayoutRecord",
  {
    intentId: { type: objectId, required: true },
    reference: { type: String, required: true },
    amountPaise: safePaise,
    currency: { type: String, enum: ["INR"], required: true },
    status: {
      type: String,
      enum: ["processed", "pending", "failed"],
      required: true,
    },
  },
  [
    { keys: { intentId: 1 }, options: { unique: true } },
    { keys: { reference: 1 }, options: { unique: true } },
  ],
);
export const PayoutAttempt = history(
  "PayoutAttempt",
  {
    intentId: { type: objectId, required: true },
    workerId: { type: String, required: true },
    outcome: { type: String, required: true },
    reference: String,
    code: String,
  },
  [{ keys: { operatorId: 1, intentId: 1, createdAt: -1 } }],
);
export const SettlementReconciliation = history(
  "SettlementReconciliation",
  {
    settlementId: { type: objectId, required: true },
    actorId: { type: objectId, required: true },
    consistent: { type: Boolean, required: true },
    issues: { type: [String], required: true },
    snapshot: Schema.Types.Mixed,
  },
  [{ keys: { operatorId: 1, settlementId: 1, createdAt: -1 } }],
);
