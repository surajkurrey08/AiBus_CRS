import { model, objectId } from "./shared/schema.js";
import { safePaise } from "./shared/financial-schema.js";
export const AccountBalanceProjection = model(
  "AccountBalanceProjection",
  {
    operatorId: { type: objectId, required: true },
    accountId: { type: objectId, required: true },
    currency: { type: String, enum: ["INR"], required: true },
    debitPaise: safePaise,
    creditPaise: safePaise,
    version: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isSafeInteger,
    },
  },
  [
    { keys: { accountId: 1 }, options: { unique: true } },
    { keys: { operatorId: 1 } },
  ],
);
