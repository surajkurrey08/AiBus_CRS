import * as Review from "../services/refund-review.service.js";
import { Router } from "express";
import { z } from "zod";
import type { Config } from "../config/env.js";
import * as M from "../models/index.js";
import * as R from "../services/refund-workflow.service.js";
import {
  asyncRoute,
  id,
  ok,
  fail,
  literalRegex,
  AppError,
} from "../utils/core.js";
import {
  createdDuring,
  agentPeriod,
} from "../validators/agent-dashboard.schemas.js";
const reason = z.string().trim().min(5).max(240);
const policyInput = z
  .object({
    enabled: z.boolean(),
    refundBasis: z.enum(["Unconfigured", "Discounted base fare"]),
    taxTreatment: z.enum([
      "Unconfigured",
      "Proportional refund",
      "Non-refundable",
    ]),
    chargeTreatment: z.enum([
      "Unconfigured",
      "Proportional refund",
      "Non-refundable",
    ]),
    commissionTreatment: z.enum(["Unconfigured", "Reverse all"]),
    allowExceptionRefunds: z.boolean(),
    version: z.number().int().min(0),
    reason,
  })
  .strict();
const listQuery = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    search: z.string().max(100).default(""),
    status: z.string().max(50).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  })
  .strict();
export function refundWorkflowRouter(
  config: Config,
  channel: "operator" | "agent" | "platform" = "operator",
) {
  const router = Router();
  router.use((req, _res, next) => {
    if (
      channel === "platform" &&
      (req.auth.role !== "super_admin" ||
        !req.auth.permissions.includes("platform:finance:read"))
    )
      return next(
        new AppError(
          403,
          "FORBIDDEN",
          "Explicit platform finance access required",
        ),
      );
    if (channel === "operator" && (req.auth.agentId || !req.auth.operatorId))
      return next(
        new AppError(403, "FORBIDDEN", "Operator finance context required"),
      );
    next();
  });
  router.post(
    "/bookings/:id/cancellation-quote",
    asyncRoute(async (req, res) => {
      const body = z
        .object({
          seats: z.array(z.string().min(1).max(12)).min(1).max(100).optional(),
        })
        .strict()
        .parse(req.body);
      ok(
        res,
        await R.quoteCancellation(
          req.auth,
          id.parse(req.params.id),
          body.seats,
        ),
      );
    }),
  );
  router.get(
    "/bookings/:id/refund-status",
    asyncRoute(async (req, res) => {
      z.object({}).strict().parse(req.query);
      ok(res, await R.refundStatus(req.auth, id.parse(req.params.id)));
    }),
  );
  if (channel === "agent") return router;
  if (channel === "operator") {
    router.get(
      "/cancellation-accounting-policy",
      asyncRoute(async (req, res) => {
        z.object({}).strict().parse(req.query);
        ok(res, await R.cancellationAccountingPolicy(req.auth));
      }),
    );
    router.put(
      "/cancellation-accounting-policy",
      asyncRoute(async (req, res) =>
        ok(
          res,
          await R.configureCancellationAccounting(
            req.auth,
            policyInput.parse(req.body),
          ),
        ),
      ),
    );
  }
  const readScope = (req: any) => {
    if (req.auth.role === "super_admin") {
      if (!req.auth.permissions.includes("platform:finance:read"))
        fail(403, "FORBIDDEN", "Explicit platform finance access required");
      return {};
    }
    if (
      !req.auth.permissions.includes("finance:read") ||
      !req.auth.operatorId ||
      req.auth.agentId
    )
      fail(403, "FORBIDDEN", "Operator finance reporting required");
    return { operatorId: req.auth.operatorId };
  };
  for (const [path, model] of [
    ["cancellations", M.Cancellation],
    ["refund-intents", M.RefundIntent],
    ["exceptions", M.FinanceException],
  ] as const) {
    router.get(
      `/${path}`,
      asyncRoute(async (req, res) => {
        const query = listQuery.parse(req.query),
          period = agentPeriod.parse({ from: query.from, to: query.to }),
          scope = readScope(req);
        const filter = {
          ...scope,
          ...createdDuring(period),
          ...(query.status ? { status: query.status } : {}),
          ...(query.search
            ? {
                ...(path === "exceptions"
                  ? { kind: literalRegex(query.search) }
                  : path === "refund-intents"
                    ? { idempotencyKey: literalRegex(query.search) }
                    : { reason: literalRegex(query.search) }),
              }
            : {}),
        };
        const data = await model
          .find(filter)
          .sort({ createdAt: -1, _id: -1 })
          .skip((query.page - 1) * query.limit)
          .limit(query.limit)
          .lean();
        ok(res, data, {
          page: query.page,
          limit: query.limit,
          total: await model.countDocuments(filter),
        });
      }),
    );
  }
  router.get(
    "/refund-intents/:id",
    asyncRoute(async (req, res) => {
      z.object({}).strict().parse(req.query);
      const scope = readScope(req);
      const intent = await M.RefundIntent.findOne({
        _id: id.parse(req.params.id),
        ...scope,
      }).lean();
      if (!intent) fail(404, "NOT_FOUND", "Refund intent not found");
      const attempts = await M.RefundAttempt.find({
        intentId: intent!._id,
        operatorId: intent!.operatorId,
      })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean();
      ok(res, { intent, attempts });
    }),
  );
  router.post(
    "/cancellations/:id/review",
    asyncRoute(async (req, res) => {
      const body = z
        .object({
          action: z.enum(["Accept", "Reject"]),
          quoteId: id.optional(),
          reason,
        })
        .strict()
        .parse(req.body);
      ok(
        res,
        await R.reviewCancellation(
          config,
          req.auth,
          id.parse(req.params.id),
          body.action,
          body.quoteId,
          body.reason,
        ),
      );
    }),
  );
  router.post(
    "/refund-intents/:id/process",
    asyncRoute(async (req, res) => {
      z.object({}).strict().parse(req.body);
      const intent: any = await M.RefundIntent.findOne({
        _id: id.parse(req.params.id),
        ...readScope(req),
      }).lean();
      if (!intent) fail(404, "NOT_FOUND", "Refund intent not found");
      R.financeReview(req.auth, String(intent.operatorId));
      ok(res, await R.processRefundIntent(config, String(intent._id)));
    }),
  );
  router.get(
    "/exceptions/:id",
    asyncRoute(async (req, res) => {
      z.object({}).strict().parse(req.query);
      ok(
        res,
        await Review.financialExceptionDetail(
          req.auth,
          id.parse(req.params.id),
        ),
      );
    }),
  );
  router.post(
    "/exceptions/:id/review",
    asyncRoute(async (req, res) => {
      const body = z
        .object({
          action: z.enum([
            "Acknowledge",
            "Approve test refund",
            "Resolve verified refund",
          ]),
          reason,
        })
        .strict()
        .parse(req.body);
      const caseId = id.parse(req.params.id);
      ok(
        res,
        body.action === "Approve test refund"
          ? await Review.approveExceptionRefund(
              config,
              req.auth,
              caseId,
              body.reason,
            )
          : await Review.reviewFinanceException(
              req.auth,
              caseId,
              body.action,
              body.reason,
            ),
      );
    }),
  );
  router.post(
    "/refund-intents/:id/recheck",
    asyncRoute(async (req, res) => {
      const body = z.object({ reason }).strict().parse(req.body);
      ok(
        res,
        await Review.authorizeRefundRecheck(
          req.auth,
          id.parse(req.params.id),
          body.reason,
        ),
      );
    }),
  );
  return router;
}
