import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import type { Config } from "../config/env.js";
import { fail } from "../utils/core.js";

const claimsSchema = z.object({
  purpose: z.enum(["execute", "entitlement"]),
  digest: z.string().length(64),
  sub: z.string().regex(/^partner_[\w-]{16,100}$/),
  actorId: z.string().regex(/^[a-f\d]{24}$/i),
});
export const bridgeDigest = (body: unknown) =>
  createHash("sha256").update(JSON.stringify(body)).digest("hex");
export function bridgeProof(
  config: Config,
  purpose: "execute" | "entitlement",
  partnerId: string,
  actorId: string,
  body: unknown,
) {
  if (!config.SANDBOX_PORTAL_BRIDGE_SECRET)
    fail(
      503,
      "SANDBOX_BRIDGE_UNAVAILABLE",
      "Sandbox portal connection is not configured",
    );
  return jwt.sign(
    { purpose, digest: bridgeDigest(body), actorId },
    config.SANDBOX_PORTAL_BRIDGE_SECRET!,
    {
      algorithm: "HS256",
      subject: partnerId,
      issuer: "aibus-private-bridge",
      audience: `aibus-sandbox-${purpose}`,
      expiresIn: 30,
    },
  );
}
export function verifyBridgeProof(
  config: Config,
  purpose: "execute" | "entitlement",
  token: string,
  body: unknown,
) {
  try {
    if (!config.SANDBOX_PORTAL_BRIDGE_SECRET) throw new Error();
    const claims = claimsSchema.parse(
      jwt.verify(token, config.SANDBOX_PORTAL_BRIDGE_SECRET, {
        algorithms: ["HS256"],
        issuer: "aibus-private-bridge",
        audience: `aibus-sandbox-${purpose}`,
        maxAge: "30s",
      }),
    );
    if (claims.purpose !== purpose || claims.digest !== bridgeDigest(body))
      throw new Error();
    return claims;
  } catch {
    fail(401, "BRIDGE_UNAUTHORIZED", "Invalid private sandbox request");
  }
}
export async function bridgeCall(
  config: Config,
  origin: string,
  purpose: "execute" | "entitlement",
  partnerId: string,
  actorId: string,
  body: unknown,
) {
  let response: Response;
  try {
    response = await fetch(
      new URL(`/internal/sandbox-portal/${purpose}`, origin),
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bridgeProof(config, purpose, partnerId, actorId, body)}`,
        },
        body: JSON.stringify(body),
      },
    );
  } catch {
    fail(
      503,
      "SANDBOX_BRIDGE_UNAVAILABLE",
      "Sandbox connection unavailable. Preserve the same request key when retrying.",
    );
  }
  const value = await response!.json().catch(() => null);
  if (!response!.ok) {
    // Do not reflect transport errors, upstream stack traces or environment secrets.
    const code =
      typeof value?.error?.code === "string"
        ? value.error.code
        : "SANDBOX_BRIDGE_UNAVAILABLE";
    const message =
      typeof value?.error?.message === "string"
        ? value.error.message
        : "Sandbox request could not be completed";
    fail(response!.status, code, message);
  }
  return value;
}

export async function sourceEntitlement(
  config: Config,
  partner: any,
  actorId: string,
) {
  if (!partner.portalSourcePublicId)
    return {
      scopes: partner.scopes as string[],
      permissions: [] as string[],
      name: String(partner.name || ""),
      requestsPerMinute: Number(partner.requestsPerMinute || 120),
    };
  if (!config.SANDBOX_CONTROL_URL)
    fail(
      503,
      "SANDBOX_BRIDGE_UNAVAILABLE",
      "Linked credentials require the control-plane connection",
    );
  const result = await bridgeCall(
    config,
    config.SANDBOX_CONTROL_URL!,
    "entitlement",
    partner.portalSourcePublicId,
    actorId,
    {},
  );
  const value = z
    .object({
      data: z.object({
        scopes: z.array(z.string()),
        permissions: z.array(z.string()),
        name: z.string(),
        requestsPerMinute: z.number().int().min(1).max(120),
      }),
    })
    .parse(result);
  return value.data;
}
