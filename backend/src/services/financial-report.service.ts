import mongoose from "mongoose";
import * as M from "../models/index.js";
import { fail, type Principal } from "../utils/core.js";
import { settlementReadScope } from "./settlement.service.js";
import { authorizeAgent, agencyBookingScope } from "./agent.service.js";
import { paise, safeMoney } from "./ledger.service.js";
import { createdDuring } from "../validators/agent-dashboard.schemas.js";
import { csvDocument } from "./finance-export.service.js";
import { verifyLedger } from "./ledger-integrity.service.js";
export const reportNames = [
  "daily-ticket-revenue",
  "monthly-ticket-revenue",
  "operator-revenue",
  "agency-revenue",
  "route-revenue",
  "booking-source",
  "commission-earned",
  "commission-payable",
  "operator-settlements",
  "pending-payments",
  "refund-summary",
  "wallet-balances",
  "credit-exposure",
  "payment-exceptions",
  "settlement-reconciliation",
] as const;
export type ReportQuery = {
  from: string;
  to: string;
  operatorId?: string;
  agentId?: string;
  status?: string;
  search?: string;
  page: number;
  limit: number;
};
function signed(n: bigint) {
  if (
    n > BigInt(Number.MAX_SAFE_INTEGER) ||
    n < -BigInt(Number.MAX_SAFE_INTEGER)
  )
    fail(409, "REPORT_OVERFLOW", "Financial report exceeds integer bounds");
  return Number(n);
}
export async function financialReport(
  auth: Principal,
  name: string,
  query: ReportQuery,
  exportAll = false,
) {
  if (!(reportNames as readonly string[]).includes(name))
    fail(404, "NOT_FOUND", "Financial report not found");
  let scope: any;
  if (auth.agentId) {
    if (
      !["agency-revenue", "commission-earned", "commission-payable"].includes(
        name,
      )
    )
      fail(403, "FORBIDDEN", "Report is unavailable to agencies");
    await authorizeAgent(auth, "commissions");
    if (
      (query.operatorId && query.operatorId !== auth.operatorId) ||
      (query.agentId && query.agentId !== auth.agentId)
    )
      fail(404, "NOT_FOUND", "Financial scope not found");
    scope = { operatorId: auth.operatorId, agentId: auth.agentId };
  } else
    scope = await settlementReadScope(auth, query.operatorId, query.agentId);
  const owner = scope.operatorId ? { operatorId: scope.operatorId } : {},
    agentId = scope.agentId;
  const bookingScope = agentId
    ? {
        ...owner,
        ...agencyBookingScope(
          scope.operatorId || query.operatorId || "",
          agentId,
        ),
      }
    : owner;
  // The selected agency must determine its operator even for a platform-wide query.
  if (agentId && !scope.operatorId) {
    const agency: any = await M.SalesPartner.findById(agentId).lean();
    scope.operatorId = String(agency.operatorId);
    return financialReport(
      auth,
      name,
      { ...query, operatorId: scope.operatorId },
      exportAll,
    );
  }
  let result: any;
  await mongoose.connection.transaction(
    async (session) => {
      let rows: any[] = [];
      const period = createdDuring(query);
      async function bounded(model: any, filter: any) {
        const data = await model
          .find(filter)
          .sort({ createdAt: -1, _id: -1 })
          .limit(10001)
          .session(session)
          .lean();
        if (data.length > 10000)
          fail(413, "REPORT_TOO_LARGE", "Narrow the date range or scope");
        return data;
      }
      if (
        ["wallet-balances", "credit-exposure", "commission-payable"].includes(
          name,
        )
      ) {
        const code =
          name === "wallet-balances"
            ? "agency-prepaid"
            : name === "credit-exposure"
              ? "agency-credit-receivable"
              : "agent-commission-payable";
        const accounts: any[] = await bounded(M.LedgerAccount, {
          ...owner,
          code,
          ...(agentId ? { ownerId: agentId } : {}),
        });
        const journals: any[] = await bounded(M.JournalEntry, {
          ...owner,
          "lines.accountId": { $in: accounts.map((a) => a._id) },
          createdAt: { $lte: new Date(`${query.to}T23:59:59.999+05:30`) },
        });
        rows = accounts.map((account) => {
          let debit = 0n,
            credit = 0n;
          for (const journal of journals)
            for (const line of journal.lines)
              if (String(line.accountId) === String(account._id)) {
                debit += paise(line.debitPaise);
                credit += paise(line.creditPaise);
              }
          return {
            id: String(account._id),
            operatorId: String(account.operatorId),
            agentId: account.ownerId,
            account: code,
            status: "Posted balance",
            currency: "INR",
            balancePaise: signed(
              code === "agency-credit-receivable"
                ? debit - credit
                : credit - debit,
            ),
            asOf: query.to,
          };
        });
      } else if (name === "operator-settlements") {
        rows = (await bounded(M.Settlement, { ...scope, ...period })).map(
          (s: any) => ({
            id: String(s._id),
            operatorId: String(s.operatorId),
            agentId: String(s.agentId || ""),
            reference: s.externalId,
            status: s.workflowStatus || s.status,
            amountPaise: s.netPaise,
            mode: s.mode || "Legacy; evidence not assessed",
            currency: s.currency,
          }),
        );
      } else if (name === "settlement-reconciliation") {
        if (agentId) {
          const settlements: any[] = await bounded(M.Settlement, { ...scope });
          rows = await bounded(M.SettlementReconciliation, {
            ...owner,
            settlementId: { $in: settlements.map((s) => s._id) },
            ...period,
          });
        } else
          rows = await bounded(M.SettlementReconciliation, {
            ...owner,
            ...period,
          });
        rows = rows.map((r: any) => ({
          id: String(r._id),
          operatorId: String(r.operatorId),
          settlementId: String(r.settlementId),
          status: r.consistent ? "Consistent" : "Review required",
          issues: r.issues.join(", "),
          bankVerified: false,
          checkedAt: r.createdAt,
        }));
      } else if (name === "payment-exceptions") {
        const bookings: any[] = agentId
          ? await bounded(M.Booking, bookingScope)
          : [];
        rows = (
          await bounded(M.FinanceException, {
            ...owner,
            ...(agentId
              ? { bookingId: { $in: bookings.map((b) => b._id) } }
              : {}),
            ...period,
          })
        ).map((e: any) => ({
          id: String(e._id),
          operatorId: String(e.operatorId),
          bookingId: String(e.bookingId || ""),
          kind: e.kind,
          status: e.status,
          code: e.code,
        }));
      } else if (name === "pending-payments") {
        rows = (
          await bounded(M.Booking, {
            ...bookingScope,
            paymentStatus: "Pending",
            ...period,
          })
        ).map((b: any) => ({
          id: String(b._id),
          operatorId: String(b.operatorId),
          agentId: String(b.agentId || ""),
          reference: b.reference,
          status: b.status,
          amountPaise: b.totalPaise,
          currency: "INR",
        }));
      } else if (name === "refund-summary") {
        const bookings: any[] = agentId
          ? await bounded(M.Booking, bookingScope)
          : [];
        rows = (
          await bounded(M.RefundIntent, {
            ...owner,
            ...(agentId
              ? { bookingId: { $in: bookings.map((b) => b._id) } }
              : {}),
            ...period,
          })
        ).map((r: any) => ({
          id: String(r._id),
          operatorId: String(r.operatorId),
          bookingId: String(r.bookingId),
          source: r.fundingMethod,
          status: r.status,
          amountPaise: r.amountPaise,
          completed: r.status === "Processed",
          currency: "INR",
        }));
      } else {
        const journals: any[] = await bounded(M.JournalEntry, {
          ...owner,
          kind: "Booking captured",
          ...period,
        });
        const grouped = new Map<string, any>();
        for (const journal of journals) {
          const booking: any = await M.Booking.findOne({
            _id: journal.bookingId,
            ...bookingScope,
          })
            .session(session)
            .lean();
          if (!booking) continue;
          const payment: any = await M.Payment.findOne({
            _id: journal.paymentId,
            operatorId: journal.operatorId,
          })
            .session(session)
            .lean();
          if (!payment) continue;
          const agency = String(
            booking.agentId ||
              (booking.commissionSnapshot?.partnerKind === "Agent"
                ? booking.salesPartnerId || ""
                : ""),
          );
          const date = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Kolkata",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(journal.createdAt);
          const trip: any =
            name === "route-revenue"
              ? await M.Trip.findOne({
                  _id: booking.tripId,
                  operatorId: booking.operatorId,
                })
                  .select("routeId")
                  .session(session)
                  .lean()
              : null;
          const group =
            name === "daily-ticket-revenue"
              ? date
              : name === "monthly-ticket-revenue"
                ? date.slice(0, 7)
                : name === "agency-revenue" || name === "commission-earned"
                  ? agency || "Direct booking"
                  : name === "route-revenue"
                    ? String(trip?.routeId || "Unknown route")
                    : name === "booking-source"
                      ? booking.source
                      : String(booking.operatorId);
          const key = `${journal.operatorId}:${group}`;
          let row = grouped.get(key);
          if (!row) {
            row = {
              id: key,
              operatorId: String(journal.operatorId),
              group,
              status: "Ledger capture activity",
              currency: "INR",
              capturedBookingCount: 0,
              grossTicketValuePaise: 0n,
              refundedPaise: 0n,
              netTicketValuePaise: 0n,
              earnedCommissionPaise: 0n,
              operatorLiabilityCreatedPaise: 0n,
              platformRevenuePaise: 0n,
              gatewayCapturePaise: 0n,
              walletFundedPaise: 0n,
              creditFundedPaise: 0n,
              bankReceivedPaise: 0,
            };
            grouped.set(key, row);
          }
          row.capturedBookingCount++;
          row.grossTicketValuePaise += paise(journal.totalPaise);
          const refund = paise(payment.refundedPaise || 0);
          row.refundedPaise += refund;
          const confirmed =
            booking.status === "Confirmed" && booking.paymentStatus === "Paid";
          const retained: any =
            booking.status === "Cancelled"
              ? await M.CancellationQuote.findOne({
                  bookingId: booking._id,
                  _id: (
                    await M.Cancellation.findOne({
                      bookingId: booking._id,
                      status: "Approved",
                    })
                      .session(session)
                      .lean()
                  )?.acceptedQuoteId,
                })
                  .session(session)
                  .lean()
              : null;
          row.netTicketValuePaise += confirmed
            ? paise(journal.totalPaise)
            : paise(retained?.retainedPaise || 0);

          for (const line of journal.lines)
            if (line.creditPaise) {
              const account: any = await M.LedgerAccount.findById(
                line.accountId,
              )
                .session(session)
                .lean();
              if (confirmed && account?.code === "agent-commission-payable")
                row.earnedCommissionPaise += paise(line.creditPaise);
              if (account?.code === "operator-payable")
                row.operatorLiabilityCreatedPaise += paise(line.creditPaise);
              if (account?.code === "platform-commission")
                row.platformRevenuePaise += paise(line.creditPaise);
            }
          if (payment.providerId === "agency-wallet")
            row.walletFundedPaise += paise(payment.amountPaise);
          else if (payment.providerId === "agency-credit")
            row.creditFundedPaise += paise(payment.amountPaise);
          else row.gatewayCapturePaise += paise(payment.amountPaise);
        }
        rows = [...grouped.values()].map((row) =>
          Object.fromEntries(
            Object.entries(row).map(([k, v]) => [
              k,
              typeof v === "bigint" ? safeMoney(v) : v,
            ]),
          ),
        );
      }
      // Agency views must never expose another party's payable or platform revenue.
      if (auth.agentId)
        rows = rows.map((row) => {
          const {
            operatorLiabilityCreatedPaise,
            platformRevenuePaise,
            bankReceivedPaise,
            ...own
          } = row;
          return own;
        });
      if (query.status) rows = rows.filter((r) => r.status === query.status);
      if (query.search) {
        const needle = query.search.toLowerCase();
        rows = rows.filter((r) =>
          Object.values(r).some((v) =>
            String(v).toLowerCase().includes(needle),
          ),
        );
      }
      const total = rows.length;
      result = {
        rows: exportAll
          ? rows
          : rows.slice(
              (query.page - 1) * query.limit,
              query.page * query.limit,
            ),
        page: query.page,
        limit: query.limit,
        total,
        from: query.from,
        to: query.to,
        currency: "INR",
        moneyUnit: "integer paise",
        coverage:
          "Posted ledger since activation; no historical backfill. Balances are cumulative through end date; activity uses IST journal dates. Ticket value is not AIBUS platform revenue. Bank receipt integration is unavailable; bankReceivedPaise is zero verified evidence, not a bank balance. Test settlements are labelled.",
        livePayoutAvailable: false,
      };
    },
    { readConcern: { level: "snapshot" } },
  );
  return result;
}
export async function financialReportCsv(
  auth: Principal,
  name: string,
  query: ReportQuery,
) {
  const report = await financialReport(auth, name, query, true),
    fields: string[] = [
      ...new Set<string>(report.rows.flatMap((r: any) => Object.keys(r))),
    ];
  return csvDocument([
    fields,
    ...report.rows.map((r: any) => fields.map((f) => r[f])),
  ]);
}
export async function financialReconciliation(
  auth: Principal,
  operatorId?: string,
) {
  const scope = await settlementReadScope(auth, operatorId);
  if (auth.agentId || !scope.operatorId)
    fail(
      400,
      "OPERATOR_REQUIRED",
      "Select one authorized operator for a financial consistency check",
    );
  let report: any;
  await mongoose.connection.transaction(
    async (session) => {
      const integrity = await verifyLedger(scope.operatorId, session),
        issues = [...integrity.issues];
      const operator = { operatorId: scope.operatorId };
      const accounts: any[] = await M.LedgerAccount.find(operator)
        .session(session)
        .lean();
      const projections: any[] = await M.AccountBalanceProjection.find(operator)
        .session(session)
        .lean();
      const balances = new Map(
        projections.map((p) => [String(p.accountId), p]),
      );
      const balance = (code: string, ownerId?: string) => {
        const account = accounts.find(
            (a) => a.code === code && (!ownerId || a.ownerId === ownerId),
          ),
          p = account && balances.get(String(account._id));
        return p ? paise(p.creditPaise) - paise(p.debitPaise) : 0n;
      };
      const reservations: any[] = await M.WalletReservation.find({
        ...operator,
        status: "Reserved",
      })
        .session(session)
        .lean();
      const wallets: any[] = await M.AgentWallet.find(operator)
          .session(session)
          .lean(),
        credit: any[] = await M.CreditFacility.find(operator)
          .session(session)
          .lean();
      for (const [mode, holders] of [
        ["wallet", wallets],
        ["credit", credit],
      ] as const)
        for (const holder of holders) {
          const reserved = reservations
            .filter(
              (r) =>
                r.mode === mode && String(r.agentId) === String(holder.agentId),
            )
            .reduce((n, r) => n + paise(r.amountPaise), 0n);
          if (reserved !== paise(holder.reservedPaise))
            issues.push({
              code: "FUNDING_RESERVATION_MISMATCH",
              id: String(holder._id),
            });
          const posted = balance(
            mode === "wallet" ? "agency-prepaid" : "agency-credit-receivable",
            String(holder.agentId),
          );
          if (
            mode === "wallet"
              ? posted < reserved
              : -posted + reserved > paise(holder.limitPaise)
          )
            issues.push({
              code: "FUNDING_EXPOSURE_EXCEEDED",
              id: String(holder._id),
            });
        }
      const intents: any[] = await M.RefundIntent.find(operator)
        .session(session)
        .lean();
      const outstandingRefunds = intents
        .filter((i) => i.status !== "Processed")
        .reduce((n, i) => n + paise(i.amountPaise), 0n);
      if (balance("customer-refunds-payable") !== outstandingRefunds)
        issues.push({
          code: "REFUND_LIABILITY_MISMATCH",
          id: scope.operatorId,
        });
      for (const intent of intents.filter((i) => i.status === "Processed"))
        if (
          !intent.journalId ||
          !(await M.JournalEntry.exists({
            _id: intent.journalId,
            ...operator,
            kind: "Refund",
          }).session(session))
        )
          issues.push({
            code: "REFUND_POSTING_MISSING",
            id: String(intent._id),
          });
      const payments: any[] = await M.Payment.find({
        ...operator,
        status: { $in: ["captured", "refunded"] },
      })
        .select("_id")
        .limit(10001)
        .session(session)
        .lean();
      if (payments.length > 10000)
        fail(
          413,
          "RECONCILIATION_TOO_LARGE",
          "Operator-wide reconciliation exceeds interactive limits; offline assessment required",
        );
      for (const payment of payments)
        if (
          !(await M.JournalEntry.exists({
            ...operator,
            paymentId: payment._id,
            kind: { $in: ["Booking captured", "Payment exception"] },
          }).session(session))
        )
          issues.push({
            code: "HISTORICAL_CAPTURE_NOT_JOURNALED",
            id: String(payment._id),
          });
      const payouts: any[] = await M.PayoutIntent.find(operator)
        .session(session)
        .lean();
      for (const payout of payouts.filter((p) => p.status === "Paid"))
        if (
          !payout.journalId ||
          !(await M.JournalEntry.exists({
            _id: payout.journalId,
            ...operator,
            kind: "Settlement payout",
          }).session(session))
        )
          issues.push({
            code: "PAYOUT_POSTING_MISSING",
            id: String(payout._id),
          });
      report = {
        consistent: !issues.length,
        issues,
        accounts: integrity.accounts,
        readOnly: true,
        automaticBalancing: false,
        bankReconciliationAvailable: false,
        openProviderCases: await M.FinanceException.countDocuments({
          ...operator,
          status: { $ne: "Resolved" },
        }).session(session),
        outstandingRefundPaise: safeMoney(outstandingRefunds),
        note: "No repair, historical backfill or bank settlement inference. Uncertain, partial and failed provider operations require explicit review.",
      };
    },
    { readConcern: { level: "snapshot" } },
  );
  return report;
}
