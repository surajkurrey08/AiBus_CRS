import { Schema } from "mongoose";
import { objectId } from "./shared/schema.js";
import { financialModel } from "./shared/financial-schema.js";
const schema = new Schema(
  {
    operatorId: { type: objectId, required: true },
    idempotencyKey: { type: String, required: true },
    payloadHash: { type: String, required: true },
    journalId: { type: objectId, required: true },
    actorId: String,
  },
  { strict: "throw", timestamps: { createdAt: true, updatedAt: false } },
);
schema.index({ operatorId: 1, idempotencyKey: 1 }, { unique: true });
schema.index({ journalId: 1 }, { unique: true });
export const FinancialOperation = financialModel("FinancialOperation", schema);
