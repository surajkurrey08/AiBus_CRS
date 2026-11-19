import { Schema } from "mongoose";
import { model, objectId, tenantFields } from "./shared/schema.js";
import { financialModel, safePaise } from "./shared/financial-schema.js";
export const CancellationAccountingPolicy = model(
  "CancellationAccountingPolicy",
  {
    operatorId: { type: objectId, required: true, immutable: true },
    enabled: { type: Boolean, default: false },
    refundBasis: {
      type: String,
      enum: ["Unconfigured", "Discounted base fare"],
      default: "Unconfigured",
    },
    taxTreatment: {
      type: String,
      enum: ["Unconfigured", "Proportional refund", "Non-refundable"],
      default: "Unconfigured",
    },
    chargeTreatment: {
      type: String,
      enum: ["Unconfigured", "Proportional refund", "Non-refundable"],
      default: "Unconfigured",
    },
    commissionTreatment: {
      type: String,
      enum: ["Unconfigured", "Reverse all"],
      default: "Unconfigured",
    },
    allowExceptionRefunds: { type: Boolean, default: false },
    version: { type: Number, default: 1 },
    updatedBy: objectId,
  },
  [{ keys: { operatorId: 1 }, options: { unique: true } }],
);
const quote = new Schema(
  {
    ...tenantFields,
    bookingId: { type: objectId, required: true },
    paymentId: { type: objectId, required: true },
    requestedBy: { type: objectId, required: true },
    policyVersion: { type: Number, required: true },
    accountingPolicyVersion: { type: Number, required: true },
    bookingVersion: { type: Number, required: true },
    seats: { type: [String], required: true },
    originalPaise: safePaise,
    refundPaise: safePaise,
    retainedPaise: safePaise,
    commissionReversePaise: safePaise,
    taxRefundPaise: safePaise,
    chargeRefundPaise: safePaise,
    baseRefundPaise: safePaise,
    expiresAt: { type: Date, required: true },
    snapshot: Schema.Types.Mixed,
  },
  { timestamps: { createdAt: true, updatedAt: false }, strict: "throw" },
);
quote.index({ operatorId: 1, bookingId: 1, createdAt: -1 });
export const CancellationQuote = financialModel("CancellationQuote", quote);
export const RefundIntent = model(
  "RefundIntent",
  {
    ...tenantFields,
    bookingId: { type: objectId, required: true },
    paymentId: { type: objectId, required: true },
    refundId: objectId,
    purpose: {
      type: String,
      enum: ["Cancellation", "Payment exception"],
      required: true,
    },
    amountPaise: { ...safePaise, immutable: true },
    currency: { type: String, enum: ["INR"], default: "INR" },
    fundingMethod: {
      type: String,
      enum: ["gateway", "wallet", "credit"],
      required: true,
    },
    status: {
      type: String,
      enum: [
        "Ready",
        "Submitting",
        "Pending",
        "Processed",
        "Failed",
        "Uncertain",
        "Manual review",
      ],
      default: "Ready",
    },
    providerId: String,
    externalRefundId: String,
    idempotencyKey: { type: String, required: true, immutable: true },
    requestBody: { type: Schema.Types.Mixed, required: true, immutable: true },
    requestHash: { type: String, required: true, immutable: true },
    leaseOwner: String,
    leaseUntil: Date,
    attempts: { type: Number, default: 0 },
    totalAttempts: { type: Number, default: 0 },
    reviewCycles: { type: Number, default: 0 },
    nextAttemptAt: Date,
    journalId: objectId,
    liabilityJournalId: objectId,
    approvedBy: objectId,
    processedAt: Date,
  },
  [
    { keys: { paymentId: 1 }, options: { unique: true } },
    { keys: { idempotencyKey: 1 }, options: { unique: true } },
    { keys: { externalRefundId: 1 }, options: { unique: true, sparse: true } },
    { keys: { status: 1, nextAttemptAt: 1, leaseUntil: 1 } },
  ],
);
const attempt = new Schema(
  {
    ...tenantFields,
    intentId: { type: objectId, required: true },
    workerId: { type: String, required: true },
    action: {
      type: String,
      enum: ["Create", "Reconcile", "Internal"],
      required: true,
    },
    outcome: {
      type: String,
      enum: ["processed", "pending", "failed", "uncertain", "manual"],
      required: true,
    },
    providerRefundId: String,
    code: String,
  },
  { strict: "throw", timestamps: { createdAt: true, updatedAt: false } },
);
attempt.index({ operatorId: 1, intentId: 1, createdAt: -1 });
export const RefundAttempt = financialModel("RefundAttempt", attempt);
export const FinanceException = model(
  "FinanceException",
  {
    ...tenantFields,
    bookingId: objectId,
    paymentId: objectId,
    intentId: objectId,
    observedAmountPaise: {
      type: Number,
      min: 0,
      validate: Number.isSafeInteger,
      immutable: true,
    },
    observedCurrency: { type: String, maxlength: 12, immutable: true },
    externalPaymentId: { type: String, immutable: true },
    kind: { type: String, required: true },
    resourceKey: { type: String, required: true },
    status: {
      type: String,
      enum: ["Open", "In review", "Resolved"],
      default: "Open",
    },
    code: String,
    reviewedBy: objectId,
    reviewReason: String,
    lastSeenAt: Date,
  },
  [
    {
      keys: { operatorId: 1, kind: 1, resourceKey: 1 },
      options: { unique: true },
    },
    { keys: { operatorId: 1, status: 1, createdAt: -1 } },
  ],
);
