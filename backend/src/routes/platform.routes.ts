import { Router } from "express";
import { cityCatalogRouter } from "./city-catalog.routes.js";
import { z } from "zod";
import mongoose from "mongoose";
import type { Config } from "../config/env.js";
import * as M from "../models/index.js";
import {
  authenticate,
  rateLimit,
  type Limiter,
} from "../middleware/auth.middleware.js";
import {
  asyncRoute,
  id,
  ok,
  literalRegex,
  fail,
  AppError,
} from "../utils/core.js";
import { dateOnly } from "../validators/common.schemas.js";
import * as R from "../services/platform-read.service.js";
import * as A from "../services/platform-admin.service.js";
import {
  profilePermissions,
  platformPermissions,
  platformProfiles,
} from "../types/platform.js";
import { ownedAgent } from "../services/agent.service.js";
const reason = z.string().trim().min(5).max(240),
  password = z.string().min(1).max(128);
const query = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    search: z.string().trim().max(100).default(""),
    status: z.string().max(50).optional(),
    operatorId: id.optional(),
    agentId: id.optional(),
    from: dateOnly.optional(),
    to: dateOnly.optional(),
    source: z.enum(["operator", "agent", "customer", "external"]).optional(),
  })
  .strict()
  .refine(
    (v) => !v.from || !v.to || v.from <= v.to,
    "From date must not follow to date",
  );
const staffInput = z.object({
  name: z.string().trim().min(2).max(100),
  email: z
    .string()
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  profile: z.enum(platformProfiles),
  permissions: z.array(z.enum(platformPermissions)).max(20),
  financeRead: z.boolean(),
  financeActions: z
    .array(
      z.enum([
        "refunds:review",
        "settlements:prepare",
        "settlements:approve",
        "payouts:authorize",
      ]),
    )
    .max(4),
  active: z.boolean(),
  reason,
  password,
});
export function platformRouter(config: Config, limiter?: Limiter) {
  const router = Router();
  router.use(authenticate(config), (req, res, next) => {
    if (
      req.auth.role !== "super_admin" ||
      req.auth.operatorId ||
      req.auth.agentId
    )
      return next(new AppError(403, "FORBIDDEN", "Platform identity required"));
    res.set("Cache-Control", "no-store");
    next();
  });
  if (limiter)
    router.use((req, res, next) =>
      req.method === "GET"
        ? next()
        : /^\/city-catalog\/imports\/[a-f0-9]{24}\/commit$/.test(req.path)
          ? rateLimit(limiter, "platform-city-import", 240, 900)(req, res, next)
          : rateLimit(limiter, "platform-privileged", 20, 900)(req, res, next),
    );
  router.use("/city-catalog", cityCatalogRouter());
  router.get(
    "/capabilities",
    asyncRoute(async (req, res) => {
      ok(res, {
        permissions: req.auth.permissions,
        roles: Object.entries(profilePermissions).map(
          ([profile, permissions]) => ({
            profile,
            permissions,
            defaultPermissions: permissions.filter(
              (p) => p !== "platform:passengers:read",
            ),
          }),
        ),
        mfa: {
          available: false,
          reason:
            "Secure factor encryption, enrollment challenge and recovery are not configured; privileged actions require password re-verification",
        },
        liveFundingAvailable: false,
        liveRefundAvailable: false,
        livePayoutAvailable: false,
      });
    }),
  );
  router.get(
    "/overview",
    asyncRoute(async (req, res) => {
      const q = query.parse(req.query),
        report = await R.platformOverview(req.auth, q);
      const counts = await M.Operator.aggregate([
        {
          $match: q.operatorId
            ? { _id: new mongoose.Types.ObjectId(q.operatorId) }
            : {},
        },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]);
      ok(res, {
        ...report,
        operators: Object.fromEntries(counts.map((c) => [c._id, c.count])),
        totalOperators: report.metrics.totalOperators,
        buses: report.metrics.buses,
        routes: await M.Route.countDocuments(
          q.operatorId ? { operatorId: q.operatorId } : {},
        ),
        scheduledTrips: report.metrics.activeTrips,
      });
    }),
  );
  router.get(
    "/operators",
    asyncRoute(async (req, res) => {
      R.platformPermit(req.auth, "platform:operators:read");
      const q = query.parse(req.query);
      const filter = {
        ...(q.operatorId ? { _id: q.operatorId } : {}),
        ...(q.status
          ? {
              status: z
                .enum(["pending", "approved", "suspended", "rejected"])
                .parse(q.status),
            }
          : {}),
        ...(q.search
          ? {
              $or: [
                { company: literalRegex(q.search) },
                { email: literalRegex(q.search) },
              ],
            }
          : {}),
      };
      const total = await M.Operator.countDocuments(filter);
      ok(
        res,
        await M.Operator.find(filter)
          .sort({ createdAt: -1, _id: -1 })
          .skip((q.page - 1) * q.limit)
          .limit(q.limit)
          .lean(),
        {
          page: q.page,
          limit: q.limit,
          total,
          pages: Math.max(1, Math.ceil(total / q.limit)),
        },
      );
    }),
  );
  router.get(
    "/operators/:id",
    asyncRoute(async (req, res) => {
      z.object({}).strict().parse(req.query);
      ok(res, await A.operatorProfile(req.auth, id.parse(req.params.id)));
    }),
  );
  router.patch(
    "/operators/:id/status",
    asyncRoute(async (req, res) => {
      R.platformPermit(req.auth, "platform:operators:write");
      const input = z
        .object({
          status: z
            .enum(["pending", "approved", "suspended", "rejected"])
            .optional(),
          salesBlocked: z.boolean().optional(),
          version: z.number().int().min(0),
          reason,
          password,
        })
        .strict()
        .refine(
          (v) => v.status !== undefined || v.salesBlocked !== undefined,
          "Choose a status or new-sales policy",
        )
        .parse(req.body);
      ok(res, await A.changeOperator(req.auth, id.parse(req.params.id), input));
    }),
  );
  router.post(
    "/operators/:id/documents",
    asyncRoute(async (req, res) => {
      R.platformPermit(req.auth, "platform:verification:write");
      const input = z
        .object({
          kind: z.enum([
            "Business registration",
            "Tax registration",
            "Operating licence",
            "Other",
          ]),
          reference: z.string().trim().min(3).max(120),
          reason,
          password,
        })
        .strict()
        .parse(req.body);
      const operatorId = id.parse(req.params.id);
      await R.selectedOperator(operatorId);
      await A.verifyPlatformAction(req.auth, input.password);
      await A.platformIndexesReady();
      let result: any;
      await mongoose.connection.transaction(async (session) => {
        result = await M.OperatorDocument.findOneAndUpdate(
          { operatorId, kind: input.kind, reference: input.reference },
          {
            $setOnInsert: {
              operatorId,
              kind: input.kind,
              reference: input.reference,
            },
          },
          { upsert: true, new: true, session },
        );
        await A.platformAudit(
          req.auth,
          "operator.document-reference",
          String(result._id),
          input.reason,
          session,
          operatorId,
        );
      });
      ok(res, result, undefined, 201);
    }),
  );
  router.post(
    "/operators/:operatorId/documents/:id/review",
    asyncRoute(async (req, res) => {
      const input = z
        .object({
          status: z.enum(["Reviewed", "Rejected", "Needs information"]),
          version: z.number().int().min(0),
          reason,
          password,
        })
        .strict()
        .parse(req.body);
      ok(
        res,
        await A.reviewOperatorDocument(
          req.auth,
          id.parse(req.params.operatorId),
          id.parse(req.params.id),
          input,
        ),
      );
    }),
  );
  router.get(
    "/operators/:operatorId/agents/:agentId/bookings",
    asyncRoute(async (req, res) => {
      R.platformPermit(req.auth, "platform:agencies:read");
      const operatorId = id.parse(req.params.operatorId),
        agency = await ownedAgent(operatorId, id.parse(req.params.agentId)),
        q = query.parse(req.query);
      const report = await R.platformRows(req.auth, "bookings", {
        ...q,
        operatorId,
        agentId: String(agency._id),
      });
      ok(res, report.rows, report);
    }),
  );
  for (const resource of [
    "buses",
    "trips",
    "routes",
    "agencies",
    "bookings",
    "alerts",
    "audit",
  ]) {
    router.get(
      "/" + resource + ".csv",
      asyncRoute(async (req, res) => {
        const q = query.parse(req.query);
        if (!q.from || !q.to)
          fail(400, "PERIOD_REQUIRED", "Choose a complete export period");
        const data = await R.platformRows(req.auth, resource, q, true);
        res
          .type("text/csv")
          .attachment("aibus-platform-" + resource + ".csv")
          .send(R.platformCsv(data.rows));
      }),
    );
    router.get(
      "/" + resource,
      asyncRoute(async (req, res) => {
        const data = await R.platformRows(
          req.auth,
          resource,
          query.parse(req.query),
        );
        ok(res, data.rows, data);
      }),
    );
    router.get(
      "/" + resource + "/:id",
      asyncRoute(async (req, res) => {
        z.object({}).strict().parse(req.query);
        ok(
          res,
          await R.platformDetail(req.auth, resource, id.parse(req.params.id)),
        );
      }),
    );
  }
  router.get(
    "/reports/:name.csv",
    asyncRoute(async (req, res) => {
      const q = query.parse(req.query);
      if (!q.from || !q.to)
        fail(400, "PERIOD_REQUIRED", "Choose a complete export period");
      const report = await R.operationalReport(
        req.auth,
        String(req.params.name),
        q,
        true,
      );
      res
        .type("text/csv")
        .attachment("aibus-platform-report.csv")
        .send(R.platformCsv(report.rows));
    }),
  );
  router.get(
    "/reports/:name",
    asyncRoute(async (req, res) => {
      const report = await R.operationalReport(
        req.auth,
        String(req.params.name),
        query.parse(req.query),
      );
      ok(res, report.rows, report);
    }),
  );
  router.get(
    "/admin-users",
    asyncRoute(async (req, res) => {
      R.platformPermit(req.auth, "platform:staff:write");
      const q = query.parse(req.query),
        filter = {
          role: "super_admin",
          ...(q.search
            ? {
                $or: [
                  { name: literalRegex(q.search) },
                  { email: literalRegex(q.search) },
                ],
              }
            : {}),
        };
      const rows = await M.User.find(filter)
          .sort({ createdAt: -1 })
          .skip((q.page - 1) * q.limit)
          .limit(q.limit)
          .lean(),
        total = await M.User.countDocuments(filter);
      ok(res, rows.map(A.safeAdminUser), {
        page: q.page,
        limit: q.limit,
        total,
        pages: Math.max(1, Math.ceil(total / q.limit)),
      });
    }),
  );
  router.post(
    "/admin-users",
    asyncRoute(async (req, res) => {
      const input = staffInput
        .extend({ initialPassword: z.string().min(12).max(128) })
        .strict()
        .parse(req.body);
      ok(
        res,
        await A.createAdminStaff(
          config,
          req.auth,
          input,
          z.string().min(10).max(150).parse(req.get("Idempotency-Key")),
        ),
        undefined,
        201,
      );
    }),
  );
  router.patch(
    "/admin-users/:id",
    asyncRoute(async (req, res) => {
      const input = staffInput
        .extend({ version: z.number().int().min(0) })
        .strict()
        .parse(req.body);
      ok(
        res,
        await A.updateAdminStaff(req.auth, id.parse(req.params.id), input),
      );
    }),
  );
  router.post(
    "/admin-users/:id/revoke-sessions",
    asyncRoute(async (req, res) => {
      const input = z.object({ password, reason }).strict().parse(req.body);
      ok(
        res,
        await A.revokeAdminSessions(
          req.auth,
          id.parse(req.params.id),
          input.password,
          input.reason,
        ),
      );
    }),
  );
  router.get(
    "/settings",
    asyncRoute(async (req, res) => {
      R.platformPermit(req.auth, "platform:settings:read");
      z.object({}).strict().parse(req.query);
      ok(res, {
        settings: (await M.PlatformSettings.findOne({
          key: "platform",
        }).lean()) || {
          displayName: "AIBUS",
          supportEmail: "",
          onboardingMode: "Manual review",
          templates: {},
          version: 0,
        },
        integration: {
          databaseConnected: mongoose.connection.readyState === 1,
          payment: config.RAZORPAY_KEY_ID?.startsWith("rzp_test_")
            ? "Test credentials configured; provider availability unverified"
            : "Unconfigured",
          financeTestMode: config.FINANCE_TEST_MODE,
          smtpConfigured: !!config.SMTP_HOST,
          redisConfigured: !!config.REDIS_URL,
          redisReachabilityVerified: false,
          livePayouts: false,
          publicApiPartners: "Reserved for Phase 7",
          liveGps: "Provider unconfigured",
          notificationTemplates: "Draft-only; no outbound delivery enabled",
        },
        mfaAvailable: false,
      });
    }),
  );
  router.put(
    "/settings",
    asyncRoute(async (req, res) => {
      const input = z
        .object({
          displayName: z.string().trim().min(2).max(100),
          supportEmail: z.string().email().max(254),
          onboardingMode: z.literal("Manual review"),
          templates: z
            .object({
              operatorApproved: z.string().max(1000).optional(),
              operatorSuspended: z.string().max(1000).optional(),
              bookingSupport: z.string().max(1000).optional(),
            })
            .strict(),
          version: z.number().int().min(0),
          reason,
          password,
        })
        .strict()
        .parse(req.body);
      ok(
        res,
        await A.updatePlatformSettings(req.auth, {
          ...input,
          templates: Object.fromEntries(
            Object.entries(input.templates).filter(
              (e): e is [string, string] => typeof e[1] === "string",
            ),
          ),
        }),
      );
    }),
  );
  return router;
}
