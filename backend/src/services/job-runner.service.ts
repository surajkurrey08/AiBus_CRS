import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import {
  OperationalJob,
  OperationalJobRun,
} from "../models/operations.model.js";
import { fail, logger } from "../utils/core.js";

export async function requireJobIndexes() {
  for (const [model, field] of [
    [OperationalJob, "key"],
    [OperationalJobRun, "token"],
  ] as const) {
    const indexes = await model.collection.indexes().catch(() => []);
    if (
      !indexes.some(
        (i) =>
          i.unique &&
          !i.sparse &&
          !i.partialFilterExpression &&
          Object.keys(i.key).length === 1 &&
          i.key[field] === 1,
      )
    )
      fail(
        503,
        "JOB_INDEX_REQUIRED",
        "Provision operational job uniqueness before starting workers",
      );
  }
}
export async function runLeasedJob(
  key: string,
  work: (signal: AbortSignal) => Promise<unknown>,
  options: { intervalMs?: number; leaseMs?: number; maxFailures?: number } = {},
) {
  await requireJobIndexes();
  const now = new Date(),
    token = randomUUID(),
    leaseMs = options.leaseMs ?? 60000;
  if (leaseMs < 300 || leaseMs > 3600000)
    throw Error("Invalid job lease duration");
  try {
    await OperationalJob.updateOne(
      { key },
      { $setOnInsert: { key } },
      { upsert: true },
    );
  } catch (error) {
    if ((error as any).code !== 11000) throw error;
  }
  let job: any;
  await mongoose.connection.transaction(async (session) => {
    job = await OperationalJob.findOneAndUpdate(
      {
        key,
        state: { $ne: "Manual review" },
        nextRunAt: { $lte: now },
        $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }],
      },
      {
        $set: {
          token,
          state: "Running",
          leaseUntil: new Date(+now + leaseMs),
          heartbeatAt: now,
          lastStartedAt: now,
        },
      },
      { new: true, session },
    );
    if (!job) return;
    await OperationalJobRun.updateMany(
      { jobKey: key, status: "Running" },
      {
        $set: { status: "Lease lost", code: "WORKER_RESTART", finishedAt: now },
      },
      { session },
    );
    await OperationalJobRun.create(
      [{ jobKey: key, token, status: "Running", startedAt: now }],
      { session },
    );
  });
  if (!job) return { acquired: false };
  const controller = new AbortController();
  let renewing = false;
  const heartbeat = setInterval(
    async () => {
      if (renewing || controller.signal.aborted) return;
      renewing = true;
      try {
        const at = new Date();
        const updated = await OperationalJob.updateOne(
          { key, token, state: "Running", leaseUntil: { $gt: at } },
          { $set: { heartbeatAt: at, leaseUntil: new Date(+at + leaseMs) } },
        );
        if (updated.modifiedCount !== 1) controller.abort();
      } catch {
        controller.abort();
      } finally {
        renewing = false;
      }
    },
    Math.max(100, Math.floor(leaseMs / 3)),
  );
  heartbeat.unref();
  try {
    await work(controller.signal);
    if (controller.signal.aborted) throw Error("LEASE_LOST");
    const finishedAt = new Date();
    await mongoose.connection.transaction(async (session) => {
      const result = await OperationalJob.updateOne(
        { key, token, state: "Running", leaseUntil: { $gt: finishedAt } },
        {
          $set: {
            state: "Idle",
            failures: 0,
            lastSucceededAt: finishedAt,
            nextRunAt: new Date(+finishedAt + (options.intervalMs ?? 10000)),
          },
          $unset: { token: 1, leaseUntil: 1, lastCode: 1 },
        },
        { session },
      );
      if (!result.modifiedCount)
        fail(409, "LEASE_LOST", "Worker ownership expired");
      await OperationalJobRun.updateOne(
        { token, status: "Running" },
        { $set: { status: "Succeeded", finishedAt } },
        { session },
      );
    });
    return { acquired: true, succeeded: true };
  } catch {
    const at = new Date(),
      failures = job.failures + 1;
    await mongoose.connection.transaction(async (session) => {
      const updated = await OperationalJob.updateOne(
        { key, token, state: "Running", leaseUntil: { $gt: at } },
        {
          $set: {
            state:
              failures >= (options.maxFailures ?? 5)
                ? "Manual review"
                : "Backoff",
            failures,
            lastFailedAt: at,
            lastCode: "JOB_FAILED",
            nextRunAt: new Date(
              +at + Math.min(900000, 10000 * 2 ** Math.min(failures, 6)),
            ),
          },
          $unset: { token: 1, leaseUntil: 1 },
        },
        { session },
      );
      await OperationalJobRun.updateOne(
        { token, status: "Running" },
        {
          $set: {
            status: updated.modifiedCount ? "Failed" : "Lease lost",
            code: updated.modifiedCount ? "JOB_FAILED" : "LEASE_LOST",
            finishedAt: at,
          },
        },
        { session },
      );
    });
    logger.error(
      { jobKey: key, runId: token, code: "JOB_FAILED" },
      "Background job requires recovery",
    );
    return { acquired: true, succeeded: false };
  } finally {
    clearInterval(heartbeat);
  }
}
