import { z } from "zod";
import { dateOnly } from "./common.schemas.js";
export const agentPeriod = z
  .object({ from: dateOnly.optional(), to: dateOnly.optional() })
  .strict()
  .refine(
    (v) => !v.from || !v.to || v.from <= v.to,
    "From date must not follow to date",
  );
export const agentBookingQuery = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    search: z.string().trim().max(100).default(""),
    status: z
      .enum([
        "Pending payment",
        "Confirmed",
        "Failed",
        "Cancelled",
        "Reconciliation required",
      ])
      .optional(),
    paymentStatus: z
      .enum(["Pending", "Paid", "Failed", "Refund pending", "Refunded"])
      .optional(),
    from: dateOnly.optional(),
    to: dateOnly.optional(),
  })
  .strict()
  .refine(
    (v) => !v.from || !v.to || v.from <= v.to,
    "From date must not follow to date",
  );
export function createdDuring(period: { from?: string; to?: string }) {
  return period.from || period.to
    ? {
        createdAt: {
          ...(period.from
            ? { $gte: new Date(`${period.from}T00:00:00+05:30`) }
            : {}),
          ...(period.to
            ? { $lte: new Date(`${period.to}T23:59:59.999+05:30`) }
            : {}),
        },
      }
    : {};
}
export function indiaToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
