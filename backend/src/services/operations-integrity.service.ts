import { verifyLedger } from "./ledger-integrity.service.js";
import mongoose from "mongoose";
import * as M from "../models/index.js";
import { OperationalIssue } from "../models/operations.model.js";
import { fail } from "../utils/core.js";

export async function inspectTripIntegrity(
  operatorId: string,
  tripId: string,
  staleMs = 900000,
) {
  return mongoose.connection.transaction(async (session) => {
    const scope = { operatorId, tripId },
      now = new Date();
    const trip: any = await M.Trip.findOne({ _id: tripId, operatorId })
      .session(session)
      .lean();
    if (!trip) fail(404, "NOT_FOUND", "Trip not found");
    const bookings: any[] = await M.Booking.find(scope)
      .select("_id holdId status paymentStatus passengers.seat createdAt")
      .session(session)
      .lean();
    const holds: any[] = await M.Hold.find(scope).session(session).lean();
    const tickets: any[] = await M.Ticket.find({
      operatorId,
      bookingId: { $in: bookings.map((b) => b._id) },
    })
      .session(session)
      .lean();
    const issues: {
      code: string;
      resourceId: string;
      category: "Inventory" | "Recovery";
    }[] = [];
    const add = (
      code: string,
      resourceId: unknown,
      category: "Inventory" | "Recovery" = "Inventory",
    ) => issues.push({ code, resourceId: String(resourceId), category });
    for (const seat of trip.seats) {
      const booking = bookings.find(
        (b) => String(b._id) === String(seat.bookingId),
      );
      if (
        seat.state === "booked" &&
        (!booking ||
          booking.status !== "Confirmed" ||
          !booking.passengers.some((p: any) => p.seat === seat.number))
      )
        add("BOOKED_SEAT_WITHOUT_CONFIRMED_OWNER", `${tripId}:${seat.number}`);
      if (seat.state === "held") {
        const hold = holds.find(
          (h) =>
            h.holdId === seat.holdId && ["held", "consumed"].includes(h.status),
        );
        if (
          !hold ||
          !hold.seats.includes(seat.number) ||
          String(hold.userId) !== String(seat.holdUserId) ||
          +new Date(hold.expiresAt) !== +new Date(seat.holdUntil)
        )
          add("HELD_SEAT_OWNERSHIP_MISMATCH", `${tripId}:${seat.number}`);
        if (new Date(seat.holdUntil) <= now)
          add("EXPIRED_HOLD_PENDING_CLEANUP", seat.holdId, "Recovery");
        if (
          seat.bookingId &&
          (!booking ||
            booking.holdId !== seat.holdId ||
            booking.status !== "Pending payment")
        )
          add("HELD_BOOKING_OWNERSHIP_MISMATCH", `${tripId}:${seat.number}`);
      }
    }
    for (const hold of holds) {
      if (
        hold.status === "consumed" &&
        bookings.some(
          (b) => b.holdId === hold.holdId && b.status === "Confirmed",
        )
      )
        continue;
      if (
        ["held", "consumed"].includes(hold.status) &&
        new Date(hold.expiresAt) <= now
      )
        add("EXPIRED_HOLD_PENDING_CLEANUP", hold.holdId, "Recovery");
      if (
        ["held", "consumed"].includes(hold.status) &&
        new Date(hold.expiresAt) > now &&
        hold.seats.some(
          (n: string) =>
            !trip.seats.some(
              (s: any) =>
                s.number === n &&
                s.state === "held" &&
                s.holdId === hold.holdId,
            ),
        )
      )
        add("ACTIVE_HOLD_WITHOUT_SEAT", hold.holdId);
    }
    for (const booking of bookings) {
      const valid = tickets.filter(
        (t) =>
          String(t.bookingId) === String(booking._id) && t.status === "valid",
      );
      if (booking.status === "Confirmed") {
        if (valid.length !== 1) add("CONFIRMED_TICKET_MISMATCH", booking._id);
        for (const p of booking.passengers)
          if (
            !trip.seats.some(
              (s: any) =>
                s.number === p.seat &&
                s.state === "booked" &&
                String(s.bookingId) === String(booking._id),
            )
          )
            add("CONFIRMED_SEAT_MISMATCH", `${booking._id}:${p.seat}`);
      } else if (valid.length)
        add("VALID_TICKET_WITHOUT_CONFIRMATION", booking._id);
      if (
        booking.status === "Pending payment" &&
        +now - +new Date(booking.createdAt) > staleMs
      )
        add("STUCK_PENDING_BOOKING", booking._id, "Recovery");
      if (
        booking.paymentStatus === "Paid" &&
        booking.status !== "Confirmed" &&
        booking.status !== "Cancelled"
      )
        add("PAID_BOOKING_REQUIRES_RECOVERY", booking._id, "Recovery");
    }
    return [
      ...new Map(issues.map((i) => [i.code + ":" + i.resourceId, i])).values(),
    ];
  });
}

export async function persistIssues(
  operatorId: string,
  issues: { code: string; resourceId: string; category: string }[],
  tripId?: string,
) {
  const now = new Date();
  await mongoose.connection.transaction(async (session) => {
    const keys = issues.map((i) => i.code + ":" + i.resourceId);
    for (const issue of issues)
      await OperationalIssue.updateOne(
        { operatorId, key: issue.code + ":" + issue.resourceId },
        {
          $set: {
            ...issue,
            ...(tripId ? { tripId } : {}),
            status: "Open",
            lastSeenAt: now,
          },
          $setOnInsert: { firstSeenAt: now },
          $unset: { resolvedAt: 1 },
        },
        { upsert: true, session },
      );
    await OperationalIssue.updateMany(
      {
        operatorId,
        ...(tripId ? { tripId } : { tripId: null }),
        status: "Open",
        key: { $nin: keys },
      },
      { $set: { status: "Resolved", resolvedAt: now } },
      { session },
    );
  });
}
export async function scanOperationalIntegrity(
  signal: AbortSignal,
  staleMs = 900000,
) {
  // Cursor avoids a first-page-only scan. Each trip snapshot is transactionally consistent.
  for await (const trip of M.Trip.find({ inventoryOwner: "internal" })
    .select("_id operatorId")
    .sort({ _id: 1 })
    .cursor()) {
    signal.throwIfAborted();
    const issues = await inspectTripIntegrity(
      String(trip.operatorId),
      String(trip._id),
      staleMs,
    );
    signal.throwIfAborted();
    await persistIssues(String(trip.operatorId), issues, String(trip._id));
  }
  for await (const operator of M.Operator.find().select("_id").cursor()) {
    signal.throwIfAborted();
    const owner = { operatorId: operator._id },
      cutoff = new Date(Date.now() - staleMs);
    const issues: { code: string; resourceId: string; category: string }[] = [];
    for (const [model, filter, code] of [
      [
        M.PaymentOrder,
        { settledAt: null, createdAt: { $lt: cutoff } },
        "PAYMENT_ORDER_UNRESOLVED",
      ],
      [
        M.RefundIntent,
        {
          status: {
            $in: [
              "Failed",
              "Uncertain",
              "Manual review",
              "Pending",
              "Submitting",
            ],
          },
        },
        "REFUND_REQUIRES_REVIEW",
      ],
      [
        M.WalletReservation,
        { status: "Reserved", expiresAt: { $lte: new Date() } },
        "WALLET_RESERVATION_EXPIRED",
      ],
      [
        M.FinanceException,
        { status: { $ne: "Resolved" } },
        "FINANCIAL_EXCEPTION_OPEN",
      ],
      [
        M.PayoutIntent,
        { status: { $in: ["Failed", "Uncertain", "Manual review"] } },
        "SETTLEMENT_PAYOUT_EXCEPTION",
      ],
    ] as const) {
      for await (const row of (model as any)
        .find({ ...owner, ...filter })
        .select("_id")
        .cursor()) {
        signal.throwIfAborted();
        issues.push({ code, resourceId: String(row._id), category: "Finance" });
      }
    }
    const ledger = await verifyLedger(String(operator._id));
    for (const issue of ledger.issues)
      issues.push({
        code: "LEDGER_" + issue.code,
        resourceId: issue.id,
        category: "Finance",
      });
    signal.throwIfAborted();
    await persistIssues(String(operator._id), issues);
  }
}
