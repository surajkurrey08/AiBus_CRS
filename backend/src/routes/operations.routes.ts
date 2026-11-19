import { Router } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import * as M from "../models/index.js";
import {
  OperationalJob,
  OperationalJobRun,
  OperationalIssue,
  TripIncident,
} from "../models/operations.model.js";
import {
  asyncRoute,
  id,
  dateOnly,
  ok,
  fail,
  literalRegex,
  type Principal,
} from "../utils/core.js";
import { platformPermit } from "../services/platform-read.service.js";
import {
  verifyPlatformAction,
  platformAudit,
} from "../services/platform-admin.service.js";
import {
  requestMetrics,
  realtimeMetrics,
} from "../services/observability.service.js";
import { inspectTripIntegrity } from "../services/operations-integrity.service.js";
import { operationalReport } from "../services/operations-report.service.js";
import { csvDocument } from "../services/finance-export.service.js";
import { createHash } from "node:crypto";
import type { Config } from "../config/env.js";

export function operationsRouter(
  config: Config,
  platform = false,
  readiness: () => Promise<boolean> = async () => false,
) {
  const router = Router();
  router.use((req, res, next) => {
    try {
      if (platform) platformPermit(req.auth, "platform:monitor:read");
      else if (
        !req.auth.operatorId ||
        req.auth.agentId ||
        !req.auth.permissions.includes("read")
      )
        fail(403, "FORBIDDEN", "Operator operational access required");
      res.set("Cache-Control", "no-store");
      next();
    } catch (error) {
      next(error);
    }
  });
  const query = z
    .object({
      operatorId: id.optional(),
      tripId: id.optional(),
      from: dateOnly.optional(),
      to: dateOnly.optional(),
      search: z.string().trim().max(100).default(""),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(25),
      status: z.enum(["Open", "Resolved"]).optional(),
    })
    .strict()
    .refine((q) => !q.from || !q.to || q.from <= q.to, "Invalid date order");
  async function owner(auth: Principal, requested?: string) {
    if (!platform && requested && requested !== auth.operatorId)
      fail(403, "FORBIDDEN", "Foreign operator scope");
    const operatorId = platform ? requested : auth.operatorId;
    if (operatorId && !(await M.Operator.exists({ _id: operatorId })))
      fail(404, "NOT_FOUND", "Operator not found");
    return operatorId ? { operatorId } : {};
  }
  router.get(
    "/issues",
    asyncRoute(async (req, res) => {
      const q = query.parse(req.query),
        scope = await owner(req.auth, q.operatorId);
      const finance = req.auth.permissions.includes(
        platform ? "platform:finance:read" : "finance:read",
      );
      const filter = {
        ...scope,
        ...(q.tripId ? { tripId: q.tripId } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(!finance ? { category: { $ne: "Finance" } } : {}),
        ...(q.search
          ? {
              code: {
                $regex: q.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
                $options: "i",
              },
            }
          : {}),
        ...(q.from || q.to
          ? {
              lastSeenAt: {
                ...(q.from
                  ? { $gte: new Date(q.from + "T00:00:00+05:30") }
                  : {}),
                ...(q.to
                  ? {
                      $lt: new Date(
                        +new Date(q.to + "T00:00:00+05:30") + 86400000,
                      ),
                    }
                  : {}),
              },
            }
          : {}),
      };
      const total = await OperationalIssue.countDocuments(filter);
      ok(
        res,
        await OperationalIssue.find(filter)
          .select(
            "operatorId tripId code category resourceId status firstSeenAt lastSeenAt resolvedAt",
          )
          .sort({ lastSeenAt: -1, _id: 1 })
          .skip((q.page - 1) * q.limit)
          .limit(q.limit)
          .lean(),
        {
          total,
          page: q.page,
          limit: q.limit,
          pages: Math.max(1, Math.ceil(total / q.limit)),
        },
      );
    }),
  );
  router.get(
    "/trips/:id/integrity",
    asyncRoute(async (req, res) => {
      const q = query.parse(req.query),
        scope = await owner(req.auth, q.operatorId);
      if (!scope.operatorId)
        fail(400, "OPERATOR_REQUIRED", "Choose an operator");
      ok(
        res,
        await inspectTripIntegrity(
          String(scope.operatorId),
          id.parse(req.params.id),
          config.OPS_STUCK_MS,
        ),
      );
    }),
  );
  if (platform) {
    router.get(
      "/health",
      asyncRoute(async (_req, res) => {
        let ready = false;
        try {
          ready = await readiness();
        } catch {
          /* Fail closed without leaking connectivity details. */
        }
        const jobs: any[] = await OperationalJob.find()
          .select(
            "key state heartbeatAt leaseUntil nextRunAt lastStartedAt lastSucceededAt lastFailedAt lastCode failures",
          )
          .lean();
        ok(res, {
          dependenciesReady: ready,
          mongoConnected: mongoose.connection.readyState === 1,
          thresholds: {
            slowRequestMs: config.OPS_SLOW_MS,
            stuckBookingMs: config.OPS_STUCK_MS,
            workerLagMs: config.OPS_JOB_LAG_MS,
          },
          realtime: realtimeMetrics(),
          metrics: requestMetrics(),
          jobs: jobs.map((j) => ({
            ...j,
            overdue:
              j.state === "Running"
                ? +new Date(j.leaseUntil) < Date.now()
                : Date.now() - +new Date(j.nextRunAt) > config.OPS_JOB_LAG_MS,
          })),
          monitoring:
            "Application-local diagnostics; no external alert delivery configured",
        });
      }),
    );
    router.get(
      "/jobs",
      asyncRoute(async (req, res) => {
        const q = query.parse(req.query),
          filter = q.search ? { jobKey: literalRegex(q.search) } : {};
        const total = await OperationalJobRun.countDocuments(filter);
        ok(
          res,
          await OperationalJobRun.find(filter)
            .select("jobKey status startedAt finishedAt code")
            .sort({ startedAt: -1 })
            .skip((q.page - 1) * q.limit)
            .limit(q.limit)
            .lean(),
          {
            total,
            page: q.page,
            limit: q.limit,
            pages: Math.max(1, Math.ceil(total / q.limit)),
          },
        );
      }),
    );
    router.post(
      "/jobs/:id/rearm",
      asyncRoute(async (req, res) => {
        platformPermit(req.auth, "platform:settings:write");
        const input = z
          .object({
            reason: z.string().trim().min(5).max(240),
            password: z.string().min(1).max(128),
          })
          .strict()
          .parse(req.body);
        await verifyPlatformAction(req.auth, input.password);
        await mongoose.connection.transaction(async (session) => {
          const job = await OperationalJob.findOneAndUpdate(
            { _id: id.parse(req.params.id), state: "Manual review" },
            {
              $set: { state: "Idle", failures: 0, nextRunAt: new Date() },
              $unset: { token: 1, leaseUntil: 1 },
            },
            { new: true, session },
          );
          if (!job)
            fail(409, "JOB_STATE", "Only manual-review jobs may be rearmed");
          await platformAudit(
            req.auth,
            "operations.job-rearmed",
            String(job!._id),
            input.reason,
            session,
          );
        });
        ok(res, { rearmed: true });
      }),
    );
  }
  for (const csv of [true, false])
    router.get(
      csv ? "/reports/:name.csv" : "/reports/:name",
      asyncRoute(async (req, res) => {
        if (platform) platformPermit(req.auth, "platform:reports:read");
        const q = query.parse(req.query),
          scope = await owner(req.auth, q.operatorId);
        if (!scope.operatorId || !q.from || !q.to)
          fail(
            400,
            "PERIOD_REQUIRED",
            "Choose an operator and complete date range",
          );
        const report = await operationalReport(
          {
            ...req.auth,
            operatorId: String(scope.operatorId),
            permissions: req.auth.permissions.includes("platform:finance:read")
              ? [...req.auth.permissions, "finance:read"]
              : req.auth.permissions,
          },
          String(req.params.name),
          { ...q, from: q.from!, to: q.to! },
          csv,
        );
        if (csv)
          res
            .type("text/csv")
            .attachment("aibus-operations.csv")
            .send(
              csvDocument([
                report.columns,
                ...report.rows.map((row) => report.columns.map((c) => row[c])),
              ]),
            );
        else ok(res, report.rows, report);
      }),
    );
  router.get(
    "/trips/:id/incidents",
    asyncRoute(async (req, res) => {
      const q = query.parse(req.query),
        scope = await owner(req.auth, q.operatorId);
      if (
        !scope.operatorId ||
        !(await M.Trip.exists({ _id: id.parse(req.params.id), ...scope }))
      )
        fail(404, "NOT_FOUND", "Trip not found");
      ok(
        res,
        await TripIncident.find({ ...scope, tripId: req.params.id })
          .select("kind reason at actorId")
          .sort({ at: -1 })
          .limit(100)
          .lean(),
      );
    }),
  );
  if (!platform)
    router.post(
      "/trips/:id/incidents",
      asyncRoute(async (req, res) => {
        if (!req.auth.permissions.includes("routes:write"))
          fail(403, "FORBIDDEN", "Trip operation permission required");
        const input = z
            .object({
              kind: z.enum(["Delay", "Breakdown", "Safety", "Other"]),
              reason: z.string().trim().min(5).max(240),
              at: z.string().datetime({ offset: true }),
            })
            .strict()
            .parse(req.body),
          tripId = id.parse(req.params.id),
          scope = await owner(req.auth),
          requestKey = z
            .string()
            .min(16)
            .max(100)
            .parse(req.get("Idempotency-Key")),
          requestHash = createHash("sha256")
            .update(JSON.stringify({ tripId, input }))
            .digest("hex");
        if (new Date(input.at) > new Date())
          fail(400, "INCIDENT_TIME", "Incident cannot be in the future");
        let result: any;
        await mongoose.connection.transaction(async (session) => {
          const prior = await TripIncident.findOne({
            ...scope,
            requestKey,
          }).session(session);
          if (prior) {
            if (prior.requestHash !== requestHash)
              fail(
                409,
                "IDEMPOTENCY_CONFLICT",
                "Incident request key has different content",
              );
            result = prior;
            return;
          }
          if (
            !(await M.Trip.exists({
              _id: tripId,
              ...scope,
              inventoryOwner: "internal",
            }).session(session))
          )
            fail(404, "NOT_FOUND", "Owned internal trip not found");
          [result] = await TripIncident.create(
            [
              {
                ...scope,
                tripId,
                ...input,
                actorId: req.auth.userId,
                requestKey,
                requestHash,
              },
            ],
            { session },
          );
          await M.Audit.create(
            [
              {
                ...scope,
                actorId: req.auth.userId,
                action: "trip.incident",
                resourceId: String(result._id),
                requestId: req.requestId,
                metadata: { reason: input.reason },
                expiresAt: null,
              },
            ],
            { session },
          );
        });
        ok(res, result, undefined, 201);
      }),
    );
  return router;
}
