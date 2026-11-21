import mongoose from "mongoose";
import type { Request } from "express";
import { z } from "zod";
import type { Config } from "../config/env.js";
import type { Limiter } from "../middleware/auth.middleware.js";
import * as M from "../models/index.js";
import * as P from "../models/public-api.model.js";
import * as V from "../validators/partner-portal.schemas.js";
import { fail } from "../utils/core.js";
import { checkPassword, hashToken } from "./auth.service.js";
import { partnerRolePermissions } from "../types/partner-portal.js";
import * as S from "./partner-portal.service.js";
import { bridgeCall, sourceEntitlement } from "./sandbox-bridge.transport.js";
import {
  generateCredential,
  publicIndexesReady,
  sandboxReady,
} from "./public-auth.service.js";
import {
  executePartnerPlayground,
  playgroundInput,
} from "./partner-playground.service.js";

const id = "[a-z]+_[\\w-]{16,100}";
export function sandboxPortalOperation(method: string, path: string) {
  if (method === "GET") {
    const permissions: Record<string, string> = {
      "/overview": "partner:overview",
      "/integration-status": "partner:overview",
      "/credentials": "partner:credentials:read",
      "/inventory": "partner:inventory",
      "/usage/summary": "partner:analytics",
      "/usage": "partner:analytics",
      "/usage/export": "partner:export",
      "/bookings": "partner:bookings",
    };
    if (permissions[path]) return permissions[path];
    if (new RegExp(`^/bookings/${id}$`).test(path)) return "partner:bookings";
  }
  if (method === "POST") {
    if (
      path === "/credentials" ||
      new RegExp(`^/credentials/${id}/revoke$`).test(path)
    )
      return "partner:credentials:write";
    if (path === "/playground") return "partner:playground";
  }
  return null;
}
export const bridgeInput = z
  .object({
    method: z.enum(["GET", "POST"]),
    path: z.string().max(150),
    query: z.record(z.string().max(500)).default({}),
    body: z.unknown().default({}),
  })
  .strict();

export async function controlEntitlement(
  sourcePublicId: string,
  actorId: string,
) {
  const partner: any = await P.ApiPartner.findOne({
    publicId: sourcePublicId,
    status: "Active",
    onboardingStatus: "Approved",
  }).lean();
  const user: any =
    partner &&
    (await M.User.findOne({
      _id: actorId,
      partnerId: partner._id,
      role: "partner",
      active: true,
    }).lean());
  if (!partner || !user)
    fail(
      403,
      "PARTNER_PERMISSION",
      "Partner or member is suspended, inactive or unavailable",
    );
  return {
    name: partner.name,
    scopes: partner.scopes,
    requestsPerMinute: partner.requestsPerMinute,
    permissions: [...(partnerRolePermissions[user.partnerRole] || [])],
  };
}

export async function forwardSandboxPortal(config: Config, req: Request) {
  const permission = sandboxPortalOperation(req.method, req.path);
  if (!permission)
    fail(404, "NOT_FOUND", "Unsupported sandbox portal operation");
  const { partner } = await S.portalMember(req.auth, permission!);
  let body: any = req.body || {};
  if (req.method === "POST" && req.path.startsWith("/credentials")) {
    const reviewed =
      req.path === "/credentials"
        ? V.credentialInput.parse(body)
        : z.object(V.secretReview).strict().parse(body);
    if (
      "scopes" in reviewed &&
      (reviewed.scopes as string[]).includes("tickets:read")
    )
      await S.portalMember(req.auth, "partner:passengers");
    const user: any = await M.User.findById(req.auth.userId)
      .select("+passwordHash")
      .lean();
    if (!user || !(await checkPassword(reviewed.password, user.passwordHash)))
      fail(403, "STEP_UP_REQUIRED", "Verify your current password");
    const { password: _password, ...sanitized } = reviewed;
    body = sanitized; // Passwords and dashboard tokens stay on the control plane.
  } else if (req.method === "POST") {
    body = playgroundInput.parse(body);
    if (body.operationId === "ticket")
      await S.portalMember(req.auth, "partner:passengers");
  }
  const query = req.method === "GET" ? V.listQuery.parse(req.query) : {};
  return bridgeCall(
    config,
    config.SANDBOX_PORTAL_URL!,
    "execute",
    partner.publicId,
    req.auth.userId,
    {
      method: req.method,
      path: req.path,
      query: Object.fromEntries(
        Object.entries(query).map(([k, v]) => [k, String(v)]),
      ),
      body,
    },
  );
}

export async function executeSandboxPortal(
  config: Config,
  limiter: Limiter,
  req: Request,
  sourcePublicId: string,
  actorId: string,
  raw: unknown,
) {
  sandboxReady(config);
  await publicIndexesReady();
  const input = bridgeInput.parse(raw),
    permission = sandboxPortalOperation(input.method, input.path);
  if (!permission)
    fail(404, "NOT_FOUND", "Unsupported sandbox portal operation");
  const source = await sourceEntitlement(
    config,
    { portalSourcePublicId: sourcePublicId },
    actorId,
  );
  if (!source.permissions?.includes(permission!))
    fail(
      403,
      "PARTNER_PERMISSION",
      "Organization role cannot perform that action",
    );
  let partner: any = await P.ApiPartner.findOne({
    publicId: sourcePublicId,
  }).lean();
  if (partner && partner.portalSourcePublicId !== sourcePublicId)
    fail(
      409,
      "SANDBOX_PARTNER_CONFLICT",
      "Sandbox identity requires administrator review",
    );
  // No production operators, passengers, bookings or inventory grants are copied.
  if (!partner) {
    try {
      partner = (
        await P.ApiPartner.create({
          publicId: sourcePublicId,
          portalSourcePublicId: sourcePublicId,
          name: source.name,
          scopes: source.scopes,
          requestsPerMinute: source.requestsPerMinute,
          status: "Active",
          onboardingStatus: "Approved",
        })
      ).toObject();
    } catch (error: any) {
      if (error.code !== 11000) throw error;
      partner = await P.ApiPartner.findOne({
        publicId: sourcePublicId,
        portalSourcePublicId: sourcePublicId,
      }).lean();
    }
  }
  if (!partner || partner.status !== "Active")
    fail(403, "PARTNER_PERMISSION", "Sandbox organization is unavailable");
  partner = {
    ...partner,
    scopes: partner.scopes.filter((s: string) => source.scopes.includes(s)),
  };
  const q =
    input.method === "GET"
      ? V.listQuery.parse(input.query)
      : V.listQuery.parse({});
  const partnerId = String(partner._id);
  if (input.method === "GET") {
    if (input.path === "/overview" || input.path === "/integration-status") {
      const inventory = await S.inventoryView(config, partner);
      const activeCredentials = await P.ApiCredential.countDocuments({
        partnerId,
        portalManaged: false,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      });
      const activeGrants = await P.PartnerInventoryGrant.countDocuments({
        partnerId,
        active: true,
        expiresAt: { $gt: new Date() },
      });
      if (input.path === "/integration-status")
        return {
          data: {
            approval: partner.onboardingStatus,
            environment: "sandbox",
            sandboxReady: true,
            productionAccess: false,
            activeCredentials,
            activeGrants,
            webhookSigningConfigured: !!config.PUBLIC_WEBHOOK_SIGNING_KEY,
            liveFunding: false,
            rescheduling: false,
            mfaSupported: false,
            scenarioGuide:
              "Use explicitly granted synthetic test trips. Production inventory and funding remain unavailable.",
          },
        };
      return {
        data: {
          name: source.name,
          status: partner.onboardingStatus,
          environment: "sandbox",
          sandboxAvailable: true,
          productionAvailable: false,
          usage: await S.usageSummary(partnerId, {}),
          authorizedOperators: new Set(
            inventory.grants.filter((g) => g.active).map((g) => g.operator),
          ).size,
          authorizedTrips: inventory.trips.length,
          bookings: await P.PartnerBookingReference.countDocuments({
            partnerId,
          }),
          webhooks: await P.PartnerWebhookDelivery.aggregate([
            { $match: { partnerId: partner._id } },
            { $group: { _id: "$status", count: { $sum: 1 } } },
          ]),
          activity: await M.Audit.find({ "metadata.partnerId": partnerId })
            .select("action createdAt resourceId")
            .sort({ createdAt: -1 })
            .limit(10)
            .lean(),
        },
      };
    }
    if (input.path === "/credentials")
      return {
        data: await P.ApiCredential.find({ partnerId, portalManaged: false })
          .select(
            "publicId label scopes expiresAt revokedAt lastUsedAt createdAt",
          )
          .sort({ createdAt: -1, _id: -1 })
          .skip((q.page - 1) * q.limit)
          .limit(q.limit)
          .lean(),
        meta: {
          page: q.page,
          limit: q.limit,
          total: await P.ApiCredential.countDocuments({
            partnerId,
            portalManaged: false,
          }),
        },
      };
    if (input.path === "/inventory")
      return { data: await S.inventoryView(config, partner) };
    if (input.path === "/usage/summary")
      return { data: await S.usageSummary(partnerId, q) };
    if (input.path === "/usage/export")
      return { csv: await S.usageCsv(partnerId, q) };
    if (input.path === "/usage") {
      const filter = S.usageFilter(partnerId, q);
      return {
        data: await P.PartnerApiUsage.find(filter)
          .select("requestId operation status durationMs createdAt")
          .sort({ createdAt: -1, _id: -1 })
          .skip((q.page - 1) * q.limit)
          .limit(q.limit)
          .lean(),
        meta: {
          page: q.page,
          limit: q.limit,
          total: await P.PartnerApiUsage.countDocuments(filter),
        },
      };
    }
    if (input.path === "/bookings") {
      const value = await S.portalBookings(partnerId, q);
      return {
        data: value.data,
        meta: { page: q.page, limit: q.limit, total: value.total },
      };
    }
    const { bookingView } = await import("./public-booking.service.js");
    return {
      data: await bookingView(
        S.portalIdentity(partner),
        input.path.split("/")[2],
      ),
    };
  }
  if (input.path === "/playground") {
    const body = playgroundInput.parse(input.body);
    if (
      body.operationId === "ticket" &&
      !source.permissions?.includes("partner:passengers")
    )
      fail(403, "PARTNER_PERMISSION", "Passenger access required");
    const clone = Object.create(req);
    clone.auth = { userId: actorId };
    const authorizedPartner = {
      ...partner,
      scopes: partner.scopes.filter(
        (s: string) =>
          s !== "tickets:read" ||
          source.permissions?.includes("partner:passengers"),
      ),
    };
    return {
      data: await executePartnerPlayground(
        config,
        limiter,
        clone,
        body,
        authorizedPartner,
      ),
    };
  }
  const schema =
    input.path === "/credentials"
      ? V.credentialInput.omit({ password: true })
      : z.object(V.secretReview).omit({ password: true }).strict();
  const body: any = schema.parse(input.body);
  if (
    body.scopes?.includes("tickets:read") &&
    !source.permissions?.includes("partner:passengers")
  )
    fail(403, "PARTNER_PERMISSION", "Passenger access required");
  if (body.scopes?.some((s: string) => !partner.scopes.includes(s)))
    fail(403, "PARTNER_SCOPE", "Scope is not approved for this organization");
  if (
    body.expiresAt &&
    (+new Date(body.expiresAt) < Date.now() + 60000 ||
      +new Date(body.expiresAt) > Date.now() + 90 * 86400000)
  )
    fail(
      400,
      "CREDENTIAL_EXPIRY",
      "Expiration must be between one minute and 90 days",
    );
  const action =
    input.path === "/credentials"
      ? "sandbox.credentials.issue"
      : "sandbox.credentials.revoke";
  const digest = hashToken(JSON.stringify({ path: input.path, body }));
  const data = await mongoose.connection.transaction(async (session) => {
    await P.ApiPartner.updateOne(
      { _id: partner._id },
      { $inc: { revision: 1 } },
      { session },
    );
    const previous = await P.PartnerCommand.findOne({
      partnerId,
      key: "bridge:" + body.key,
    }).session(session);
    if (previous)
      fail(
        409,
        previous.requestHash === digest
          ? "COMMAND_ALREADY_APPLIED"
          : "IDEMPOTENCY_CONFLICT",
        "This request key was already applied. Refresh credential metadata; secrets are shown only once.",
      );
    let result: any;
    if (action === "sandbox.credentials.revoke" || body.rotateId) {
      const credentialId = body.rotateId || input.path.split("/")[2];
      const updated = await P.ApiCredential.updateOne(
        {
          publicId: credentialId,
          partnerId,
          portalManaged: false,
          revokedAt: null,
        },
        { $set: { revokedAt: new Date() } },
        { session },
      );
      if (!updated.matchedCount)
        fail(404, "NOT_FOUND", "Owned active credential not found");
      result = { id: credentialId, revoked: true };
    }
    if (action === "sandbox.credentials.issue")
      result = await generateCredential(
        config,
        partnerId,
        body.scopes,
        new Date(body.expiresAt),
        { session, actorId, label: body.label },
      );
    await P.PartnerCommand.create(
      [
        {
          partnerId,
          key: "bridge:" + body.key,
          action,
          requestHash: digest,
          resourceId: result.id,
        },
      ],
      { session },
    );
    await M.Audit.create(
      [
        {
          actorId,
          action,
          resourceId: result.id,
          metadata: {
            partnerId,
            sourcePartnerPublicId: sourcePublicId,
            reason: body.reason,
          },
          expiresAt: null,
        },
      ],
      { session },
    );
    return result;
  });
  return { data };
}
