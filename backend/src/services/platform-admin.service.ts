import { financialReconciliation } from "./financial-report.service.js";
import mongoose, { type ClientSession } from "mongoose";
import { createHmac } from "node:crypto";
import * as M from "../models/index.js";
import type { Config } from "../config/env.js";
import { fail, type Principal } from "../utils/core.js";
import { platformPermit } from "./platform-read.service.js";
import { profilePermissions } from "../types/platform.js";
import { checkPassword, hashPassword } from "./auth.service.js";
export async function platformIndexesReady() {
  for (const model of [
    M.PlatformCommand,
    M.PlatformSettings,
    M.OperatorDocument,
  ]) {
    let installed: any[];
    try {
      installed = await model.collection.listIndexes().toArray();
    } catch {
      fail(
        503,
        "PLATFORM_NOT_READY",
        "Review and install additive platform indexes first",
      );
    }
    for (const [keys, options] of model.schema.indexes())
      if (
        options.unique &&
        !installed!.some(
          (i) =>
            i.unique &&
            !i.sparse &&
            !i.partialFilterExpression &&
            JSON.stringify(i.key) === JSON.stringify(keys),
        )
      )
        fail(
          503,
          "PLATFORM_NOT_READY",
          "Platform uniqueness has not been provisioned",
        );
  }
}
export async function verifyPlatformAction(auth: Principal, password: string) {
  const user: any = await M.User.findOne({
    _id: auth.userId,
    role: "super_admin",
    active: true,
  })
    .select("+passwordHash")
    .lean();
  if (!user || !password || !(await checkPassword(password, user.passwordHash)))
    fail(
      403,
      "STEP_UP_REQUIRED",
      "Verify your current password before this privileged action",
    );
}
export async function platformAudit(
  auth: Principal,
  action: string,
  resourceId: string,
  reason: string,
  session?: ClientSession,
  operatorId?: string,
  metadata: Record<string, unknown> = {},
) {
  const options = session ? { session } : undefined;
  await M.Audit.create(
    [
      {
        actorId: auth.userId,
        ...(operatorId ? { operatorId } : {}),
        action,
        resourceId,
        resource: "Platform",
        metadata: { reason, ...metadata },
        expiresAt: null,
      },
    ],
    options,
  );
}
export async function changeOperator(
  auth: Principal,
  id: string,
  input: {
    status?: string;
    salesBlocked?: boolean;
    version: number;
    reason: string;
    password: string;
  },
) {
  platformPermit(auth, "platform:operators:write");
  await verifyPlatformAction(auth, input.password);
  return mongoose.connection.transaction(async (session) => {
    const row: any = await M.Operator.findById(id).session(session);
    if (!row) fail(404, "NOT_FOUND", "Operator not found");
    if (row.__v !== input.version)
      fail(
        409,
        "VERSION_CONFLICT",
        "Operator changed; reload its current state",
      );
    const before = row.status;
    if (input.status && input.status !== row.status) {
      const transitions: Record<string, string[]> = {
        pending: ["approved", "rejected"],
        approved: ["suspended"],
        suspended: ["approved", "rejected"],
        rejected: ["pending"],
      };
      if (!transitions[row.status]?.includes(input.status))
        fail(
          409,
          "INVALID_TRANSITION",
          "This operator status transition is not allowed",
        );
      row.status = input.status;
      row.approvedBy = auth.userId;
      row.approvedAt = new Date();
    } else if (input.status && input.salesBlocked === undefined)
      fail(409, "NO_STATE_CHANGE", "Operator already has that status");
    if (input.salesBlocked !== undefined) row.salesBlocked = input.salesBlocked;
    row.__v++;
    row.salesRevision = (row.salesRevision || 0) + 1;
    await row.save({ session });
    await platformAudit(
      auth,
      input.status ? `operator.${row.status}` : "operator.sales-policy",
      id,
      input.reason,
      session,
      id,
      {
        previousStatus: before,
        status: row.status,
        salesBlocked: row.salesBlocked,
      },
    );
    await M.Outbox.create(
      [{ operatorId: id, event: "operator.status.updated", resourceId: id }],
      { session },
    );
    return {
      ...row.toObject(),
      bookingPolicy: {
        newSalesBlocked: row.status !== "approved" || row.salesBlocked,
        existingTickets: "Preserved",
        pendingCapturedPayments:
          "Existing ownership and payment state machines continue",
        futureTrips: "Retained; review in monitoring",
      },
    };
  });
}
export async function operatorProfile(auth: Principal, id: string) {
  platformPermit(auth, "platform:operators:read");
  const row: any = await M.Operator.findById(id).lean();
  if (!row) fail(404, "NOT_FOUND", "Operator not found");
  const [buses, routes, trips] = await Promise.all([
    M.Bus.countDocuments({ operatorId: id }),
    M.Route.countDocuments({ operatorId: id }),
    M.Trip.countDocuments({ operatorId: id, status: "Scheduled" }),
  ]);
  return {
    ...row,
    counts: { buses, routes, scheduledTrips: trips },
    history: await M.Audit.find({ operatorId: id, action: /^operator\./ })
      .select("action actorId metadata.reason createdAt")
      .sort({ createdAt: -1 })
      .limit(100)
      .lean(),
    staff: await M.User.find({ operatorId: id, salesPartnerId: null })
      .select("name role active")
      .limit(100)
      .lean(),
    documents: auth.permissions.includes("platform:verification:write")
      ? await M.OperatorDocument.find({ operatorId: id })
          .select("kind reference status reviewReason reviewedAt __v")
          .limit(100)
          .lean()
      : [],
    financeAvailable: auth.permissions.includes("platform:finance:read"),
    ...(auth.permissions.includes("platform:finance:read")
      ? { financialOverview: await financialReconciliation(auth, id) }
      : {}),
    verification: {
      mode: "Manual external evidence reference review; approval remains a separate action",
    },
    policy: {
      newSalesBlocked: row.status !== "approved" || row.salesBlocked,
      existingTickets:
        "Preserved; suspension does not cancel or refund tickets",
      futureTrips: "Retained for explicit operator review",
    },
  };
}
export async function reviewOperatorDocument(
  auth: Principal,
  operatorId: string,
  id: string,
  input: { status: string; version: number; reason: string; password: string },
) {
  platformPermit(auth, "platform:verification:write");
  await verifyPlatformAction(auth, input.password);
  return mongoose.connection.transaction(async (session) => {
    const row = await M.OperatorDocument.findOneAndUpdate(
      { _id: id, operatorId, __v: input.version },
      {
        $set: {
          status: input.status,
          reviewedBy: auth.userId,
          reviewedAt: new Date(),
          reviewReason: input.reason,
        },
        $inc: { __v: 1 },
      },
      { session, new: true },
    );
    if (!row)
      fail(
        409,
        "VERSION_CONFLICT",
        "Document reference changed or does not belong to this operator",
      );
    await platformAudit(
      auth,
      "operator.document-review",
      id,
      input.reason,
      session,
      operatorId,
      { status: input.status },
    );
    return row;
  });
}
type AdminStaffInput = {
  name: string;
  email: string;
  profile: string;
  permissions: string[];
  financeRead: boolean;
  financeActions: string[];
  initialPassword?: string;
  password: string;
  reason: string;
  active: boolean;
  version?: number;
};
function validateStaffPolicy(input: AdminStaffInput) {
  const allowed = profilePermissions[input.profile];
  if (
    !allowed ||
    input.permissions.some((p) => !allowed.includes(p)) ||
    new Set(input.permissions).size !== input.permissions.length
  )
    fail(
      400,
      "ROLE_PERMISSIONS",
      "Permissions must belong to the selected functional role",
    );
  if (
    (input.financeRead &&
      !["Finance Manager", "Audit / Read Only"].includes(input.profile)) ||
    (input.financeActions.length &&
      (!input.financeRead || input.profile !== "Finance Manager"))
  )
    fail(
      400,
      "FINANCE_GRANTS",
      "Only an explicitly authorized Finance Manager can receive finance action grants",
    );
}
export function safeAdminUser(user: any) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    profile: user.platformProfile || "Super Admin",
    permissions: user.platformPermissions || [],
    financeRead: user.platformFinanceRead,
    financeActions: user.platformFinanceActions,
    active: user.active,
    version: user.__v,
  };
}
export async function createAdminStaff(
  config: Config,
  auth: Principal,
  input: AdminStaffInput,
  key: string,
) {
  platformPermit(auth, "platform:staff:write");
  await verifyPlatformAction(auth, input.password);
  validateStaffPolicy(input);
  await platformIndexesReady();
  const identity = { ...input, password: undefined },
    hash = createHmac("sha256", config.JWT_SECRET)
      .update(JSON.stringify(identity))
      .digest("hex"),
    passwordHash = await hashPassword(input.initialPassword!);
  for (let attempt = 0; ; attempt++)
    try {
      return await mongoose.connection.transaction(async (session) => {
        const previous: any = await M.PlatformCommand.findOne({
          actorId: auth.userId,
          key,
        })
          .select("+requestHash")
          .session(session)
          .lean();
        if (previous) {
          if (
            previous.requestHash !== hash ||
            previous.action !== "admin.created"
          )
            fail(
              409,
              "IDEMPOTENCY_CONFLICT",
              "Operation key belongs to different staff details",
            );
          return safeAdminUser(
            await M.User.findById(previous.resourceId).session(session).lean(),
          );
        }
        if (await M.User.exists({ email: input.email }).session(session))
          fail(409, "EMAIL_EXISTS", "This email already has an account");
        const [user] = await M.User.create(
          [
            {
              name: input.name,
              email: input.email,
              passwordHash,
              role: "super_admin",
              platformProfile: input.profile,
              platformPermissions: input.permissions,
              platformFinanceRead: input.financeRead,
              platformFinanceActions: input.financeActions,
              active: input.active,
            },
          ],
          { session },
        );
        await M.PlatformCommand.create(
          [
            {
              actorId: auth.userId,
              key,
              requestHash: hash,
              resourceId: user._id,
              action: "admin.created",
            },
          ],
          { session },
        );
        await platformAudit(
          auth,
          "admin.created",
          String(user._id),
          input.reason,
          session,
          undefined,
          {
            profile: input.profile,
            permissions: input.permissions,
            financeRead: input.financeRead,
            financeActions: input.financeActions,
            active: input.active,
          },
        );
        return safeAdminUser(user);
      });
    } catch (e) {
      if ((e as any).code !== 11000 || attempt >= 2) throw e;
    }
}
export async function updateAdminStaff(
  auth: Principal,
  id: string,
  input: AdminStaffInput,
) {
  platformPermit(auth, "platform:staff:write");
  await verifyPlatformAction(auth, input.password);
  validateStaffPolicy(input);
  if (auth.userId === id)
    fail(
      403,
      "SELF_CHANGE_FORBIDDEN",
      "You cannot change your own privileged access",
    );
  return mongoose.connection.transaction(async (session) => {
    const user: any = await M.User.findOne({
      _id: id,
      role: "super_admin",
      platformProfile: { $exists: true },
      __v: input.version,
    }).session(session);
    if (!user)
      fail(
        409,
        "PROTECTED_ADMIN",
        "Bootstrap Super Admin accounts are protected; staff may also have changed",
      );
    const updated = await M.User.findOneAndUpdate(
      { _id: user._id, __v: input.version },
      {
        $set: {
          name: input.name,
          email: input.email,
          platformProfile: input.profile,
          platformPermissions: input.permissions,
          platformFinanceRead: input.financeRead,
          platformFinanceActions: input.financeActions,
          active: input.active,
        },
        $inc: { __v: 1 },
      },
      { session, new: true, runValidators: true },
    );
    if (!updated)
      fail(409, "VERSION_CONFLICT", "Staff access changed concurrently");
    await M.Session.updateMany(
      { userId: id, revokedAt: null },
      { $set: { revokedAt: new Date() } },
      { session },
    );
    await platformAudit(
      auth,
      "admin.access-updated",
      id,
      input.reason,
      session,
      undefined,
      {
        profile: input.profile,
        permissions: input.permissions,
        previousProfile: user.platformProfile,
        previousPermissions: user.platformPermissions,
        financeRead: input.financeRead,
        financeActions: input.financeActions,
        previousFinanceRead: user.platformFinanceRead,
        previousFinanceActions: user.platformFinanceActions,
        active: input.active,
      },
    );
    return safeAdminUser(updated);
  });
}
export async function revokeAdminSessions(
  auth: Principal,
  id: string,
  password: string,
  reason: string,
) {
  platformPermit(auth, "platform:staff:write");
  await verifyPlatformAction(auth, password);
  if (
    id === auth.userId ||
    !(await M.User.exists({
      _id: id,
      role: "super_admin",
      platformProfile: { $exists: true },
    }))
  )
    fail(
      403,
      "PROTECTED_ADMIN",
      "Self and bootstrap Super Admin sessions are protected from this staff action",
    );
  return mongoose.connection.transaction(async (session) => {
    const result = await M.Session.updateMany(
      { userId: id, revokedAt: null },
      { $set: { revokedAt: new Date() } },
      { session },
    );
    await platformAudit(auth, "admin.sessions-revoked", id, reason, session);
    return { revoked: result.modifiedCount };
  });
}
export async function updatePlatformSettings(
  auth: Principal,
  input: {
    displayName: string;
    supportEmail: string;
    onboardingMode: string;
    templates: Record<string, string>;
    version: number;
    reason: string;
    password: string;
  },
) {
  platformPermit(auth, "platform:settings:write");
  await verifyPlatformAction(auth, input.password);
  await platformIndexesReady();
  return mongoose.connection.transaction(async (session) => {
    let row = await M.PlatformSettings.findOne({ key: "platform" }).session(
      session,
    );
    if ((row?.version || 0) !== input.version)
      fail(409, "VERSION_CONFLICT", "Platform settings changed; reload first");
    if (!row) row = new M.PlatformSettings({ key: "platform" });
    row.displayName = input.displayName;
    row.supportEmail = input.supportEmail;
    row.onboardingMode = input.onboardingMode;
    row.templates = new Map(Object.entries(input.templates));
    row.version = input.version + 1;
    row.updatedBy = auth.userId;
    await row.save({ session });
    await platformAudit(
      auth,
      "platform.settings-updated",
      "platform",
      input.reason,
      session,
      undefined,
      {
        version: row.version,
        changedFields: ["profile", "notification template drafts"],
      },
    );
    return row;
  });
}
