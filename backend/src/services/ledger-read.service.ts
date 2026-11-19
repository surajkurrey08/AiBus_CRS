import * as M from "../models/index.js";
import { authorizeAgent } from "./agent.service.js";
import { fail, type Principal } from "../utils/core.js";
import { paise } from "./ledger.service.js";

export async function financialScope(
  auth: Principal,
): Promise<Record<string, any>> {
  if (auth.role === "agent" || auth.agentId) {
    await authorizeAgent(auth, "commissions");
    return {
      operatorId: auth.operatorId,
      ownerType: "Agent",
      ownerId: auth.agentId,
    };
  }
  if (auth.role === "super_admin") {
    if (!auth.permissions.includes("platform:finance:read"))
      fail(
        403,
        "FORBIDDEN",
        "Explicit platform finance permission is required",
      );
    return {};
  }
  if (!auth.operatorId || !auth.permissions.includes("finance:read"))
    fail(403, "FORBIDDEN", "Finance permission is required");
  return { operatorId: auth.operatorId };
}
export async function financialAccounts(
  auth: Principal,
  page: number,
  limit: number,
) {
  const scope = await financialScope(auth);
  const accounts = await M.LedgerAccount.find(scope)
    .sort({ _id: 1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();
  const rows = [];
  for (const account of accounts) {
    const projection = await M.AccountBalanceProjection.findOne({
      accountId: account._id,
      operatorId: account.operatorId,
    }).lean();
    const net = projection
      ? paise(projection.debitPaise) - paise(projection.creditPaise)
      : null;
    rows.push({
      ...account,
      projection: projection
        ? {
            debitPaise: projection.debitPaise,
            creditPaise: projection.creditPaise,
            netDebitPaise: Number(net),
            version: projection.version,
          }
        : null,
    });
  }
  return {
    accounts: rows,
    page,
    limit,
    total: await M.LedgerAccount.countDocuments(scope),
    walletAvailable: false,
    settlementAvailable: false,
    coverage:
      "New captures since ledger activation; historical payments have not been backfilled",
  };
}
export async function financialJournals(
  auth: Principal,
  page: number,
  limit: number,
  journalId?: string,
) {
  const scope = await financialScope(auth);
  const agent = auth.role === "agent" || !!auth.agentId;
  const accountIds = agent
    ? (await M.LedgerAccount.find(scope).select("_id").lean()).map((a) => a._id)
    : [];
  const filter = {
    ...(auth.role === "super_admin" ? {} : { operatorId: auth.operatorId }),
    ...(agent ? { "lines.accountId": { $in: accountIds } } : {}),
    ...(journalId ? { _id: journalId } : {}),
  };
  const rows = await M.JournalEntry.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();
  if (journalId && !rows.length) fail(404, "NOT_FOUND", "Journal not found");
  const ownIds = new Set(accountIds.map(String));
  return {
    journals: rows.map((row) =>
      agent
        ? {
            id: row._id,
            kind: row.kind,
            currency: row.currency,
            createdAt: row.createdAt,
            reversalOf: row.reversalOf,
            lines: (row.lines as any[]).filter((line) =>
              ownIds.has(String(line.accountId)),
            ),
            partialView: true,
          }
        : row,
    ),
    page,
    limit,
    total: await M.JournalEntry.countDocuments(filter),
  };
}
