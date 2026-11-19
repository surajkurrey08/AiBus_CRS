import { percentBasisPoints } from "./refund-workflow.service.js";
import { paise, safeMoney } from "./ledger.service.js";
import mongoose from "mongoose";
import * as M from "../models/index.js";
import { fail, type Principal } from "../utils/core.js";
import { agencyBookingScope, authorizeAgent } from "./agent.service.js";
export async function requestCancellation(
  auth: Principal,
  bookingId: string,
  reason: string,
  requestId?: string,
) {
  const owner = auth.agentId
    ? agencyBookingScope(auth.operatorId!, auth.agentId)
    : { operatorId: auth.operatorId };
  let result: any;
  try {
    await mongoose.connection.transaction(async (session) => {
      if (auth.agentId) await authorizeAgent(auth, "cancel", session);
      const booking: any = await M.Booking.findOne({ _id: bookingId, ...owner })
        .session(session)
        .lean();
      if (!booking) fail(404, "NOT_FOUND", "Booking not found");
      const prior = await M.Cancellation.findOne({
        operatorId: auth.operatorId,
        bookingId,
      })
        .session(session)
        .lean();
      if (prior) {
        result = prior;
        return;
      }
      if (await M.SettlementLine.exists({ operatorId: auth.operatorId, bookingId }).session(session)) fail(409, "SETTLEMENT_CLAIMED", "This booking has a financial settlement claim; an approved compensating adjustment is required before cancellation");
      if (booking.status !== "Confirmed")
        fail(409, "NOT_CONFIRMED", "Only a confirmed booking can be cancelled");
      const trip: any = await M.Trip.findOne({
        _id: booking.tripId,
        operatorId: auth.operatorId,
      })
        .session(session)
        .lean();
      if (!trip) fail(404, "NOT_FOUND", "Trip not found");
      if (new Date(trip.departureAt) <= new Date())
        fail(409, "DEPARTED", "Trip has already departed");
      const policy: any = await M.Policy.findOne({
        operatorId: auth.operatorId,
      })
        .session(session)
        .lean();
      if (!policy)
        fail(
          409,
          "POLICY_REQUIRED",
          "Configure an operator cancellation policy first",
        );
      const hours = (+new Date(trip.departureAt) - Date.now()) / 3600000;
      const rule = [...policy.rules]
        .sort((a, b) => b.hoursBefore - a.hoursBefore)
        .find((r) => hours >= r.hoursBefore);
      if (!rule) fail(409, "POLICY_AMBIGUOUS", "No cancellation rule covers this departure");
      const refundPaise = safeMoney(paise(booking.totalPaise) * percentBasisPoints(rule.refundPercent) / 10000n);
      // Request only: confirmation, inventory release and gateway refunds remain unchanged.
      await M.Booking.updateOne(
        { _id: bookingId, ...owner, status: "Confirmed" },
        { $inc: { __v: 1 } },
        { session },
      );
      [result] = await M.Cancellation.create(
        [
          {
            operatorId: auth.operatorId,
            bookingId,
            reason,
            requestedBy: auth.userId,
            policySnapshot: { version: policy.version, rules: policy.rules },
            refundPaise,
          },
        ],
        { session },
      );
      await M.Refund.create(
        [
          {
            operatorId: auth.operatorId,
            bookingId,
            cancellationId: result._id,
            amountPaise: refundPaise,
          },
        ],
        { session },
      );
      await M.Audit.create(
        [
          {
            operatorId: auth.operatorId,
            actorId: auth.userId,
            action: "cancellation.request",
            resourceId: bookingId,
            requestId,
          },
        ],
        { session },
      );
    });
  } catch (error) {
    if ((error as any).code !== 11000) throw error;
    result = await M.Cancellation.findOne({
      operatorId: auth.operatorId,
      bookingId,
    }).lean();
    if (!result) throw error;
  }
  return result;
}
