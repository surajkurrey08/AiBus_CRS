import {
  collectPartnerEvents,
  deliverPartnerWebhooks,
} from "../services/public-webhook.service.js";
import type { Server } from "socket.io";
import type { Config } from "../config/env.js";
import { runLeasedJob } from "../services/job-runner.service.js";
import { reconcileRazorpayOrders } from "../services/razorpay.service.js";
import { expireFundingReservations } from "../services/agency-finance.service.js";
import { reconcileRefundIntents } from "../services/refund-workflow.service.js";
import { scanOperationalIntegrity } from "../services/operations-integrity.service.js";
import {
  reconcileExpiredHolds,
  reconcileExternalBookings,
  publishOutbox,
} from "./booking.jobs.js";
import { logger } from "../utils/core.js";
export async function runOperationalJobs(config: Config, io?: Server) {
  const jobs: [string, (signal: AbortSignal) => Promise<unknown>, number][] = [
    ["hold-expiry", async () => reconcileExpiredHolds(), 10000],
    [
      "razorpay-reconciliation",
      async () => reconcileRazorpayOrders(config),
      10000,
    ],
    ["wallet-expiry", async () => expireFundingReservations(), 10000],
    [
      "refund-reconciliation",
      async () => reconcileRefundIntents(config),
      10000,
    ],
    ["external-bookings", async () => reconcileExternalBookings(), 30000],
    [
      "integrity-scan",
      (signal) => scanOperationalIntegrity(signal, config.OPS_STUCK_MS),
      60000,
    ],
  ];
  if (config.PUBLIC_API_SANDBOX)
    jobs.push(
      [
        "public-webhook-events",
        (signal) => collectPartnerEvents(config, signal),
        10000,
      ],
      [
        "public-webhook-delivery",
        async () => deliverPartnerWebhooks(config),
        10000,
      ],
    );
  if (io) jobs.push(["inventory-outbox", async () => publishOutbox(io), 1000]);
  const results = [];
  for (const [key, work, intervalMs] of jobs) {
    try {
      results.push({
        key,
        ...(await runLeasedJob(
          key,
          (signal) => {
            signal.throwIfAborted();
            return work(signal);
          },
          { intervalMs },
        )),
      });
    } catch {
      logger.error(
        { jobKey: key, code: "JOB_RUNNER_UNAVAILABLE" },
        "Operational job could not acquire safe ownership",
      );
      results.push({ key, succeeded: false });
    }
  }
  return results;
}
