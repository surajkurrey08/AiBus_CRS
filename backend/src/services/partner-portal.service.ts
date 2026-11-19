import mongoose, { type ClientSession } from "mongoose";
import { randomBytes } from "node:crypto";
import * as M from "../models/index.js";
import * as P from "../models/public-api.model.js";
import type { Config } from "../config/env.js";
import { fail, literalRegex, type Principal } from "../utils/core.js";
import { checkPassword, hashPassword, hashToken } from "./auth.service.js";
import { partnerRolePermissions } from "../types/partner-portal.js";
import {
  generateCredential,
  publicIndexesReady,
  sandboxReady,
  publicId,
  type PartnerIdentity,
} from "./public-auth.service.js";
import { authorizedTrips } from "./public-inventory.service.js";
import { bookingView } from "./public-booking.service.js";
import { platformPermit } from "./platform-read.service.js";
import { verifyPlatformAction } from "./platform-admin.service.js";
import { webhookTarget, webhookSecret } from "./public-webhook.service.js";
import { csvDocument } from "./finance-export.service.js";

async function portalIndexesReady() {
  await publicIndexesReady();
  for (const model of [M.User, M.PartnerSupport]) {
    const installed = await model.collection.indexes().catch(() => []);
    for (const [keys, options] of model.schema.indexes())
      if (
        options.unique &&
        !installed.some(
          (i) =>
            i.unique &&
            !i.sparse &&
            JSON.stringify(i.key) === JSON.stringify(keys),
        )
      )
        fail(
          503,
          "PARTNER_INDEX_REQUIRED",
          "Review and provision additive partner uniqueness before making changes",
        );
  }
}

export async function portalMember(
  auth: Principal,
  permission: string,
  session?: ClientSession,
) {
  if (
    auth.role !== "partner" ||
    auth.operatorId ||
    auth.agentId ||
    !auth.partnerId
  )
    fail(403, "PARTNER_REQUIRED", "Partner organization login required");
  const user: any = await M.User.findOne({
    _id: auth.userId,
    partnerId: auth.partnerId,
    role: "partner",
    active: true,
  })
    .session(session || null)
    .lean();
  const partner = await P.ApiPartner.findOne({
    _id: auth.partnerId,
    status: "Active",
    onboardingStatus: "Approved",
  })
    .session(session || null)
    .lean();
  if (
    !partner ||
    !user ||
    !(partnerRolePermissions as any)[user.partnerRole]?.includes(permission)
  )
    fail(
      403,
      "PARTNER_PERMISSION",
      "This organization role cannot perform that action",
    );
  return { user, partner: partner! };
}
export const portalIdentity = (partner: any): PartnerIdentity => ({
  partnerId: String(partner._id),
  publicId: partner.publicId,
  credentialId: "",
  environment: "sandbox",
  scopes: partner.scopes,
});
async function audit(
  auth: Principal,
  action: string,
  resourceId: string,
  reason: string,
  session: ClientSession,
  partnerId = auth.partnerId!,
) {
  await M.Audit.create(
    [
      {
        actorId: auth.userId,
        action: "partner." + action,
        resource: "ApiPartner",
        resourceId,
        metadata: { partnerId, reason },
        expiresAt: null,
      },
    ],
    { session },
  );
}
async function command(
  auth: Principal,
  partnerId: string,
  action: string,
  input: any,
  work: (session: ClientSession) => Promise<any>,
  admin = false,
) {
  await portalIndexesReady();
  if (admin) {
    platformPermit(auth, "platform:partners:write");
    await verifyPlatformAction(auth, input.password);
  } else {
    const { user } = await portalMember(auth, action);
    const passwordUser: any = await M.User.findById(user._id)
      .select("+passwordHash")
      .lean();
    if (!(await checkPassword(input.password, passwordUser.passwordHash)))
      fail(403, "STEP_UP_REQUIRED", "Verify your current password");
  }
  const digest = hashToken(
    JSON.stringify({
      ...input,
      password: undefined,
      // Password material must not become a fast offline-verification digest.
      // A completed key can never create another user or change their password.
      initialPassword: undefined,
    }),
  );
  return mongoose.connection.transaction(async (session) => {
    if (!admin) {
      await portalMember(auth, action, session);
      const currentSession = await M.Session.exists({
        _id: auth.sessionId,
        userId: auth.userId,
        client: "partner",
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      }).session(session);
      if (!currentSession)
        fail(
          401,
          "SESSION_REVOKED",
          "Sign in again before changing your organization",
        );
      await M.User.updateOne(
        { _id: auth.userId, active: true },
        { $inc: { __v: 1 } },
        { session },
      );
    }
    const org = await P.ApiPartner.findOneAndUpdate(
      {
        _id: partnerId,
        ...(!admin ? { status: "Active", onboardingStatus: "Approved" } : {}),
      },
      { $inc: { revision: 1 } },
      { session, new: true },
    );
    if (!org) fail(404, "NOT_FOUND", "Organization not found");
    const old = await P.PartnerCommand.findOne({
      partnerId,
      key: "portal:" + input.key,
    }).session(session);
    if (old) {
      if (old.action !== action || old.requestHash !== digest)
        fail(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Request key was used for another command",
        );
      fail(
        409,
        "COMMAND_ALREADY_APPLIED",
        "This reviewed command already completed. Refresh its metadata; secrets cannot be retrieved again.",
      );
    }
    await P.PartnerCommand.create(
      [
        {
          partnerId,
          key: "portal:" + input.key,
          action,
          requestHash: digest,
          resourceId: org!.publicId,
        },
      ],
      { session },
    );
    const result = await work(session);
    await audit(
      auth,
      action,
      typeof result?.id === "string" ? result.id : org!.publicId,
      input.reason,
      session,
      partnerId,
    );
    return result;
  });
}
export async function registerApplication(input: any) {
  await portalIndexesReady();
  const { password, submit, ...company } = input;
  const passwordHash = await hashPassword(password),
    token = randomBytes(32).toString("hex");
  return mongoose.connection.transaction(async (session) => {
    const [partner] = await P.ApiPartner.create(
      [
        {
          ...company,
          publicId: publicId("partner"),
          status: "Suspended",
          onboardingStatus: submit ? "Submitted" : "Draft",
          scopes: [],
          submissionTokenHash: hashToken(token),
          submissionExpiresAt: new Date(Date.now() + 86400000),
        },
      ],
      { session },
    );
    await M.User.create(
      [
        {
          name: company.contactPerson,
          email: company.businessEmail,
          passwordHash,
          role: "partner",
          partnerId: partner._id,
          partnerRole: "Owner",
          active: false,
        },
      ],
      { session },
    );
    await M.Audit.create(
      [
        {
          action: "partner.application.created",
          resourceId: partner.publicId,
          metadata: {
            partnerId: String(partner._id),
            status: partner.onboardingStatus,
          },
          expiresAt: null,
        },
      ],
      { session },
    );
    return {
      id: partner.publicId,
      status: partner.onboardingStatus,
      ...(!submit ? { submissionToken: token } : {}),
    };
  });
}
export async function submitApplication(id: string, token: string) {
  return mongoose.connection.transaction(async (session) => {
    const p = await P.ApiPartner.findOneAndUpdate(
      {
        publicId: id,
        onboardingStatus: "Draft",
        submissionTokenHash: hashToken(token),
        submissionExpiresAt: { $gt: new Date() },
      },
      {
        $set: { onboardingStatus: "Submitted" },
        $unset: { submissionTokenHash: 1, submissionExpiresAt: 1 },
        $inc: { revision: 1 },
      },
      { new: true, session },
    );
    if (!p)
      fail(
        404,
        "APPLICATION_UNAVAILABLE",
        "Draft token is invalid, expired or already submitted",
      );
    await M.Audit.create(
      [
        {
          action: "partner.application.submitted",
          resourceId: id,
          metadata: { partnerId: String(p!._id) },
          expiresAt: null,
        },
      ],
      { session },
    );
    return { id, status: "Submitted" };
  });
}
export async function reviewPartner(auth: Principal, id: string, input: any) {
  return command(
    auth,
    id,
    "admin.review",
    input,
    async (session) => {
      const p = await P.ApiPartner.findById(id).session(session).lean();
      if (p!.revision !== input.version + 1)
        fail(
          409,
          "VERSION_CONFLICT",
          "Reload the current organization before reviewing",
        );
      const transitions: Record<string, string[]> = {
        Draft: ["Submitted"],
        Submitted: ["Under Review", "Approved", "Rejected"],
        "Under Review": ["Approved", "Rejected"],
        Approved: ["Suspended"],
        Suspended: ["Approved", "Rejected"],
        Rejected: ["Under Review"],
      };
      if (
        input.status &&
        input.status !== p!.onboardingStatus &&
        !transitions[p!.onboardingStatus]?.includes(input.status)
      )
        fail(409, "INVALID_TRANSITION", "Review transition is not allowed");
      const onboardingStatus = input.status || p!.onboardingStatus,
        status = onboardingStatus === "Approved" ? "Active" : "Suspended";
      const changed = await P.ApiPartner.updateOne(
        { _id: id, revision: input.version + 1 },
        {
          $set: {
            onboardingStatus,
            status,
            scopes: input.scopes || p!.scopes,
            requestsPerMinute: input.requestsPerMinute || p!.requestsPerMinute,
            reviewedBy: auth.userId,
            reviewReason: input.reason,
            reviewedAt: new Date(),
            ...(status === "Active" && !p!.portalActivatedAt
              ? { portalActivatedAt: new Date() }
              : {}),
          },
        },
        { session },
      );
      if (!changed.matchedCount)
        fail(409, "VERSION_CONFLICT", "Organization changed during review");
      if (status === "Active" && !p!.portalActivatedAt)
        await M.User.updateMany(
          { partnerId: id, role: "partner", partnerRole: "Owner" },
          { $set: { active: true } },
          { session },
        );
      if (status !== "Active") {
        const users = await M.User.find({ partnerId: id, role: "partner" })
          .select("_id")
          .session(session);
        await M.Session.updateMany(
          { userId: { $in: users.map((u) => u._id) }, revokedAt: null },
          { $set: { revokedAt: new Date() } },
          { session },
        );
        await P.ApiCredential.updateMany(
          { partnerId: id, revokedAt: null },
          { $set: { revokedAt: new Date() } },
          { session },
        );
      }
      return {
        id: p!.publicId,
        status: onboardingStatus,
        version: p!.revision,
      };
    },
    true,
  );
}
export async function issuePortalCredential(
  config: Config,
  auth: Principal,
  input: any,
) {
  const { partner } = await portalMember(auth, "partner:credentials:write");
  if (input.scopes.includes("tickets:read"))
    await portalMember(auth, "partner:passengers");
  sandboxReady(config);
  const expiresAt = new Date(input.expiresAt);
  if (
    +expiresAt < Date.now() + 60000 ||
    +expiresAt > Date.now() + 90 * 86400000
  )
    fail(
      400,
      "CREDENTIAL_EXPIRY",
      "Expiration must be between one minute and 90 days",
    );
  return command(
    auth,
    String(partner._id),
    "partner:credentials:write",
    input,
    async (session) => {
      if (input.scopes.includes("tickets:read"))
        await portalMember(auth, "partner:passengers", session);
      if (input.rotateId) {
        const old = await P.ApiCredential.findOneAndUpdate(
          {
            publicId: input.rotateId,
            partnerId: partner._id,
            portalManaged: false,
            revokedAt: null,
          },
          { $set: { revokedAt: new Date() } },
          { session },
        );
        if (!old) fail(404, "NOT_FOUND", "Active credential not found");
      }
      return generateCredential(
        config,
        String(partner._id),
        input.scopes,
        expiresAt,
        { session, actorId: auth.userId, label: input.label },
      );
    },
  );
}
export async function revokePortalCredential(
  auth: Principal,
  id: string,
  input: any,
  adminPartnerId?: string,
) {
  const partnerId =
    adminPartnerId ||
    (
      await portalMember(auth, "partner:credentials:write")
    ).partner._id.toString();
  return command(
    auth,
    partnerId,
    adminPartnerId ? "admin.credential.revoke" : "partner:credentials:write",
    input,
    async (session) => {
      const p = await P.ApiCredential.findOneAndUpdate(
        { publicId: id, partnerId, revokedAt: null },
        { $set: { revokedAt: new Date() } },
        { session },
      );
      if (!p) fail(404, "NOT_FOUND", "Active credential not found");
      return { revoked: true, id };
    },
    !!adminPartnerId,
  );
}
export async function teamCreate(auth: Principal, input: any) {
  const { partner, user } = await portalMember(auth, "partner:team:write");
  if (input.role === "Owner" && user.partnerRole !== "Owner")
    fail(403, "OWNER_REQUIRED", "Only an owner can appoint another owner");
  const passwordHash = await hashPassword(input.initialPassword);
  return command(
    auth,
    String(partner._id),
    "partner:team:write",
    input,
    async (session) => {
      const current = await portalMember(auth, "partner:team:write", session);
      if (input.role === "Owner" && current.user.partnerRole !== "Owner")
        fail(403, "OWNER_REQUIRED", "Only an owner can appoint another owner");
      const [u] = await M.User.create(
        [
          {
            name: input.name,
            email: input.email,
            passwordHash,
            role: "partner",
            partnerId: partner._id,
            partnerRole: input.role,
            active: true,
          },
        ],
        { session },
      );
      return { id: String(u._id), name: u.name, role: u.partnerRole };
    },
  );
}
export async function teamUpdate(auth: Principal, id: string, input: any) {
  const { partner, user } = await portalMember(auth, "partner:team:write");
  return command(
    auth,
    String(partner._id),
    "partner:team:write",
    input,
    async (session) => {
      const current = await portalMember(auth, "partner:team:write", session);
      const target: any = await M.User.findOne({
        _id: id,
        partnerId: partner._id,
        role: "partner",
      }).session(session);
      if (!target) fail(404, "NOT_FOUND", "Organization member not found");
      if (id === auth.userId)
        fail(
          409,
          "SELF_CHANGE_DENIED",
          "Another owner must review your role or deactivate your access",
        );
      if (
        (target.partnerRole === "Owner" || input.role === "Owner") &&
        current.user.partnerRole !== "Owner"
      )
        fail(403, "OWNER_REQUIRED", "Only owners can change owner membership");
      if (
        target.partnerRole === "Owner" &&
        (input.role !== "Owner" || !input.active) &&
        (await M.User.countDocuments({
          partnerId: partner._id,
          role: "partner",
          partnerRole: "Owner",
          active: true,
        }).session(session)) <= 1
      )
        fail(409, "LAST_OWNER", "Keep an active organization owner");
      target.partnerRole = input.role;
      target.active = input.active;
      await target.save({ session });
      await P.ApiCredential.updateMany(
        { partnerId: partner._id, createdBy: id, revokedAt: null },
        { $set: { revokedAt: new Date() } },
        { session },
      );
      await M.Session.updateMany(
        { userId: id, revokedAt: null },
        { $set: { revokedAt: new Date() } },
        { session },
      );
      return { updated: true, id };
    },
  );
}
export async function manageGrant(
  config: Config,
  auth: Principal,
  id: string,
  input: any,
) {
  sandboxReady(config);
  return command(
    auth,
    id,
    "admin.inventory.grant",
    input,
    async (session) => {
      const owner = await M.Operator.exists({
        _id: input.operatorId,
        status: "approved",
        publicSandboxInventory: true,
      }).session(session);
      if (!owner)
        fail(
          400,
          "SANDBOX_OPERATOR_REQUIRED",
          "Choose an approved explicitly sandbox-enabled operator",
        );
      const models: any = {
        Route: M.Route,
        Service: M.BusService,
        Trip: M.Trip,
      };
      if (
        input.kind === "Operator"
          ? input.targetId !== input.operatorId
          : !(await models[input.kind]
              .exists({ _id: input.targetId, operatorId: input.operatorId })
              .session(session))
      )
        fail(
          400,
          "GRANT_OWNER",
          "Resource must belong to the selected operator",
        );
      if (new Date(input.expiresAt) <= new Date())
        fail(400, "GRANT_EXPIRY", "Choose a future expiration");
      const g = await P.PartnerInventoryGrant.findOneAndUpdate(
        {
          partnerId: id,
          operatorId: input.operatorId,
          kind: input.kind,
          targetId: input.targetId,
        },
        {
          $set: { active: input.active, expiresAt: new Date(input.expiresAt) },
        },
        { upsert: true, new: true, session },
      );
      return { id: String(g!._id), active: g!.active };
    },
    true,
  );
}
export async function manageWebhook(
  config: Config,
  auth: Principal,
  id: string | undefined,
  input: any,
) {
  sandboxReady(config);
  const { partner } = await portalMember(auth, "partner:webhooks:write");
  if (!id) webhookTarget(config, input.url);
  return command(
    auth,
    String(partner._id),
    "partner:webhooks:write",
    input,
    async (session) => {
      if (!id) {
        const [sub] = await P.PartnerWebhookSubscription.create(
          [
            {
              partnerId: partner._id,
              publicId: publicId("sub"),
              url: input.url,
            },
          ],
          { session },
        );
        return {
          id: sub.publicId,
          signingSecret: webhookSecret(
            config,
            String(partner._id),
            sub.publicId,
          ),
        };
      }
      const sub = await P.PartnerWebhookSubscription.findOne({
        publicId: id,
        partnerId: partner._id,
      }).session(session);
      if (!sub) fail(404, "NOT_FOUND", "Subscription not found");
      if (input.action === "test") {
        if (!sub!.active)
          fail(
            409,
            "SUBSCRIPTION_DISABLED",
            "Enable the subscription before testing",
          );
        webhookTarget(config, sub!.url);
        const [event] = await P.PartnerWebhookEvent.create(
          [
            {
              partnerId: partner._id,
              publicId: publicId("evt"),
              key: "test:" + input.key,
              type: "integration.test",
            },
          ],
          { session },
        );
        await P.PartnerWebhookDelivery.create(
          [
            {
              partnerId: partner._id,
              subscriptionId: sub!._id,
              eventId: event._id,
            },
          ],
          { session },
        );
        return { queued: true };
      }
      if (input.action === "rotate")
        sub!.signingVersion = (sub!.signingVersion || 1) + 1;
      else sub!.active = input.action === "enable";
      await sub!.save({ session });
      return {
        id: sub!.publicId,
        active: sub!.active,
        ...(input.action === "rotate"
          ? {
              signingSecret: webhookSecret(
                config,
                String(partner._id),
                sub!.publicId,
                sub!.signingVersion,
              ),
            }
          : {}),
      };
    },
  );
}
export async function retryDelivery(auth: Principal, id: string, input: any) {
  const { partner } = await portalMember(auth, "partner:webhooks:write");
  return command(
    auth,
    String(partner._id),
    "partner:webhooks:write",
    input,
    async (session) => {
      const row = await P.PartnerWebhookDelivery.findOneAndUpdate(
        {
          _id: id,
          partnerId: partner._id,
          status: "Manual review",
          attempts: { $lte: 5 },
          $or: [{ retryLimit: { $exists: false } }, { retryLimit: 5 }],
        },
        {
          $set: {
            status: "Pending",
            retryLimit: 10,
            nextAttemptAt: new Date(),
          },
          $unset: { leaseToken: 1, leaseUntil: 1 },
        },
        { session, new: true },
      );
      if (!row)
        fail(
          409,
          "RETRY_INELIGIBLE",
          "Only a first exhausted sandbox delivery can receive five additional attempts",
        );
      return { queued: true, retryLimit: 10 };
    },
  );
}
export function usageFilter(partnerId: string, q: any) {
  if (q.from && q.to && q.from > q.to)
    fail(400, "DATE_RANGE", "End date must follow start date");
  return {
    partnerId,
    ...(q.from || q.to
      ? {
          createdAt: {
            ...(q.from ? { $gte: new Date(q.from + "T00:00:00+05:30") } : {}),
            ...(q.to
              ? {
                  $lt: new Date(+new Date(q.to + "T00:00:00+05:30") + 86400000),
                }
              : {}),
          },
        }
      : {}),
    ...(q.endpoint ? { operation: q.endpoint } : {}),
    ...(q.status ? { status: Number(q.status) } : {}),
  };
}
export async function usageSummary(partnerId: string, q: any) {
  const filter = usageFilter(partnerId, q),
    match = { ...filter, partnerId: new mongoose.Types.ObjectId(partnerId) };
  const [summary] = await P.PartnerApiUsage.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        success: { $sum: { $cond: [{ $lt: ["$status", 400] }, 1, 0] } },
        latencyMs: { $avg: "$durationMs" },
      },
    },
  ]);
  const endpoints = await P.PartnerApiUsage.aggregate([
    { $match: match },
    { $group: { _id: "$operation", requests: { $sum: 1 } } },
    { $sort: { requests: -1 } },
    { $limit: 50 },
  ]);
  return {
    environment: "sandbox",
    total: summary?.total || 0,
    success: summary?.success || 0,
    failed: (summary?.total || 0) - (summary?.success || 0),
    latencyMs: Math.round(summary?.latencyMs || 0),
    endpoints,
  };
}
export async function portalBookings(partnerId: string, q: any) {
  const filter: any = {
    partnerId,
    ...(q.search ? { reference: literalRegex(q.search) } : {}),
  };
  const rows = await P.PartnerBookingReference.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .skip((q.page - 1) * q.limit)
    .limit(q.limit)
    .lean();
  const data = [];
  for (const ref of rows) {
    const view = ref.bookingId
      ? await bookingView({ partnerId } as PartnerIdentity, ref.publicId)
      : { id: ref.publicId, status: "Preparing" };
    const booking: any = ref.bookingId
      ? await M.Booking.findOne({
          _id: ref.bookingId,
          operatorId: ref.operatorId,
        }).lean()
      : null;
    const trip: any = booking
      ? await M.Trip.findOne({
          _id: booking.tripId,
          operatorId: ref.operatorId,
        }).lean()
      : null;
    const route: any = trip
      ? await M.Route.findOne({
          _id: trip.routeId,
          operatorId: ref.operatorId,
        }).lean()
      : null;
    const operator: any = await M.Operator.findById(ref.operatorId)
      .select("company")
      .lean();
    const refund: any = booking
      ? await M.Refund.findOne({
          bookingId: booking._id,
          operatorId: ref.operatorId,
        })
          .select("status")
          .lean()
      : null;
    data.push({
      ...view,
      aibusReference: booking?.reference,
      refundStatus: refund?.status || "None",
      reference: ref.reference,
      operator: operator?.company,
      route:
        route?.route ||
        route?.name ||
        [route?.source, route?.destination].filter(Boolean).join(" → "),
      journeyDate: trip?.journeyDate,
      seats: booking?.passengers?.map((p: any) => p.seat) || [],
      environment: "sandbox",
    });
  }
  return {
    data,
    total: await P.PartnerBookingReference.countDocuments(filter),
  };
}
export async function inventoryView(config: Config, partner: any) {
  const grants = await P.PartnerInventoryGrant.find({ partnerId: partner._id })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  const rows = [];
  for (const g of grants) {
    const operator: any = await M.Operator.findById(g.operatorId)
      .select("company publicSandboxInventory")
      .lean();
    rows.push({
      id: String(g._id),
      kind: g.kind,
      targetId: String(g.targetId),
      operator: operator?.company,
      active: g.active && g.expiresAt > new Date(),
      expiresAt: g.expiresAt,
      sandboxEnabled: operator?.publicSandboxInventory === true,
    });
  }
  let trips: any[] = [];
  let unavailable: string | undefined;
  // Admins must be able to review an application before the company is
  // authorized to search inventory. Do not run active-partner discovery here.
  if (
    partner.status !== "Active" ||
    (partner.onboardingStatus && partner.onboardingStatus !== "Approved")
  )
    return {
      grants: rows,
      trips,
      unavailable:
        "Inventory access is unavailable until the company is approved and active.",
    };
  try {
    sandboxReady(config);
    trips = await authorizedTrips(portalIdentity(partner));
  } catch (e: any) {
    if (e.code !== "PUBLIC_API_DISABLED") throw e;
    unavailable = e.message;
  }
  return { grants: rows, trips, unavailable };
}
export async function usageCsv(partnerId: string, q: any) {
  const rows = await P.PartnerApiUsage.find(usageFilter(partnerId, q))
    .sort({ createdAt: -1 })
    .limit(5001)
    .lean();
  if (rows.length > 5000)
    fail(422, "EXPORT_LIMIT", "Narrow the filters to at most 5000 requests");
  return csvDocument([
    [
      "Request ID",
      "Endpoint",
      "Status",
      "Duration ms",
      "Created at",
      "Environment",
    ],
    ...rows.map((r) => [
      r.requestId,
      r.operation,
      r.status,
      r.durationMs,
      r.createdAt.toISOString(),
      "sandbox",
    ]),
  ]);
}

export async function updatePartnerSettings(
  auth: Principal,
  id: string,
  input: any,
) {
  return command(auth, id, "partner:settings:write", input, async (session) => {
    const { name, contactPerson, phone, address, technicalEmail } = input;
    await P.ApiPartner.updateOne(
      { _id: id },
      { $set: { name, contactPerson, phone, address, technicalEmail } },
      { session },
    );
    return { updated: true };
  });
}
export async function createSupport(auth: Principal, id: string, input: any) {
  await portalIndexesReady();
  return mongoose.connection.transaction(async (session) => {
    await portalMember(auth, "partner:support:write", session);
    const old: any = await M.PartnerSupport.findOne({
      partnerId: id,
      requestKey: input.key,
    })
      .session(session)
      .lean();
    if (old) {
      if (old.subject !== input.subject || old.message !== input.message)
        fail(409, "IDEMPOTENCY_CONFLICT", "Support key has different content");
      return { id: String(old._id), status: old.status };
    }
    const [row] = await M.PartnerSupport.create(
      [
        {
          partnerId: id,
          requestKey: input.key,
          subject: input.subject,
          message: input.message,
          createdBy: auth.userId,
        },
      ],
      { session },
    );
    await audit(
      auth,
      "support.created",
      String(row._id),
      "Integration support request",
      session,
      id,
    );
    return { id: String(row._id), status: row.status };
  });
}
export async function respondSupport(
  auth: Principal,
  id: string,
  supportId: string,
  input: any,
) {
  return command(
    auth,
    id,
    "admin.support.respond",
    input,
    async (session) => {
      const row = await M.PartnerSupport.findOneAndUpdate(
        { _id: supportId, partnerId: id },
        {
          $set: {
            response: input.response,
            status: input.status,
            reviewedBy: auth.userId,
          },
        },
        { session },
      );
      if (!row) fail(404, "NOT_FOUND", "Support request not found");
      return { updated: true };
    },
    true,
  );
}
