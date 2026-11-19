import * as M from "../models/index.js";
import { agencyFinanceScope } from "./agency-finance.service.js";
import { fail, type Principal } from "../utils/core.js";
import { createdDuring } from "../validators/agent-dashboard.schemas.js";
export function csvDocument(rows: unknown[][]): string {
  return rows
    .map((row) =>
      row
        .map((value) => {
          const text = String(value ?? "");
          return `"${(/^[=+\-@\t\r]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`;
        })
        .join(","),
    )
    .join("\r\n");
}
export async function walletStatement(
  auth: Principal,
  agentId: string | undefined,
  from: string,
  to: string,
) {
  const scope = await agencyFinanceScope(auth, agentId);
  const accounts = await M.LedgerAccount.find({
    operatorId: scope.operatorId,
    ownerType: "Agent",
    ownerId: scope.agentId,
    code: { $in: ["agency-prepaid", "agency-credit-receivable"] },
  }).lean();
  const accountMap = new Map(accounts.map((a) => [String(a._id), a.code]));
  const journals = await M.JournalEntry.find({
    operatorId: scope.operatorId,
    "lines.accountId": { $in: accounts.map((a) => a._id) },
    ...createdDuring({ from, to }),
  })
    .sort({ createdAt: 1, _id: 1 })
    .limit(10001)
    .lean();
  if (journals.length > 10000)
    fail(413, "EXPORT_TOO_LARGE", "Choose a shorter statement period");
  return csvDocument([
    [
      "Journal",
      "Timestamp UTC",
      "Account",
      "Event",
      "Currency",
      "Debit paise",
      "Credit paise",
    ],
    ...journals.flatMap((j) =>
      (j.lines as any[])
        .filter((l) => accountMap.has(String(l.accountId)))
        .map((l) => [
          j._id,
          (j.createdAt as Date).toISOString(),
          accountMap.get(String(l.accountId)),
          j.kind,
          j.currency,
          l.debitPaise,
          l.creditPaise,
        ]),
    ),
  ]);
}
