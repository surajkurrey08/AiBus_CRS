import {
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { createApp } from "../../src/app.js";
import { readConfig } from "../../src/config/env.js";
import * as M from "../../src/models/index.js";
import * as P from "../../src/models/public-api.model.js";
import { hashPassword, signAccess } from "../../src/services/auth.service.js";
import {
  publicId,
  publicScopes,
} from "../../src/services/public-auth.service.js";
import { bridgeProof } from "../../src/services/sandbox-bridge.transport.js";
import { partnerPermissions } from "../../src/types/partner-portal.js";

const password = "Isolated-bridge-password-2026";
const config = readConfig({
  NODE_ENV: "test",
  MONGODB_URI: "mongodb://127.0.0.1/aibus_public_sandbox_bridge",
  JWT_SECRET: "d".repeat(64),
  PUBLIC_API_JWT_SECRET: "p".repeat(64),
  PUBLIC_API_SANDBOX: "true",
  SANDBOX_PORTAL_BRIDGE_SECRET: "b".repeat(64),
  SANDBOX_PORTAL_URL: "https://sandbox.example.test",
  SANDBOX_CONTROL_URL: "https://control.example.test",
});
const app = createApp(config, { check: async () => true });
let mongo: MongoMemoryReplSet, actorId: string, sourceId: string, hash: string;
let source: any;
const transport = vi.fn();
const operation = (
  path = "/credentials",
  method = "POST",
  body: any = issueBody(),
  query = {},
) => ({ method, path, query, body });
function issueBody(extra = {}) {
  return {
    label: "Backend test key",
    scopes: ["inventory:read"],
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    reason: "Reviewed sandbox integration test",
    key: randomUUID(),
    ...extra,
  };
}
function execute(body: any, partnerId = sourceId, token?: string) {
  return request(app)
    .post("/internal/sandbox-portal/execute")
    .set(
      "Authorization",
      "Bearer " +
        (token ?? bridgeProof(config, "execute", partnerId, actorId, body)),
    )
    .send(body);
}
async function issue(extra = {}) {
  const result = await execute(
    operation("/credentials", "POST", issueBody(extra)),
  );
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  return result.body.data;
}
async function tokenFor(credential: string) {
  return request(app)
    .post("/api/v1/public/auth/token")
    .set("Authorization", "Bearer " + credential)
    .send({});
}
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "7.0.14" },
  });
  await mongoose.connect(mongo.getUri("aibus_public_sandbox_bridge"));
  await Promise.all(
    Object.values(mongoose.models).map((model) => model.init()),
  );
  hash = await hashPassword(password);
});
beforeEach(async () => {
  // Only this disposable replica set is touched; never a configured environment database.
  for (const model of Object.values(mongoose.models))
    await model.collection.deleteMany({});
  actorId = new mongoose.Types.ObjectId().toString();
  sourceId = publicId("partner");
  source = {
    name: "Approved source company",
    scopes: [...publicScopes],
    permissions: [...partnerPermissions],
    requestsPerMinute: 60,
  };
  transport.mockReset().mockImplementation(async (_url, options) => {
    const parsed = JSON.parse(options.body);
    if (String(_url).endsWith("/entitlement"))
      return new Response(JSON.stringify({ data: source }), { status: 200 });
    return new Response(
      JSON.stringify({ data: { forwarded: true, received: parsed } }),
      { status: 200 },
    );
  });
  vi.stubGlobal("fetch", transport);
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe("Private production portal to isolated sandbox bridge", () => {
  it("applies a reduced source request limit to already-issued access tokens", async () => {
    const key = await issue();
    const auth = await tokenFor(key.credential);
    const check = vi.fn(async () => true);
    const limited = createApp(config, { check });
    source.requestsPerMinute = 7;
    const response = await request(limited)
      .get("/api/v1/public/capabilities")
      .set("Authorization", "Bearer " + auth.body.data.accessToken);
    expect(response.status).toBe(200);
    const partner = await P.ApiPartner.findOne({ publicId: sourceId }).lean();
    expect(check).toHaveBeenCalledWith("public-partner:" + partner!._id, 7, 60);
  });
  it("rejects unsafe bridge transport and reused signing secrets", () => {
    const base = {
      NODE_ENV: "test",
      MONGODB_URI: "mongodb://127.0.0.1/aibus_public_sandbox_bridge",
      JWT_SECRET: "d".repeat(64),
      SANDBOX_PORTAL_BRIDGE_SECRET: "b".repeat(64),
    };
    for (const url of [
      "http://untrusted.test",
      "https://user:password@example.test",
      "https://example.test/path",
      "https://example.test/?token=secret",
    ])
      expect(() => readConfig({ ...base, SANDBOX_PORTAL_URL: url })).toThrow();
    expect(() =>
      readConfig({ ...base, SANDBOX_PORTAL_BRIDGE_SECRET: base.JWT_SECRET }),
    ).toThrow();
  });
  it("reports sandbox readiness from the isolated backend without inventing grants", async () => {
    const overview = await execute(operation("/overview", "GET", {}));
    expect(overview.status).toBe(200);
    expect(overview.body.data).toMatchObject({
      sandboxAvailable: true,
      productionAvailable: false,
      authorizedTrips: 0,
      bookings: 0,
    });
    const status = await execute(operation("/integration-status", "GET", {}));
    expect(status.body.data).toMatchObject({
      sandboxReady: true,
      productionAccess: false,
      activeCredentials: 0,
      activeGrants: 0,
    });
  });
  it("fails closed without a signed proof and rejects edited body, audience and expired proofs", async () => {
    const body = operation();
    expect((await execute(body, sourceId, "invalid")).status).toBe(401);
    const proof = bridgeProof(config, "execute", sourceId, actorId, body);
    expect(
      (await execute({ ...body, path: "/inventory" }, sourceId, proof)).status,
    ).toBe(401);
    expect(
      (
        await execute(
          body,
          sourceId,
          bridgeProof(config, "entitlement", sourceId, actorId, body),
        )
      ).status,
    ).toBe(401);
    const expired = jwt.sign(
      { purpose: "execute", digest: "0".repeat(64), actorId },
      config.SANDBOX_PORTAL_BRIDGE_SECRET!,
      {
        subject: sourceId,
        issuer: "aibus-private-bridge",
        audience: "aibus-sandbox-execute",
        expiresIn: -1,
      },
    );
    expect((await execute(body, sourceId, expired)).status).toBe(401);
    expect(await P.ApiCredential.countDocuments()).toBe(0);
  });
  it("issues a real sandbox key once without granting production or test inventory", async () => {
    const body = operation();
    const first = await execute(body);
    expect(first.status).toBe(200);
    expect(first.body.data.credential).toMatch(/^ap_sandbox_cred_/);
    expect((await execute(body)).body.error.code).toBe(
      "COMMAND_ALREADY_APPLIED",
    );
    expect(await P.ApiCredential.countDocuments()).toBe(1);
    expect(await P.PartnerInventoryGrant.countDocuments()).toBe(0);
    expect(await M.Operator.countDocuments()).toBe(0);
    const listed = await execute(operation("/credentials", "GET", {}));
    expect(listed.body.data).toHaveLength(1);
    expect(JSON.stringify(listed.body)).not.toContain(
      first.body.data.credential,
    );
    expect(JSON.stringify(listed.body)).not.toContain("secretHash");
    expect((await tokenFor(first.body.data.credential)).status).toBe(200);
  });
  it("handles concurrent duplicate commands without issuing duplicate secrets", async () => {
    const body = operation();
    const results = await Promise.all([execute(body), execute(body)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await P.ApiCredential.countDocuments()).toBe(1);
  });
  it("preserves the request key after an uncertain response and rejects changed content", async () => {
    const body = operation();
    await execute(body);
    const retry = await execute({
      ...body,
      body: { ...body.body, label: "Changed content" },
    });
    expect(retry.status).toBe(409);
    expect(retry.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(await P.ApiCredential.countDocuments()).toBe(1);
  });
  it("isolates two companies and denies cross-company revocation", async () => {
    const first = await issue();
    const secondSource = publicId("partner");
    const second = await execute(operation(), secondSource);
    expect(second.status).toBe(200);
    const listed = await execute(
      operation("/credentials", "GET", {}),
      secondSource,
    );
    expect(listed.body.data.map((x: any) => x.publicId)).toEqual([
      second.body.data.id,
    ]);
    const revoked = await execute(
      operation(`/credentials/${first.id}/revoke`, "POST", {
        key: randomUUID(),
        reason: "Reviewed revoke attempt",
      }),
      secondSource,
    );
    expect(revoked.status).toBe(404);
    expect((await tokenFor(first.credential)).status).toBe(200);
  });
  it("revokes existing access tokens and rotates atomically", async () => {
    const first = await issue();
    const auth = await tokenFor(first.credential);
    const rotated = await issue({ rotateId: first.id });
    expect((await tokenFor(first.credential)).status).toBe(401);
    expect(
      (
        await request(app)
          .get("/api/v1/public/capabilities")
          .set("Authorization", "Bearer " + auth.body.data.accessToken)
      ).status,
    ).toBe(401);
    expect((await tokenFor(rotated.credential)).status).toBe(200);
    expect(
      (
        await execute(
          operation(`/credentials/${rotated.id}/revoke`, "POST", {
            key: randomUUID(),
            reason: "Revoke test credential",
          }),
        )
      ).status,
    ).toBe(200);
    expect((await tokenFor(rotated.credential)).status).toBe(401);
  });
  it("checks source suspension and member permissions on every token use", async () => {
    const key = await issue();
    const auth = await tokenFor(key.credential);
    transport.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "PARTNER_PERMISSION",
            message: "Source organization suspended",
          },
        }),
        { status: 403 },
      ),
    );
    expect((await tokenFor(key.credential)).status).toBe(403);
    expect(
      (
        await request(app)
          .get("/api/v1/public/cities")
          .set("Authorization", "Bearer " + auth.body.data.accessToken)
      ).status,
    ).toBe(403);
  });
  it("fails closed on a control-plane timeout and never leaks upstream transport details", async () => {
    const key = await issue();
    transport.mockRejectedValue(new Error("private-url-and-password"));
    const response = await tokenFor(key.credential);
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain(
      "private-url-and-password",
    );
  });
  it("limits scopes and passenger access from current source policy", async () => {
    source.permissions = ["partner:credentials:write", "partner:playground"];
    expect(
      (
        await execute(
          operation(
            "/credentials",
            "POST",
            issueBody({ scopes: ["tickets:read"] }),
          ),
        )
      ).status,
    ).toBe(403);
    source.scopes = ["inventory:read"];
    expect(
      (
        await execute(
          operation(
            "/credentials",
            "POST",
            issueBody({ scopes: ["holds:write"] }),
          ),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await execute(
          operation("/playground", "POST", {
            operationId: "ticket",
            params: { id: publicId("booking") },
          }),
        )
      ).status,
    ).toBe(403);
  });
  it("runs the allowlisted Playground without returning its ephemeral credential", async () => {
    const response = await execute(
      operation("/playground", "POST", { operationId: "capabilities" }),
    );
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.data.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toContain("ap_sandbox_");
    expect(
      await P.ApiCredential.countDocuments({
        portalManaged: true,
        revokedAt: null,
      }),
    ).toBe(0);
    expect(
      (
        await execute(
          operation("/playground", "POST", {
            operationId: "https://evil.test",
          }),
        )
      ).status,
    ).toBe(400);
  });
  it("authenticates the portal locally, verifies step-up, and strips passwords before forwarding", async () => {
    const partner = await P.ApiPartner.create({
      publicId: sourceId,
      name: "Control plane",
      scopes: [...publicScopes],
    });
    const user = await M.User.create({
      name: "Control Owner",
      email: "owner@bridge.test",
      role: "partner",
      partnerRole: "Owner",
      partnerId: partner._id,
      passwordHash: hash,
    });
    const session = await M.Session.create({
      userId: user._id,
      client: "partner",
      family: randomUUID(),
      refreshHash: randomUUID(),
      expiresAt: new Date(Date.now() + 3600000),
    });
    const token = signAccess(String(user._id), String(session._id), config);
    const send = (body: any, bearer = token) =>
      request(app)
        .post("/api/v1/partner/credentials")
        .set("Authorization", "Bearer " + bearer)
        .send(body);
    expect((await send({ ...issueBody(), password: "wrong" })).status).toBe(
      403,
    );
    expect(transport).not.toHaveBeenCalled();
    const response = await send({ ...issueBody(), password });
    expect(response.status).toBe(201);
    expect(JSON.stringify(transport.mock.calls)).not.toContain(password);
    expect(JSON.stringify(transport.mock.calls)).not.toContain(token);
    expect(response.body.data.received.body.password).toBeUndefined();
    await M.Session.updateOne(
      { _id: session._id },
      { $set: { revokedAt: new Date() } },
    );
    expect((await send({ ...issueBody(), password })).status).toBe(401);
  });
  it("keeps the production sandbox guard and private endpoints disabled by default", async () => {
    const unconfigured = createApp(
      {
        ...config,
        SANDBOX_CONTROL_URL: undefined,
        SANDBOX_PORTAL_URL: undefined,
      },
      { check: async () => true },
    );
    expect(
      (
        await request(unconfigured)
          .post("/internal/sandbox-portal/execute")
          .send({})
      ).status,
    ).toBe(404);
    const production = createApp(
      { ...config, NODE_ENV: "production", PUBLIC_API_SANDBOX: false },
      { check: async () => true },
    );
    expect(
      (
        await request(production)
          .post("/internal/sandbox-portal/execute")
          .send({})
      ).status,
    ).toBe(401);
    expect(
      (await request(production).post("/api/v1/public/auth/token").send({}))
        .status,
    ).toBe(503);
  });
});
