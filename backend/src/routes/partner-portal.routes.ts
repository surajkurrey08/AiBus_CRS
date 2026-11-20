import { Router } from "express";
import { z } from "zod";
import * as M from "../models/index.js";
import * as P from "../models/public-api.model.js";
import type { Config } from "../config/env.js";
import {
  authenticate,
  rateLimit,
  type Limiter,
} from "../middleware/auth.middleware.js";
import { asyncRoute, ok, fail, literalRegex } from "../utils/core.js";
import * as S from "../services/partner-portal.service.js";
import * as V from "../validators/partner-portal.schemas.js";
import { publicApiSpec } from "../docs/public-api.openapi.js";
import { sandboxReady } from "../services/public-auth.service.js";
import {
  executePlayground,
  playgroundInput,
  playgroundOperations,
} from "../services/partner-playground.service.js";
import { platformPermit } from "../services/platform-read.service.js";
import { checkPassword } from "../services/auth.service.js";
const oid = z.string().regex(/^[a-f\d]{24}$/i),
  pid = z.string().regex(/^[a-z]+_[\w-]{16,100}$/);
const review = z.object(V.secretReview).strict();
const metadata =
  "publicId label scopes expiresAt revokedAt lastUsedAt createdAt";
const slice = async (model: any, filter: any, q: any, select?: string) => ({
  data: await model
    .find(filter)
    .select(select || "")
    .sort({ createdAt: -1, _id: -1 })
    .skip((q.page - 1) * q.limit)
    .limit(q.limit)
    .lean(),
  meta: {
    page: q.page,
    limit: q.limit,
    total: await model.countDocuments(filter),
  },
});
function send(res: any, value: any) {
  ok(res, value.data, value.meta);
}
export function partnerPortalRouter(config: Config, limiter: Limiter) {
  const r = Router();
  r.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  r.post(
    "/applications",
    rateLimit(limiter, "partner-register", 5, 3600),
    asyncRoute(async (req, res) =>
      ok(
        res,
        await S.registerApplication(V.applicationInput.parse(req.body)),
        undefined,
        201,
      ),
    ),
  );
  r.post(
    "/applications/:id/submit",
    rateLimit(limiter, "partner-submit", 10, 3600),
    asyncRoute(async (req, res) => {
      const body = z
        .object({ submissionToken: z.string().regex(/^[a-f\d]{64}$/) })
        .strict()
        .parse(req.body);
      ok(
        res,
        await S.submitApplication(
          pid.parse(req.params.id),
          body.submissionToken,
        ),
      );
    }),
  );
  r.use(authenticate(config));
  const member = async (req: any, permission: string) =>
    (await S.portalMember(req.auth, permission)).partner;
  r.get(
    "/overview",
    asyncRoute(async (req, res) => {
      const p = await member(req, "partner:overview");
      let available = true;
      try {
        sandboxReady(config);
      } catch {
        available = false;
      }
      const usage = await S.usageSummary(String(p._id), {}),
        inventory = await S.inventoryView(config, p);
      ok(res, {
        name: p.name,
        status: p.onboardingStatus,
        environment: "sandbox",
        sandboxAvailable: available,
        productionAvailable: false,
        usage,
        authorizedOperators: new Set(
          inventory.grants.filter((g) => g.active).map((g) => g.operator),
        ).size,
        authorizedTrips: inventory.trips.length,
        bookings: await P.PartnerBookingReference.countDocuments({
          partnerId: p._id,
        }),
        webhooks: await P.PartnerWebhookDelivery.aggregate([
          { $match: { partnerId: p._id } },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ]),
        activity: await M.Audit.find({
          "metadata.partnerId": String(p._id),
          action: /^partner\./,
        })
          .select("action createdAt resourceId")
          .sort({ createdAt: -1 })
          .limit(10)
          .lean(),
      });
    }),
  );
  r.get(
    "/credentials",
    asyncRoute(async (req, res) => {
      const p = await member(req, "partner:credentials:read");
      send(
        res,
        await slice(
          P.ApiCredential,
          { partnerId: p._id, portalManaged: false },
          V.listQuery.parse(req.query),
          metadata,
        ),
      );
    }),
  );
  r.post(
    "/credentials",
    asyncRoute(async (req, res) =>
      ok(
        res,
        await S.issuePortalCredential(
          config,
          req.auth,
          V.credentialInput.parse(req.body),
        ),
        undefined,
        201,
      ),
    ),
  );
  r.post(
    "/credentials/:id/revoke",
    asyncRoute(async (req, res) =>
      ok(
        res,
        await S.revokePortalCredential(
          req.auth,
          pid.parse(req.params.id),
          review.parse(req.body),
        ),
      ),
    ),
  );
  r.get(
    "/inventory",
    asyncRoute(async (req, res) =>
      ok(
        res,
        await S.inventoryView(config, await member(req, "partner:inventory")),
      ),
    ),
  );
  r.get(
    "/documentation",
    asyncRoute(async (req, res) => {
      await member(req, "partner:docs");
      ok(res, publicApiSpec);
    }),
  );
  r.get(
    "/playground",
    asyncRoute(async (req, res) => {
      await member(req, "partner:playground");
      ok(res, playgroundOperations);
    }),
  );
  r.post(
    "/playground",
    asyncRoute(async (req, res) =>
      ok(
        res,
        await executePlayground(
          config,
          limiter,
          req,
          playgroundInput.parse(req.body),
        ),
      ),
    ),
  );
  r.get(
    "/usage/summary",
    asyncRoute(async (req, res) => {
      const p = await member(req, "partner:analytics");
      ok(
        res,
        await S.usageSummary(String(p._id), V.listQuery.parse(req.query)),
      );
    }),
  );
  r.get(
    "/usage/export",
    asyncRoute(async (req, res) => {
      const p = await member(req, "partner:export");
      res
        .type("text/csv")
        .attachment("sandbox-api-usage.csv")
        .send(await S.usageCsv(String(p._id), V.listQuery.parse(req.query)));
    }),
  );
  r.get(
    "/usage",
    asyncRoute(async (req, res) => {
      const p = await member(req, "partner:analytics"),
        q = V.listQuery.parse(req.query);
      send(
        res,
        await slice(
          P.PartnerApiUsage,
          S.usageFilter(String(p._id), q),
          q,
          "requestId operation status durationMs createdAt",
        ),
      );
    }),
  );
  r.get(
    "/bookings",
    asyncRoute(async (req, res) => {
      const p = await member(req, "partner:bookings"),
        q = V.listQuery.parse(req.query),
        value = await S.portalBookings(String(p._id), q);
      ok(res, value.data, { page: q.page, limit: q.limit, total: value.total });
    }),
  );
  r.get(
    "/bookings/:id",
    asyncRoute(async (req, res) => {
      const p = await member(req, "partner:bookings"),
        ref = await P.PartnerBookingReference.findOne({
          publicId: pid.parse(req.params.id),
          partnerId: p._id,
        }).lean();
      if (!ref) fail(404, "NOT_FOUND", "Owned booking not found");
      const { bookingView } =
        await import("../services/public-booking.service.js");
      const value: any = await bookingView(S.portalIdentity(p), ref!.publicId);
      if (req.auth.permissions.includes("partner:passengers" as any)) {
        const b: any = await M.Booking.findOne({
          _id: ref!.bookingId,
          operatorId: ref!.operatorId,
        })
          .select("passengers")
          .lean();
        value.passengers = b?.passengers?.map((p: any) => ({
          name: p.name,
          seat: p.seat,
        }));
      }
      ok(res, value);
    }),
  );
  r.get(
    "/webhooks",
    asyncRoute(async (req, res) => {
      const p = await member(req, "partner:webhooks:read");
      send(
        res,
        await slice(
          P.PartnerWebhookSubscription,
          { partnerId: p._id },
          V.listQuery.parse(req.query),
          "publicId url active signingVersion createdAt",
        ),
      );
    }),
  );
  r.post(
    "/webhooks",
    asyncRoute(async (req, res) =>
      ok(
        res,
        await S.manageWebhook(
          config,
          req.auth,
          undefined,
          V.webhookInput.parse(req.body),
        ),
        undefined,
        201,
      ),
    ),
  );
  r.post(
    "/webhooks/:id",
    asyncRoute(async (req, res) =>
      ok(
        res,
        await S.manageWebhook(
          config,
          req.auth,
          pid.parse(req.params.id),
          V.webhookAction.parse(req.body),
        ),
      ),
    ),
  );
  r.get(
    "/deliveries",
    asyncRoute(async (req, res) => {
      const p = await member(req, "partner:webhooks:read"),
        q = V.listQuery.parse(req.query);
      send(
        res,
        await slice(
          P.PartnerWebhookDelivery,
          { partnerId: p._id, ...(q.status ? { status: q.status } : {}) },
          q,
          "status attempts retryLimit nextAttemptAt lastCode createdAt",
        ),
      );
    }),
  );
  r.post(
    "/deliveries/:id/retry",
    asyncRoute(async (req, res) =>
      ok(
        res,
        await S.retryDelivery(
          req.auth,
          oid.parse(req.params.id),
          review.parse(req.body),
        ),
      ),
    ),
  );
  r.get(
    "/team",
    asyncRoute(async (req, res) => {
      const p = await member(req, "partner:team:read");
      send(
        res,
        await slice(
          M.User,
          { partnerId: p._id, role: "partner" },
          V.listQuery.parse(req.query),
          "name email partnerRole active createdAt",
        ),
      );
    }),
  );
  r.post(
    "/team",
    asyncRoute(async (req, res) =>
      ok(
        res,
        await S.teamCreate(req.auth, V.teamInput.parse(req.body)),
        undefined,
        201,
      ),
    ),
  );
  r.post(
    "/team/:id",
    asyncRoute(async (req, res) =>
      ok(
        res,
        await S.teamUpdate(
          req.auth,
          oid.parse(req.params.id),
          V.teamChange.parse(req.body),
        ),
      ),
    ),
  );
  r.get(
    "/settings",
    asyncRoute(async (req, res) => {
      const p = await member(req, "partner:overview");
      ok(res, {
        name: p.name,
        contactPerson: p.contactPerson,
        businessEmail: p.businessEmail,
        phone: p.phone,
        address: p.address,
        technicalEmail: p.technicalEmail,
        intendedUsage: p.intendedUsage,
        requestedEnvironment: p.requestedEnvironment,
        environment: "sandbox",
        productionAccess: false,
      });
    }),
  );
  r.post(
    "/settings",
    asyncRoute(async (req, res) => {
      const p = await member(req, "partner:settings:write"),
        input = z
          .object({
            ...V.secretReview,
            name: z.string().trim().min(2).max(150),
            contactPerson: z.string().trim().min(2).max(150),
            phone: z.string().trim().min(2).max(30),
            address: z.string().trim().min(2).max(500),
            technicalEmail: z.string().email().max(254),
          })
          .strict()
          .parse(req.body);
      const u: any = await M.User.findById(req.auth.userId)
        .select("+passwordHash")
        .lean();
      if (!(await checkPassword(input.password, u.passwordHash)))
        fail(403, "STEP_UP_REQUIRED", "Verify your current password");
      // Use the same reviewed, serialized command path as credential/team operations.
      ok(res, await S.updatePartnerSettings(req.auth, String(p._id), input));
    }),
  );
  r.get(
    "/support",
    asyncRoute(async (req, res) => {
      const p = await member(req, "partner:support:read");
      send(
        res,
        await slice(
          M.PartnerSupport,
          { partnerId: p._id },
          V.listQuery.parse(req.query),
          "subject message status response createdAt",
        ),
      );
    }),
  );
  r.post(
    "/support",
    asyncRoute(async (req, res) => {
      const p = await member(req, "partner:support:write"),
        v = z
          .object({
            subject: z.string().trim().min(3).max(150),
            message: z.string().trim().min(5).max(2000),
            key: z.string().regex(/^[\w:-]{16,100}$/),
          })
          .strict()
          .parse(req.body);
      ok(
        res,
        await S.createSupport(req.auth, String(p._id), v),
        undefined,
        201,
      );
    }),
  );
  r.get(
    "/integration-status",
    asyncRoute(async (req, res) => {
      const p = await member(req, "partner:overview");
      let ready = true;
      try {
        sandboxReady(config);
      } catch {
        ready = false;
      }
      ok(res, {
        approval: p.onboardingStatus,
        environment: "sandbox",
        sandboxReady: ready,
        productionAccess: false,
        activeCredentials: await P.ApiCredential.countDocuments({
          partnerId: p._id,
          portalManaged: false,
          revokedAt: null,
          expiresAt: { $gt: new Date() },
        }),
        activeGrants: await P.PartnerInventoryGrant.countDocuments({
          partnerId: p._id,
          active: true,
          expiresAt: { $gt: new Date() },
        }),
        webhookSigningConfigured: !!config.PUBLIC_WEBHOOK_SIGNING_KEY,
        liveFunding: false,
        rescheduling: false,
        mfaSupported: false,
        scenarioGuide:
          "Use the documented isolated sandbox fixture and Phase 7 contracts; no live inventory or funds are accessible.",
      });
    }),
  );
  return r;
}
export function platformPartnersRouter(config: Config) {
  const r = Router();
  r.use(authenticate(config));
  r.use((req, res, next) => {
    platformPermit(req.auth, "platform:partners:read");
    res.set("Cache-Control", "no-store");
    next();
  });
  r.get(
    "/",
    asyncRoute(async (req, res) => {
      const q = V.listQuery.parse(req.query);
      send(
        res,
        await slice(
          P.ApiPartner,
          {
            ...(q.search ? { name: literalRegex(q.search) } : {}),
            ...(q.status ? { onboardingStatus: q.status } : {}),
          },
          q,
          "publicId name onboardingStatus businessEmail requestedEnvironment requestsPerMinute revision createdAt",
        ),
      );
    }),
  );
  r.get(
    "/:id",
    asyncRoute(async (req, res) => {
      const id = oid.parse(req.params.id),
        p = await P.ApiPartner.findById(id)
          .select("-submissionTokenHash")
          .lean();
      if (!p) fail(404, "NOT_FOUND", "Partner not found");
      ok(res, {
        partner: p,
        credentials: await P.ApiCredential.find({
          partnerId: id,
          portalManaged: false,
        })
          .select(metadata)
          .limit(100)
          .lean(),
        inventory: await S.inventoryView(config, p),
        usage: await S.usageSummary(id, {}),
        bookings: await S.portalBookings(id, { page: 1, limit: 25 }),
        failures: await P.PartnerWebhookDelivery.find({
          partnerId: id,
          status: "Manual review",
        })
          .select("status attempts lastCode createdAt")
          .limit(25)
          .lean(),
        audit: await M.Audit.find({ "metadata.partnerId": id })
          .select("action resourceId createdAt actorId metadata.reason")
          .sort({ createdAt: -1 })
          .limit(50)
          .lean(),
        support: await M.PartnerSupport.find({ partnerId: id })
          .select("subject message status response createdAt")
          .limit(25)
          .lean(),
        productionAccess: false,
      });
    }),
  );
  r.post(
    "/:id/review",
    asyncRoute(async (req, res) =>
      ok(
        res,
        await S.reviewPartner(
          req.auth,
          oid.parse(req.params.id),
          V.reviewInput.parse(req.body),
        ),
      ),
    ),
  );
  r.post(
    "/:id/grants",
    asyncRoute(async (req, res) =>
      ok(
        res,
        await S.manageGrant(
          config,
          req.auth,
          oid.parse(req.params.id),
          V.grantInput.parse(req.body),
        ),
      ),
    ),
  );
  r.post(
    "/:id/credentials/:credential/revoke",
    asyncRoute(async (req, res) =>
      ok(
        res,
        await S.revokePortalCredential(
          req.auth,
          pid.parse(req.params.credential),
          review.parse(req.body),
          oid.parse(req.params.id),
        ),
      ),
    ),
  );
  r.post(
    "/:id/support/:support",
    asyncRoute(async (req, res) =>
      ok(
        res,
        await S.respondSupport(
          req.auth,
          oid.parse(req.params.id),
          oid.parse(req.params.support),
          z
            .object({
              ...V.secretReview,
              response: z.string().trim().min(2).max(2000),
              status: z.enum(["In review", "Resolved"]),
            })
            .strict()
            .parse(req.body),
        ),
      ),
    ),
  );
  return r;
}
