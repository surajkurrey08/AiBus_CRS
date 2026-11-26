import {
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
  expect,
  it,
  vi,
} from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { createApp } from "../../src/app.js";
import { readConfig } from "../../src/config/env.js";
import * as M from "../../src/models/index.js";
import { hashPassword, signAccess } from "../../src/services/auth.service.js";
import {
  publicId,
  generateCredential,
} from "../../src/services/public-auth.service.js";
import { bridgeProof } from "../../src/services/sandbox-bridge.transport.js";

const password = "Reviewed-inventory-fixture-password";
const config = readConfig({
  NODE_ENV: "test",
  MONGODB_URI: "mongodb://localhost/aibus_public_sandbox_inventory_admin",
  JWT_SECRET: "j".repeat(64),
  PUBLIC_API_SANDBOX: "true",
  PUBLIC_API_JWT_SECRET: "p".repeat(64),
  SANDBOX_PORTAL_BRIDGE_SECRET: "b".repeat(64),
  SANDBOX_PORTAL_URL: "https://sandbox.example.test",
  SANDBOX_CONTROL_URL: "https://control.example.test",
});
const sandbox = createApp(config, { check: async () => true });
const control = createApp(
  { ...config, PUBLIC_API_SANDBOX: false },
  { check: async () => true },
);
const transport = vi.fn();
let mongo: MongoMemoryReplSet,
  hash: string,
  admin: any,
  session: any,
  token: string,
  partner: any,
  owner: any,
  operator: any,
  trip: any,
  route: any;
const path = (suffix = "") =>
  `/api/v1/platform/api-partners/${partner._id}${suffix}`;
const get = (suffix: string, bearer = token) =>
  request(control).get(path(suffix)).set("Authorization", `Bearer ${bearer}`);
const grantBody = (extra = {}) => ({
  operatorId: String(operator._id),
  kind: "Trip",
  targetId: String(trip._id),
  active: true,
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  reason: "Reviewed partner test inventory",
  password,
  key: randomUUID(),
  ...extra,
});
const save = (body: any, bearer = token) =>
  request(control)
    .post(path("/grants"))
    .set("Authorization", `Bearer ${bearer}`)
    .send(body);
const privateRequest = (
  body: any,
  purpose: "execute" | "inventory-execute" = "inventory-execute",
  overrides = {},
) =>
  request(sandbox)
    .post("/internal/sandbox-portal/inventory-execute")
    .set(
      "Authorization",
      `Bearer ${bridgeProof(config, purpose, partner.publicId, String(admin._id), body)}`,
    )
    .send({ ...body, ...overrides });

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "7.0.14" },
  });
  await mongoose.connect(mongo.getUri("aibus_public_sandbox_inventory_admin"));
  await Promise.all(
    Object.values(mongoose.models).map((model) => model.init()),
  );
  hash = await hashPassword(password);
});
beforeEach(async () => {
  for (const model of Object.values(mongoose.models))
    await model.collection.deleteMany({});
  const sourceId = publicId("partner");
  partner = await M.ApiPartner.create({
    publicId: sourceId,
    portalSourcePublicId: sourceId,
    name: "Reviewed Company",
    scopes: ["inventory:read"],
  });
  // One disposable database models both sides of the signed transport. Real
  // deployments have separate databases and the same public organization ID.
  admin = await M.User.create({
    name: "Inventory Admin",
    email: "admin@inventory.test",
    role: "super_admin",
    passwordHash: hash,
  });
  session = await M.Session.create({
    userId: admin._id,
    client: "admin",
    family: randomUUID(),
    refreshHash: randomUUID(),
    expiresAt: new Date(Date.now() + 3600000),
  });
  token = signAccess(String(admin._id), String(session._id), config);
  owner = await M.User.create({
    name: "Company Owner",
    email: "owner@inventory.test",
    role: "partner",
    partnerRole: "Owner",
    partnerId: partner._id,
    passwordHash: hash,
  });
  operator = await M.Operator.create({
    company: "Isolated Test Fleet",
    email: "sandbox@inventory.test",
    status: "approved",
    publicSandboxInventory: true,
  });
  await M.Operator.create({
    company: "Production Fleet",
    email: "production@inventory.test",
    status: "approved",
  });
  const bus = await M.Bus.create({
    operatorId: operator._id,
    name: "Test bus",
    registration: "SB123",
    type: "AC Sleeper",
    capacity: 1,
  });
  route = await M.Route.create({
    operatorId: operator._id,
    source: "Pune",
    destination: "Mumbai",
    departure: "20:00",
    arrival: "23:00",
    durationMinutes: 180,
  });
  trip = await M.Trip.create({
    operatorId: operator._id,
    busId: bus._id,
    routeId: route._id,
    journeyDate: "2030-01-01",
    departureAt: new Date(Date.now() + 3600000),
    seats: [
      { number: "L1", row: 0, column: 0, farePaise: 10000, state: "available" },
    ],
  });
  transport.mockReset().mockImplementation(async (url, options) => {
    const parsed = new URL(String(url));
    const app = parsed.origin === config.SANDBOX_PORTAL_URL ? sandbox : control;
    const response = await request(app)
      .post(parsed.pathname)
      .set("Authorization", options.headers.Authorization)
      .send(JSON.parse(options.body));
    return new Response(JSON.stringify(response.body), {
      status: response.status,
    });
  });
  vi.stubGlobal("fetch", transport);
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

it("loads named sandbox resources through the admin bridge and excludes production and closed trips", async () => {
  const operators = await get("/inventory-options?kind=Operator");
  expect(operators.status, JSON.stringify(operators.body)).toBe(200);
  expect(operators.body.data).toEqual([
    { id: String(operator._id), label: "Isolated Test Fleet" },
  ]);
  const choices = await get(
    `/inventory-options?kind=Trip&operatorId=${operator._id}&search=Pune`,
  );
  expect(choices.status).toBe(200);
  expect(choices.body.data[0]).toMatchObject({
    id: String(trip._id),
    operatorId: String(operator._id),
  });
  expect(choices.body.data[0].label).toContain("Pune → Mumbai");
  expect(choices.body.meta.total).toBe(1);
  expect(
    (
      await get(
        `/inventory-options?kind=Trip&operatorId=${operator._id}&search=missing`,
      )
    ).body.data,
  ).toEqual([]);
  await M.Trip.updateOne({ _id: trip._id }, { $set: { bookingOpen: false } });
  expect(
    (await get(`/inventory-options?kind=Trip&operatorId=${operator._id}`)).body
      .data,
  ).toEqual([]);
  const production = await M.Operator.findOne({ company: "Production Fleet" });
  expect(
    (await get(`/inventory-options?kind=Route&operatorId=${production!._id}`))
      .status,
  ).toBe(400);
});
it("assigns one company's test trip, returns real inventory, and enables its public city response", async () => {
  const other = await M.ApiPartner.create({
    publicId: publicId("partner"),
    name: "Other company",
    scopes: ["inventory:read"],
  });
  const issued = await generateCredential(
    config,
    String(partner._id),
    ["inventory:read"],
    new Date(Date.now() + 86400000),
    { actorId: String(owner._id) },
  );
  const exchange = await request(sandbox)
    .post("/api/v1/public/auth/token")
    .set("Authorization", `Bearer ${issued.credential}`)
    .send({});
  expect(exchange.status).toBe(200);
  const cities = () =>
    request(sandbox)
      .get("/api/v1/public/cities")
      .set("Authorization", `Bearer ${exchange.body.data.accessToken}`);
  expect((await cities()).body.data).toEqual([]);
  const response = await save(grantBody());
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  const details = await get("");
  expect(details.status, JSON.stringify(details.body)).toBe(200);
  expect(details.body.data.inventory.grants[0]).toMatchObject({
    operatorId: String(operator._id),
    kind: "Trip",
    targetId: String(trip._id),
    active: true,
  });
  expect(details.body.data.inventory.trips).toHaveLength(1);
  expect(
    (await cities()).body.data.map((city: any) => city.name).sort(),
  ).toEqual(["Mumbai", "Pune"]);
  expect(
    await M.PartnerInventoryGrant.countDocuments({ partnerId: other._id }),
  ).toBe(0);
  expect(JSON.stringify(transport.mock.calls)).not.toContain(password);
  expect(JSON.stringify(transport.mock.calls)).not.toContain(token);
  expect(JSON.stringify(details.body)).not.toContain(issued.credential);
});
it("requires explicit write permission and the correct current password before forwarding grants", async () => {
  expect((await save(grantBody({ password: "incorrect" }))).status).toBe(403);
  expect(transport).not.toHaveBeenCalled();
  await M.User.updateOne(
    { _id: admin._id },
    {
      $set: {
        platformProfile: "Audit / Read Only",
        platformPermissions: ["platform:partners:read"],
      },
    },
  );
  expect((await get("/inventory-options?kind=Operator")).status).toBe(403);
  expect((await save(grantBody())).status).toBe(403);
  expect(transport).not.toHaveBeenCalled();
  expect(await M.PartnerInventoryGrant.countDocuments()).toBe(0);
});
it("rechecks current source sessions, admin permissions and partner approval on private requests", async () => {
  const raw = grantBody();
  const { password: _password, ...grant } = raw;
  const body = { operation: "grant", sessionId: String(session._id), grant };
  await M.Session.updateOne(
    { _id: session._id },
    { $set: { revokedAt: new Date() } },
  );
  expect((await privateRequest(body)).status).toBe(403);
  await M.Session.updateOne(
    { _id: session._id },
    { $set: { revokedAt: null } },
  );
  await M.User.updateOne(
    { _id: admin._id },
    {
      $set: {
        platformProfile: "Audit / Read Only",
        platformPermissions: ["platform:partners:read"],
      },
    },
  );
  expect((await privateRequest(body)).status).toBe(403);
  await M.User.updateOne(
    { _id: admin._id },
    { $unset: { platformProfile: 1, platformPermissions: 1 } },
  );
  await M.ApiPartner.updateOne(
    { _id: partner._id },
    { $set: { onboardingStatus: "Suspended" } },
  );
  expect((await privateRequest(body)).status).toBe(409);
  expect(await M.PartnerInventoryGrant.countDocuments()).toBe(0);
});
it("rejects partner proofs, modified signed bodies and browser-supplied private fields", async () => {
  const body = {
    operation: "options",
    sessionId: String(session._id),
    query: { kind: "Operator" },
  };
  expect((await privateRequest(body, "execute")).status).toBe(401);
  expect(
    (
      await privateRequest(body, "inventory-execute", {
        operation: "inventory",
      })
    ).status,
  ).toBe(401);
  expect((await privateRequest({ ...body, password })).status).toBe(400);
  expect(
    (await get("/inventory-options?kind=Operator&url=https://untrusted.test"))
      .status,
  ).toBe(400);
});
it("replays uncertain saves safely, rejects changed content, and audits only one inventory mutation", async () => {
  const body = grantBody();
  expect((await save(body)).status).toBe(200);
  expect((await save(body)).body.data.alreadyApplied).toBe(true);
  expect((await save({ ...body, active: false })).status).toBe(409);
  expect(
    await M.PartnerInventoryGrant.countDocuments({ partnerId: partner._id }),
  ).toBe(1);
  expect(
    await M.Audit.countDocuments({ action: "sandbox.inventory.grant" }),
  ).toBe(1);
  expect(
    await M.PartnerCommand.countDocuments({
      action: "sandbox.inventory.grant",
    }),
  ).toBe(1);
  expect((await save(grantBody({ active: false }))).status).toBe(200);
  expect(
    (await M.PartnerInventoryGrant.findOne({ partnerId: partner._id }).lean())!
      .active,
  ).toBe(false);
});
it("serializes concurrent retries without creating duplicate grants or audit records", async () => {
  const body = grantBody();
  const responses = await Promise.all([save(body), save(body)]);
  expect(responses.map((response) => response.status)).toEqual([200, 200]);
  expect(
    await M.PartnerInventoryGrant.countDocuments({ partnerId: partner._id }),
  ).toBe(1);
  expect(
    await M.Audit.countDocuments({ action: "sandbox.inventory.grant" }),
  ).toBe(1);
});
it("can disable a previously assigned grant even after its operator is suspended", async () => {
  expect((await save(grantBody())).status).toBe(200);
  await M.Operator.updateOne(
    { _id: operator._id },
    { $set: { status: "suspended" } },
  );
  expect((await save(grantBody({ active: false }))).status).toBe(200);
  expect(
    (await M.PartnerInventoryGrant.findOne({ partnerId: partner._id }).lean())!
      .active,
  ).toBe(false);
});
it("keeps the new private endpoints unavailable without the configured bridge", async () => {
  const disabled = createApp(
    {
      ...config,
      SANDBOX_PORTAL_URL: undefined,
      SANDBOX_CONTROL_URL: undefined,
    },
    { check: async () => true },
  );
  expect(
    (
      await request(disabled)
        .post("/internal/sandbox-portal/inventory-execute")
        .send({})
    ).status,
  ).toBe(404);
  expect(
    (
      await request(disabled)
        .post("/internal/sandbox-portal/inventory-entitlement")
        .send({})
    ).status,
  ).toBe(404);
});
it("rejects mismatched ownership and past expiry without granting access", async () => {
  expect((await save(grantBody({ targetId: String(admin._id) }))).status).toBe(
    400,
  );
  expect(
    (await save(grantBody({ expiresAt: new Date(0).toISOString() }))).status,
  ).toBe(400);
  expect(await M.PartnerInventoryGrant.countDocuments()).toBe(0);
  expect(
    await M.Audit.countDocuments({ action: "sandbox.inventory.grant" }),
  ).toBe(0);
});
it("fails closed for an unavailable bridge while preserving access to organization details", async () => {
  transport.mockRejectedValue(new Error("private connection failure"));
  expect((await get("/inventory-options?kind=Operator")).status).toBe(503);
  expect((await save(grantBody())).status).toBe(503);
  const detail = await get("");
  expect(detail.status).toBe(200);
  expect(detail.body.data.inventory.unavailable).toContain(
    "temporarily unavailable",
  );
  expect(JSON.stringify(detail.body)).not.toContain(
    "private connection failure",
  );
  expect(await M.PartnerInventoryGrant.countDocuments()).toBe(0);
});
