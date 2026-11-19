import mongoose from "mongoose";
import { readConfig } from "../config/env.js";
import * as M from "../models/index.js";
if (process.argv.length > 2)
  throw Error("Read-only platform preflight has no apply mode");
await mongoose.connect(readConfig().MONGODB_URI, {
  autoCreate: false,
  autoIndex: false,
});
try {
  const collections = [];
  for (const model of [
    M.OperatorDocument,
    M.PlatformSettings,
    M.PlatformCommand,
  ]) {
    let indexes: any[] = [];
    try {
      indexes = await model.collection.listIndexes().toArray();
    } catch (e) {
      if ((e as any).code !== 26) throw e;
    }
    const required = [];
    for (const [keys, options] of model.schema.indexes())
      if (options.unique) {
        const duplicates = await model.aggregate([
          {
            $group: {
              _id: Object.fromEntries(
                Object.keys(keys).map((key) => [key, `$${key}`]),
              ),
              count: { $sum: 1 },
            },
          },
          { $match: { count: { $gt: 1 } } },
          { $limit: 10 },
        ]);
        const installed = indexes.find(
          (i) => JSON.stringify(i.key) === JSON.stringify(keys),
        );
        required.push({
          keys,
          installed: !!installed,
          incompatible:
            !!installed &&
            (!installed.unique ||
              !!installed.partialFilterExpression ||
              !!installed.sparse),
          duplicateGroups: duplicates.length,
        });
      }
    collections.push({ collection: model.collection.name, required });
  }
  console.log(
    JSON.stringify(
      {
        version: "2026-11-18-platform-v1",
        readOnly: true,
        collections,
        schemaChanges: [
          "Optional User.platformProfile/platformPermissions; legacy Super Admin accounts retain their operational privileges",
          "Operator.salesBlocked defaults false; existing operator status still controls access",
        ],
        mfaAvailable: false,
        liveFinancialOperations: false,
        rollback:
          "Revoke staff sessions and disable their accounts, retain all audit, command and financial records; never delete or reset collections",
      },
      null,
      2,
    ),
  );
} finally {
  await mongoose.disconnect();
}
