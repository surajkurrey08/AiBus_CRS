import { reviewPartner } from "../../src/services/partner-portal.service.js";
import jwt from "jsonwebtoken";
import { principal } from "../../src/services/auth.service.js";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createHmac, randomUUID } from "node:crypto";
import * as M from "../../src/models/index.js";
import * as P from "../../src/models/public-api.model.js";
import { createApp } from "../../src/app.js";
import { readConfig } from "../../src/config/env.js";
import { hashPassword, signAccess } from "../../src/services/auth.service.js";
import {
  publicId,
  publicScopes,
} from "../../src/services/public-auth.service.js";
import {
  deliverPartnerWebhooks,
  webhookSecret,
} from "../../src/services/public-webhook.service.js";
const password = "Isolated-portal-password-2026",
  origin = "http://127.0.0.1:5176";
const config = readConfig({
  NODE_ENV: "test",
  MONGODB_URI: "mongodb://127.0.0.1/aibus_public_sandbox_portal",
  JWT_SECRET: "d".repeat(64),
  CAR_PROVIDER_JWT_SECRET: "c".repeat(64),
  CAR_SANDBOX_DEMO_OPERATOR_ID: "b4eede3b6d7e78a69446fd8d",
  PUBLIC_API_SANDBOX: "true",
  PUBLIC_API_JWT_SECRET: "p".repeat(64),
  PUBLIC_WEBHOOK_SIGNING_KEY: "b".repeat(64),
  PUBLIC_WEBHOOK_ALLOWED_HOSTS: "partner.example.test",
  RAZORPAY_KEY_ID: "rzp_test_portal_fixture",
  RAZORPAY_KEY_SECRET: "portal-fixture-secret-not-a-real-key",
  FINANCE_TEST_MODE: "true",
});
const app = createApp(config, { check: async () => true });
let mongo: MongoMemoryReplSet,
  hash: string,
  partner: any,
  other: any,
  owner: any,
  admin: any,
  token: string,
  adminToken: string;
async function session(user: any, client = "partner") {
  const s = await M.Session.create({
    userId: user._id,
    client,
    family: randomUUID(),
    refreshHash: randomUUID(),
    expiresAt: new Date(Date.now() + 3600000),
  });
  return signAccess(String(user._id), String(s._id), config);
}
const get = (path: string, auth = token) =>
  request(app)
    .get("/api/v1" + path)
    .set("Authorization", "Bearer " + auth);
const post = (path: string, body: any, auth = token) =>
  request(app)
    .post("/api/v1" + path)
    .set("Origin", origin)
    .set("X-Aibus-Client", "partner")
    .set("Authorization", "Bearer " + auth)
    .send(body);
const reviewed = (extra: any = {}) => ({
  password,
  reason: "Reviewed isolated test request",
  key: randomUUID(),
  ...extra,
});
const application = (extra: any = {}) => ({
  name: "New Company",
  contactPerson: "Owner Example",
  businessEmail: "new@portal.test",
  phone: "9000000000",
  address: "Pune test address",
  technicalEmail: "tech@portal.test",
  intendedUsage: "Sandbox bus integration",
  requestedEnvironment: "Sandbox",
  password,
  ...extra,
});
const issue = (extra: any = {}) =>
  post(
    "/partner/credentials",
    reviewed({
      label: "Test server key",
      scopes: ["inventory:read"],
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      ...extra,
    }),
  );
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "7.0.14" },
  });
  await mongoose.connect(mongo.getUri("aibus_public_sandbox_portal"));
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  hash = await hashPassword(password);
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  for (const m of Object.values(mongoose.models))
    await m.collection.deleteMany({});
  partner = await P.ApiPartner.create({
    publicId: publicId("partner"),
    name: "Partner One",
    scopes: [...publicScopes],
    portalActivatedAt: new Date(),
  });
  other = await P.ApiPartner.create({
    publicId: publicId("partner"),
    name: "Partner Two",
    scopes: [...publicScopes],
  });
  owner = await M.User.create({
    name: "Portal Owner",
    email: "owner@portal.test",
    role: "partner",
    partnerId: partner._id,
    partnerRole: "Owner",
    passwordHash: hash,
  });
  admin = await M.User.create({
    name: "Root Admin",
    email: "root@portal.test",
    role: "super_admin",
    passwordHash: hash,
  });
  token = await session(owner);
  adminToken = await session(admin, "admin");
});
describe("Phase 8 partner platform boundaries", () => {
  it("Car portal tokens require approval, full scopes, password and passenger permission", async () => {
    await P.ApiPartner.updateOne({_id: partner._id}, {$set: {status: "Active", onboardingStatus: "Approved"}});
    expect((await post("/partner/car/token", {password: "wrong"})).status).toBe(403);
    const result = await post("/partner/car/token", {password});
    expect(result.status).toBe(200);
    const claims = jwt.verify(result.body.data.token, "c".repeat(64), {audience: "car-provider-sandbox", algorithms: ["HS256"]}) as jwt.JwtPayload;
    expect(claims.sub).toBe(String(partner._id));
    expect(claims.operatorId).toBe(config.CAR_SANDBOX_DEMO_OPERATOR_ID);
    expect(claims.exp! - claims.iat!).toBe(2700);
    await M.User.updateOne({_id: owner._id}, {$set: {partnerRole: "Developer"}});
    expect((await post("/partner/car/token", {password})).status).toBe(403);
    await M.User.updateOne({_id: owner._id}, {$set: {partnerRole: "Owner"}});
    await P.ApiPartner.updateOne({_id: partner._id}, {$set: {scopes: ["inventory:read"]}});
    expect((await post("/partner/car/token", {password})).status).toBe(403);
    await P.ApiPartner.updateOne({_id: partner._id}, {$set: {status: "Suspended"}});
    expect((await post("/partner/car/token", {password})).status).toBe(403);
  });
  it("registers a submitted organization without credentials or inventory", async () => {
    const r = await post("/partner/applications", application(), "");
    expect(r.status).toBe(201);
    expect(r.body.data.status).toBe("Submitted");
    const p = await P.ApiPartner.findOne({ publicId: r.body.data.id });
    expect(p?.status).toBe("Suspended");
    expect(p?.scopes).toEqual([]);
    const review = await get("/platform/api-partners/" + p!._id, adminToken);
    expect(review.status).toBe(200);
    expect(review.body.data.partner.onboardingStatus).toBe("Submitted");
    expect(review.body.data.inventory.trips).toEqual([]);
    expect(await P.ApiCredential.countDocuments()).toBe(0);
    expect(await P.PartnerInventoryGrant.countDocuments()).toBe(0);
    expect(JSON.stringify(r.body)).not.toContain(password);
  });
  it("accepts empty optional company registration details without rejecting the application", async () => {
    const r = await post(
      "/partner/applications",
      application({ registrationDetails: "   " }),
      "",
    );
    expect(r.status).toBe(201);
    const row = await P.ApiPartner.findOne({ publicId: r.body.data.id }).lean();
    expect(row?.registrationDetails).toBeUndefined();
  });
  it("submits a draft once with its private expiring token", async () => {
    const r = await post(
      "/partner/applications",
      application({ submit: false }),
      "",
    );
    expect(r.status).toBe(201);
    expect(
      (
        await post(
          "/partner/applications/" + r.body.data.id + "/submit",
          { submissionToken: r.body.data.submissionToken },
          "",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await post(
          "/partner/applications/" + r.body.data.id + "/submit",
          { submissionToken: r.body.data.submissionToken },
          "",
        )
      ).status,
    ).toBe(404);
  });
  it("rejects forged registration tenant identifiers and duplicate identities", async () => {
    expect(
      (
        await post(
          "/partner/applications",
          application({ operatorId: String(admin._id) }),
          "",
        )
      ).status,
    ).toBe(400);
    await post("/partner/applications", application(), "");
    expect(
      (await post("/partner/applications", application(), "")).status,
    ).toBe(409);
    expect(await P.ApiPartner.countDocuments({ name: "New Company" })).toBe(1);
  });
  it("approves registration with explicit root authority, no automatic grants", async () => {
    const r = await post("/partner/applications", application(), "");
    const p = await P.ApiPartner.findOne({ publicId: r.body.data.id });
    await reviewPartner(
      await principal(adminToken, config),
      String(p!._id),
      reviewed({ version: 0, status: "Under Review" }),
    );
    const a = await post(
      "/platform/api-partners/" + p!._id + "/review",
      reviewed({ version: 1, status: "Approved", scopes: ["inventory:read"] }),
      adminToken,
    );
    expect(a.status).toBe(200);
    expect(
      (
        await request(app)
          .post("/api/v1/auth/login")
          .set("X-Aibus-Client", "partner")
          .send({ email: "new@portal.test", password })
      ).status,
    ).toBe(200);
    expect(await P.PartnerInventoryGrant.countDocuments()).toBe(0);
  });
  it("rejects an application and keeps its login unavailable", async () => {
    const r = await post("/partner/applications", application(), "");
    const p = await P.ApiPartner.findOne({ publicId: r.body.data.id });
    expect(
      (
        await post(
          "/platform/api-partners/" + p!._id + "/review",
          reviewed({ version: 0, status: "Rejected" }),
          adminToken,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post("/api/v1/auth/login")
          .set("X-Aibus-Client", "partner")
          .send({ email: "new@portal.test", password })
      ).status,
    ).toBe(401);
  });
  it("separates portal login from operator login and supports refresh/logout", async () => {
    expect(
      (
        await request(app)
          .post("/api/v1/auth/login")
          .send({ email: owner.email, password })
      ).status,
    ).toBe(403);
    const agent = request.agent(app);
    const r = await agent
      .post("/api/v1/auth/login")
      .set("X-Aibus-Client", "partner")
      .send({ email: owner.email, password });
    expect(r.status).toBe(200);
    expect(r.headers["set-cookie"][0]).toContain("aibus_partner_refresh");
    expect(
      (
        await agent
          .post("/api/v1/auth/refresh")
          .set("Origin", origin)
          .set("X-Aibus-Client", "partner")
      ).status,
    ).toBe(200);
    expect(
      (
        await agent
          .post("/api/v1/auth/logout")
          .set("Origin", origin)
          .set("X-Aibus-Client", "partner")
      ).status,
    ).toBe(200);
    expect(
      (
        await agent
          .post("/api/v1/auth/refresh")
          .set("Origin", origin)
          .set("X-Aibus-Client", "partner")
      ).status,
    ).toBe(401);
  });
  it("suspends organization sessions and all existing machine credentials", async () => {
    const key = await issue();
    expect(key.status).toBe(201);
    expect(
      (
        await post(
          "/platform/api-partners/" + partner._id + "/review",
          reviewed({ version: 1, status: "Suspended" }),
          adminToken,
        )
      ).status,
    ).toBe(200);
    expect((await get("/partner/overview")).status).toBe(401);
    expect(
      (
        await request(app)
          .post("/api/v1/auth/login")
          .set("X-Aibus-Client", "partner")
          .send({ email: owner.email, password })
      ).status,
    ).toBe(403);
    expect(
      (await P.ApiCredential.findOne({ publicId: key.body.data.id }))
        ?.revokedAt,
    ).toBeTruthy();
  });
  it("requires privileged review and rejects stale approval revisions", async () => {
    expect(
      (
        await post(
          "/platform/api-partners/" + partner._id + "/review",
          reviewed({ version: 0, status: "Suspended" }),
          token,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await post(
          "/platform/api-partners/" + partner._id + "/review",
          reviewed({ password: "wrong", version: 0, status: "Suspended" }),
          adminToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await post(
          "/platform/api-partners/" + partner._id + "/review",
          reviewed({ version: 9, status: "Suspended" }),
          adminToken,
        )
      ).status,
    ).toBe(409);
    expect((await P.ApiPartner.findById(partner._id))?.revision).toBe(0);
  });
  it("returns new secrets once and persists only hash and safe metadata", async () => {
    const key = await issue();
    expect(key.status).toBe(201);
    expect(key.body.data.credential).toMatch(/^ap_sandbox_cred_/);
    const row = await P.ApiCredential.findOne({ publicId: key.body.data.id })
      .select("+secretHash")
      .lean();
    expect(row?.secretHash).not.toContain(key.body.data.credential);
    const list = await get("/partner/credentials");
    expect(list.body.data).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain("secretHash");
    expect(JSON.stringify(list.body)).not.toContain(key.body.data.credential);
    expect(JSON.stringify(await M.Audit.find({}).lean())).not.toContain(
      key.body.data.credential,
    );
  });
  it("does not reissue credentials after an uncertain response retry", async () => {
    const body = reviewed({
      label: "Stable",
      scopes: ["inventory:read"],
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    expect((await post("/partner/credentials", body)).status).toBe(201);
    const replay = await post("/partner/credentials", body);
    expect(replay.status).toBe(409);
    expect(replay.body.error.code).toBe("COMMAND_ALREADY_APPLIED");
    expect(await P.ApiCredential.countDocuments()).toBe(1);
  });
  it("rotates credentials atomically and invalidates existing machine tokens", async () => {
    const old = await issue(),
      auth = await request(app)
        .post("/api/v1/public/auth/token")
        .set("Authorization", "Bearer " + old.body.data.credential)
        .send({});
    expect(auth.status).toBe(200);
    const next = await issue({ rotateId: old.body.data.id });
    expect(next.status).toBe(201);
    expect(
      (
        await request(app)
          .get("/api/v1/public/capabilities")
          .set("Authorization", "Bearer " + auth.body.data.accessToken)
      ).status,
    ).toBe(401);
    expect(
      (await P.ApiCredential.findOne({ publicId: old.body.data.id }))
        ?.revokedAt,
    ).toBeTruthy();
  });
  it("revokes only organization-owned credentials", async () => {
    const key = await issue();
    const u = await M.User.create({
      name: "Other Owner",
      email: "other@portal.test",
      role: "partner",
      partnerId: other._id,
      partnerRole: "Owner",
      passwordHash: hash,
    });
    expect(
      (
        await post(
          "/partner/credentials/" + key.body.data.id + "/revoke",
          reviewed(),
          await session(u),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await post(
          "/partner/credentials/" + key.body.data.id + "/revoke",
          reviewed(),
        )
      ).status,
    ).toBe(200);
  });
  it("applies scope ceilings and bounded credential expiration", async () => {
    await P.ApiPartner.updateOne(
      { _id: partner._id },
      { $set: { scopes: ["inventory:read"] } },
    );
    expect((await issue({ scopes: ["bookings:write"] })).status).toBe(400);
    expect((await issue({ expiresAt: "2035-01-01T00:00:00Z" })).status).toBe(
      400,
    );
    expect((await issue({ password: "wrong" })).status).toBe(403);
    expect(await P.ApiCredential.countDocuments()).toBe(0);
  });
  it("shows no authorized trips or grants without explicit platform grants", async () => {
    const r = await get("/partner/inventory");
    expect(r.status).toBe(200);
    expect(r.body.data.grants).toEqual([]);
    expect(r.body.data.trips).toEqual([]);
    expect(
      (await post("/partner/inventory", { operatorId: String(admin._id) }))
        .status,
    ).toBe(404);
  });
  it("rejects admin grants for resources owned by another operator", async () => {
    const o = await M.Operator.create({
      company: "Test sandbox",
      email: "op@portal.test",
      status: "approved",
      publicSandboxInventory: true,
    });
    expect(
      (
        await post(
          "/platform/api-partners/" + partner._id + "/grants",
          reviewed({
            operatorId: String(o._id),
            kind: "Operator",
            targetId: String(admin._id),
            active: true,
            expiresAt: "2031-01-01T00:00:00Z",
          }),
          adminToken,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await post(
          "/platform/api-partners/" + partner._id + "/grants",
          reviewed({
            operatorId: String(o._id),
            kind: "Operator",
            targetId: String(o._id),
            active: true,
            expiresAt: "2031-01-01T00:00:00Z",
          }),
          adminToken,
        )
      ).status,
    ).toBe(200);
  });
  it("executes existing public API through the sandbox playground without exposing its credential", async () => {
    const r = await post("/partner/playground", {
      operationId: "capabilities",
      body: {},
    });
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe(200);
    expect(r.body.data.response.data.productionCredentials).toBe(false);
    expect(JSON.stringify(r.body)).not.toContain("ap_sandbox_");
    const key = await P.ApiCredential.findOne({ portalManaged: true });
    expect(key?.revokedAt).toBeTruthy();
    expect((await get("/partner/credentials")).body.data).toHaveLength(0);
  });
  it("rejects arbitrary playground targets, methods and authentication operations", async () => {
    expect(
      (
        await post("/partner/playground", {
          operationId: "capabilities",
          url: "http://127.0.0.1",
        })
      ).status,
    ).toBe(400);
    expect(
      (await post("/partner/playground", { operationId: "authenticate" }))
        .status,
    ).toBe(400);
    expect(
      (await post("/partner/playground", { operationId: "../../platform" }))
        .status,
    ).toBe(400);
  });
  it("keeps the public sandbox disabled outside a dedicated database", async () => {
    const db = mongoose.connection.name;
    try {
      mongoose.connection.name = "ordinary_crs";
      expect(
        (await post("/partner/playground", { operationId: "capabilities" }))
          .status,
      ).toBe(503);
      expect((await issue()).status).toBe(503);
    } finally {
      mongoose.connection.name = db;
    }
    expect(() =>
      readConfig({
        NODE_ENV: "production",
        PUBLIC_API_SANDBOX: "true",
        JWT_SECRET: "z".repeat(64),
      }),
    ).toThrow();
  });
  it("keeps booking history and booking detail isolated by organization", async () => {
    await P.PartnerBookingReference.create({
      partnerId: other._id,
      publicId: publicId("booking"),
      reference: "private-other",
      operatorId: new mongoose.Types.ObjectId(),
    });
    expect((await get("/partner/bookings")).body.data).toEqual([]);
    const ref = await P.PartnerBookingReference.findOne({
      partnerId: other._id,
    });
    expect((await get("/partner/bookings/" + ref!.publicId)).status).toBe(404);
    expect((await get("/partner/bookings?partnerId=" + other._id)).status).toBe(
      400,
    );
  });
  it("registers a webhook with one-time signing secret, rotates and queues a safe test", async () => {
    const r = await post(
      "/partner/webhooks",
      reviewed({ url: "https://partner.example.test/hook" }),
    );
    expect(r.status).toBe(201);
    expect(r.body.data.signingSecret).toHaveLength(64);
    expect(JSON.stringify((await get("/partner/webhooks")).body)).not.toContain(
      r.body.data.signingSecret,
    );
    const rotate = await post(
      "/partner/webhooks/" + r.body.data.id,
      reviewed({ action: "rotate" }),
    );
    expect(rotate.status).toBe(200);
    expect(rotate.body.data.signingSecret).not.toBe(r.body.data.signingSecret);
    expect(
      (
        await post(
          "/partner/webhooks/" + r.body.data.id,
          reviewed({ action: "test" }),
        )
      ).status,
    ).toBe(200);
    let observed = "";
    await deliverPartnerWebhooks(config, async (_c, _u, body) => {
      observed = body;
      return true;
    });
    expect(JSON.parse(observed).type).toBe("integration.test");
    expect(observed).not.toContain(password);
    expect((await P.PartnerWebhookDelivery.findOne())?.status).toBe(
      "Delivered",
    );
  });
  it("rejects unsafe callback destinations before queuing any delivery", async () => {
    for (const url of [
      "http://partner.example.test/hook",
      "https://127.0.0.1/hook",
      "https://user:pass@partner.example.test/hook",
      "https://not-allowed.test/hook",
    ]) {
      expect((await post("/partner/webhooks", reviewed({ url }))).status).toBe(
        400,
      );
    }
    expect(await P.PartnerWebhookSubscription.countDocuments()).toBe(0);
  });
  it("allows a single bounded manual retry without resetting attempt history", async () => {
    const sub = await P.PartnerWebhookSubscription.create({
      partnerId: partner._id,
      publicId: publicId("sub"),
      url: "https://partner.example.test/hook",
    });
    const event = await P.PartnerWebhookEvent.create({
      partnerId: partner._id,
      publicId: publicId("evt"),
      key: "retry",
      type: "integration.test",
    });
    const d = await P.PartnerWebhookDelivery.create({
      partnerId: partner._id,
      subscriptionId: sub._id,
      eventId: event._id,
      status: "Manual review",
      attempts: 5,
    });
    expect(
      (await post("/partner/deliveries/" + d._id + "/retry", reviewed()))
        .status,
    ).toBe(200);
    await deliverPartnerWebhooks(config, async () => true);
    expect((await P.PartnerWebhookDelivery.findById(d._id))?.attempts).toBe(6);
    expect(
      await P.PartnerWebhookAttempt.countDocuments({
        deliveryId: d._id,
        attempt: 6,
      }),
    ).toBe(1);
    expect(
      (await post("/partner/deliveries/" + d._id + "/retry", reviewed()))
        .status,
    ).toBe(409);
  });
  it("filters usage and exports only owned safe request metadata", async () => {
    await P.PartnerApiUsage.create([
      {
        partnerId: partner._id,
        operation: "GET /cities",
        requestId: "own",
        status: 200,
        durationMs: 10,
      },
      {
        partnerId: other._id,
        operation: "GET /cities",
        requestId: "other-private",
        status: 500,
        durationMs: 20,
      },
    ]);
    const r = await get(
      "/partner/usage/summary?endpoint=GET%20%2Fcities&status=200",
    );
    expect(r.body.data.total).toBe(1);
    expect(r.body.data.success).toBe(1);
    const csv = await get("/partner/usage/export");
    expect(csv.status).toBe(200);
    expect(csv.text).toContain("own");
    expect(csv.text).not.toContain("other-private");
  });
  it("enforces read-only team and export permissions server-side", async () => {
    await M.User.updateOne(
      { _id: owner._id },
      { $set: { partnerRole: "Read Only" } },
    );
    expect((await issue()).status).toBe(403);
    expect((await get("/partner/usage/export")).status).toBe(403);
    expect(
      (await post("/partner/playground", { operationId: "capabilities" }))
        .status,
    ).toBe(403);
    expect((await get("/partner/overview")).status).toBe(200);
  });
  it("adds organization users and revokes sessions when roles change", async () => {
    const r = await post(
      "/partner/team",
      reviewed({
        name: "Developer",
        email: "dev@portal.test",
        role: "Developer",
        initialPassword: password,
      }),
    );
    expect(r.status).toBe(201);
    const u = await M.User.findById(r.body.data.id),
      t = await session(u);
    expect((await get("/partner/team", t)).status).toBe(200);
    const issued = await post(
      "/partner/credentials",
      reviewed({
        label: "Developer scoped",
        scopes: ["inventory:read"],
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      }),
      t,
    );
    expect(issued.status).toBe(201);
    expect(
      (
        await post(
          "/partner/credentials",
          reviewed({
            label: "Escalated",
            scopes: ["tickets:read"],
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
          }),
          t,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await post(
          "/partner/team/" + r.body.data.id,
          reviewed({ role: "Read Only", active: true }),
        )
      ).status,
    ).toBe(200);
    expect((await get("/partner/overview", t)).status).toBe(401);
    expect(
      (await P.ApiCredential.findOne({ publicId: issued.body.data.id }).lean())
        ?.revokedAt,
    ).toBeTruthy();
  });
  it("prevents admin ownership escalation and self removal", async () => {
    await M.User.updateOne(
      { _id: owner._id },
      { $set: { partnerRole: "Admin" } },
    );
    expect(
      (
        await post(
          "/partner/team",
          reviewed({
            name: "Forged Owner",
            email: "forged@portal.test",
            role: "Owner",
            initialPassword: password,
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await post(
          "/partner/team/" + owner._id,
          reviewed({ role: "Read Only", active: false }),
        )
      ).status,
    ).toBe(409);
  });
  it("blocks partner sessions from platform, operator and agent management", async () => {
    expect((await get("/platform/api-partners")).status).toBe(403);
    expect((await get("/operator/buses")).status).toBe(403);
    expect((await get("/agent/overview")).status).toBe(403);
    expect((await get("/partner/overview", adminToken)).status).toBe(403);
  });
  it("enforces partner-cookie origin protection", async () => {
    expect(
      (
        await request(app)
          .post("/api/v1/auth/refresh")
          .set("Cookie", "aibus_partner_refresh=fake")
          .set("X-Aibus-Client", "partner")
      ).status,
    ).toBe(403);
    expect(
      (await post("/partner/playground", { operationId: "capabilities" }))
        .status,
    ).toBe(200);
  });
  it("keeps support records scoped and permits reviewed admin responses", async () => {
    const r = await post("/partner/support", {
      subject: "Integration question",
      message: "Request ID abc failed",
      key: randomUUID(),
    });
    expect(r.status).toBe(201);
    expect(
      (
        await post(
          "/platform/api-partners/" +
            partner._id +
            "/support/" +
            r.body.data.id,
          reviewed({
            response: "Check the sandbox request scope",
            status: "Resolved",
          }),
          adminToken,
        )
      ).status,
    ).toBe(200);
    expect((await get("/partner/support")).body.data[0].status).toBe(
      "Resolved",
    );
    const u = await M.User.create({
      name: "Other",
      email: "other@portal.test",
      role: "partner",
      partnerId: other._id,
      partnerRole: "Owner",
      passwordHash: hash,
    });
    expect((await get("/partner/support", await session(u))).body.data).toEqual(
      [],
    );
  });
  it("retains the legacy signing key for existing version-one subscriptions", () => {
    expect(webhookSecret(config, "a", "b")).toBe(
      webhookSecret(config, "a", "b", 1),
    );
    expect(webhookSecret(config, "a", "b", 2)).not.toBe(
      webhookSecret(config, "a", "b", 1),
    );
  });
  it("completes the portal sandbox hold-to-ticket flow through the existing reservation and ledger engine", async () => {
    const o = await M.Operator.create({
      company: "Portal Sandbox Operator",
      email: "sandbox@portal.test",
      status: "approved",
      publicSandboxInventory: true,
    });
    const bus = await M.Bus.create({
      operatorId: o._id,
      registration: "MH12PT1234",
      name: "Portal bus",
      type: "AC Sleeper",
      capacity: 2,
    });
    const route = await M.Route.create({
      operatorId: o._id,
      source: "Pune",
      destination: "Mumbai",
      boarding: [{ name: "Wakad" }],
      dropping: [{ name: "Dadar" }],
      departure: "20:00",
      arrival: "23:00",
      durationMinutes: 180,
    });
    const trip = await M.Trip.create({
      operatorId: o._id,
      busId: bus._id,
      routeId: route._id,
      journeyDate: "2030-11-20",
      departureAt: new Date("2030-11-20T20:00:00+05:30"),
      seats: ["L1", "L2"].map((number, column) => ({
        number,
        column,
        row: 0,
        deck: "lower",
        category: "sleeper",
        farePaise: 100000,
        state: "available",
      })),
    });
    await M.PricingPolicy.create({
      operatorId: o._id,
      taxBasisPoints: 0,
      chargePaise: 0,
      chargesTaxable: false,
      operatorDiscountMaxPaise: 0,
      requireAge: false,
      requireGender: false,
      requireMobile: false,
      gstEnabled: false,
    });
    await P.PartnerInventoryGrant.create({
      partnerId: partner._id,
      operatorId: o._id,
      kind: "Trip",
      targetId: trip._id,
      expiresAt: new Date("2031-01-01"),
    });
    const call = async (operationId: string, values: any = {}) => {
      const r = await post("/partner/playground", { operationId, ...values });
      expect(r.status).toBe(200);
      return r.body.data;
    };
    const inventory = await get("/partner/inventory"),
      id = inventory.body.data.trips[0].id;
    const hold = await call("seatHold", {
      params: { id },
      body: { seats: ["L1"] },
      idempotencyKey: randomUUID(),
    });
    expect(hold.status).toBe(201);
    const quote = await call("fareRecheck", {
      params: { id },
      body: { seats: ["L1"], holdId: hold.response.data.id },
    });
    expect(quote.status).toBe(200);
    const key = randomUUID(),
      body = {
        tripId: id,
        holdId: hold.response.data.id,
        quoteId: quote.response.data.id,
        partnerReference: "portal-booking-one",
        passengers: [
          {
            name: "Protected Passenger",
            seat: "L1",
            boarding: "Wakad",
            dropping: "Dadar",
          },
        ],
      };
    const created = await call("pendingBooking", { body, idempotencyKey: key });
    expect(created.status).toBe(201);
    const replay = await call("pendingBooking", { body, idempotencyKey: key });
    expect(replay.response.data.id).toBe(created.response.data.id);
    const previousFetch = globalThis.fetch;
    const orderId = "order_portalfixture",
      paymentId = "pay_portalfixture";
    let confirmation: any;
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.origin !== "https://api.razorpay.com")
        throw Error("Unexpected provider host");
      if (url.pathname === "/v1/orders" && init?.method === "POST") {
        const order = JSON.parse(String(init.body));
        return Response.json({
          id: orderId,
          amount: order.amount,
          currency: order.currency,
          receipt: order.receipt,
          partial_payment: false,
        });
      }
      if (
        url.pathname === `/v1/payments/${paymentId}` &&
        init?.method === "GET"
      )
        return Response.json({
          id: paymentId,
          order_id: orderId,
          amount: created.response.data.totalPaise,
          currency: "INR",
          amount_refunded: 0,
          status: "captured",
          captured: true,
        });
      throw Error("Unexpected provider request");
    };
    try {
      const started = await call("startTestPayment", {
        params: { id: created.response.data.id },
        body: {},
        idempotencyKey: randomUUID(),
      });
      expect(started.status).toBe(200);
      expect(started.response.data).toMatchObject({
        mode: "test",
        orderId,
        amountPaise: created.response.data.totalPaise,
      });
      const verifyBody = {
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: createHmac("sha256", config.RAZORPAY_KEY_SECRET!)
          .update(`${orderId}|${paymentId}`)
          .digest("hex"),
      };
      const verifyKey = randomUUID();
      confirmation = await call("verifyTestPayment", {
        params: { id: created.response.data.id },
        body: verifyBody,
        idempotencyKey: verifyKey,
      });
      const verifiedReplay = await call("verifyTestPayment", {
        params: { id: created.response.data.id },
        body: verifyBody,
        idempotencyKey: verifyKey,
      });
      expect(verifiedReplay.response.data.pnr).toBe(
        confirmation.response.data.pnr,
      );
      expect(await M.PaymentOrder.countDocuments()).toBe(1);
      expect(await M.Ticket.countDocuments()).toBe(1);
    } finally {
      globalThis.fetch = previousFetch;
    }
    expect(confirmation.status).toBe(200);
    expect(confirmation.response.data.status).toBe("Confirmed");
    const ticket = await call("ticket", {
      params: { id: created.response.data.id },
    });
    expect(ticket.status).toBe(200);
    expect(ticket.response.data.pnr).toBeTruthy();
    const history = await get("/partner/bookings");
    expect(history.body.data[0].route).toBe("Pune \u2192 Mumbai");
    expect(history.body.data[0].aibusReference).toBeTruthy();
    expect(JSON.stringify(history.body)).not.toContain("Protected Passenger");
    await M.User.updateOne(
      { _id: owner._id },
      { $set: { partnerRole: "Developer" } },
    );
    expect(
      (
        await post("/partner/playground", {
          operationId: "ticket",
          params: { id: created.response.data.id },
        })
      ).status,
    ).toBe(403);
    expect(
      JSON.stringify(
        (await get("/partner/bookings/" + created.response.data.id)).body,
      ),
    ).not.toContain("Protected Passenger");
    expect((await M.Trip.findById(trip._id).lean())?.seats?.[0].state).toBe(
      "booked",
    );
    expect(await M.Payment.countDocuments()).toBe(1);
    expect(await M.JournalEntry.countDocuments()).toBeGreaterThan(0);
  });
});
