import mongoose, { type ClientSession } from "mongoose";
import { createHash, randomUUID } from "node:crypto";
import * as M from "../models/index.js";
import { fail, type Principal } from "../utils/core.js";
import type { Config } from "../config/env.js";
import { authorizeAgent } from "./agent.service.js";
import {
  financeTransaction,
  financeAudit,
  testFinance,
} from "./agency-finance.service.js";
import {
  paise,
  safeMoney,
  postJournalInTransaction,
  type JournalInput,
} from "./ledger.service.js";
import { verifyLedger } from "./ledger-integrity.service.js";
import { createdDuring } from "../validators/agent-dashboard.schemas.js";
import { testPayout } from "../integrations/test-payout.js";

export async function settlementReadScope(
  auth: Principal,
  operatorId?: string,
  agentId?: string,
): Promise<Record<string, any>> {
  if (auth.agentId || auth.role === "agent") {
    await authorizeAgent(auth, "settlements");
    if (
      (operatorId && operatorId !== auth.operatorId) ||
      (agentId && agentId !== auth.agentId)
    )
      fail(404, "NOT_FOUND", "Financial scope not found");
    return { operatorId: auth.operatorId, agentId: auth.agentId };
  }
  if (auth.role === "super_admin") {
    if (!auth.permissions.includes("platform:finance:read"))
      fail(403, "FORBIDDEN", "Explicit financial reporting access required");
  } else if (!auth.operatorId || !auth.permissions.includes("finance:read"))
    fail(403, "FORBIDDEN", "Operator financial reporting access required");
  if (
    auth.role !== "super_admin" &&
    operatorId &&
    operatorId !== auth.operatorId
  )
    fail(404, "NOT_FOUND", "Operator not found");
  const owner = auth.role === "super_admin" ? operatorId : auth.operatorId!;
  if (
    owner &&
    (!mongoose.isValidObjectId(owner) ||
      !(await M.Operator.exists({ _id: owner })))
  )
    fail(404, "NOT_FOUND", "Operator not found");
  if (
    agentId &&
    !(await M.SalesPartner.exists({
      _id: agentId,
      ...(owner ? { operatorId: owner } : {}),
      kind: "Agent",
    }))
  )
    fail(404, "NOT_FOUND", "Agency not found");
  return {
    ...(owner ? { operatorId: owner } : {}),
    ...(agentId ? { agentId } : {}),
  };
}
function privileged(
  auth: Principal,
  permission:
    "settlements:prepare" | "settlements:approve" | "payouts:authorize",
) {
  if (
    auth.agentId ||
    auth.role !== "super_admin" ||
    !auth.permissions.includes("platform:finance:read") ||
    !auth.permissions.includes(permission)
  )
    fail(403, "FORBIDDEN", "Explicit platform financial action grant required");
}
export async function settlementIndexesReady() {
  for (const model of [
    M.Settlement,
    M.SettlementPolicy,
    M.SettlementLine,
    M.SettlementApproval,
    M.PayoutIntent,
    M.TestSettlementReceipt,
    M.TestPayoutRecord,
  ]) {
    let indexes: any[];
    try {
      indexes = await model.collection.listIndexes().toArray();
    } catch {
      fail(
        503,
        "SETTLEMENT_NOT_READY",
        "Review additive settlement indexes first",
      );
    }
    for (const [keys, options] of model.schema.indexes())
      if (
        options.unique &&
        !indexes!.some(
          (i) =>
            i.unique &&
            JSON.stringify(i.key) === JSON.stringify(keys) &&
            JSON.stringify(i.partialFilterExpression) ===
              JSON.stringify(options.partialFilterExpression) &&
            !!i.sparse === !!options.sparse,
        )
      )
        fail(
          503,
          "SETTLEMENT_NOT_READY",
          "Settlement uniqueness is not provisioned",
        );
  }
}
async function transact<T>(fn: (session: ClientSession) => Promise<T>) {
  await settlementIndexesReady();
  return financeTransaction(fn);
}
async function batch(
  auth: Principal,
  id: string,
  session?: ClientSession,
): Promise<any> {
  const scope = await settlementReadScope(auth);
  const row = await M.Settlement.findOne({
    _id: id,
    ...scope,
    workflowVersion: 1,
  }).session(session || null);
  if (!row) fail(404, "NOT_FOUND", "Settlement batch not found");
  return row!;
}
async function policy(operatorId: string, session: ClientSession) {
  const row = await M.SettlementPolicy.findOneAndUpdate(
    {
      operatorId,
      enabled: true,
      treatment: "Existing capture liabilities",
      funding: "Simulated gateway receipts",
    },
    { $inc: { __v: 1 } },
    { session, new: true },
  );
  if (!row)
    fail(
      409,
      "SETTLEMENT_POLICY_REQUIRED",
      "Explicit test custody and capture-liability policy is required; live payouts remain disabled",
    );
  return row!;
}
export async function configureSettlementPolicy(
  config: Config,
  auth: Principal,
  operatorId: string,
  input: {
    enabled: boolean;
    treatment: string;
    funding: string;
    version: number;
    reason: string;
  },
) {
  privileged(auth, "settlements:prepare");
  testFinance(config);
  await settlementReadScope(auth, operatorId);
  if (
    input.enabled &&
    (input.treatment !== "Existing capture liabilities" ||
      input.funding !== "Simulated gateway receipts")
  )
    fail(
      400,
      "POLICY_REQUIRED",
      "Explicit existing liability split and simulated receipt treatment required",
    );
  return transact(async (session) => {
    let row = await M.SettlementPolicy.findOne({ operatorId }).session(session);
    if ((row?.version || 0) !== input.version)
      fail(409, "POLICY_CONFLICT", "Refresh the current settlement policy");
    if (!row) row = new M.SettlementPolicy({ operatorId });
    row.enabled = input.enabled;
    row.treatment = input.treatment;
    row.funding = input.funding;
    row.version = input.version + 1;
    row.updatedBy = auth.userId;
    await row.save({ session });
    await financeAudit(
      { ...auth, operatorId },
      "settlement.policy",
      operatorId,
      session,
      { ...input },
    );
    return row;
  });
}
export type PrepareSettlement = {
  operatorId: string;
  agentId?: string;
  kind: "Operator" | "Agency";
  from: string;
  to: string;
  reason: string;
};
export async function prepareSettlement(
  config: Config,
  auth: Principal,
  input: PrepareSettlement,
  key: string,
) {
  privileged(auth, "settlements:prepare");
  testFinance(config);
  await settlementReadScope(auth, input.operatorId, input.agentId);
  if ((input.kind === "Agency") !== !!input.agentId)
    fail(
      400,
      "AGENCY_REQUIRED",
      "Agency settlements require one owned agency; operator settlements cannot select an agency",
    );
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return transact(async (session) => {
    const prior: any = await M.Settlement.findOne({
      operatorId: input.operatorId,
      idempotencyKey: key,
    }).session(session);
    if (prior) {
      if (prior.requestHash !== hash)
        fail(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Settlement key belongs to different content",
        );
      return prior;
    }
    const p = await policy(input.operatorId, session),
      sid = new mongoose.Types.ObjectId();
    const accounts = await M.LedgerAccount.find({
      operatorId: input.operatorId,
      code:
        input.kind === "Operator"
          ? { $in: ["operator-payable", "operator-cancellation-payable"] }
          : "agent-commission-payable",
      ...(input.agentId ? { ownerId: input.agentId } : {}),
    })
      .session(session)
      .lean();
    const ids = accounts.map((a) => a._id),
      journals: any[] = await M.JournalEntry.find({
        operatorId: input.operatorId,
        "lines.accountId": { $in: ids },
        kind: { $in: ["Booking captured", "Cancellation adjustment"] },
        ...createdDuring(input),
      })
        .sort({ _id: 1 })
        .limit(501)
        .session(session)
        .lean();
    if (journals.length > 500)
      fail(413, "SETTLEMENT_TOO_LARGE", "Choose a shorter settlement period");
    const accountMap = new Map(accounts.map((a) => [String(a._id), a]));
    let total = 0n;
    const lines: any[] = [];
    for (const journal of journals) {
      if (
        await M.JournalEntry.exists({ reversalOf: journal._id }).session(
          session,
        )
      )
        continue;
      const payment: any = await M.Payment.findOne({
        _id: journal.paymentId,
        operatorId: input.operatorId,
        bookingId: journal.bookingId,
        providerId: "razorpay_test",
        status: { $in: ["captured", "refunded"] },
      })
        .session(session)
        .lean();
      if (!payment) continue; // Wallet/credit exposure is never gateway cash.
      const booking: any = await M.Booking.findOne({
        _id: journal.bookingId,
        operatorId: input.operatorId,
      })
        .session(session)
        .lean();
      if (
        !booking ||
        !(await M.Trip.exists({
          _id: booking.tripId,
          operatorId: input.operatorId,
          departureAt: { $lt: new Date() },
          arrivalAt: { $lt: new Date() },
        }).session(session))
      )
        continue;
      const cancelled = booking.status === "Cancelled";
      if (
        (!cancelled &&
          (booking.status !== "Confirmed" ||
            booking.paymentStatus !== "Paid" ||
            journal.kind !== "Booking captured")) ||
        (cancelled &&
          (input.kind === "Agency" ||
            journal.kind !== "Cancellation adjustment"))
      )
        continue;
      if (
        (await M.Cancellation.exists({
          bookingId: booking._id,
          operatorId: input.operatorId,
          status: "Requested",
        }).session(session)) ||
        (await M.FinanceException.exists({
          paymentId: payment._id,
          operatorId: input.operatorId,
          status: { $ne: "Resolved" },
        }).session(session))
      )
        continue;
      if (cancelled) {
        const cancellation: any = await M.Cancellation.findOne({
          bookingId: booking._id,
          operatorId: input.operatorId,
          status: "Approved",
          accountingJournalId: journal._id,
        })
          .session(session)
          .lean();
        if (!cancellation) continue;
        const refund: any = await M.Refund.findOne({
          bookingId: booking._id,
          operatorId: input.operatorId,
          status: { $in: ["Refunded", "Not due"] },
        })
          .session(session)
          .lean();
        if (!refund) continue;
        const quote: any = await M.CancellationQuote.findOne({
          _id: cancellation.acceptedQuoteId,
          operatorId: input.operatorId,
          bookingId: booking._id,
        })
          .session(session)
          .lean();
        if (!quote || (refund.status === "Not due" && quote.refundPaise !== 0))
          fail(
            409,
            "REFUND_NOT_VERIFIED",
            "Retained cancellation requires original quote evidence",
          );
        if (refund.status === "Refunded") {
          const intent: any = await M.RefundIntent.findOne({
            _id: refund.workflowIntentId,
            paymentId: payment._id,
            bookingId: booking._id,
            operatorId: input.operatorId,
            status: "Processed",
            amountPaise: refund.amountPaise,
          })
            .session(session)
            .lean();
          if (
            !intent?.journalId ||
            payment.refundedPaise < refund.amountPaise ||
            !(await M.JournalEntry.exists({
              _id: intent.journalId,
              operatorId: input.operatorId,
              kind: "Refund",
            }).session(session))
          )
            fail(
              409,
              "REFUND_NOT_VERIFIED",
              "Refund status alone is insufficient; verified intent and journal are required",
            );
        }
      } else if (
        (payment.refundedPaise || 0) !== 0 ||
        payment.amountPaise !== booking.totalPaise
      )
        continue;
      await M.Booking.updateOne(
        { _id: booking._id, __v: booking.__v, status: booking.status },
        { $inc: { __v: 1 } },
        { session },
      );
      for (const line of journal.lines)
        if (line.creditPaise && accountMap.has(String(line.accountId))) {
          if (
            await M.SettlementLine.exists({
              journalId: journal._id,
              accountId: line.accountId,
            }).session(session)
          )
            continue;
          total += paise(line.creditPaise);
          lines.push({
            operatorId: input.operatorId,
            settlementId: sid,
            journalId: journal._id,
            accountId: line.accountId,
            bookingId: booking._id,
            paymentId: payment._id,
            ...(input.agentId ? { agentId: input.agentId } : {}),
            amountPaise: line.creditPaise,
            kind: cancelled ? "Retained cancellation" : "Ticket payable",
          });
        }
    }
    if (!lines.length || !total)
      fail(
        409,
        "NO_ELIGIBLE_PAYABLES",
        "No unclaimed mature gateway-funded payable lines; unresolved, historical, wallet/credit and unpaid obligations require separate policy/review",
      );
    let gross = 0n,
      commission = 0n,
      refunded = 0n;
    for (const paymentId of new Set(lines.map((l) => String(l.paymentId)))) {
      const original: any = await M.JournalEntry.findOne({
        operatorId: input.operatorId,
        paymentId,
        kind: "Booking captured",
      })
        .session(session)
        .lean();
      const paid: any = await M.Payment.findOne({
        _id: paymentId,
        operatorId: input.operatorId,
      })
        .session(session)
        .lean();
      const booking: any =
        paid &&
        (await M.Booking.findOne({
          _id: paid.bookingId,
          operatorId: input.operatorId,
        })
          .session(session)
          .lean());
      if (
        !original ||
        !paid ||
        original.totalPaise !== paid.amountPaise ||
        !booking
      )
        fail(
          409,
          "SETTLEMENT_SOURCE_MISMATCH",
          "Original capture evidence is inconsistent",
        );
      gross += paise(original.totalPaise);
      refunded += paise(paid.refundedPaise || 0);
      if (booking.status === "Confirmed" && booking.paymentStatus === "Paid") {
        const commissionAccounts = await M.LedgerAccount.find({
          operatorId: input.operatorId,
          code: "agent-commission-payable",
        })
          .select("_id")
          .session(session)
          .lean();
        const own = new Set(commissionAccounts.map((a) => String(a._id)));
        for (const line of original.lines)
          if (own.has(String(line.accountId)))
            commission += paise(line.creditPaise);
      }
    }
    const amount = safeMoney(total);
    const [row] = await M.Settlement.create(
      [
        {
          _id: sid,
          operatorId: input.operatorId,
          externalId: `TEST-${sid}`,
          workflowVersion: 1,
          mode: "Test",
          kind: input.kind,
          agentId: input.agentId,
          periodFrom: input.from,
          periodTo: input.to,
          workflowStatus: "Calculated",
          preparedBy: auth.userId,
          policyVersion: p.version,
          requestHash: hash,
          idempotencyKey: key,
          netPaise: amount,
          grossPaise: safeMoney(gross),
          commissionPaise: safeMoney(commission),
          refundPaise: safeMoney(refunded),
        },
      ],
      { session },
    );
    await M.SettlementLine.create(lines, { session, ordered: true });
    await M.SettlementApproval.create(
      [
        {
          operatorId: input.operatorId,
          settlementId: sid,
          actorId: auth.userId,
          action: "Prepared",
          reason: input.reason,
        },
      ],
      { session },
    );
    await financeAudit(
      { ...auth, operatorId: input.operatorId },
      "settlement.prepared",
      String(sid),
      session,
      { reason: input.reason, amountPaise: amount },
    );
    return row;
  });
}
export async function reviewSettlement(
  config: Config,
  auth: Principal,
  id: string,
  action: "Submit" | "Approve",
  reason: string,
) {
  privileged(
    auth,
    action === "Submit" ? "settlements:prepare" : "settlements:approve",
  );
  testFinance(config);
  return transact(async (session) => {
    const row = await batch(auth, id, session),
      wanted = action === "Submit" ? "Under review" : "Approved";
    if (action === "Approve" && String(row.preparedBy) === auth.userId)
      fail(
        403,
        "MAKER_CHECKER",
        "The preparer cannot approve their own settlement",
      );
    if (row.workflowStatus === wanted) return row;
    if (
      row.workflowStatus !==
      (action === "Submit" ? "Calculated" : "Under review")
    )
      fail(409, "SETTLEMENT_STATE", "Invalid settlement transition");
    const p = await policy(String(row.operatorId), session);
    if (row.policyVersion !== p.version)
      fail(409, "POLICY_CONFLICT", "Policy changed; financial review required");
    row.workflowStatus = wanted;
    if (action === "Approve") row.approvedBy = auth.userId;
    await row.save({ session });
    await M.SettlementApproval.create(
      [
        {
          operatorId: row.operatorId,
          settlementId: id,
          actorId: auth.userId,
          action: action === "Submit" ? "Submitted" : "Approved",
          reason,
        },
      ],
      { session },
    );
    await financeAudit(
      { ...auth, operatorId: String(row.operatorId) },
      `settlement.${action.toLowerCase()}`,
      id,
      session,
      { reason },
    );
    return row;
  });
}
export async function recordTestSettlementReceipts(
  config: Config,
  auth: Principal,
  id: string,
  reason: string,
) {
  privileged(auth, "payouts:authorize");
  testFinance(config);
  return transact(async (session) => {
    const row = await batch(auth, id, session);
    await policy(String(row.operatorId), session);
    if (
      !["Approved", "Payment processing", "Paid"].includes(row.workflowStatus)
    )
      fail(409, "SETTLEMENT_STATE", "Approved settlement required");
    if (String(row.preparedBy) === auth.userId)
      fail(403, "MAKER_CHECKER", "Preparer cannot authorize receipt or payout");
    const lines = await M.SettlementLine.find({
      settlementId: id,
      operatorId: row.operatorId,
    })
      .session(session)
      .lean();
    const receipts = [];
    for (const paymentId of new Set(lines.map((l) => String(l.paymentId)))) {
      const old = await M.TestSettlementReceipt.findOne({ paymentId })
        .session(session)
        .lean();
      if (old) {
        receipts.push(old);
        continue;
      }
      const payment: any = await M.Payment.findOne({
        _id: paymentId,
        operatorId: row.operatorId,
        providerId: "razorpay_test",
        status: { $in: ["captured", "refunded"] },
      })
        .session(session)
        .lean();
      if (!payment)
        fail(
          409,
          "RECEIPT_INVALID",
          "Original captured gateway payment required",
        );
      const amount = safeMoney(
        paise(payment.amountPaise) - paise(payment.refundedPaise || 0),
      );
      if (!amount) fail(409, "RECEIPT_INVALID", "No remaining gateway funds");
      const journal = await postJournalInTransaction(
        {
          operatorId: String(row.operatorId),
          idempotencyKey: `test-receipt:${paymentId}`,
          currency: "INR",
          kind: "Settlement receipt",
          paymentId,
          actorId: auth.userId,
          reason: "ISOLATED SIMULATOR receipt; not bank evidence",
          lines: [
            {
              account: {
                ownerType: "Platform",
                ownerId: "aibus",
                code: "simulated-bank-clearing",
              },
              debitPaise: amount,
              creditPaise: 0,
            },
            {
              account: {
                ownerType: "Platform",
                ownerId: "aibus",
                code: "payment-clearing",
              },
              debitPaise: 0,
              creditPaise: amount,
            },
          ],
        },
        session,
      );
      const [receipt] = await M.TestSettlementReceipt.create(
        [
          {
            operatorId: row.operatorId,
            paymentId,
            amountPaise: amount,
            journalId: journal._id,
            provider: "aibus-isolated-test",
            reference: `test_receipt_${paymentId}`,
            verifiedAt: new Date(),
          },
        ],
        { session },
      );
      receipts.push(receipt);
    }
    await financeAudit(
      { ...auth, operatorId: String(row.operatorId) },
      "settlement.simulated-receipts",
      id,
      session,
      { reason },
    );
    return { simulated: true, bankVerified: false, receipts };
  });
}
export async function authorizePayout(
  config: Config,
  auth: Principal,
  id: string,
  reason: string,
) {
  privileged(auth, "payouts:authorize");
  testFinance(config);
  return transact(async (session) => {
    const row = await batch(auth, id, session);
    await policy(String(row.operatorId), session);
    if (String(row.preparedBy) === auth.userId)
      fail(403, "MAKER_CHECKER", "Preparer cannot authorize their own payout");
    const old = await M.PayoutIntent.findOne({ settlementId: id }).session(
      session,
    );
    if (old) return old;
    if (row.workflowStatus !== "Approved")
      fail(
        409,
        "SETTLEMENT_STATE",
        "Separate approval is required before payout",
      );
    const lines = await M.SettlementLine.find({ settlementId: id })
      .session(session)
      .lean();
    for (const line of lines)
      if (
        !(await M.TestSettlementReceipt.exists({
          paymentId: line.paymentId,
          operatorId: row.operatorId,
        }).session(session))
      )
        fail(
          409,
          "VERIFIED_RECEIPT_REQUIRED",
          "Capture is not bank cash. Explicit isolated simulated receipts are required",
        );
    const [intent] = await M.PayoutIntent.create(
      [
        {
          operatorId: row.operatorId,
          settlementId: id,
          amountPaise: row.netPaise,
          currency: "INR",
          provider: "aibus-isolated-test",
          authorizedBy: auth.userId,
          idempotencyKey: `payout_${id}`,
        },
      ],
      { session },
    );
    row.workflowStatus = "Payment processing";
    row.payoutIntentId = intent._id;
    await row.save({ session });
    await M.SettlementApproval.create(
      [
        {
          operatorId: row.operatorId,
          settlementId: id,
          actorId: auth.userId,
          action: "Payout authorized",
          reason,
        },
      ],
      { session },
    );
    await financeAudit(
      { ...auth, operatorId: String(row.operatorId) },
      "settlement.payout-authorized",
      id,
      session,
      { reason },
    );
    return intent;
  });
}
export async function processPayout(
  config: Config,
  auth: Principal,
  id: string,
  reason: string,
) {
  privileged(auth, "payouts:authorize");
  testFinance(config);
  const row = await batch(auth, id);
  if (String(row.preparedBy) === auth.userId)
    fail(403, "MAKER_CHECKER", "Preparer cannot dispatch a payout");
  await settlementIndexesReady();
  const workerId = randomUUID();
  const intent: any = await transact(async (session) => {
    const live = await batch(auth, id, session),
      p = await policy(String(live.operatorId), session);
    if (p.version !== live.policyVersion)
      fail(
        409,
        "POLICY_CONFLICT",
        "Settlement policy changed; no payout was dispatched",
      );
    const claimed = await M.PayoutIntent.findOneAndUpdate(
      {
        settlementId: id,
        status: { $in: ["Ready", "Uncertain", "Processing", "Failed"] },
        attempts: { $lt: 5 },
        $or: [
          { leaseUntil: { $exists: false } },
          { leaseUntil: { $lte: new Date() } },
        ],
      },
      {
        $set: {
          status: "Processing",
          leaseOwner: workerId,
          leaseUntil: new Date(Date.now() + 60000),
        },
        $inc: { attempts: 1 },
      },
      { new: true, session },
    ).lean();
    if (!claimed) {
      const exhausted: any = await M.PayoutIntent.findOneAndUpdate(
        {
          settlementId: id,
          attempts: { $gte: 5 },
          status: { $in: ["Ready", "Uncertain", "Failed", "Processing"] },
          $or: [
            { leaseUntil: { $exists: false } },
            { leaseUntil: { $lte: new Date() } },
          ],
        },
        { $set: { status: "Manual review" } },
        { session, new: true },
      );
      if (exhausted) {
        await M.Settlement.updateOne(
          { _id: id, workflowStatus: { $ne: "Paid" } },
          { $set: { workflowStatus: "Reconciliation required" } },
          { session },
        );
        await M.PayoutAttempt.create(
          [
            {
              operatorId: live.operatorId,
              intentId: exhausted._id,
              workerId,
              outcome: "manual",
              code: "PAYOUT_RETRY_LIMIT",
            },
          ],
          { session },
        );
      }
    }
    if (claimed)
      await financeAudit(
        { ...auth, operatorId: String(live.operatorId) },
        "settlement.dispatch-requested",
        id,
        session,
        { reason, workerId },
      );
    return claimed;
  });
  if (!intent)
    return {
      status:
        (await M.PayoutIntent.findOne({ settlementId: id }).lean())?.status ||
        "Not authorized",
      dispatched: false,
    };
  try {
    // Provider evidence lookup always precedes submit, outside Mongo transactions.
    let evidence: any = await testPayout.status(config, String(intent._id));
    if (!evidence) {
      await testPayout.submit(config, intent);
      evidence = await testPayout.status(config, String(intent._id));
    }
    if (
      !evidence ||
      String(evidence.intentId) !== String(intent._id) ||
      evidence.amountPaise !== intent.amountPaise ||
      evidence.currency !== "INR"
    )
      fail(
        409,
        "PAYOUT_EVIDENCE_MISMATCH",
        "Missing, partial or mismatched evidence requires manual reconciliation; no automatic top-up",
      );
    if (evidence.status !== "processed") {
      await M.PayoutIntent.updateOne(
        { _id: intent._id, leaseOwner: workerId, status: { $ne: "Paid" } },
        {
          $set: {
            status: evidence.status === "failed" ? "Failed" : "Uncertain",
            leaseUntil: new Date(0),
          },
        },
      );
      await M.PayoutAttempt.create({
        operatorId: row.operatorId,
        intentId: intent._id,
        workerId,
        outcome: evidence.status,
        reference: evidence.reference,
      });
      return { status: evidence.status, simulated: true };
    }
    return await transact(async (session) => {
      const current: any = await M.PayoutIntent.findOne({
        _id: intent._id,
      }).session(session);
      if (current.status === "Paid") return current;
      if (current.leaseOwner !== workerId || current.status !== "Processing")
        fail(
          409,
          "PAYOUT_LEASE_LOST",
          "Another worker owns payout reconciliation",
        );
      const currentBatch = await batch(auth, id, session);
      await policy(String(row.operatorId), session);
      const lines = await M.SettlementLine.find({
        settlementId: id,
        operatorId: row.operatorId,
      })
        .session(session)
        .lean();
      if (
        safeMoney(lines.reduce((n, l) => n + paise(l.amountPaise), 0n)) !==
        intent.amountPaise
      )
        fail(
          409,
          "PAYOUT_LINES_CHANGED",
          "Payable claim does not match approved amount",
        );
      const debits = new Map<string, { account: any; amount: bigint }>();
      for (const line of lines) {
        if (
          await M.JournalEntry.exists({ reversalOf: line.journalId }).session(
            session,
          )
        )
          fail(
            409,
            "PAYABLE_REVERSED",
            "Original payable was reversed; manual review required",
          );
        const account: any = await M.LedgerAccount.findOne({
          _id: line.accountId,
          operatorId: row.operatorId,
        })
          .session(session)
          .lean();
        if (!account)
          fail(409, "PAYABLE_MISSING", "Original payable account missing");
        const old = debits.get(String(account._id));
        debits.set(String(account._id), {
          account,
          amount: (old?.amount || 0n) + paise(line.amountPaise),
        });
      }
      const journalLines: JournalInput["lines"] = [];
      for (const [accountId, debit] of debits) {
        const balance: any = await M.AccountBalanceProjection.findOne({
          accountId,
          operatorId: row.operatorId,
        })
          .session(session)
          .lean();
        if (
          !balance ||
          paise(balance.creditPaise) - paise(balance.debitPaise) < debit.amount
        )
          fail(
            409,
            "PAYABLE_SHORTFALL",
            "Payable balance changed; retain verified payout evidence for reconciliation",
          );
        journalLines.push({
          account: {
            ownerType: debit.account.ownerType,
            ownerId: debit.account.ownerId,
            code: debit.account.code,
          },
          debitPaise: safeMoney(debit.amount),
          creditPaise: 0,
        });
      }
      const bank: any = await M.LedgerAccount.findOne({
        operatorId: row.operatorId,
        code: "simulated-bank-clearing",
      })
        .session(session)
        .lean();
      const cash: any =
        bank &&
        (await M.AccountBalanceProjection.findOne({ accountId: bank._id })
          .session(session)
          .lean());
      if (
        !cash ||
        paise(cash.debitPaise) - paise(cash.creditPaise) <
          paise(intent.amountPaise)
      )
        fail(
          409,
          "RECEIPT_SHORTFALL",
          "Verified simulated receipt balance is insufficient",
        );
      journalLines.push({
        account: {
          ownerType: "Platform",
          ownerId: "aibus",
          code: "simulated-bank-clearing",
        },
        debitPaise: 0,
        creditPaise: intent.amountPaise,
      });
      const journal = await postJournalInTransaction(
        {
          operatorId: String(row.operatorId),
          idempotencyKey: `payout-post:${intent._id}`,
          currency: "INR",
          kind: "Settlement payout",
          sourceEventId: evidence.reference,
          actorId: auth.userId,
          reason: "Verified ISOLATED SIMULATOR payout; no bank transfer",
          lines: journalLines,
        },
        session,
      );
      current.status = "Paid";
      current.journalId = journal._id;
      current.externalId = evidence.reference;
      current.processedAt = new Date();
      current.leaseUntil = new Date(0);
      await current.save({ session });
      currentBatch.workflowStatus = "Paid";
      currentBatch.status = "settled";
      currentBatch.settledAt = new Date();
      await currentBatch.save({ session });
      await M.PayoutAttempt.create(
        [
          {
            operatorId: row.operatorId,
            intentId: intent._id,
            workerId,
            outcome: "processed",
            reference: evidence.reference,
          },
        ],
        { session },
      );
      await financeAudit(
        { ...auth, operatorId: String(row.operatorId) },
        "settlement.simulated-payout",
        id,
        session,
        { reason, reference: evidence.reference },
      );
      return current;
    });
  } catch (e) {
    const uncertain = !(e as any).code || (e as any).status >= 500;
    const changed = await M.PayoutIntent.updateOne(
      { _id: intent._id, leaseOwner: workerId, status: { $ne: "Paid" } },
      {
        $set: {
          status: uncertain ? "Uncertain" : "Manual review",
          leaseUntil: new Date(0),
        },
      },
    );
    if (changed.modifiedCount) {
      await M.Settlement.updateOne(
        { _id: id, workflowStatus: { $ne: "Paid" } },
        { $set: { workflowStatus: "Reconciliation required" } },
      );
      await M.PayoutAttempt.create({
        operatorId: row.operatorId,
        intentId: intent._id,
        workerId,
        outcome: uncertain ? "uncertain" : "manual",
        code: (e as any).code || "PAYOUT_TRANSPORT_UNCERTAIN",
      });
    }
    return {
      status: uncertain ? "Uncertain" : "Manual review",
      code: (e as any).code || "PAYOUT_TRANSPORT_UNCERTAIN",
      simulated: true,
    };
  }
}
export async function settlementDetail(auth: Principal, id: string) {
  const row = await batch(auth, id);
  const scope = { operatorId: row.operatorId, settlementId: row._id };
  const lines = await M.SettlementLine.find(scope).lean(),
    approvals = await M.SettlementApproval.find(scope)
      .sort({ createdAt: 1 })
      .lean(),
    payout: any = await M.PayoutIntent.findOne(scope).lean();
  return {
    settlement: row,
    lines,
    approvals,
    payout,
    attempts: payout
      ? await M.PayoutAttempt.find({
          intentId: payout._id,
          operatorId: row.operatorId,
        })
          .sort({ createdAt: -1 })
          .limit(100)
          .lean()
      : [],
    simulated: true,
    bankTransfer: false,
  };
}
export async function reconcileSettlement(
  auth: Principal,
  id: string,
  reason: string,
) {
  privileged(auth, "settlements:approve");
  return transact(async (session) => {
    const row = await batch(auth, id, session),
      integrity = await verifyLedger(String(row.operatorId), session),
      issues = integrity.issues.map((i: any) => i.code);
    const lines = await M.SettlementLine.find({
      settlementId: id,
      operatorId: row.operatorId,
    })
      .session(session)
      .lean();
    if (
      lines.reduce((n, l) => n + paise(l.amountPaise), 0n) !==
      paise(row.netPaise)
    )
      issues.push("SETTLEMENT_LINE_TOTAL");
    const payout: any = await M.PayoutIntent.findOne({ settlementId: id })
      .session(session)
      .lean();
    if (
      row.workflowStatus === "Paid" &&
      (!payout?.journalId ||
        payout.status !== "Paid" ||
        !(await M.JournalEntry.exists({
          _id: payout.journalId,
          kind: "Settlement payout",
          operatorId: row.operatorId,
        }).session(session)))
    )
      issues.push("PAYOUT_EVIDENCE_MISSING");
    if (
      payout &&
      ["Failed", "Uncertain", "Manual review"].includes(payout.status)
    )
      issues.push(`PAYOUT_${payout.status.toUpperCase().replaceAll(" ", "_")}`);
    const [record] = await M.SettlementReconciliation.create(
      [
        {
          operatorId: row.operatorId,
          settlementId: id,
          actorId: auth.userId,
          consistent: !issues.length,
          issues,
          snapshot: {
            workflowStatus: row.workflowStatus,
            lineCount: lines.length,
            payoutStatus: payout?.status || "Not authorized",
            bankVerified: false,
          },
        },
      ],
      { session },
    );
    await financeAudit(
      { ...auth, operatorId: String(row.operatorId) },
      "settlement.reconciled",
      id,
      session,
      { reason, consistent: record.consistent },
    );
    return record;
  });
}
