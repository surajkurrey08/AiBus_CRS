import { Schema } from "mongoose";
import { model, objectId, tenantFields } from "./shared/schema.js";
import { safePaise, financialModel } from "./shared/financial-schema.js";
const ownership = {
  ...tenantFields,
  agentId: { type: objectId, required: true },
  currency: { type: String, enum: ["INR"], default: "INR" },
};
export const AgentWallet = model(
  "AgentWallet",
  {
    ...ownership,
    status: { type: String, enum: ["Active", "Suspended"], default: "Active" },
    reservedPaise: { ...safePaise, default: 0 },
    revision: { type: Number, default: 0 },
    createdBy: objectId,
  },
  [{ keys: { operatorId: 1, agentId: 1 }, options: { unique: true } }],
);
export const CreditFacility = model(
  "CreditFacility",
  {
    ...ownership,
    status: {
      type: String,
      enum: ["Active", "Suspended"],
      default: "Suspended",
    },
    limitPaise: { ...safePaise, default: 0 },
    reservedPaise: { ...safePaise, default: 0 },
    revision: { type: Number, default: 0 },
  },
  [{ keys: { operatorId: 1, agentId: 1 }, options: { unique: true } }],
);
export const FinancePolicy = model(
  "FinancePolicy",
  {
    operatorId: { type: objectId, required: true, immutable: true },
    walletEnabled: { type: Boolean, default: false },
    creditEnabled: { type: Boolean, default: false },
    testOperationsEnabled: { type: Boolean, default: false },
    custodyOwner: {
      type: String,
      enum: ["Unconfigured", "Operator"],
      default: "Unconfigured",
    },
    version: { type: Number, default: 1 },
    updatedBy: objectId,
  },
  [{ keys: { operatorId: 1 }, options: { unique: true } }],
);
export const WalletFundingIntent = model(
  "WalletFundingIntent",
  {
    ...ownership,
    purpose: {
      type: String,
      enum: ["Wallet", "Credit repayment"],
      required: true,
    },
    amountPaise: safePaise,
    key: { type: String, required: true },
    requestHash: { type: String, required: true },
    status: {
      type: String,
      enum: ["Requested", "Verified", "Posted", "Rejected"],
      default: "Requested",
    },
    testEvidenceId: objectId,
    journalId: objectId,
    requestedBy: objectId,
    reviewedBy: objectId,
    reason: String,
  },
  [{ keys: { operatorId: 1, agentId: 1, key: 1 }, options: { unique: true } }],
);
export const WalletReservation = model(
  "WalletReservation",
  {
    ...ownership,
    bookingId: { type: objectId, required: true },
    userId: { type: objectId, required: true },
    mode: { type: String, enum: ["wallet", "credit"], required: true },
    amountPaise: safePaise,
    key: { type: String, required: true },
    status: {
      type: String,
      enum: ["Reserved", "Consumed", "Released", "Expired"],
      default: "Reserved",
    },
    expiresAt: { type: Date, required: true },
    policyVersion: Number,
  },
  [
    { keys: { bookingId: 1 }, options: { unique: true } },
    { keys: { operatorId: 1, agentId: 1, key: 1 }, options: { unique: true } },
    { keys: { status: 1, expiresAt: 1 } },
  ],
);
const history = new Schema(
  {
    ...ownership,
    beforePaise: safePaise,
    afterPaise: safePaise,
    beforeStatus: String,
    afterStatus: String,
    key: { type: String, required: true },
    reason: { type: String, required: true },
    actorId: { type: objectId, required: true },
  },
  { strict: "throw", timestamps: { createdAt: true, updatedAt: false } },
);
history.index({ operatorId: 1, agentId: 1, key: 1 }, { unique: true });
export const CreditLimitHistory = financialModel("CreditLimitHistory", history);
// Provider-side test evidence is created only by a server test adapter. It never
// represents bank cash, screenshots, transfer references or a live deposit.
const evidence = new Schema(
  {
    ...ownership,
    resourceId: { type: objectId, required: true },
    amountPaise: safePaise,
    provider: { type: String, enum: ["aibus-test"], required: true },
    status: { type: String, enum: ["succeeded"], required: true },
    reference: { type: String, required: true },
    verifiedAt: { type: Date, required: true },
  },
  { strict: "throw", timestamps: { createdAt: true, updatedAt: false } },
);
evidence.index({ resourceId: 1 }, { unique: true });
evidence.index({ reference: 1 }, { unique: true });
export const TestFundingEvidence = financialModel(
  "TestFundingEvidence",
  evidence,
);
