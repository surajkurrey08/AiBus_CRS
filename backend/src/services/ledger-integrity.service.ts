import mongoose, { type ClientSession } from "mongoose";
import * as M from "../models/index.js";
import {
  paise,
  journalPayloadHash,
  type JournalInput,
} from "./ledger.service.js";
import { fail } from "../utils/errors.js";

// Read-only snapshot. Never repairs balances or creates historical journals.
export async function verifyLedger(
  operatorId: string,
  existingSession?: ClientSession,
) {
  if (!mongoose.isValidObjectId(operatorId))
    fail(400, "INVALID_ID", "Invalid operator");
  const inspect = async (session: ClientSession) => {
    const accounts = await M.LedgerAccount.find({ operatorId })
      .session(session)
      .lean();
    const journals = await M.JournalEntry.find({ operatorId })
      .session(session)
      .lean();
    const operations = await M.FinancialOperation.find({ operatorId })
      .session(session)
      .lean();
    const projections = await M.AccountBalanceProjection.find({ operatorId })
      .session(session)
      .lean();
    const issues: { code: string; id: string }[] = [];
    const issue = (code: string, id: unknown) =>
      issues.push({ code, id: String(id) });
    const accountMap = new Map(accounts.map((a) => [String(a._id), a]));
    const journalMap = new Map(journals.map((j) => [String(j._id), j]));
    const totals = new Map<
      string,
      { debit: bigint; credit: bigint; count: number }
    >();
    for (const journal of journals) {
      let debit = 0n,
        credit = 0n;
      const ids = new Set<string>();
      for (const line of journal.lines as any[]) {
        const key = String(line.accountId),
          account = accountMap.get(key);
        if (!account || account.currency !== journal.currency || ids.has(key))
          issue("ACCOUNT_REFERENCE", journal._id);
        ids.add(key);
        try {
          const d = paise(line.debitPaise),
            c = paise(line.creditPaise);
          if ((d === 0n) === (c === 0n)) issue("LINE_SIDES", journal._id);
          debit += d;
          credit += c;
          const value = totals.get(key) || { debit: 0n, credit: 0n, count: 0 };
          value.debit += d;
          value.credit += c;
          value.count++;
          totals.set(key, value);
        } catch {
          issue("INVALID_MONEY", journal._id);
        }
      }
      if (
        !debit ||
        debit !== credit ||
        debit > BigInt(Number.MAX_SAFE_INTEGER) ||
        Number(debit) !== journal.totalPaise ||
        journal.currency !== "INR"
      )
        issue("UNBALANCED", journal._id);
      const op = operations.find(
        (o) => String(o._id) === String(journal.operationId),
      );
      if (!op || String(op.journalId) !== String(journal._id))
        issue("OPERATION_REFERENCE", journal._id);
      if (op) {
        try {
          const hash = journalPayloadHash({
            operatorId,
            idempotencyKey: String(op.idempotencyKey),
            currency: String(journal.currency),
            kind: journal.kind as JournalInput["kind"],
            reason: String(journal.reason),
            ...(journal.bookingId
              ? { bookingId: String(journal.bookingId) }
              : {}),
            ...(journal.paymentId
              ? { paymentId: String(journal.paymentId) }
              : {}),
            ...(journal.sourceEventId
              ? { sourceEventId: String(journal.sourceEventId) }
              : {}),
            ...(journal.reversalOf
              ? { reversalOf: String(journal.reversalOf) }
              : {}),
            lines: (journal.lines as any[]).map((line) => {
              const account = accountMap.get(String(line.accountId));
              return {
                account: {
                  ownerType: account!.ownerType,
                  ownerId: account!.ownerId,
                  code: account!.code,
                },
                debitPaise: line.debitPaise,
                creditPaise: line.creditPaise,
              };
            }) as JournalInput["lines"],
          });
          if (hash !== op.payloadHash) issue("PAYLOAD_HASH", journal._id);
        } catch {
          issue("PAYLOAD_HASH", journal._id);
        }
      }
      if (journal.kind === "Reversal") {
        const original = journalMap.get(String(journal.reversalOf));
        const signature = (lines: any[], reverse = false) =>
          lines
            .map(
              (l) =>
                `${l.accountId}:${reverse ? l.creditPaise : l.debitPaise}:${reverse ? l.debitPaise : l.creditPaise}`,
            )
            .sort()
            .join("|");
        if (
          !original ||
          original.kind === "Reversal" ||
          String(original.bookingId || "") !==
            String(journal.bookingId || "") ||
          String(original.paymentId || "") !==
            String(journal.paymentId || "") ||
          signature(original.lines as any[], true) !==
            signature(journal.lines as any[])
        )
          issue("REVERSAL_REFERENCE", journal._id);
      }
    }
    for (const operation of operations)
      if (
        String(journalMap.get(String(operation.journalId))?.operationId) !==
        String(operation._id)
      )
        issue("ORPHAN_OPERATION", operation._id);
    for (const account of accounts) {
      const expected = totals.get(String(account._id));
      const projection = projections.find(
        (p) => String(p.accountId) === String(account._id),
      );
      if (!expected || !projection) {
        issue("MISSING_PROJECTION_OR_LINES", account._id);
        continue;
      }
      try {
        if (
          paise(projection.debitPaise) !== expected.debit ||
          paise(projection.creditPaise) !== expected.credit ||
          projection.version !== expected.count ||
          projection.currency !== account.currency
        )
          issue("PROJECTION_MISMATCH", account._id);
      } catch {
        issue("INVALID_PROJECTION", account._id);
      }
    }
    for (const projection of projections)
      if (!accountMap.has(String(projection.accountId)))
        issue("ORPHAN_PROJECTION", projection._id);
    return {
      consistent: issues.length === 0,
      accounts: accounts.length,
      journals: journals.length,
      operations: operations.length,
      issues,
    };
  };
  if (existingSession) return inspect(existingSession);
  let report: any;
  await mongoose.connection.transaction(
    async (session) => {
      report = await inspect(session);
    },
    { readConcern: { level: "snapshot" } },
  );
  return report;
}

export async function assessHistoricalFinance(
  operatorId: string,
  limit = 1000,
) {
  if (
    !mongoose.isValidObjectId(operatorId) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 10000
  )
    fail(
      400,
      "ASSESSMENT_INPUT",
      "Explicit operator and bounded limit required",
    );
  let result: any;
  await mongoose.connection.transaction(
    async (session) => {
      const payments = await M.Payment.find({ operatorId })
        .sort({ _id: 1 })
        .limit(limit + 1)
        .session(session)
        .lean();
      const rows = [];
      for (const payment of payments.slice(0, limit)) {
        const booking = await M.Booking.findOne({
          _id: payment.bookingId,
          operatorId,
        })
          .session(session)
          .lean();
        const journal = await M.JournalEntry.exists({
          operatorId,
          paymentId: payment._id,
          kind: { $ne: "Reversal" },
        }).session(session);
        const captures = await M.Payment.countDocuments({
          operatorId,
          bookingId: payment.bookingId,
          status: "captured",
        }).session(session);
        const cancellation = await M.Cancellation.exists({
          operatorId,
          bookingId: payment.bookingId,
        }).session(session);
        const refund = await M.Refund.exists({
          operatorId,
          bookingId: payment.bookingId,
        }).session(session);
        let classification = "Not collected";
        if (journal) classification = "Already journaled; do not backfill";
        else if (payment.status === "captured") {
          let valid = false;
          try {
            valid =
              payment.currency === "INR" &&
              paise(payment.amountPaise) > 0n &&
              payment.amountPaise === booking?.totalPaise;
          } catch {
            /* Report instead of guessing. */
          }
          classification =
            valid &&
            captures === 1 &&
            booking?.status === "Confirmed" &&
            booking.paymentStatus === "Paid" &&
            !cancellation &&
            !refund
              ? "Candidate only; commission ownership and settlement evidence need review"
              : "Ambiguous; manual reconciliation required";
        } else if (payment.status === "refunded" || refund || cancellation)
          classification = "Adjustment evidence requires review";
        rows.push({
          paymentId: String(payment._id),
          bookingId: String(payment.bookingId),
          classification,
          requiresAdjustmentReview:
            !!refund || !!cancellation || payment.status === "refunded",
          paymentStatus: payment.status,
          bookingStatus: booking?.status || "Missing",
          captureCount: captures,
        });
      }
      result = {
        operatorId,
        readOnly: true,
        historicalWritesEnabled: false,
        settlementInferred: false,
        truncated: payments.length > limit,
        rows,
        integrity: await verifyLedger(operatorId, session),
      };
    },
    { readConcern: { level: "snapshot" } },
  );
  return result;
}
