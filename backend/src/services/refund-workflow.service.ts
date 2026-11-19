import mongoose, { type ClientSession } from "mongoose";
import { createHash, randomUUID } from "node:crypto";
import * as M from "../models/index.js";
import { fail, type Principal } from "../utils/core.js";
import { agencyBookingScope, authorizeAgent } from "./agent.service.js";
import {
  financeTransaction,
  financeAudit,
  testFinance,
  ledgerBalance,
} from "./agency-finance.service.js";
import {
  paise,
  safeMoney,
  postJournalInTransaction,
  type JournalInput,
} from "./ledger.service.js";
import {
  razorpayRequest,
  requireRazorpay,
  RAZORPAY_PROVIDER,
} from "../integrations/razorpay.js";
import type { Config } from "../config/env.js";

export function percentBasisPoints(value: unknown): bigint {
  const text = String(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text))
    fail(
      409,
      "POLICY_AMBIGUOUS",
      "Refund percentages need at most two decimal places",
    );
  const [whole, fraction = ""] = text.split(".");
  const points = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (points > 10000n)
    fail(409, "POLICY_AMBIGUOUS", "Refund percentage is out of range");
  return points;
}
export function financeReview(
  auth: Principal,
  operatorId: string,
  permission: string = "refunds:review",
) {
  if (auth.role === "super_admin") {
    if (
      !auth.permissions.includes("platform:finance:read") ||
      !(auth.permissions as string[]).includes(permission)
    )
      fail(403, "FORBIDDEN", "Explicit financial review permission required");
  } else if (
    auth.agentId ||
    auth.operatorId !== operatorId ||
    !auth.permissions.includes("finance:manage") ||
    !auth.permissions.includes("refunds:write")
  )
    fail(403, "FORBIDDEN", "Authorized operator refund review required");
}
export async function refundIndexesReady() {
  for (const model of [
    M.CancellationAccountingPolicy,
    M.CancellationQuote,
    M.RefundIntent,
    M.RefundAttempt,
    M.FinanceException,
  ]) {
    let installed: any[];
    try {
      installed = await model.collection.listIndexes().toArray();
    } catch {
      fail(
        503,
        "REFUND_NOT_READY",
        "Review and install additive refund indexes first",
      );
    }
    for (const [keys, options] of model.schema.indexes())
      if (
        options.unique &&
        !installed!.some(
          (i) =>
            i.unique &&
            !!i.sparse === !!options.sparse &&
            !i.partialFilterExpression &&
            JSON.stringify(i.key) === JSON.stringify(keys),
        )
      )
        fail(
          503,
          "REFUND_NOT_READY",
          "Required refund uniqueness is not installed",
        );
  }
}
async function refundTransaction<T>(
  work: (session: ClientSession) => Promise<T>,
) {
  await refundIndexesReady();
  return financeTransaction(work);
}
async function bookingFor(
  auth: Principal,
  bookingId: string,
  session?: ClientSession,
  cancellation = true,
): Promise<any> {
  if (auth.role === "super_admin") {
    if (!auth.permissions.includes("platform:finance:read"))
      fail(403, "FORBIDDEN", "Platform financial access required");
  } else if (auth.agentId)
    await authorizeAgent(auth, cancellation ? "cancel" : "bookings", session);
  else if (
    !auth.operatorId ||
    !auth.permissions.includes(cancellation ? "refunds:write" : "finance:read")
  )
    fail(403, "FORBIDDEN", "Refund access required");
  const row = await M.Booking.findOne({
    _id: bookingId,
    ...(auth.role === "super_admin" ? {} : { operatorId: auth.operatorId }),
    ...(auth.agentId ? agencyBookingScope(auth.operatorId!, auth.agentId) : {}),
  }).session(session || null);
  if (!row) fail(404, "NOT_FOUND", "Booking not found");
  return row!;
}
function bookingFingerprint(booking: any) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        total: booking.totalPaise,
        gross: booking.grossPaise,
        discount: booking.discountPaise,
        tax: booking.taxPaise,
        charges: booking.chargePaise,
        commission: booking.commissionPaise,
        agentId: String(booking.agentId || ""),
        seats: booking.passengers.map((p: any) => p.seat).sort(),
      }),
    )
    .digest("hex");
}
export async function cancellationAccountingPolicy(auth: Principal) {
  if (
    !auth.operatorId ||
    !auth.permissions.includes("finance:read") ||
    auth.agentId
  )
    fail(403, "FORBIDDEN", "Operator financial policy access required");
  return (
    (await M.CancellationAccountingPolicy.findOne({
      operatorId: auth.operatorId,
    }).lean()) || {
      enabled: false,
      refundBasis: "Unconfigured",
      taxTreatment: "Unconfigured",
      chargeTreatment: "Unconfigured",
      commissionTreatment: "Unconfigured",
      allowExceptionRefunds: false,
      version: 0,
    }
  );
}
export async function configureCancellationAccounting(
  auth: Principal,
  input: {
    enabled: boolean;
    refundBasis: string;
    taxTreatment: string;
    chargeTreatment: string;
    commissionTreatment: string;
    allowExceptionRefunds: boolean;
    version: number;
    reason: string;
  },
) {
  if (!auth.operatorId)
    fail(403, "OPERATOR_CONTEXT_REQUIRED", "Operator policy context required");
  financeReview(auth, auth.operatorId!);
  if (
    input.enabled &&
    (input.refundBasis !== "Discounted base fare" ||
      [
        input.taxTreatment,
        input.chargeTreatment,
        input.commissionTreatment,
      ].includes("Unconfigured"))
  )
    fail(
      400,
      "POLICY_REQUIRED",
      "Explicit tax, charge and commission treatment is required",
    );
  return refundTransaction(async (session) => {
    const prior: any = await M.CancellationAccountingPolicy.findOne({
      operatorId: auth.operatorId,
    })
      .session(session)
      .lean();
    if ((prior?.version || 0) !== input.version)
      fail(409, "POLICY_CONFLICT", "Accounting policy changed; reload first");
    const { reason, version, ...body } = input;
    const result = await M.CancellationAccountingPolicy.findOneAndUpdate(
      { operatorId: auth.operatorId, ...(version ? { version } : {}) },
      { $set: { ...body, updatedBy: auth.userId }, $inc: { version: 1 } },
      { session, upsert: version === 0, new: true, setDefaultsOnInsert: false },
    );
    if (!result) fail(409, "POLICY_CONFLICT", "Accounting policy changed");
    await financeAudit(auth, "refund.policy", String(result!._id), session, {
      reason,
      previousVersion: version,
    });
    return result;
  });
}
export async function quoteCancellation(
  auth: Principal,
  bookingId: string,
  seats?: string[],
) {
  return refundTransaction(async (session) => {
    const booking = await bookingFor(auth, bookingId, session);
    const allSeats = booking.passengers.map((p: any) => p.seat).sort();
    if (seats && new Set(seats).size !== seats.length)
      fail(
        400,
        "INVALID_CANCELLATION_SCOPE",
        "Duplicate seat selections are invalid",
      );
    if (
      seats &&
      JSON.stringify([...new Set(seats)].sort()) !== JSON.stringify(allSeats)
    )
      fail(
        409,
        "PARTIAL_CANCELLATION_UNSUPPORTED",
        "Only full booking cancellation is supported; seat-level tax/discount policies are not configured",
      );
    if (booking.status !== "Confirmed" || booking.paymentStatus !== "Paid")
      fail(409, "NOT_CONFIRMED", "Only confirmed paid bookings can be quoted");
    const operatorId = String(booking.operatorId);
    const trip: any = await M.Trip.findOne({ _id: booking.tripId, operatorId })
      .session(session)
      .lean();
    if (!trip || trip.departureAt <= new Date())
      fail(409, "DEPARTED", "Trip has departed or is unavailable");
    const policy: any = await M.Policy.findOne({ operatorId })
      .session(session)
      .lean();
    const accounting: any = await M.CancellationAccountingPolicy.findOne({
      operatorId,
    })
      .session(session)
      .lean();
    if (
      !policy ||
      !accounting?.enabled ||
      accounting.refundBasis !== "Discounted base fare" ||
      accounting.commissionTreatment !== "Reverse all" ||
      [accounting.taxTreatment, accounting.chargeTreatment].includes(
        "Unconfigured",
      )
    )
      fail(
        409,
        "CANCELLATION_ACCOUNTING_REQUIRED",
        "Configure explicit cancellation, tax, charge and commission policies",
      );
    const milliseconds = +new Date(trip.departureAt) - Date.now();
    const rules = [...policy.rules].sort(
      (a: any, b: any) => b.hoursBefore - a.hoursBefore,
    );
    const rule = rules.find(
      (r: any) =>
        Number.isFinite(r.hoursBefore) &&
        milliseconds >= r.hoursBefore * 3600000,
    );
    if (!rule)
      fail(
        409,
        "POLICY_AMBIGUOUS",
        "No cancellation rule covers this departure time",
      );
    const points = percentBasisPoints(rule.refundPercent);
    const base = paise(booking.grossPaise) - paise(booking.discountPaise);
    if (
      base < 0n ||
      base + paise(booking.taxPaise) + paise(booking.chargePaise) !==
        paise(booking.totalPaise)
    )
      fail(409, "PRICING_AMBIGUOUS", "Booking pricing requires finance review");
    const baseRefundPaise = safeMoney((base * points) / 10000n);
    const taxRefundPaise =
      accounting.taxTreatment === "Proportional refund"
        ? safeMoney((paise(booking.taxPaise) * points) / 10000n)
        : 0;
    const chargeRefundPaise =
      accounting.chargeTreatment === "Proportional refund"
        ? safeMoney((paise(booking.chargePaise) * points) / 10000n)
        : 0;
    const refundPaise = safeMoney(
      paise(baseRefundPaise) + paise(taxRefundPaise) + paise(chargeRefundPaise),
    );
    const payments: any[] = await M.Payment.find({
      bookingId,
      operatorId,
      status: "captured",
    })
      .session(session)
      .lean();
    if (
      payments.length !== 1 ||
      payments[0].amountPaise !== booking.totalPaise ||
      payments[0].currency !== "INR" ||
      (payments[0].refundedPaise || 0) !== 0
    )
      fail(
        409,
        "PAYMENT_AMBIGUOUS",
        "A single captured, unrefunded payment is required",
      );
    const expiresAt = new Date(
      Math.min(
        Date.now() + 5 * 60000,
        +new Date(trip.departureAt) - rule.hoursBefore * 3600000 + 1,
      ),
    );
    const [quote] = await M.CancellationQuote.create(
      [
        {
          operatorId,
          bookingId,
          paymentId: payments[0]._id,
          requestedBy: auth.userId,
          policyVersion: policy.version,
          accountingPolicyVersion: accounting.version,
          bookingVersion: booking.__v,
          seats: allSeats,
          originalPaise: booking.totalPaise,
          refundPaise,
          retainedPaise: safeMoney(
            paise(booking.totalPaise) - paise(refundPaise),
          ),
          commissionReversePaise: booking.commissionPaise || 0,
          taxRefundPaise,
          chargeRefundPaise,
          baseRefundPaise,
          expiresAt,
          snapshot: {
            rule: {
              hoursBefore: rule.hoursBefore,
              refundPercent: rule.refundPercent,
            },
            taxTreatment: accounting.taxTreatment,
            chargeTreatment: accounting.chargeTreatment,
            commissionTreatment: accounting.commissionTreatment,
            bookingHash: bookingFingerprint(booking),
            partialSupported: false,
          },
        },
      ],
      { session },
    );
    return quote.toObject();
  });
}
export async function createIntent(
  session: ClientSession,
  booking: any,
  payment: any,
  amount: number,
  purpose: "Cancellation" | "Payment exception",
  approvedBy: string,
  liabilityJournalId: any,
  refundId?: any,
) {
  const intentId = new mongoose.Types.ObjectId(),
    receipt = `crs_${intentId}`;
  const requestBody = {
    amount,
    speed: "normal",
    receipt,
    notes: { crs_refund_intent: String(intentId) },
  };
  const method =
    payment.providerId === "agency-wallet"
      ? "wallet"
      : payment.providerId === "agency-credit"
        ? "credit"
        : "gateway";
  const [intent] = await M.RefundIntent.create(
    [
      {
        _id: intentId,
        operatorId: booking.operatorId,
        bookingId: booking._id,
        paymentId: payment._id,
        ...(refundId ? { refundId } : {}),
        purpose,
        amountPaise: amount,
        fundingMethod: method,
        providerId: payment.providerId,
        idempotencyKey: `refund_${intentId}`,
        requestBody,
        requestHash: createHash("sha256")
          .update(JSON.stringify(requestBody))
          .digest("hex"),
        approvedBy,
        liabilityJournalId,
        nextAttemptAt: new Date(),
      },
    ],
    { session },
  );
  return intent;
}
export async function reviewCancellation(
  config: Config,
  auth: Principal,
  cancellationId: string,
  action: "Accept" | "Reject",
  quoteId: string | undefined,
  reason: string,
) {
  if (action === "Accept") testFinance(config);
  if (action === "Accept" && !mongoose.isValidObjectId(quoteId))
    fail(
      400,
      "QUOTE_REQUIRED",
      "An explicit valid cancellation quote is required",
    );
  return refundTransaction(async (session) => {
    const cancellation: any = await M.Cancellation.findOne({
      _id: cancellationId,
      ...(auth.role === "super_admin" ? {} : { operatorId: auth.operatorId }),
    }).session(session);
    if (!cancellation) fail(404, "NOT_FOUND", "Cancellation not found");
    financeReview(auth, String(cancellation.operatorId));
    if (cancellation.status !== "Requested") {
      if (
        (action === "Accept" &&
          cancellation.status === "Approved" &&
          String(cancellation.acceptedQuoteId) === quoteId &&
          cancellation.reviewReason === reason) ||
        (action === "Reject" &&
          cancellation.status === "Rejected" &&
          cancellation.reviewReason === reason)
      )
        return cancellation;
      fail(
        409,
        "CANCELLATION_CLOSED",
        "Cancellation review already completed with different content",
      );
    }
    cancellation.reviewedBy = auth.userId;
    cancellation.reviewedAt = new Date();
    cancellation.reviewReason = reason;
    if (action === "Reject") {
      cancellation.status = "Rejected";
      await cancellation.save({ session });
      await financeAudit(
        { ...auth, operatorId: String(cancellation.operatorId) },
        "cancellation.reject",
        cancellationId,
        session,
        { reason },
      );
      return cancellation;
    }
    const operatorId = String(cancellation.operatorId);
    const booking: any = await M.Booking.findOne({
      _id: cancellation.bookingId,
      operatorId,
      status: "Confirmed",
      paymentStatus: "Paid",
    }).session(session);
    const quote: any = await M.CancellationQuote.findOne({
      _id: quoteId,
      operatorId,
      bookingId: cancellation.bookingId,
      expiresAt: { $gt: new Date() },
    })
      .session(session)
      .lean();
    if (
      !booking ||
      !quote ||
      quote.snapshot?.bookingHash !== bookingFingerprint(booking)
    )
      fail(
        409,
        "CANCELLATION_QUOTE_EXPIRED",
        "Generate a fresh quote for the current paid booking",
      );
    const policy = await M.Policy.findOneAndUpdate(
      { operatorId, version: quote.policyVersion },
      { $inc: { __v: 1 } },
      { session },
    );
    const accounting = await M.CancellationAccountingPolicy.findOneAndUpdate(
      { operatorId, enabled: true, version: quote.accountingPolicyVersion },
      { $inc: { __v: 1 } },
      { session },
    );
    if (!policy || !accounting)
      fail(
        409,
        "POLICY_CONFLICT",
        "Cancellation policy changed; regenerate the quote",
      );
    const payment: any = await M.Payment.findOne({
      _id: quote.paymentId,
      operatorId,
      bookingId: booking._id,
      status: "captured",
    })
      .session(session)
      .lean();
    const capture: any =
      payment &&
      (await M.JournalEntry.findOne({
        operatorId,
        paymentId: payment._id,
        kind: "Booking captured",
      })
        .session(session)
        .lean());
    if (
      !capture ||
      payment.amountPaise !== quote.originalPaise ||
      (payment.refundedPaise || 0) !== 0 ||
      (await M.JournalEntry.exists({ reversalOf: capture._id }).session(
        session,
      ))
    )
      fail(
        409,
        "LEDGER_HISTORY_REQUIRED",
        "Original capture accounting must be present and unreversed; historical backfill needs separate approval",
      );
    if (
      await M.SettlementLine.exists({
        operatorId,
        bookingId: booking._id,
      }).session(session)
    )
      fail(
        409,
        "SETTLEMENT_CLAIMED",
        "Settlement claims require an approved compensating adjustment before cancellation",
      );
    const lines: JournalInput["lines"] = [];
    let originalCredits = 0n,
      commissionCredit = 0n;
    for (const line of capture.lines as any[])
      if (line.creditPaise) {
        const account: any = await M.LedgerAccount.findOne({
          _id: line.accountId,
          operatorId,
        })
          .session(session)
          .lean();
        if (
          !account ||
          !["operator-payable", "agent-commission-payable"].includes(
            account.code,
          )
        )
          fail(
            409,
            "ACCOUNTING_AMBIGUOUS",
            "Capture includes an unsupported fee or liability allocation",
          );
        originalCredits += paise(line.creditPaise);
        if (account.code === "agent-commission-payable")
          commissionCredit += paise(line.creditPaise);
        lines.push({
          account: {
            ownerType: account.ownerType,
            ownerId: account.ownerId,
            code: account.code,
          },
          debitPaise: line.creditPaise,
          creditPaise: 0,
        });
      }
    if (
      originalCredits !== paise(quote.originalPaise) ||
      commissionCredit !== paise(quote.commissionReversePaise)
    )
      fail(
        409,
        "ACCOUNTING_AMBIGUOUS",
        "Commission snapshot and original journal disagree",
      );
    if (quote.refundPaise)
      lines.push({
        account: {
          ownerType: "Operator",
          ownerId: operatorId,
          code: "customer-refunds-payable",
        },
        debitPaise: 0,
        creditPaise: quote.refundPaise,
      });
    if (quote.retainedPaise)
      lines.push({
        account: {
          ownerType: "Operator",
          ownerId: operatorId,
          code: "operator-cancellation-payable",
        },
        debitPaise: 0,
        creditPaise: quote.retainedPaise,
      });
    const trip = await M.Trip.updateOne(
      {
        _id: booking.tripId,
        operatorId,
        inventoryOwner: "internal",
        departureAt: { $gt: new Date() },
        $and: booking.passengers.map((p: any) => ({
          seats: {
            $elemMatch: {
              number: p.seat,
              state: "booked",
              bookingId: booking._id,
              holdId: booking.holdId,
            },
          },
        })),
      },
      {
        $set: { "seats.$[seat].state": "available" },
        $unset: {
          "seats.$[seat].bookingId": 1,
          "seats.$[seat].holdId": 1,
          "seats.$[seat].holdUserId": 1,
          "seats.$[seat].holdUntil": 1,
        },
      },
      {
        session,
        arrayFilters: [
          {
            "seat.bookingId": booking._id,
            "seat.holdId": booking.holdId,
            "seat.state": "booked",
            "seat.number": { $in: booking.passengers.map((p: any) => p.seat) },
          },
        ],
      },
    );
    if (trip.modifiedCount !== 1)
      fail(
        409,
        "CANCELLATION_INVENTORY_CONFLICT",
        "Departure or seat ownership changed; no replacement seat was released",
      );
    const journal = await postJournalInTransaction(
      {
        operatorId,
        idempotencyKey: `cancellation:${cancellation._id}`,
        currency: "INR",
        kind: "Cancellation adjustment",
        bookingId: String(booking._id),
        paymentId: String(payment._id),
        actorId: auth.userId,
        reason:
          "Approved full cancellation; original payables reallocated to refund liability and operator retained amount",
        sourceEventId: String(quote._id),
        lines,
      },
      session,
    );
    const refund: any = await M.Refund.findOne({
      bookingId: booking._id,
      operatorId,
      status: "Requested",
    }).session(session);
    if (!refund)
      fail(
        409,
        "REFUND_STATE_CONFLICT",
        "Existing refund requires manual review",
      );
    refund.amountPaise = quote.refundPaise;
    refund.paymentId = payment._id;
    refund.liabilityJournalId = journal._id;
    if (quote.refundPaise) {
      const intent = await createIntent(
        session,
        booking,
        payment,
        quote.refundPaise,
        "Cancellation",
        auth.userId,
        journal._id,
        refund._id,
      );
      refund.workflowIntentId = intent._id;
    } else refund.status = "Not due";
    booking.status = "Cancelled";
    booking.paymentStatus = quote.refundPaise ? "Refund pending" : "Paid";
    await booking.save({ session });
    await refund.save({ session });
    await M.Ticket.updateOne(
      { operatorId, bookingId: booking._id, status: "valid" },
      { $set: { status: "cancelled" } },
      { session },
    );
    cancellation.status = "Approved";
    cancellation.acceptedQuoteId = quote._id;
    cancellation.accountingJournalId = journal._id;
    await cancellation.save({ session });
    await financeAudit(
      { ...auth, operatorId },
      "cancellation.accept",
      cancellationId,
      session,
      { reason, quoteId, journalId: String(journal._id) },
    );
    await M.Outbox.create(
      [
        {
          operatorId,
          event: "booking.cancelled",
          resourceId: String(booking._id),
        },
        {
          operatorId,
          event: "seat.availability.changed",
          resourceId: String(booking.tripId),
        },
      ],
      { session, ordered: true },
    );
    return cancellation;
  });
}
export async function recordFinanceException(
  input: {
    operatorId: string;
    bookingId?: string;
    paymentId?: string;
    intentId?: string;
    observedAmountPaise?: number;
    observedCurrency?: string;
    externalPaymentId?: string;
    kind: string;
    resourceKey: string;
    code: string;
  },
  session?: ClientSession,
) {
  return M.FinanceException.findOneAndUpdate(
    {
      operatorId: input.operatorId,
      kind: input.kind,
      resourceKey: input.resourceKey,
    },
    {
      $setOnInsert: { ...input, status: "Open" },
      $set: { lastSeenAt: new Date() },
    },
    { upsert: true, new: true, session },
  );
}
async function verifyAndPostRefund(
  intentId: string,
  evidence: any,
  workerId: string,
) {
  return refundTransaction(async (session) => {
    const intent: any = await M.RefundIntent.findOne({ _id: intentId }).session(
      session,
    );
    if (!intent) fail(404, "NOT_FOUND", "Refund intent not found");
    if (intent.status === "Processed") return intent;
    if (
      evidence.currency !== "INR" ||
      evidence.amount !== intent.amountPaise ||
      evidence.status !== "processed"
    )
      fail(
        409,
        "REFUND_EVIDENCE_INVALID",
        "Refund is not verified processed for the expected INR amount",
      );
    const payment: any = await M.Payment.findOne({
      _id: intent.paymentId,
      operatorId: intent.operatorId,
      bookingId: intent.bookingId,
    }).session(session);
    if (
      !payment ||
      paise(payment.amountPaise) - paise(payment.refundedPaise || 0) <
        paise(intent.amountPaise)
    )
      fail(
        409,
        "REFUND_EXCESS",
        "Refund exceeds the remaining captured balance",
      );
    const operatorId = String(intent.operatorId);
    if (
      intent.fundingMethod === "gateway" &&
      (payment.providerId !== RAZORPAY_PROVIDER ||
        evidence.payment_id !== payment.externalId ||
        evidence.id !== intent.externalRefundId)
    )
      fail(
        409,
        "REFUND_EVIDENCE_INVALID",
        "Gateway refund identity does not match its durable intent",
      );
    let creditAccount: JournalInput["lines"][number]["account"];
    if (intent.fundingMethod === "gateway")
      creditAccount = {
        ownerType: "Platform",
        ownerId: "aibus",
        code: "payment-clearing",
      };
    else {
      const reservation: any = await M.WalletReservation.findOne({
        bookingId: intent.bookingId,
        operatorId,
        status: "Consumed",
        mode: intent.fundingMethod,
      })
        .session(session)
        .lean();
      if (!reservation)
        fail(
          409,
          "FUNDING_HISTORY_REQUIRED",
          "Original consumed funding authorization is missing",
        );
      const model =
        intent.fundingMethod === "wallet" ? M.AgentWallet : M.CreditFacility;
      const holder = await model.findOneAndUpdate(
        { operatorId, agentId: reservation.agentId },
        { $inc: { revision: 1 } },
        { session },
      );
      if (!holder)
        fail(
          409,
          "FUNDING_HISTORY_REQUIRED",
          "Original agency financial account is missing",
        );
      if (intent.fundingMethod === "credit") {
        const outstanding = await ledgerBalance(
          operatorId,
          String(reservation.agentId),
          "agency-credit-receivable",
          session,
        );
        if (outstanding.amountPaise < intent.amountPaise)
          fail(
            409,
            "CREDIT_REFUND_REVIEW",
            "Credit was repaid; refund cannot convert credit into cash or prepaid funds",
          );
      }
      creditAccount = {
        ownerType: "Agent",
        ownerId: String(reservation.agentId),
        code:
          intent.fundingMethod === "wallet"
            ? "agency-prepaid"
            : "agency-credit-receivable",
      };
    }
    const journal = await postJournalInTransaction(
      {
        operatorId,
        idempotencyKey: `refund-post:${intent._id}`,
        currency: "INR",
        kind: "Refund",
        bookingId: String(intent.bookingId),
        paymentId: String(payment._id),
        sourceEventId: intent.externalRefundId || `internal_${intent._id}`,
        reason:
          "Verified refund discharges the approved liability to the original funding source",
        lines: [
          {
            account: {
              ownerType: "Operator",
              ownerId: operatorId,
              code: "customer-refunds-payable",
            },
            debitPaise: intent.amountPaise,
            creditPaise: 0,
          },
          {
            account: creditAccount,
            debitPaise: 0,
            creditPaise: intent.amountPaise,
          },
        ],
      },
      session,
    );
    payment.refundedPaise = safeMoney(
      paise(payment.refundedPaise || 0) + paise(intent.amountPaise),
    );
    if (payment.refundedPaise === payment.amountPaise)
      payment.status = "refunded";
    await payment.save({ session });
    if (intent.refundId)
      await M.Refund.updateOne(
        { _id: intent.refundId, operatorId, workflowIntentId: intent._id },
        {
          $set: {
            status: "Refunded",
            externalId: intent.externalRefundId,
            confirmedAt: new Date(),
          },
        },
        { session },
      );
    if (intent.purpose === "Payment exception")
      await M.Booking.updateOne(
        {
          _id: intent.bookingId,
          operatorId,
          status: "Reconciliation required",
        },
        { $set: { paymentStatus: "Refunded" } },
        { session },
      );
    if (intent.purpose === "Cancellation")
      await M.Booking.updateOne(
        { _id: intent.bookingId, operatorId, status: "Cancelled" },
        { $set: { paymentStatus: "Refunded" } },
        { session },
      );
    intent.status = "Processed";
    intent.journalId = journal._id;
    intent.processedAt = new Date();
    intent.leaseUntil = new Date(0);
    await intent.save({ session });
    await M.RefundAttempt.create(
      [
        {
          operatorId,
          intentId: intent._id,
          workerId,
          action: intent.fundingMethod === "gateway" ? "Reconcile" : "Internal",
          outcome: "processed",
          providerRefundId: intent.externalRefundId,
        },
      ],
      { session },
    );
    await M.Audit.create(
      [
        {
          operatorId,
          action: "refund.verified",
          resourceId: intentId,
          metadata: {
            journalId: String(journal._id),
            fundingMethod: intent.fundingMethod,
          },
          expiresAt: null,
        },
      ],
      { session },
    );
    await M.FinanceException.updateMany(
      { operatorId, intentId: intent._id, status: { $ne: "Resolved" } },
      { $set: { status: "Resolved", code: "REFUND_VERIFIED" } },
      { session },
    );
    return intent;
  });
}
async function gatewayEvidence(
  config: Config,
  intent: any,
  payment: any,
  id: string,
) {
  if (!/^rfnd_[a-z\d]+$/i.test(id))
    fail(409, "REFUND_EVIDENCE_INVALID", "Invalid gateway refund identifier");
  const refund = await razorpayRequest(
    config,
    `/refunds/${encodeURIComponent(id)}`,
  );
  if (
    refund.id !== id ||
    refund.payment_id !== payment.externalId ||
    refund.currency !== "INR" ||
    refund.amount !== intent.amountPaise ||
    (refund.receipt && refund.receipt !== intent.requestBody.receipt) ||
    !["pending", "processed", "failed"].includes(refund.status)
  )
    fail(
      409,
      "REFUND_EVIDENCE_INVALID",
      "Gateway refund does not match the durable intent",
    );
  return refund;
}
export async function processRefundIntent(config: Config, intentId: string) {
  testFinance(config);
  await refundIndexesReady();
  const workerId = randomUUID(),
    now = new Date();
  const intent: any = await M.RefundIntent.findOneAndUpdate(
    {
      _id: intentId,
      status: { $in: ["Ready", "Submitting", "Pending", "Uncertain"] },
      attempts: { $lt: 5 },
      $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: now } }],
    },
    {
      $set: {
        leaseOwner: workerId,
        leaseUntil: new Date(Date.now() + 60000),
        status: "Submitting",
      },
      $inc: { attempts: 1, totalAttempts: 1 },
    },
    { new: false },
  ).lean();
  if (!intent) return { busyOrClosed: true };
  try {
    if (
      createHash("sha256")
        .update(JSON.stringify(intent.requestBody))
        .digest("hex") !== intent.requestHash
    )
      fail(
        409,
        "REFUND_REQUEST_CHANGED",
        "Refund request identity changed; manual review required",
      );
    const payment: any = await M.Payment.findOne({
      _id: intent.paymentId,
      operatorId: intent.operatorId,
    }).lean();
    if (!payment)
      fail(409, "PAYMENT_AMBIGUOUS", "Captured payment evidence is missing");
    if (intent.fundingMethod !== "gateway")
      return await verifyAndPostRefund(
        intentId,
        { currency: "INR", amount: intent.amountPaise, status: "processed" },
        workerId,
      );
    requireRazorpay(config);
    if (
      payment.providerId !== RAZORPAY_PROVIDER ||
      !/^pay_[a-z\d]+$/i.test(payment.externalId)
    )
      fail(
        409,
        "REFUND_PROVIDER_UNSUPPORTED",
        "Only the original Razorpay test payment is supported",
      );
    let externalId = intent.externalRefundId;
    if (!externalId && intent.status !== "Ready") {
      let exhausted = false;
      for (let skip = 0; skip < 1000; skip += 100) {
        const page = await razorpayRequest(
          config,
          `/payments/${encodeURIComponent(payment.externalId)}/refunds?count=100&skip=${skip}`,
        );
        if (!Array.isArray(page.items))
          fail(
            503,
            "REFUND_LOOKUP_INVALID",
            "Cannot safely reconcile the previous refund request",
          );
        const matches = page.items.filter(
          (r: any) =>
            r.receipt === intent.requestBody.receipt ||
            r.notes?.crs_refund_intent === String(intent._id),
        );
        if (matches.length > 1)
          fail(
            409,
            "DUPLICATE_GATEWAY_REFUND",
            "Multiple gateway refunds match; manual review required",
          );
        if (matches.length) {
          externalId = matches[0].id;
          break;
        }
        if (page.items.length < 100) {
          exhausted = true;
          break;
        }
      }
      if (!externalId && !exhausted)
        fail(
          409,
          "REFUND_LOOKUP_TRUNCATED",
          "Gateway history is too large to safely retry",
        );
    }
    if (!externalId) {
      const captured = await razorpayRequest(
        config,
        `/payments/${encodeURIComponent(payment.externalId)}`,
      );
      if (
        captured.id !== payment.externalId ||
        captured.currency !== "INR" ||
        captured.status !== "captured" ||
        captured.amount !== payment.amountPaise ||
        paise(captured.amount) - paise(captured.amount_refunded ?? 0) <
          paise(intent.amountPaise)
      )
        fail(
          409,
          "REFUND_CAPTURE_INVALID",
          "Gateway captured/refundable balance does not match the intent",
        );
      const renewedLease = await M.RefundIntent.updateOne(
        {
          _id: intentId,
          leaseOwner: workerId,
          status: "Submitting",
          leaseUntil: { $gt: new Date() },
        },
        { $set: { leaseUntil: new Date(Date.now() + 60000) } },
      );
      if (renewedLease.matchedCount !== 1) return { leaseLost: true };
      const created = await razorpayRequest(
        config,
        `/payments/${encodeURIComponent(payment.externalId)}/refund`,
        intent.requestBody,
        { "X-Refund-Idempotency": intent.idempotencyKey },
      );
      externalId = created.id;
      if (!/^rfnd_[a-z\d]+$/i.test(externalId || ""))
        fail(
          503,
          "REFUND_CREATE_UNCERTAIN",
          "Refund result is uncertain; reconcile the original request",
        );
    }
    const saved = await M.RefundIntent.updateOne(
      { _id: intentId, leaseOwner: workerId, status: "Submitting" },
      { $set: { externalRefundId: externalId } },
    );
    if (saved.matchedCount !== 1) return { leaseLost: true };
    intent.externalRefundId = externalId;
    const evidence = await gatewayEvidence(config, intent, payment, externalId);
    if (evidence.status === "processed")
      return await verifyAndPostRefund(intentId, evidence, workerId);
    await M.RefundIntent.updateOne(
      { _id: intentId, leaseOwner: workerId, status: { $ne: "Processed" } },
      {
        $set: {
          status: evidence.status === "failed" ? "Failed" : "Pending",
          leaseUntil: new Date(0),
          nextAttemptAt: new Date(Date.now() + 60000),
        },
      },
    );
    if (intent.refundId)
      await M.Refund.updateOne(
        { _id: intent.refundId, status: { $ne: "Refunded" } },
        {
          $set: {
            status:
              evidence.status === "failed" ? "Failed" : "Provider pending",
            externalId,
          },
        },
      );
    await M.RefundAttempt.create([
      {
        operatorId: intent.operatorId,
        intentId,
        workerId,
        action: "Reconcile",
        outcome: evidence.status,
        providerRefundId: externalId,
      },
    ]);
    if (evidence.status === "failed")
      await recordFinanceException({
        operatorId: String(intent.operatorId),
        bookingId: String(intent.bookingId),
        paymentId: String(intent.paymentId),
        intentId,
        kind: "Refund failed",
        resourceKey: intentId,
        code: "PROVIDER_REFUND_FAILED",
      });
    return { status: evidence.status };
  } catch (error) {
    const uncertain = (error as any).status >= 500 || !(error as any).code;
    await M.RefundIntent.updateOne(
      { _id: intentId, leaseOwner: workerId, status: { $ne: "Processed" } },
      {
        $set: {
          status: uncertain ? "Uncertain" : "Manual review",
          leaseUntil: new Date(0),
          nextAttemptAt: new Date(Date.now() + 60000),
        },
      },
    );
    await M.RefundAttempt.create([
      {
        operatorId: intent.operatorId,
        intentId,
        workerId,
        action: "Reconcile",
        outcome: uncertain ? "uncertain" : "manual",
        code: (error as any).code || "TRANSPORT_UNCERTAIN",
      },
    ]);
    await recordFinanceException({
      operatorId: String(intent.operatorId),
      bookingId: String(intent.bookingId),
      paymentId: String(intent.paymentId),
      intentId,
      kind: "Refund review",
      resourceKey: intentId,
      code: (error as any).code || "TRANSPORT_UNCERTAIN",
    });
    return {
      status: uncertain ? "Uncertain" : "Manual review",
      code: (error as any).code || "TRANSPORT_UNCERTAIN",
    };
  }
}
export async function reconcileRefundWebhook(config: Config, entity: any) {
  if (
    !/^rfnd_[a-z\d]+$/i.test(entity?.id || "") ||
    !/^pay_[a-z\d]+$/i.test(entity?.payment_id || "")
  )
    fail(400, "INVALID_WEBHOOK", "Refund identifiers are missing");
  let intent: any = await M.RefundIntent.findOne({
    externalRefundId: entity.id,
  }).lean();
  if (!intent && /^[a-f\d]{24}$/i.test(entity?.notes?.crs_refund_intent || ""))
    intent = await M.RefundIntent.findById(
      entity.notes.crs_refund_intent,
    ).lean();
  if (!intent) return { ignored: true };
  const payment: any = await M.Payment.findOne({
    _id: intent.paymentId,
    operatorId: intent.operatorId,
  }).lean();
  if (
    !payment ||
    payment.providerId !== RAZORPAY_PROVIDER ||
    payment.externalId !== entity.payment_id
  )
    fail(409, "REFUND_EVIDENCE_INVALID", "Refund payment does not match");
  const evidence = await gatewayEvidence(config, intent, payment, entity.id);
  if (intent.externalRefundId && intent.externalRefundId !== evidence.id)
    fail(409, "REFUND_EVIDENCE_INVALID", "Refund identity changed");
  await M.RefundIntent.updateOne(
    {
      _id: intent._id,
      $or: [
        { externalRefundId: { $exists: false } },
        { externalRefundId: evidence.id },
      ],
    },
    { $set: { externalRefundId: evidence.id } },
  );
  if (evidence.status === "processed")
    return verifyAndPostRefund(
      String(intent._id),
      evidence,
      "authenticated-webhook",
    );
  await M.RefundIntent.updateOne(
    { _id: intent._id, status: { $ne: "Processed" } },
    {
      $set: {
        status: evidence.status === "failed" ? "Failed" : "Pending",
        nextAttemptAt: new Date(Date.now() + 60000),
      },
    },
  );
  if (intent.refundId)
    await M.Refund.updateOne(
      { _id: intent.refundId, status: { $ne: "Refunded" } },
      {
        $set: {
          status: evidence.status === "failed" ? "Failed" : "Provider pending",
          externalId: evidence.id,
        },
      },
    );
  return { status: evidence.status, completed: false };
}
export async function reconcileRefundIntents(config: Config) {
  if (!config.FINANCE_TEST_MODE || config.NODE_ENV === "production")
    return { disabled: true };
  await refundIndexesReady();
  const overdue = await M.RefundIntent.find({
    status: { $in: ["Ready", "Submitting", "Pending", "Uncertain"] },
    attempts: { $gte: 5 },
    leaseUntil: { $lte: new Date() },
  })
    .limit(100)
    .lean();
  for (const intent of overdue) {
    await M.RefundIntent.updateOne(
      { _id: intent._id, status: { $ne: "Processed" } },
      { $set: { status: "Manual review" } },
    );
    await recordFinanceException({
      operatorId: String(intent.operatorId),
      bookingId: String(intent.bookingId),
      paymentId: String(intent.paymentId),
      intentId: String(intent._id),
      kind: "Refund retries exhausted",
      resourceKey: String(intent._id),
      code: "RETRY_LIMIT",
    });
  }
  const due = await M.RefundIntent.find({
    status: { $in: ["Ready", "Submitting", "Pending", "Uncertain"] },
    attempts: { $lt: 5 },
    $and: [
      {
        $or: [
          { nextAttemptAt: { $exists: false } },
          { nextAttemptAt: { $lte: new Date() } },
        ],
      },
      {
        $or: [
          { leaseUntil: { $exists: false } },
          { leaseUntil: { $lte: new Date() } },
        ],
      },
    ],
  })
    .limit(50)
    .lean();
  for (const intent of due)
    await processRefundIntent(config, String(intent._id));
  return { checked: due.length, exhausted: overdue.length };
}
export async function refundStatus(auth: Principal, bookingId: string) {
  const booking = await bookingFor(auth, bookingId, undefined, false);
  const operatorId = String(booking.operatorId);
  const refund: any = await M.Refund.findOne({ operatorId, bookingId }).lean();
  const intents = await M.RefundIntent.find({
    operatorId,
    bookingId,
    ...(auth.agentId ? { purpose: "Cancellation" } : {}),
  })
    .select("status amountPaise currency fundingMethod processedAt createdAt")
    .lean();
  return {
    bookingId,
    bookingStatus: booking.status,
    paymentStatus: booking.paymentStatus,
    refund: refund
      ? {
          id: refund._id,
          status: refund.status,
          amountPaise: refund.amountPaise,
          completed: refund.status === "Refunded",
        }
      : null,
    intents,
    partialSupported: false,
  };
}
