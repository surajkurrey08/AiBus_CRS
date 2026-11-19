import { Router } from "express";
import { z } from "zod";
import type { Config } from "../config/env.js";
import * as M from "../models/index.js";
import * as S from "../services/settlement.service.js";
import {
  financialReport,
  financialReportCsv,
  financialReconciliation,
  reportNames,
} from "../services/financial-report.service.js";
import {
  asyncRoute,
  id,
  ok,
  fail,
  literalRegex,
  AppError,
} from "../utils/core.js";
import { dateOnly } from "../validators/common.schemas.js";
import { createdDuring } from "../validators/agent-dashboard.schemas.js";
const reason = z.string().trim().min(5).max(240);
const listQuery = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    operatorId: id.optional(),
    agentId: id.optional(),
    status: z.string().max(50).optional(),
    search: z.string().max(100).default(""),
    from: dateOnly.optional(),
    to: dateOnly.optional(),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.from <= v.to, "Invalid period");
const reportQuery = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    operatorId: id.optional(),
    agentId: id.optional(),
    status: z.string().max(50).optional(),
    search: z.string().max(100).default(""),
    from: dateOnly,
    to: dateOnly,
  })
  .strict()
  .refine((v) => v.from <= v.to, "Invalid period");
export function settlementRouter(
  config: Config,
  channel: "operator" | "platform" | "agent",
) {
  const router = Router();
  router.use((req, _res, next) => {
    if (
      channel === "platform" &&
      (req.auth.role !== "super_admin" ||
        !req.auth.permissions.includes("platform:finance:read"))
    )
      return next(
        new AppError(403, "FORBIDDEN", "Platform finance access required"),
      );
    if (channel === "agent" && (!req.auth.agentId || req.auth.role !== "agent"))
      return next(
        new AppError(403, "AGENT_REQUIRED", "An agent account is required"),
      );
    if (channel === "operator" && (req.auth.agentId || !req.auth.operatorId))
      return next(
        new AppError(403, "FORBIDDEN", "Operator finance context required"),
      );
    next();
  });
  router.get(
    "/reports",
    asyncRoute(async (req, res) => {
      await S.settlementReadScope(req.auth);
      z.object({}).strict().parse(req.query);
      ok(res, {
        reports: reportNames,
        testModeAvailable:
          !!config.FINANCE_TEST_MODE && config.NODE_ENV !== "production",
        livePayoutAvailable: false,
      });
    }),
  );
  router.get(
    "/reports/:name.csv",
    asyncRoute(async (req, res) => {
      const query = reportQuery.parse(req.query);
      res
        .type("text/csv")
        .set(
          "Content-Disposition",
          'attachment; filename="aibus-financial-report.csv"',
        )
        .set("Cache-Control", "no-store")
        .send(
          await financialReportCsv(req.auth, String(req.params.name), query),
        );
    }),
  );
  router.get(
    "/reports/:name",
    asyncRoute(async (req, res) =>
      ok(
        res,
        await financialReport(
          req.auth,
          String(req.params.name),
          reportQuery.parse(req.query),
        ),
      ),
    ),
  );
  router.get(
    "/reconciliation",
    asyncRoute(async (req, res) => {
      const query = z
        .object({ operatorId: id.optional() })
        .strict()
        .parse(req.query);
      ok(res, await financialReconciliation(req.auth, query.operatorId));
    }),
  );
  router.get(
    "/settlements",
    asyncRoute(async (req, res) => {
      const q = listQuery.parse(req.query),
        scope = await S.settlementReadScope(req.auth, q.operatorId, q.agentId);
      const filter = {
        ...scope,
        workflowVersion: 1,
        ...createdDuring(q),
        ...(q.status ? { workflowStatus: q.status } : {}),
        ...(q.search ? { externalId: literalRegex(q.search) } : {}),
      };
      const data = await M.Settlement.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean();
      ok(res, data, {
        page: q.page,
        limit: q.limit,
        total: await M.Settlement.countDocuments(filter),
      });
    }),
  );
  router.get(
    "/settlements/:id",
    asyncRoute(async (req, res) => {
      z.object({}).strict().parse(req.query);
      ok(res, await S.settlementDetail(req.auth, id.parse(req.params.id)));
    }),
  );
  if (channel === "agent") return router;
  router.get(
    "/audit",
    asyncRoute(async (req, res) => {
      const q = listQuery.parse(req.query),
        scope = await S.settlementReadScope(req.auth, q.operatorId);
      const filter = {
        ...scope,
        expiresAt: null,
        ...(q.search ? { action: literalRegex(q.search) } : {}),
        ...createdDuring(q),
      };
      const data = await M.Audit.find(filter)
        .select("operatorId actorId action resourceId metadata createdAt")
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean();
      ok(res, data, {
        page: q.page,
        limit: q.limit,
        total: await M.Audit.countDocuments(filter),
      });
    }),
  );
  router.get(
    "/agencies",
    asyncRoute(async (req, res) => {
      const q = z
        .object({ operatorId: id.optional() })
        .strict()
        .parse(req.query);
      const scope = await S.settlementReadScope(req.auth, q.operatorId);
      if (!scope.operatorId)
        fail(
          400,
          "OPERATOR_REQUIRED",
          "Choose an operator for agency filtering",
        );
      ok(
        res,
        await M.SalesPartner.find({
          operatorId: scope.operatorId,
          kind: "Agent",
        })
          .select("_id name status")
          .sort({ name: 1 })
          .limit(500)
          .lean(),
      );
    }),
  );
  if (channel !== "platform") return router;
  router.get(
    "/settlement-policy/:operatorId",
    asyncRoute(async (req, res) => {
      const operatorId = id.parse(req.params.operatorId);
      await S.settlementReadScope(req.auth, operatorId);
      ok(
        res,
        (await M.SettlementPolicy.findOne({ operatorId }).lean()) || {
          operatorId,
          enabled: false,
          version: 0,
          treatment: "Unconfigured",
          funding: "Unconfigured",
        },
      );
    }),
  );
  router.put(
    "/settlement-policy/:operatorId",
    asyncRoute(async (req, res) => {
      const input = z
        .object({
          enabled: z.boolean(),
          treatment: z.enum(["Unconfigured", "Existing capture liabilities"]),
          funding: z.enum(["Unconfigured", "Simulated gateway receipts"]),
          version: z.number().int().min(0),
          reason,
        })
        .strict()
        .parse(req.body);
      ok(
        res,
        await S.configureSettlementPolicy(
          config,
          req.auth,
          id.parse(req.params.operatorId),
          input,
        ),
      );
    }),
  );
  router.post(
    "/settlements",
    asyncRoute(async (req, res) => {
      const input = z
        .object({
          operatorId: id,
          agentId: id.optional(),
          kind: z.enum(["Operator", "Agency"]),
          from: dateOnly,
          to: dateOnly,
          reason,
        })
        .strict()
        .refine((v) => v.from <= v.to, "Invalid period")
        .parse(req.body);
      const key = z.string().min(10).max(150).parse(req.get("Idempotency-Key"));
      ok(
        res,
        await S.prepareSettlement(config, req.auth, input, key),
        undefined,
        201,
      );
    }),
  );
  router.post(
    "/settlements/:id/review",
    asyncRoute(async (req, res) => {
      const input = z
        .object({ action: z.enum(["Submit", "Approve"]), reason })
        .strict()
        .parse(req.body);
      ok(
        res,
        await S.reviewSettlement(
          config,
          req.auth,
          id.parse(req.params.id),
          input.action,
          input.reason,
        ),
      );
    }),
  );
  router.post(
    "/settlements/:id/test-receipts",
    asyncRoute(async (req, res) => {
      const input = z.object({ reason }).strict().parse(req.body);
      ok(
        res,
        await S.recordTestSettlementReceipts(
          config,
          req.auth,
          id.parse(req.params.id),
          input.reason,
        ),
      );
    }),
  );
  router.post(
    "/settlements/:id/authorize-payout",
    asyncRoute(async (req, res) => {
      const input = z.object({ reason }).strict().parse(req.body);
      ok(
        res,
        await S.authorizePayout(
          config,
          req.auth,
          id.parse(req.params.id),
          input.reason,
        ),
      );
    }),
  );
  router.post(
    "/settlements/:id/process-payout",
    asyncRoute(async (req, res) => {
      const input = z.object({ reason }).strict().parse(req.body);
      ok(
        res,
        await S.processPayout(
          config,
          req.auth,
          id.parse(req.params.id),
          input.reason,
        ),
      );
    }),
  );
  router.post(
    "/settlements/:id/reconcile",
    asyncRoute(async (req, res) => {
      const input = z.object({ reason }).strict().parse(req.body);
      ok(
        res,
        await S.reconcileSettlement(
          req.auth,
          id.parse(req.params.id),
          input.reason,
        ),
      );
    }),
  );
  return router;
}
