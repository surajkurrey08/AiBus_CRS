import { Schema } from "mongoose";
import { objectId } from "./shared/schema.js";
import { financialModel, safePaise } from "./shared/financial-schema.js";
const line = new Schema(
  {
    accountId: { type: objectId, required: true },
    debitPaise: safePaise,
    creditPaise: safePaise,
  },
  { _id: false, strict: "throw", versionKey: false },
);
const schema = new Schema(
  {
    operatorId: { type: objectId, required: true },
    operationId: { type: objectId, required: true },
    currency: { type: String, enum: ["INR"], required: true },
    kind: {
      type: String,
      enum: [
        "Booking captured",
        "Payment exception",
        "Reversal",
        "Wallet funding",
        "Credit repayment",
        "Cancellation adjustment",
        "Refund",
        "Exception refund",
      "Settlement receipt",
      "Settlement payout",
      ],
      required: true,
    },
    bookingId: objectId,
    paymentId: objectId,
    sourceEventId: String,
    reversalOf: objectId,
    reason: { type: String, required: true },
    lines: { type: [line], required: true },
    totalPaise: safePaise,
    accountingVersion: { type: Number, required: true },
  },
  { strict: "throw", timestamps: { createdAt: true, updatedAt: false } },
);
schema.index({ operationId: 1 }, { unique: true });
schema.index({ reversalOf: 1 }, { unique: true, sparse: true });
schema.index({ operatorId: 1, createdAt: -1 });
schema.index({ operatorId: 1, "lines.accountId": 1, createdAt: -1 });
schema.index({ operatorId: 1, paymentId: 1 });
schema.index(
  { paymentId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      paymentId: { $type: "objectId" },
      kind: { $in: ["Booking captured", "Payment exception"] },
    },
  },
);
schema.pre("validate", function () {
  const lines = this.lines as any[];
  if (lines.length < 2 || lines.length > 100)
    throw new Error("Invalid journal line count");
  let debit = 0n,
    credit = 0n;
  const accounts = new Set<string>();
  for (const line of lines) {
    if (
      !Number.isSafeInteger(line.debitPaise) ||
      !Number.isSafeInteger(line.creditPaise) ||
      line.debitPaise < 0 ||
      line.creditPaise < 0 ||
      (line.debitPaise === 0) === (line.creditPaise === 0) ||
      accounts.has(String(line.accountId))
    )
      throw new Error("Invalid journal line");
    accounts.add(String(line.accountId));
    debit += BigInt(line.debitPaise);
    credit += BigInt(line.creditPaise);
  }
  if (
    !debit ||
    debit !== credit ||
    debit > BigInt(Number.MAX_SAFE_INTEGER) ||
    Number(debit) !== this.totalPaise
  )
    throw new Error("Unbalanced journal");
});
export const JournalEntry = financialModel("JournalEntry", schema);
