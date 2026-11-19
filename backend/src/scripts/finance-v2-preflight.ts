import mongoose from "mongoose";
import { readConfig } from "../config/env.js";
import * as M from "../models/index.js";
// Deliberately no apply flag. Index installation is a separately reviewed
// additive rollout, never a side effect of this assessment.
if (process.argv.length > 2)
  throw Error("Read-only finance-v2 preflight has no apply mode");
await mongoose.connect(readConfig().MONGODB_URI, {
  autoIndex: false,
  autoCreate: false,
});
try {
  const collections = [];
  for (const model of [
    M.AgentWallet,
    M.CreditFacility,
    M.FinancePolicy,
    M.WalletFundingIntent,
    M.WalletReservation,
    M.CreditLimitHistory,
    M.TestFundingEvidence,
    M.CancellationAccountingPolicy,
    M.CancellationQuote,
    M.RefundIntent,
    M.RefundAttempt,
    M.FinanceException,
    M.Settlement,
    M.SettlementPolicy,
    M.SettlementLine,
    M.SettlementApproval,
    M.PayoutIntent,
    M.TestSettlementReceipt,
    M.TestPayoutRecord,
    M.PayoutAttempt,
    M.SettlementReconciliation,
  ]) {
    let installed: any[] = [];
    try {
      installed = await model.collection.listIndexes().toArray();
    } catch (e) {
      if ((e as any).code !== 26) throw e;
    }
    const unique = [];
    for (const [keys, options] of model.schema.indexes())
      if (options.unique) {
        const relevant =
          options.partialFilterExpression ||
          (options.sparse
            ? {
                $or: Object.keys(keys).map((key) => ({
                  [key]: { $exists: true },
                })),
              }
            : {});
        const duplicates = await model.aggregate([
          { $match: relevant },
          {
            $group: {
              _id: Object.fromEntries(
                Object.keys(keys).map((k) => [k, `$${k}`]),
              ),
              count: { $sum: 1 },
            },
          },
          { $match: { count: { $gt: 1 } } },
          { $limit: 10 },
        ]);
        const actual = installed.find(
          (i) => JSON.stringify(i.key) === JSON.stringify(keys),
        );
        unique.push({
          keys,
          expectedUnique: true,
          installed: !!actual,
          incompatible:
            !!actual &&
            (!actual.unique ||
              JSON.stringify(actual.partialFilterExpression) !==
                JSON.stringify(options.partialFilterExpression) ||
              !!actual.sparse !== !!options.sparse),
          duplicateGroups: duplicates.length,
        });
      }
    collections.push({ collection: model.collection.name, unique });
  }
  console.log(
    JSON.stringify(
      {
        version: "2026-11-18-finance-v2",
        readOnly: true,
        liveWrites: false,
        historicalBackfill: false,
        collections,
        recovery:
          "Disable finance test mode and policy funding flags; preserve all financial records and resolve exceptions before reactivation",
      },
      null,
      2,
    ),
  );
} finally {
  await mongoose.disconnect();
}
