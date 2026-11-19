import * as M from "../models/index.js";
import { fail, type Principal } from "../utils/core.js";
import type { Config } from "../config/env.js";
import {
  financeTransaction,
  financeAudit,
  testFinance,
} from "./agency-finance.service.js";
import {
  financeReview,
  refundIndexesReady,
  createIntent,
} from "./refund-workflow.service.js";
import {
  postJournalInTransaction,
  paise,
  safeMoney,
} from "./ledger.service.js";
async function ownedException(
  auth: Principal,
  id: string,
  session?: any,
  write = true,
): Promise<any> {
  const row = await M.FinanceException.findOne({
    _id: id,
    ...(auth.role === "super_admin" ? {} : { operatorId: auth.operatorId }),
  }).session(session || null);
  if (!row) fail(404, "NOT_FOUND", "Financial exception not found");
  if (write) financeReview(auth, String(row!.operatorId));
  else if (
    auth.agentId ||
    (auth.role === "super_admin"
      ? !auth.permissions.includes("platform:finance:read")
      : !auth.permissions.includes("finance:read"))
  )
    fail(403, "FORBIDDEN", "Financial reporting access required");
  return row;
}
export async function financialExceptionDetail(auth: Principal, id: string) {
  const row = await ownedException(auth, id, undefined, false);
  const payment: any = row.paymentId
    ? await M.Payment.findOne({
        _id: row.paymentId,
        operatorId: row.operatorId,
      })
        .select("providerId amountPaise currency refundedPaise status")
        .lean()
    : null;
  return {
    exception: row,
    payment,
    refundableCapturedPaise: payment
      ? safeMoney(
          paise(payment.amountPaise) - paise(payment.refundedPaise || 0),
        )
      : null,
    liveRefundAvailable: false,
  };
}
export async function approveExceptionRefund(
  config: Config,
  auth: Principal,
  id: string,
  reason: string,
) {
  testFinance(config);
  await refundIndexesReady();
  return financeTransaction(async (session) => {
    const row = await ownedException(auth, id, session),
      operatorId = String(row.operatorId);
    if (row.intentId) return row;
    if (
      !["Duplicate capture", "Late capture"].includes(row.kind) ||
      row.status === "Resolved"
    )
      fail(
        409,
        "EXCEPTION_REVIEW_REQUIRED",
        "This exception cannot automatically create a refund",
      );
    const policy = await M.CancellationAccountingPolicy.findOneAndUpdate(
      { operatorId, enabled: true, allowExceptionRefunds: true },
      { $inc: { __v: 1 } },
      { session },
    );
    if (!policy)
      fail(
        409,
        "EXCEPTION_POLICY_REQUIRED",
        "Explicit captured-exception refund policy is required",
      );
    const payment: any = await M.Payment.findOne({
      _id: row.paymentId,
      operatorId,
      bookingId: row.bookingId,
      status: "captured",
      providerId: "razorpay_test",
    })
      .session(session)
      .lean();
    const booking = await M.Booking.findOne({ _id: row.bookingId, operatorId })
      .session(session)
      .lean();
    if (
      !payment ||
      !booking ||
      (payment.refundedPaise || 0) !== 0 ||
      paise(payment.amountPaise) === 0n
    )
      fail(
        409,
        "PAYMENT_AMBIGUOUS",
        "A matched, unrefunded captured test payment is required",
      );
    const capture: any = await M.JournalEntry.findOne({
      operatorId,
      paymentId: payment._id,
      kind: "Payment exception",
    })
      .session(session)
      .lean();
    if (
      !capture ||
      capture.totalPaise !== payment.amountPaise ||
      (await M.JournalEntry.exists({ reversalOf: capture._id }).session(
        session,
      ))
    )
      fail(
        409,
        "LEDGER_HISTORY_REQUIRED",
        "Original unreversed suspense journal is required",
      );
    const journal = await postJournalInTransaction(
      {
        operatorId,
        idempotencyKey: `exception-refund:${payment._id}`,
        currency: "INR",
        kind: "Exception refund",
        bookingId: String(booking!._id),
        paymentId: String(payment._id),
        actorId: auth.userId,
        sourceEventId: id,
        reason:
          "Authorized full captured-exception refund liability; no ticket or payable changes",
        lines: [
          {
            account: {
              ownerType: "Platform",
              ownerId: "aibus",
              code: "payment-exceptions",
            },
            debitPaise: payment.amountPaise,
            creditPaise: 0,
          },
          {
            account: {
              ownerType: "Operator",
              ownerId: operatorId,
              code: "customer-refunds-payable",
            },
            debitPaise: 0,
            creditPaise: payment.amountPaise,
          },
        ],
      },
      session,
    );
    const intent = await createIntent(
      session,
      booking,
      payment,
      payment.amountPaise,
      "Payment exception",
      auth.userId,
      journal._id,
    );
    row.intentId = intent._id;
    row.status = "In review";
    row.reviewedBy = auth.userId;
    row.reviewReason = reason;
    await row.save({ session });
    await financeAudit(
      { ...auth, operatorId },
      "exception.refund-approved",
      id,
      session,
      { reason, intentId: String(intent._id), journalId: String(journal._id) },
    );
    return row;
  });
}
export async function reviewFinanceException(
  auth: Principal,
  id: string,
  action: "Acknowledge" | "Resolve verified refund",
  reason: string,
) {
  return financeTransaction(async (session) => {
    const row = await ownedException(auth, id, session),
      operatorId = String(row.operatorId);
    if (action === "Resolve verified refund") {
      if (
        !row.intentId ||
        !(await M.RefundIntent.exists({
          _id: row.intentId,
          operatorId,
          status: "Processed",
          journalId: { $exists: true },
        }).session(session))
      )
        fail(
          409,
          "VERIFIED_EVIDENCE_REQUIRED",
          "A completed verified refund and posted journal are required; a review click is insufficient",
        );
      row.status = "Resolved";
    } else if (row.status !== "Resolved") row.status = "In review";
    row.reviewedBy = auth.userId;
    row.reviewReason = reason;
    await row.save({ session });
    await financeAudit(
      { ...auth, operatorId },
      "exception.review",
      id,
      session,
      { reason, action },
    );
    return row;
  });
}
export async function authorizeRefundRecheck(
  auth: Principal,
  id: string,
  reason: string,
) {
  return financeTransaction(async (session) => {
    const intent: any = await M.RefundIntent.findOne({
      _id: id,
      ...(auth.role === "super_admin" ? {} : { operatorId: auth.operatorId }),
    }).session(session);
    if (!intent) fail(404, "NOT_FOUND", "Refund intent not found");
    financeReview(auth, String(intent.operatorId));
    if (intent.status === "Processed") return intent;
    if (intent.leaseUntil && intent.leaseUntil > new Date())
      fail(409, "REFUND_BUSY", "A worker still owns this refund attempt");
    const previousAttempts = intent.attempts;
    intent.attempts = 0;
    intent.reviewCycles = (intent.reviewCycles || 0) + 1;
    intent.status = "Uncertain";
    intent.nextAttemptAt = new Date();
    await intent.save({ session });
    await financeAudit(
      { ...auth, operatorId: String(intent.operatorId) },
      "refund.recheck-authorized",
      id,
      session,
      { reason, previousAttempts, reviewCycles: intent.reviewCycles },
    );
    return intent;
  });
}
