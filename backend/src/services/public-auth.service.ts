import { Audit } from "../models/index.js";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import * as P from "../models/public-api.model.js";
import type { Config } from "../config/env.js";
import { fail } from "../utils/core.js";
import { sourceEntitlement } from "./sandbox-bridge.transport.js";
const ACCESS_TOKEN_TTL_SECONDS = 45 * 60;
export const publicScopes = [
  "inventory:read",
  "holds:write",
  "bookings:write",
  "bookings:read",
  "tickets:read",
  "cancellations:write",
  "refunds:read",
  "webhooks:read",
] as const;
export type PartnerIdentity = {
  partnerId: string;
  credentialId: string;
  publicId: string;
  scopes: string[];
  environment: "sandbox";
  requestsPerMinute?: number;
};
export const publicId = (kind: string) =>
  `${kind}_${randomBytes(18).toString("base64url")}`;
export function sandboxReady(config: Config) {
  if (
    !config.PUBLIC_API_SANDBOX ||
    config.NODE_ENV === "production" ||
    !config.PUBLIC_API_JWT_SECRET ||
    !mongoose.connection.name?.startsWith("aibus_public_sandbox_")
  )
    fail(
      503,
      "PUBLIC_API_DISABLED",
      "Public API sandbox requires a dedicated isolated sandbox database; production partner funding is unavailable",
    );
}
export async function publicIndexesReady() {
  for (const model of Object.values(P)) {
    const installed = await model.collection.indexes().catch(() => []);
    for (const [keys, options] of model.schema.indexes())
      if (
        options.unique &&
        !installed.some(
          (i) =>
            i.unique &&
            !i.sparse &&
            JSON.stringify(i.key) === JSON.stringify(keys) &&
            JSON.stringify(i.partialFilterExpression || {}) ===
              JSON.stringify(options.partialFilterExpression || {}),
        )
      )
        fail(
          503,
          "PUBLIC_INDEX_REQUIRED",
          "Provision additive Public API uniqueness before sandbox use",
        );
  }
}
export async function generateCredential(
  config: Config,
  partnerId: string,
  scopes: string[],
  expiresAt: Date,
  options: {
    session?: mongoose.ClientSession;
    actorId?: string;
    label?: string;
    portalManaged?: boolean;
  } = {},
) {
  sandboxReady(config);
  await publicIndexesReady();
  const partner = await P.ApiPartner.findOne({
    _id: partnerId,
    status: "Active",
    $or: [
      { onboardingStatus: "Approved" },
      { onboardingStatus: { $exists: false } },
    ],
    environment: "sandbox",
  });
  if (
    !partner ||
    scopes.some(
      (s) =>
        !partner.scopes.includes(s) ||
        !(publicScopes as readonly string[]).includes(s),
    ) ||
    expiresAt <= new Date()
  )
    fail(400, "CREDENTIAL_POLICY", "Invalid partner credential policy");
  const id = publicId("cred"),
    secret = randomBytes(32).toString("hex");
  const [credential] = await P.ApiCredential.create(
    [
      {
        publicId: id,
        partnerId,
        environment: "sandbox",
        scopes,
        secretHash: createHash("sha256").update(secret).digest("hex"),
        expiresAt,
        label: options.label,
        createdBy: options.actorId,
        portalManaged: options.portalManaged || false,
      },
    ],
    { session: options.session },
  );
  await Audit.create(
    [
      {
        actorId: options.actorId || partnerId,
        action: "public.credential.issued",
        resourceId: String(credential._id),
        metadata: { partnerId, scopes, environment: "sandbox" },
        expiresAt: null,
      },
    ],
    { session: options.session },
  );
  // Returned once to reviewed provisioning callers; never persisted in raw form.
  return { credential: `ap_sandbox_${id}.${secret}`, id };
}
async function current(
  config: Config,
  credentialId: string,
): Promise<PartnerIdentity> {
  sandboxReady(config);
  const credential = await P.ApiCredential.findOne({
    _id: credentialId,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
    environment: "sandbox",
  }).lean();
  const partner =
    credential &&
    (await P.ApiPartner.findOne({
      _id: credential.partnerId,
      status: "Active",
      $or: [
        { onboardingStatus: "Approved" },
        { onboardingStatus: { $exists: false } },
      ],
      environment: "sandbox",
    }).lean());
  if (!credential || !partner)
    fail(
      401,
      "PARTNER_UNAUTHORIZED",
      "Partner credential is invalid, expired or revoked",
    );
  const source = await sourceEntitlement(
    config,
    partner!,
    String(credential!.createdBy || ""),
  );
  if (
    partner!.portalSourcePublicId &&
    (!source.permissions?.includes("partner:credentials:write") ||
      (credential!.scopes.includes("tickets:read") &&
        !source.permissions?.includes("partner:passengers")))
  )
    fail(
      401,
      "PARTNER_UNAUTHORIZED",
      "Credential issuer no longer has the required organization permissions",
    );
  return {
    partnerId: String(partner!._id),
    credentialId: String(credential!._id),
    publicId: partner!.publicId,
    environment: "sandbox",
    requestsPerMinute: Math.min(
      partner!.requestsPerMinute || 120,
      source.requestsPerMinute,
    ),
    scopes: credential!.scopes.filter(
      (s: string) => partner!.scopes.includes(s) && source.scopes.includes(s),
    ),
  };
}
export async function authenticatePartner(config: Config, raw: string) {
  sandboxReady(config);
  const match = /^ap_sandbox_(cred_[\w-]+)\.([a-f0-9]{64})$/.exec(raw);
  const credential: any =
    match &&
    (await P.ApiCredential.findOne({ publicId: match[1] })
      .select("+secretHash")
      .lean());
  const candidate = createHash("sha256")
      .update(match?.[2] || "invalid")
      .digest(),
    expected = Buffer.from(credential?.secretHash || "0".repeat(64), "hex");
  if (!credential || !timingSafeEqual(candidate, expected))
    fail(
      401,
      "PARTNER_UNAUTHORIZED",
      "Partner credential is invalid, expired or revoked",
    );
  const identity = await current(config, String(credential._id));
  return {
    accessToken: jwt.sign(
      {
        cid: credential.publicId,
        cv: credential.version,
        environment: "sandbox",
      },
      config.PUBLIC_API_JWT_SECRET!,
      {
        subject: identity.publicId,
        audience: "aibus-public-v1",
        issuer: "aibus",
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      },
    ),
    tokenType: "Bearer",
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    environment: "sandbox",
    scopes: identity.scopes,
  };
}
export async function partnerFromToken(config: Config, token: string) {
  sandboxReady(config);
  let payload: any;
  try {
    payload = jwt.verify(token, config.PUBLIC_API_JWT_SECRET!, {
      audience: "aibus-public-v1",
      issuer: "aibus",
      algorithms: ["HS256"],
    });
  } catch {
    fail(401, "PARTNER_UNAUTHORIZED", "Invalid or expired partner token");
  }
  if (
    typeof payload.cid !== "string" ||
    !/^cred_[A-Za-z0-9_-]{16,100}$/.test(payload.cid) ||
    payload.environment !== "sandbox"
  )
    fail(401, "PARTNER_UNAUTHORIZED", "Invalid partner token");
  const credential = await P.ApiCredential.findOne({ publicId: payload.cid })
    .select("_id version")
    .lean();
  if (!credential)
    fail(401, "PARTNER_UNAUTHORIZED", "Credential is unavailable");
  const identity = await current(config, String(credential!._id));
  if (payload.sub !== identity.publicId || payload.cv !== credential?.version)
    fail(401, "PARTNER_UNAUTHORIZED", "Credential was rotated");
  await P.ApiCredential.updateOne(
    { _id: credential!._id },
    { $set: { lastUsedAt: new Date() } },
  );
  return identity;
}
export function requirePublicScope(identity: PartnerIdentity, scope: string) {
  if (!identity.scopes.includes(scope))
    fail(403, "PARTNER_SCOPE", "Required partner scope is not granted");
}
