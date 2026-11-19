import { Schema } from "mongoose";
import { objectId } from "./shared/schema.js";
import { financialModel } from "./shared/financial-schema.js";
const schema = new Schema(
  {
    operatorId: { type: objectId, required: true },
    ownerType: {
      type: String,
      enum: ["Platform", "Operator", "Agent", "ApiPartner"],
      required: true,
    },
    ownerId: { type: String, required: true },
    code: { type: String, required: true },
    accountType: {
      type: String,
      enum: ["Asset", "Liability", "Revenue", "Expense", "Equity"],
      required: true,
    },
    currency: { type: String, enum: ["INR"], required: true },
  },
  { strict: "throw", timestamps: { createdAt: true, updatedAt: false } },
);
schema.index(
  { operatorId: 1, ownerType: 1, ownerId: 1, code: 1, currency: 1 },
  { unique: true },
);
export const LedgerAccount = financialModel("LedgerAccount", schema);
