import mongoose from "mongoose";
import { readConfig } from "../config/env.js";
import * as M from "../models/index.js";
const config = readConfig(),
  apply = process.argv.includes("--apply-sandbox");
if (
  process.argv
    .slice(2)
    .some((a) => !["--apply-sandbox", "--ack-reviewed"].includes(a))
)
  throw Error("Unknown readiness option");
await mongoose.connect(config.MONGODB_URI, {
  autoIndex: false,
  autoCreate: false,
});
try {
  if (
    apply &&
    (!process.argv.includes("--ack-reviewed") ||
      config.NODE_ENV === "production" ||
      !mongoose.connection.name.startsWith("aibus_public_sandbox_"))
  )
    throw Error(
      "Writes require explicit acknowledgement and an isolated sandbox database; live rollout is not supported by this script",
    );
  const selected = [
    M.Trip,
    M.Booking,
    M.Hold,
    M.PaymentOrder,
    M.Outbox,
    M.OperationalJob,
    M.OperationalJobRun,
    M.OperationalIssue,
    M.TripIncident,
    M.ApiPartner,
    M.ApiCredential,
    M.PartnerInventoryGrant,
    M.PublicResource,
    M.PartnerCommand,
    M.PartnerBookingReference,
    M.PartnerApiUsage,
    M.PartnerWebhookSubscription,
    M.PartnerWebhookEvent,
    M.PartnerWebhookDelivery,
    M.PartnerWebhookAttempt,
    M.PartnerSupport,
    M.User,
  ];
  const rows = [];
  for (const model of selected) {
    let installed: any[] = await model.collection.indexes().catch((e) => {
      if (e.code === 26) return [];
      throw e;
    });
    for (const [keys, options] of model.schema.indexes()) {
      const match = installed.find(
        (i) => JSON.stringify(i.key) === JSON.stringify(keys),
      );
      let duplicates = 0;
      if (options.unique && installed.length)
        duplicates = (
          await model.aggregate([
            ...(options.partialFilterExpression
              ? [{ $match: options.partialFilterExpression }]
              : options.sparse
                ? [
                    {
                      $match: {
                        $or: Object.keys(keys).map((k) => ({
                          [k]: { $exists: true },
                        })),
                      },
                    },
                  ]
                : []),
            {
              $group: {
                _id: Object.fromEntries(
                  Object.keys(keys).map((k) => [k, "$" + k]),
                ),
                count: { $sum: 1 },
              },
            },
            { $match: { count: { $gt: 1 } } },
            { $limit: 10 },
          ])
        ).length;
      const conflict =
        !!match &&
        (!!match.unique !== !!options.unique ||
          !!match.sparse !== !!options.sparse ||
          JSON.stringify(match.partialFilterExpression || {}) !==
            JSON.stringify(options.partialFilterExpression || {}) ||
          (match.expireAfterSeconds ?? null) !==
            (options.expireAfterSeconds ?? null));
      rows.push({
        collection: model.collection.name,
        keys,
        installed: !!match,
        conflict,
        duplicateGroups: duplicates,
      });
    }
  }
  if (apply) {
    if (rows.some((r) => r.conflict || r.duplicateGroups))
      throw Error(
        "Conflicting indexes/data require manual review; nothing was dropped or reset",
      );
    for (const model of selected) await model.createIndexes();
  }
  const queryPlan: any = await M.Trip.find({
    operatorId: new mongoose.Types.ObjectId(),
    status: "Scheduled",
    departureAt: { $gt: new Date() },
  })
    .limit(25)
    .explain("queryPlanner");
  console.log(
    JSON.stringify(
      {
        version: "operations-public-v1",
        readOnly: !apply,
        indexes: rows,
        tripLookupPlan: queryPlan.queryPlanner?.winningPlan,
        evidence:
          "One empty-scope query plan, not a production workload benchmark",
        rollback:
          "Stop rollout/revoke access; preserve existing indexes, job history, bookings and financial records. No automatic rollback deletion.",
      },
      null,
      2,
    ),
  );
} finally {
  await mongoose.disconnect();
}
