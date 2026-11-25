import { Schema } from "mongoose";
import { createCarModel, objectId, tenantFields } from "./shared/car-schema.js";

const ledgerLineSchema = new Schema(
  {
    accountCode: { type: String, required: true },
    ownerType: {
      type: String,
      enum: ["Platform", "Operator", "Agent", "Customer"],
      required: true,
    },
    ownerId: { type: String, required: true },
    debitPaise: { type: Number, required: true, min: 0, default: 0 },
    creditPaise: { type: Number, required: true, min: 0, default: 0 },
  },
  { _id: false, strict: "throw", versionKey: false }
);

export const CarJournalEntry = createCarModel(
  "CarJournalEntry",
  {
    ...tenantFields,
    operationId: { type: String, required: true, unique: true },
    bookingId: { type: objectId, ref: "CarBooking" },
    pnr: { type: String, uppercase: true },
    kind: {
      type: String,
      enum: [
        "Booking captured",
        "Cancellation adjustment",
        "Refund",
        "Agent commission",
        "Platform fee",
        "Reversal",
      ],
      required: true,
    },
    currency: { type: String, enum: ["INR"], default: "INR", required: true },
    reason: { type: String, required: true },
    lines: {
      type: [ledgerLineSchema],
      required: true,
      validate: [
        {
          validator: function (lines: any[]) {
            if (!lines || lines.length < 2) return false;
            const totalDebits = lines.reduce((acc, l) => acc + (l.debitPaise || 0), 0);
            const totalCredits = lines.reduce((acc, l) => acc + (l.creditPaise || 0), 0);
            return totalDebits === totalCredits && totalDebits > 0;
          },
          message: "Journal lines must balance: total debits must equal total credits and be > 0",
        },
      ],
    },
    totalPaise: { type: Number, required: true, min: 0 },
    reversalOf: String,
  },
  [
    { keys: { operatorId: 1, pnr: 1 } },
    { keys: { operatorId: 1, bookingId: 1 } },
    { keys: { operatorId: 1, createdAt: -1 } },
  ]
);

export const CarFinanceOutbox = createCarModel(
  "CarFinanceOutbox",
  {
    ...tenantFields,
    eventId: { type: String, required: true, unique: true },
    eventType: {
      type: String,
      enum: ["BOOKING_CAPTURED", "BOOKING_CANCELLED", "REFUND_PROCESSED"],
      required: true,
    },
    bookingId: { type: objectId, required: true },
    pnr: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: ["pending", "processed", "failed"],
      default: "processed", // In sandbox mode, immediately marked processed
      required: true,
    },
    processedAt: { type: Date, default: Date.now },
  },
  [
    { keys: { operatorId: 1, status: 1 } },
    { keys: { bookingId: 1 } },
  ]
);
