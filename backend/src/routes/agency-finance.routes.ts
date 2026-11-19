import { Router } from "express";
import { z } from "zod";
import type { Config } from "../config/env.js";
import * as M from "../models/index.js";
import * as F from "../services/agency-finance.service.js";
import { financialJournals } from "../services/ledger-read.service.js";
import { walletStatement } from "../services/finance-export.service.js";
import { agentPeriod } from "../validators/agent-dashboard.schemas.js";
import { asyncRoute, id, ok, fail, literalRegex } from "../utils/core.js";
const money = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const reason = z.string().trim().min(5).max(240);
const key = (req: any) =>
  z.string().min(8).max(128).parse(req.get("Idempotency-Key"));
const paging = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export function agencyFinanceRouter(config: Config, agent = false) {
  const router = Router();
  const root = agent ? "/wallet" : "/wallets/:agentId";
  const agentId = (req: any) =>
    agent ? req.auth.agentId : id.parse(req.params.agentId);
  if (!agent) {
    router.get(
      "/wallet-summary",
      asyncRoute(async (req, res) => {
        z.object({}).strict().parse(req.query);
        ok(res, await F.walletOverview(req.auth));
      }),
    );

    router.get(
      "/policy",
      asyncRoute(async (req, res) => {
        z.object({}).strict().parse(req.query);
        if (
          !req.auth.operatorId ||
          !req.auth.permissions.includes("finance:read")
        )
          fail(403, "FORBIDDEN", "Operator finance access required");
        ok(res, {
          ...(await F.financePolicy(req.auth.operatorId!)),
          testModeAvailable:
            config.FINANCE_TEST_MODE && config.NODE_ENV !== "production",
          liveFundingAvailable: false,
        });
      }),
    );
    router.put(
      "/policy",
      asyncRoute(async (req, res) =>
        ok(
          res,
          await F.configureFinancePolicy(
            req.auth,
            z
              .object({
                walletEnabled: z.boolean(),
                creditEnabled: z.boolean(),
                testOperationsEnabled: z.boolean(),
                custodyOwner: z.enum(["Operator", "Unconfigured"]),
                version: z.number().int().min(0),
                reason,
              })
              .strict()
              .parse(req.body),
          ),
        ),
      ),
    );
    router.get(
      "/wallets",
      asyncRoute(async (req, res) => {
        const p = paging
          .extend({
            search: z.string().max(100).default(""),
            status: z
              .enum(["Active", "Suspended", "Not configured"])
              .optional(),
          })
          .parse(req.query);
        if (
          !req.auth.operatorId ||
          !req.auth.permissions.includes("finance:read")
        )
          fail(403, "FORBIDDEN", "Operator finance access required");
        const walletIds = p.status
          ? (
              await M.AgentWallet.find({
                operatorId: req.auth.operatorId,
                ...(p.status === "Not configured" ? {} : { status: p.status }),
              })
                .select("agentId")
                .lean()
            ).map((w) => w.agentId)
          : [];
        const filter = {
          operatorId: req.auth.operatorId,
          kind: "Agent",
          ...(p.search ? { name: literalRegex(p.search) } : {}),
          ...(p.status
            ? {
                _id: {
                  [p.status === "Not configured" ? "$nin" : "$in"]: walletIds,
                },
              }
            : {}),
        };
        const agencies = await M.SalesPartner.find(filter)
          .sort({ _id: 1 })
          .skip((p.page - 1) * p.limit)
          .limit(p.limit)
          .lean();
        const rows = [];
        for (const agency of agencies) {
          const view = await F.walletView(req.auth, String(agency._id));
          rows.push({
            ...view,
            _id: agency._id,
            agencyId: agency._id,
            name: agency.name,
            status: view.wallet?.status || "Not configured",
          });
        }
        ok(res, rows, {
          ...p,
          total: await M.SalesPartner.countDocuments(filter),
        });
      }),
    );
    router.post(
      root,
      asyncRoute(async (req, res) => {
        z.object({}).strict().parse(req.body);
        ok(res, await F.createWallet(req.auth, agentId(req)!));
      }),
    );
    router.patch(
      `${root}/status`,
      asyncRoute(async (req, res) => {
        const body = z
          .object({ status: z.enum(["Active", "Suspended"]), reason })
          .strict()
          .parse(req.body);
        ok(
          res,
          await F.setWalletStatus(
            req.auth,
            agentId(req)!,
            body.status,
            body.reason,
          ),
        );
      }),
    );
    router.put(
      `${root}/credit`,
      asyncRoute(async (req, res) => {
        const b = z
          .object({
            limitPaise: money,
            status: z.enum(["Active", "Suspended"]),
            reason,
          })
          .strict()
          .parse(req.body);
        ok(
          res,
          await F.configureCredit(
            req.auth,
            agentId(req)!,
            b.limitPaise,
            b.status,
            key(req),
            b.reason,
          ),
        );
      }),
    );
    router.post(
      `${root}/funding/:intentId/review`,
      asyncRoute(async (req, res) => {
        const b = z
          .object({
            action: z.enum(["Verify test evidence", "Confirm", "Reject"]),
            reason,
          })
          .strict()
          .parse(req.body);
        ok(
          res,
          await F.reviewFunding(
            config,
            req.auth,
            agentId(req)!,
            id.parse(req.params.intentId),
            b.action,
            b.reason,
          ),
        );
      }),
    );
  }
  router.get(
    root,
    asyncRoute(async (req, res) => {
      z.object({}).strict().parse(req.query);
      ok(res, await F.walletView(req.auth, agentId(req)));
    }),
  );
  router.get(
    `${root}/statement.csv`,
    asyncRoute(async (req, res) => {
      const period = agentPeriod.parse(req.query);
      if (!period.from || !period.to)
        fail(400, "PERIOD_REQUIRED", "Select a complete statement period");
      const csv = await walletStatement(
        req.auth,
        agentId(req),
        period.from!,
        period.to!,
      );
      res
        .set("Cache-Control", "no-store")
        .attachment("aibus-agency-statement.csv")
        .type("text/csv")
        .send(csv);
    }),
  );

  router.post(
    `${root}/funding`,
    asyncRoute(async (req, res) => {
      const b = z
        .object({
          amountPaise: money.min(1),
          purpose: z.enum(["Wallet", "Credit repayment"]),
        })
        .strict()
        .parse(req.body);
      ok(
        res,
        await F.requestFunding(
          req.auth,
          agentId(req),
          b.amountPaise,
          b.purpose,
          key(req),
        ),
      );
    }),
  );
  router.get(
    `${root}/funding`,
    asyncRoute(async (req, res) => {
      const p = paging.parse(req.query),
        scope = await F.agencyFinanceScope(req.auth, agentId(req));
      ok(
        res,
        await M.WalletFundingIntent.find(scope)
          .sort({ createdAt: -1, _id: -1 })
          .skip((p.page - 1) * p.limit)
          .limit(p.limit)
          .lean(),
        { ...p, total: await M.WalletFundingIntent.countDocuments(scope) },
      );
    }),
  );
  router.get(
    `${root}/funding/:intentId`,
    asyncRoute(async (req, res) => {
      z.object({}).strict().parse(req.query);
      const scope = await F.agencyFinanceScope(req.auth, agentId(req)),
        item = await M.WalletFundingIntent.findOne({
          ...scope,
          _id: id.parse(req.params.intentId),
        }).lean();
      if (!item) fail(404, "NOT_FOUND", "Funding request not found");
      ok(res, item);
    }),
  );
  router.get(
    `${root}/credit/history`,
    asyncRoute(async (req, res) => {
      const p = paging.parse(req.query),
        scope = await F.agencyFinanceScope(req.auth, agentId(req));
      ok(
        res,
        await M.CreditLimitHistory.find(scope)
          .sort({ createdAt: -1, _id: -1 })
          .skip((p.page - 1) * p.limit)
          .limit(p.limit)
          .lean(),
        { ...p, total: await M.CreditLimitHistory.countDocuments(scope) },
      );
    }),
  );
  router.get(
    `${root}/transactions`,
    asyncRoute(async (req, res) => {
      const p = paging.parse(req.query),
        scope = await F.agencyFinanceScope(req.auth, agentId(req));
      const accounts = await M.LedgerAccount.find({
        operatorId: scope.operatorId,
        ownerType: "Agent",
        ownerId: scope.agentId,
        code: { $in: ["agency-prepaid", "agency-credit-receivable"] },
      })
        .select("_id")
        .lean();
      const ids = accounts.map((a) => a._id),
        filter = {
          operatorId: scope.operatorId,
          "lines.accountId": { $in: ids },
        };
      const own = new Set(ids.map(String));
      const rows = await M.JournalEntry.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((p.page - 1) * p.limit)
        .limit(p.limit)
        .lean();
      ok(
        res,
        rows.map((j) => ({
          id: j._id,
          createdAt: j.createdAt,
          kind: j.kind,
          currency: j.currency,
          lines: (j.lines as any[]).filter((l) => own.has(String(l.accountId))),
        })),
        { ...p, total: await M.JournalEntry.countDocuments(filter) },
      );
    }),
  );
  if (agent) {
    router.post(
      "/wallet/reservations",
      asyncRoute(async (req, res) => {
        const b = z
          .object({ bookingId: id, mode: z.enum(["wallet", "credit"]) })
          .strict()
          .parse(req.body);
        ok(
          res,
          await F.reserveBookingFunds(
            config,
            req.auth,
            b.bookingId,
            b.mode,
            key(req),
          ),
        );
      }),
    );
    router.post(
      "/wallet/reservations/:id/confirm",
      asyncRoute(async (req, res) => {
        z.object({}).strict().parse(req.body);
        ok(
          res,
          await F.confirmFundedBooking(
            config,
            req.auth,
            id.parse(req.params.id),
          ),
        );
      }),
    );
    router.delete(
      "/wallet/reservations/:id",
      asyncRoute(async (req, res) => {
        ok(
          res,
          await F.releaseFundingReservation(id.parse(req.params.id), req.auth),
        );
      }),
    );
    router.get(
      "/wallet/reservations/:id",
      asyncRoute(async (req, res) => {
        const scope = await F.agencyFinanceScope(req.auth),
          item = await M.WalletReservation.findOne({
            _id: id.parse(req.params.id),
            ...scope,
            userId: req.auth.userId,
          }).lean();
        if (!item) fail(404, "NOT_FOUND", "Funding reservation not found");
        ok(res, item);
      }),
    );
  }
  return router;
}
