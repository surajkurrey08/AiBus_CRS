import type { RequestHandler } from "express";
import { logger } from "../utils/core.js";
// Bounded, per-process counters. No paths, query strings, identifiers or PII labels.
const buckets = new Map<
  number,
  {
    requests: number;
    failed: number;
    slow: number;
    durationMs: number;
    bookingFailures: number;
    inventoryConflicts: number;
  }
>();
export const observeRequests =
  (slowMs: number): RequestHandler =>
  (req, res, next) => {
    const start = performance.now();
    res.once("finish", () => {
      const minute = Math.floor(Date.now() / 60000),
        durationMs = performance.now() - start;
      for (const key of buckets.keys())
        if (key < minute - 59) buckets.delete(key);
      const value = buckets.get(minute) || {
        requests: 0,
        failed: 0,
        slow: 0,
        durationMs: 0,
        bookingFailures: 0,
        inventoryConflicts: 0,
      };
      value.requests++;
      value.durationMs += durationMs;
      if (res.statusCode >= 500) value.failed++;
      if (durationMs >= slowMs) value.slow++;
      if (
        res.statusCode >= 400 &&
        /\/(counter|bookings|holds)(\/|$)/.test(req.path)
      )
        value.bookingFailures++;
      if (
        res.statusCode === 409 &&
        /\/(counter|bookings|holds|inventory)(\/|$)/.test(req.path)
      )
        value.inventoryConflicts++;
      buckets.set(minute, value);
      if (res.statusCode >= 500 || durationMs >= slowMs)
        logger.warn(
          {
            requestId: req.requestId,
            status: res.statusCode,
            durationMs: Math.round(durationMs),
            code: res.statusCode >= 500 ? "API_FAILURE" : "SLOW_REQUEST",
          },
          "Operational request threshold exceeded",
        );
    });
    next();
  };
export function requestMetrics() {
  const rows = [...buckets]
    .filter(([minute]) => minute >= Math.floor(Date.now() / 60000) - 59)
    .map(([minute, values]) => ({ minute, ...values }));
  return {
    scope:
      "Current API process, rolling 60 minutes; not a production metrics backend",
    rows,
  };
}
let realtime: {
  connected: number;
  adapterReady: boolean;
  checkedAt: string;
} | null = null;
export function recordRealtime(connected: number, adapterReady: boolean) {
  realtime = { connected, adapterReady, checkedAt: new Date().toISOString() };
}
export function realtimeMetrics() {
  return realtime || { connected: 0, adapterReady: false, checkedAt: null };
}
