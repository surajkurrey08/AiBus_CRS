import mongoose from "mongoose";
import { z } from "zod";
import type { Config } from "../config/env.js";
import type { Principal } from "../utils/core.js";
import { fail, literalRegex } from "../utils/core.js";
import * as M from "../models/index.js";
import * as P from "../models/public-api.model.js";
import { platformIdentity } from "../types/platform.js";
import { platformPermit } from "./platform-read.service.js";
import { verifyPlatformAction } from "./platform-admin.service.js";
import { hashToken } from "./auth.service.js";
import { bridgeCall } from "./sandbox-bridge.transport.js";
import { publicIndexesReady, sandboxReady } from "./public-auth.service.js";
import {
  applySandboxGrant,
  inventoryView,
  manageGrant,
} from "./partner-portal.service.js";
import { grantInput } from "../validators/partner-portal.schemas.js";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
export const inventoryOptionsQuery = z
  .object({
    kind: z.enum(["Operator", "Route", "Service", "Trip"]).default("Operator"),
    operatorId: objectId.optional(),
    search: z.string().trim().max(100).default(""),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(100),
  })
  .strict();
const operation = z.enum(["options", "inventory", "grant"]);
const entitlementInput = z.object({ sessionId: objectId, operation }).strict();
const reviewedGrant = grantInput.omit({ password: true });
const inventoryBridgeInput = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("options"),
      sessionId: objectId,
      query: inventoryOptionsQuery,
    })
    .strict(),
  z.object({ operation: z.literal("inventory"), sessionId: objectId }).strict(),
  z
    .object({
      operation: z.literal("grant"),
      sessionId: objectId,
      grant: reviewedGrant,
    })
    .strict(),
]);

// The control plane rechecks the actual administrator and session on every
// sandbox request. A partner-member proof cannot authorize an inventory grant.
export async function controlInventoryEntitlement(
  publicId: string,
  actorId: string,
  raw: unknown,
) {
  const input = entitlementInput.parse(raw);
  const session = await M.Session.exists({
    _id: input.sessionId,
    userId: actorId,
    client: "admin",
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  });
  const user: any = await M.User.findOne({
    _id: actorId,
    active: true,
    role: "super_admin",
  }).lean();
  if (!session || !user)
    fail(
      403,
      "FORBIDDEN",
      "An active platform administrator session is required",
    );
  const permissions = platformIdentity(user);
  if (
    !permissions.includes("platform:partners:read") ||
    (input.operation !== "inventory" &&
      !permissions.includes("platform:partners:write"))
  )
    fail(403, "FORBIDDEN", "Explicit API partner permission is required");
  const partner = await P.ApiPartner.findOne({ publicId }).lean();
  if (!partner) fail(404, "NOT_FOUND", "Partner organization not found");
  if (
    input.operation === "grant" &&
    (partner!.status !== "Active" || partner!.onboardingStatus !== "Approved")
  )
    fail(
      409,
      "PARTNER_NOT_APPROVED",
      "Approve and activate the partner before assigning inventory",
    );
  return {
    name: partner!.name,
    scopes: partner!.scopes,
    requestsPerMinute: partner!.requestsPerMinute,
  };
}

export async function listSandboxInventory(raw: unknown, config: Config) {
  sandboxReady(config);
  const q = inventoryOptionsQuery.parse(raw);
  const owners: any = {
    status: "approved",
    publicSandboxInventory: true,
    salesBlocked: { $ne: true },
  };
  let model: mongoose.Model<any> = M.Operator,
    filter: any = owners;
  if (q.kind === "Operator") {
    if (q.search) filter = { ...filter, company: literalRegex(q.search) };
  } else {
    if (!q.operatorId)
      fail(400, "OPERATOR_REQUIRED", "Select a sandbox operator first");
    if (!(await M.Operator.exists({ ...owners, _id: q.operatorId })))
      fail(
        400,
        "SANDBOX_OPERATOR_REQUIRED",
        "Select an approved sandbox-enabled operator",
      );
    filter = { operatorId: q.operatorId, status: "Active" };
    if (q.kind === "Route") {
      model = M.Route;
      if (q.search)
        filter.$or = ["name", "source", "destination"].map((f) => ({
          [f]: literalRegex(q.search),
        }));
    } else if (q.kind === "Service") {
      model = M.BusService;
      if (q.search)
        filter.$or = ["name", "code"].map((f) => ({
          [f]: literalRegex(q.search),
        }));
    } else {
      model = M.Trip;
      const [routes, cars, buses] = await Promise.all([
        M.Route.find({ operatorId: q.operatorId, status: "Active" })
          .select("_id source destination name")
          .lean(),
        M.Car.find({ operatorId: q.operatorId, status: "Active" })
          .select("_id")
          .lean(),
        M.Bus.find({ operatorId: q.operatorId, status: "Active" })
          .select("_id")
          .lean(),
      ]);
      filter = {
        operatorId: q.operatorId,
        inventoryOwner: "internal",
        status: "Scheduled",
        bookingOpen: { $ne: false },
        departureAt: { $gt: new Date() },
        routeId: { $in: routes.map((r) => r._id) },
        $or: [
          { carId: { $in: cars.map((c) => c._id) } },
          { busId: { $in: buses.map((b) => b._id) } },
        ],
      };
      if (q.search)
        filter.$and = [
          {
            $or: [
              { tripNumber: literalRegex(q.search) },
              { routeName: literalRegex(q.search) },
              { journeyDate: literalRegex(q.search) },
              {
                routeId: {
                  $in: routes
                    .filter((r) =>
                      literalRegex(q.search).test(
                        [r.name, r.source, r.destination].join(" "),
                      ),
                    )
                    .map((r) => r._id),
                },
              },
            ],
          },
        ];
    }
  }
  const [total, rows] = await Promise.all([
    model.countDocuments(filter),
    model
      .find(filter)
      .select(
        "_id company name source destination code tripNumber routeName routeId journeyDate departureAt",
      )
      .sort(q.kind === "Trip" ? { departureAt: 1, _id: 1 } : { _id: 1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
  ]);
  const routeIds = q.kind === "Trip" ? rows.map((r: any) => r.routeId) : [];
  const routes = routeIds.length
    ? await M.Route.find({ _id: { $in: routeIds }, operatorId: q.operatorId })
        .select("_id source destination")
        .lean()
    : [];
  return {
    data: rows.map((r: any) => {
      const route = routes.find(
        (item) => String(item._id) === String(r.routeId),
      );
      return {
        id: String(r._id),
        label:
          q.kind === "Trip"
            ? [
                r.tripNumber ||
                  r.routeName ||
                  (route
                    ? `${route.source} → ${route.destination}`
                    : "Scheduled trip"),
                r.journeyDate,
                new Date(r.departureAt).toLocaleTimeString("en-IN", {
                  timeZone: "Asia/Kolkata",
                  hour: "2-digit",
                  minute: "2-digit",
                }) + " IST",
              ]
                .filter(Boolean)
                .join(" · ")
            : r.company ||
              r.name ||
              [r.source, r.destination].filter(Boolean).join(" → ") ||
              r.code,
        ...(q.operatorId ? { operatorId: q.operatorId } : {}),
      };
    }),
    meta: {
      page: q.page,
      limit: q.limit,
      total,
      pages: Math.max(1, Math.ceil(total / q.limit)),
    },
  };
}

async function organization(id: string) {
  const partner = await P.ApiPartner.findById(id).lean();
  if (!partner) fail(404, "NOT_FOUND", "Partner organization not found");
  return partner!;
}
async function inventoryDetails(config: Config, partner: any) {
  const inventory = await inventoryView(config, partner);
  const grants = await P.PartnerInventoryGrant.find({ partnerId: partner._id })
    .select("_id operatorId")
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  return {
    ...inventory,
    grants: inventory.grants.map((grant) => ({
      ...grant,
      operatorId: String(
        grants.find((row) => String(row._id) === grant.id)?.operatorId || "",
      ),
    })),
  };
}
async function forward(
  config: Config,
  auth: Principal,
  id: string,
  input: Record<string, unknown>,
) {
  if (!config.SANDBOX_PORTAL_URL)
    fail(
      503,
      "SANDBOX_BRIDGE_UNAVAILABLE",
      "Sandbox inventory connection is not configured",
    );
  const partner = await organization(id);
  return bridgeCall(
    config,
    config.SANDBOX_PORTAL_URL!,
    "inventory-execute",
    partner.publicId,
    auth.userId,
    { ...input, sessionId: auth.sessionId },
  );
}
export async function adminInventoryOptions(
  config: Config,
  auth: Principal,
  id: string,
  raw: unknown,
) {
  platformPermit(auth, "platform:partners:write");
  const query = inventoryOptionsQuery.parse(raw);
  if (!config.PUBLIC_API_SANDBOX)
    return forward(config, auth, id, { operation: "options", query });
  await organization(id);
  return listSandboxInventory(query, config);
}
export async function adminInventoryView(
  config: Config,
  auth: Principal,
  id: string,
) {
  platformPermit(auth, "platform:partners:read");
  const partner = await organization(id);
  if (config.PUBLIC_API_SANDBOX) return inventoryDetails(config, partner);
  if (!config.SANDBOX_PORTAL_URL)
    return {
      grants: [],
      trips: [],
      unavailable: "Sandbox inventory connection is not configured.",
    };
  try {
    return (
      (await forward(config, auth, id, { operation: "inventory" })) as any
    ).data;
  } catch (error: any) {
    if (error.status >= 500 || error.statusCode >= 500)
      return {
        grants: [],
        trips: [],
        unavailable:
          "Sandbox inventory is temporarily unavailable. Retry the organization details.",
      };
    throw error;
  }
}
export async function adminManageGrant(
  config: Config,
  auth: Principal,
  id: string,
  raw: unknown,
) {
  platformPermit(auth, "platform:partners:write");
  const input = grantInput.parse(raw);
  if (config.PUBLIC_API_SANDBOX) return manageGrant(config, auth, id, input);
  await verifyPlatformAction(auth, input.password);
  const { password: _password, ...grant } = input;
  return (
    (await forward(config, auth, id, { operation: "grant", grant })) as any
  ).data;
}

export async function executeInventoryAdmin(
  config: Config,
  publicId: string,
  actorId: string,
  raw: unknown,
) {
  sandboxReady(config);
  if (!config.SANDBOX_CONTROL_URL)
    fail(
      503,
      "SANDBOX_BRIDGE_UNAVAILABLE",
      "Sandbox control connection is not configured",
    );
  const input = inventoryBridgeInput.parse(raw);
  const response: any = await bridgeCall(
    config,
    config.SANDBOX_CONTROL_URL!,
    "inventory-entitlement",
    publicId,
    actorId,
    { sessionId: input.sessionId, operation: input.operation },
  );
  const source = z
    .object({
      data: z.object({
        name: z.string(),
        scopes: z.array(z.string()),
        requestsPerMinute: z.number().int().min(1).max(120),
      }),
    })
    .parse(response).data;
  let partner = await P.ApiPartner.findOne({ publicId }).lean();
  if (partner && partner.portalSourcePublicId !== publicId)
    fail(
      409,
      "SANDBOX_PARTNER_CONFLICT",
      "Sandbox identity requires administrator review",
    );
  if (input.operation === "options")
    return listSandboxInventory(input.query, config);
  if (input.operation === "inventory")
    return {
      data: partner
        ? await inventoryDetails(config, partner)
        : {
            grants: [],
            trips: [],
            unavailable:
              "No sandbox inventory has been assigned to this company.",
          },
    };
  await publicIndexesReady();
  const digest = hashToken(JSON.stringify(input.grant));
  if (!partner) {
    try {
      partner = (
        await P.ApiPartner.create({
          publicId,
          portalSourcePublicId: publicId,
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
        publicId,
        portalSourcePublicId: publicId,
      }).lean();
    }
  }
  if (!partner || partner.portalSourcePublicId !== publicId)
    fail(
      409,
      "SANDBOX_PARTNER_CONFLICT",
      "Sandbox identity requires administrator review",
    );
  return mongoose.connection.transaction(async (session) => {
    if (
      partner!.status !== "Active" ||
      partner!.onboardingStatus !== "Approved"
    )
      fail(
        409,
        "PARTNER_NOT_APPROVED",
        "Approve and activate the sandbox partner before assigning inventory",
      );
    const currentPartner = await P.ApiPartner.findOneAndUpdate(
      {
        _id: partner!._id,
        status: "Active",
        onboardingStatus: "Approved",
        portalSourcePublicId: publicId,
      },
      { $inc: { revision: 1 } },
      { session, new: true },
    );
    if (!currentPartner)
      fail(
        409,
        "PARTNER_NOT_APPROVED",
        "Sandbox partner access changed. Refresh before assigning inventory",
      );
    const partnerId = String(partner!._id),
      key = "inventory-admin:" + input.grant.key;
    const old = await P.PartnerCommand.findOne({ partnerId, key }).session(
      session,
    );
    if (old) {
      if (old.requestHash !== digest)
        fail(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Request key was used for a different inventory decision",
        );
      return { data: { id: old.resourceId, alreadyApplied: true } };
    }
    const result = await applySandboxGrant(partnerId, input.grant, session);
    await P.PartnerCommand.create(
      [
        {
          partnerId,
          key,
          action: "sandbox.inventory.grant",
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
          action: "sandbox.inventory.grant",
          resourceId: result.id,
          metadata: {
            partnerId,
            sourcePartnerPublicId: publicId,
            reason: input.grant.reason,
            kind: input.grant.kind,
            operatorId: input.grant.operatorId,
            targetId: input.grant.targetId,
            active: input.grant.active,
            expiresAt: input.grant.expiresAt,
          },
          expiresAt: null,
        },
      ],
      { session },
    );
    return { data: result };
  });
}
