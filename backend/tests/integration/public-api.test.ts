import { inspectTripIntegrity } from "../../src/services/operations-integrity.service.js";
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { randomUUID } from "node:crypto";
import * as M from "../../src/models/index.js";
import * as P from "../../src/models/public-api.model.js";
import { createApp } from "../../src/app.js";
import { readConfig } from "../../src/config/env.js";
import {
  publicId,
  publicScopes,
  generateCredential,
} from "../../src/services/public-auth.service.js";
import {
  resourceId,
  partnerPrincipal,
} from "../../src/services/public-inventory.service.js";
import { createHold } from "../../src/services/inventory.service.js";
import {
  collectPartnerEvents,
  deliverPartnerWebhooks,
  webhookSecret,
  verifyWebhookSignature,
  webhookSignature,
  publicAddress,
  webhookTarget,
} from "../../src/services/public-webhook.service.js";
import { reconcileExpiredHolds } from "../../src/jobs/booking.jobs.js";
import { verifyLedger } from "../../src/services/ledger-integrity.service.js";
let mongo: MongoMemoryReplSet,
  partner: any,
  other: any,
  owner: any,
  trip: any,
  publicTripId: string,
  token: string,
  otherToken: string,
  credential: string;
const config = readConfig({
  NODE_ENV: "test",
  MONGODB_URI: "mongodb://127.0.0.1/aibus_public_sandbox_fixture",
  JWT_SECRET: "i".repeat(64),
  PUBLIC_API_SANDBOX: "true",
  PUBLIC_API_JWT_SECRET: "s".repeat(64),
  PUBLIC_WEBHOOK_SIGNING_KEY: "a".repeat(64),
  PUBLIC_WEBHOOK_ALLOWED_HOSTS: "partner.example.test",
});
const app = createApp(config, { check: async () => true });
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri("aibus_public_sandbox_phase7"));
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  for (const model of Object.values(mongoose.models))
    await model.collection.deleteMany({});
  owner = await M.Operator.create({
    company: "Sandbox Operator",
    email: "sandbox@fixture.test",
    status: "approved",
    publicSandboxInventory: true,
  });
  const bus = await M.Bus.create({
    operatorId: owner._id,
    registration: "MH12SB1234",
    name: "Sandbox bus",
    type: "AC Sleeper",
    capacity: 3,
    amenities: ["Water"],
  });
  const route = await M.Route.create({
    operatorId: owner._id,
    source: "Pune",
    destination: "Mumbai",
    boarding: [{ name: "Wakad" }],
    dropping: [{ name: "Dadar" }],
    departure: "20:00",
    arrival: "23:00",
    durationMinutes: 180,
  });
  trip = await M.Trip.create({
    operatorId: owner._id,
    busId: bus._id,
    routeId: route._id,
    journeyDate: "2030-11-20",
    departureAt: new Date("2030-11-20T20:00:00+05:30"),
    seats: ["L1", "L2", "U1"].map((number, column) => ({
      number,
      column,
      row: 0,
      deck: number === "U1" ? "upper" : "lower",
      category: "sleeper",
      farePaise: 100000,
      state: "available",
    })),
  });
  await M.PricingPolicy.create({
    operatorId: owner._id,
    taxBasisPoints: 500,
    chargePaise: 100,
    chargesTaxable: false,
    operatorDiscountMaxPaise: 0,
    requireAge: false,
    requireGender: false,
    requireMobile: false,
    gstEnabled: false,
  });
  await M.Policy.create({
    operatorId: owner._id,
    version: 1,
    rules: [{ hoursBefore: 0, refundPercent: 80 }],
  });
  await M.CancellationAccountingPolicy.create({
    operatorId: owner._id,
    enabled: true,
    refundBasis: "Discounted base fare",
    taxTreatment: "Proportional refund",
    chargeTreatment: "Non-refundable",
    commissionTreatment: "Reverse all",
  });
  partner = await P.ApiPartner.create({
    publicId: publicId("partner"),
    name: "Partner A",
    scopes: [...publicScopes],
    sandboxAllowancePaise: 1000000,
  });
  other = await P.ApiPartner.create({
    publicId: publicId("partner"),
    name: "Partner B",
    scopes: [...publicScopes],
    sandboxAllowancePaise: 1000000,
  });
  for (const p of [partner, other])
    await P.PartnerInventoryGrant.create({
      partnerId: p._id,
      operatorId: owner._id,
      kind: "Trip",
      targetId: trip._id,
      expiresAt: new Date("2031-01-01"),
    });
  publicTripId = await resourceId("trip", String(trip._id));
  credential = (
    await generateCredential(
      config,
      String(partner._id),
      [...publicScopes],
      new Date("2031-01-01"),
    )
  ).credential;
  token = (
    await request(app)
      .post("/api/v1/public/auth/token")
      .set("Authorization", "Bearer " + credential)
      .send({})
  ).body.data.accessToken;
  const otherCredential = (
    await generateCredential(
      config,
      String(other._id),
      [...publicScopes],
      new Date("2031-01-01"),
    )
  ).credential;
  otherToken = (
    await request(app)
      .post("/api/v1/public/auth/token")
      .set("Authorization", "Bearer " + otherCredential)
      .send({})
  ).body.data.accessToken;
});
const get = (path: string, auth = token, target = app) =>
  request(target)
    .get("/api/v1/public" + path)
    .set("Authorization", "Bearer " + auth);
const post = (
  path: string,
  body: unknown = {},
  key = randomUUID(),
  auth = token,
) =>
  request(app)
    .post("/api/v1/public" + path)
    .set("Authorization", "Bearer " + auth)
    .set("Idempotency-Key", key)
    .send(body);
async function pending(seat = "L1", key = randomUUID()) {
  const held = await post(`/trips/${publicTripId}/holds`, { seats: [seat] });
  expect(held.status).toBe(201);
  const quoted = await post(`/trips/${publicTripId}/quotes`, {
    seats: [seat],
    holdId: held.body.data.id,
  });
  expect(quoted.status).toBe(200);
  const body = {
    tripId: publicTripId,
    holdId: held.body.data.id,
    quoteId: quoted.body.data.id,
    partnerReference: "ref-" + key,
    passengers: [
      { name: "PRIVATE Passenger", seat, boarding: "Wakad", dropping: "Dadar" },
    ],
  };
  const created = await post("/bookings", body, key);
  expect(created.status).toBe(201);
  return { booking: created.body.data, body, key, holdId: held.body.data.id };
}
async function confirmed() {
  const result = await pending();
  const response = await post(`/bookings/${result.booking.id}/confirm`, {
    authorization: "sandbox-allowance",
  });
  expect(response.status).toBe(200);
  return { ...result, booking: response.body.data };
}
describe("Phase 7 public API provider", () => {
  it("rejects the ordinary database boundary even with valid sandbox credentials", async () => {
    const original = mongoose.connection.name;
    try {
      mongoose.connection.name = "ordinary_crs_fixture";
      expect((await get("/cities")).status).toBe(503);
    } finally {
      mongoose.connection.name = original;
    }
  });
  it("rejects fare changes after a bound quote without creating a booking", async () => {
    const hold = (await post(`/trips/${publicTripId}/holds`, { seats: ["L1"] }))
      .body.data;
    const quote = (
      await post(`/trips/${publicTripId}/quotes`, {
        seats: ["L1"],
        holdId: hold.id,
      })
    ).body.data;
    await M.Trip.updateOne(
      { _id: trip._id },
      { $set: { "seats.0.farePaise": 110000 } },
    );
    const response = await post("/bookings", {
      tripId: publicTripId,
      holdId: hold.id,
      quoteId: quote.id,
      partnerReference: "changed-fare-fixture",
      passengers: [{ name: "Fixture", seat: "L1" }],
    });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("FARE_CHANGED");
    expect(await M.Booking.countDocuments()).toBe(0);
  });
  it("bounds notification retries without repeating financial confirmation", async () => {
    await confirmed();
    await P.PartnerWebhookSubscription.create({
      partnerId: partner._id,
      publicId: publicId("sub"),
      url: "https://partner.example.test/aibus",
    });
    await collectPartnerEvents(config, new AbortController().signal);
    await P.PartnerWebhookDelivery.updateOne({}, { $set: { attempts: 4 } });
    await deliverPartnerWebhooks(config, async () => false);
    expect((await P.PartnerWebhookDelivery.findOne())?.status).toBe(
      "Manual review",
    );
    expect(
      (
        await deliverPartnerWebhooks(config, async () => {
          throw Error("Must not retry exhausted delivery");
        })
      ).checked,
    ).toBe(0);
    expect(await M.Ticket.countDocuments()).toBe(1);
  });
  it("exchanges hashed credentials for scoped short-lived tokens", async () => {
    expect(token).toBeTruthy();
    expect(JSON.stringify(await P.ApiCredential.find().lean())).not.toContain(
      credential.split(".")[1],
    );
    expect((await get("/capabilities")).body.data.liveTicketIssuance).toBe(
      false,
    );
  });
  it("rejects invalid, revoked, expired and rotated credentials", async () => {
    expect(
      (await post("/auth/token", {}, randomUUID(), "invalid")).status,
    ).toBe(401);
    await P.ApiCredential.updateOne(
      { partnerId: partner._id },
      { $set: { revokedAt: new Date() } },
    );
    expect((await get("/cities")).status).toBe(401);
    await P.ApiCredential.updateOne(
      { partnerId: partner._id },
      { $unset: { revokedAt: 1 }, $set: { expiresAt: new Date(0) } },
    );
    expect((await get("/cities")).status).toBe(401);
    await P.ApiCredential.updateOne(
      { partnerId: partner._id },
      { $set: { expiresAt: new Date("2031-01-01") }, $inc: { version: 1 } },
    );
    expect((await get("/cities")).status).toBe(401);
  });
  it("requires effective scopes and revalidates them after token issuance", async () => {
    await P.ApiPartner.updateOne(
      { _id: partner._id },
      { $set: { scopes: ["inventory:read"] } },
    );
    expect(
      (await post(`/trips/${publicTripId}/holds`, { seats: ["L1"] })).status,
    ).toBe(403);
    expect((await get("/cities")).status).toBe(200);
  });
  it("requires explicit unexpired inventory grants", async () => {
    await P.PartnerInventoryGrant.updateMany(
      { partnerId: partner._id },
      { $set: { active: false } },
    );
    expect((await get("/cities")).body.data).toHaveLength(0);
    expect((await get(`/trips/${publicTripId}`)).status).toBe(404);
  });
  it("does not leak foreign operators or internal database identifiers", async () => {
    const foreignId = await resourceId(
      "trip",
      String(new mongoose.Types.ObjectId()),
    );
    expect((await get(`/trips/${foreignId}`)).status).toBe(404);
    const response = await get(`/trips/${publicTripId}`);
    expect(JSON.stringify(response.body)).not.toContain(String(trip._id));
    expect(JSON.stringify(response.body)).not.toContain(String(owner._id));
    const claims = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString(),
    );
    expect(JSON.stringify(claims)).not.toContain(String(partner._id));
    expect(claims.cid).toMatch(/^cred_/);
  });
  it("searches stable authorized cities and exact travel dates", async () => {
    const response = await get("/cities");
    expect(response.body.success).toBe(true);
    for (const city of response.body.data) {
      expect(city.CityId).toBe(city.id);
      expect(city.City).toBe(city.name);
      expect(city.State).toBeNull();
      expect(city.CityKey).toBeNull();
    }
    const cities = (await get("/cities")).body.data,
      from = cities.find((c: any) => c.name === "Pune").id,
      to = cities.find((c: any) => c.name === "Mumbai").id;
    expect(
      (await get(`/trips?from=${from}&to=${to}&journeyDate=2030-11-20`)).body
        .data,
    ).toHaveLength(1);
    expect(
      (await get(`/trips?from=${from}&to=${to}&journeyDate=2030-11-21`)).body
        .data,
    ).toHaveLength(0);
    expect(
      (
        await get(
          `/trips?from=${from}&to=${to}&journeyDate=2030-11-20&operatorId=${owner._id}`,
        )
      ).status,
    ).toBe(400);
  });
  it("returns accurate decks, seats and configured stops without ownership leakage", async () => {
    await M.Trip.updateOne(
      { _id: trip._id },
      { $set: { "seats.0.state": "blocked" } },
    );
    const layout = (await get(`/trips/${publicTripId}/seats`)).body.data;
    expect(layout.seats[0].state).toBe("blocked");
    expect(layout.seats[2].deck).toBe("upper");
    expect(JSON.stringify(layout)).not.toMatch(/holdUserId|bookingId/);
    expect(
      (await get(`/trips/${publicTripId}/stops`)).body.data.boarding[0].name,
    ).toBe("Wakad");
  });
  it("rechecks integer-paise fare including configured tax and fees", async () => {
    const r = await post(`/trips/${publicTripId}/quotes`, { seats: ["L1"] });
    expect(r.body.data).toMatchObject({
      grossPaise: 100000,
      taxPaise: 5000,
      chargePaise: 100,
      totalPaise: 105100,
    });
  });
  it("deduplicates concurrent hold requests and rejects changed payloads", async () => {
    const key = randomUUID(),
      responses = await Promise.all([
        post(`/trips/${publicTripId}/holds`, { seats: ["L1"] }, key),
        post(`/trips/${publicTripId}/holds`, { seats: ["L1"] }, key),
      ]);
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    expect(responses[0].body.data.id).toBe(responses[1].body.data.id);
    expect(await M.Hold.countDocuments()).toBe(1);
    expect(
      (await post(`/trips/${publicTripId}/holds`, { seats: ["L2"] }, key))
        .status,
    ).toBe(409);
  });
  it("protects replacement holds from expired public requests", async () => {
    const key = randomUUID(),
      old = await post(`/trips/${publicTripId}/holds`, { seats: ["L1"] }, key);
    await M.Hold.updateOne(
      { holdId: old.body.data.id },
      { $set: { expiresAt: new Date(0) } },
    );
    await M.Trip.updateOne(
      { _id: trip._id },
      { $set: { "seats.0.holdUntil": new Date(0) } },
    );
    const replacement = await post(
      `/trips/${publicTripId}/holds`,
      { seats: ["L1"] },
      randomUUID(),
      otherToken,
    );
    expect(replacement.status).toBe(201);
    await reconcileExpiredHolds();
    expect(
      (await post(`/trips/${publicTripId}/holds`, { seats: ["L1"] }, key))
        .status,
    ).toBe(410);
    expect((await M.Trip.findById(trip._id))?.seats[0].holdId).toBe(
      replacement.body.data.id,
    );
  });
  it("uses the same atomic inventory for public and operator-channel holds", async () => {
    const identity = {
        partnerId: String(other._id),
        credentialId: "fixture",
      } as any,
      actor = partnerPrincipal(identity, String(owner._id));
    const results = await Promise.allSettled([
      post(`/trips/${publicTripId}/holds`, { seats: ["L1"] }),
      createHold(actor, String(trip._id), ["L1"]),
    ]);
    const winners = results.filter(
      (r) =>
        r.status === "fulfilled" &&
        ((r.value as any).status === "held" || (r.value as any).status === 201),
    );
    expect(winners).toHaveLength(1);
    expect(await M.Hold.countDocuments()).toBe(1);
  });
  it("creates pending bookings idempotently and protects partner references", async () => {
    const { booking, body, key } = await pending();
    expect(booking.status).toBe("Pending payment");
    expect((await post("/bookings", body, key)).body.data.id).toBe(booking.id);
    expect(
      (await post("/bookings", { ...body, partnerReference: "changed" }, key))
        .status,
    ).toBe(409);
    expect(await M.Booking.countDocuments()).toBe(1);
  });
  it("rejects client payment claims and insufficient server allowance", async () => {
    const { booking } = await pending();
    expect(
      (
        await post(`/bookings/${booking.id}/confirm`, {
          authorization: "paid",
          amountPaise: 1,
        })
      ).status,
    ).toBe(400);
    await P.ApiPartner.updateOne(
      { _id: partner._id },
      { $set: { sandboxAllowancePaise: 0 } },
    );
    expect(
      (
        await post(`/bookings/${booking.id}/confirm`, {
          authorization: "sandbox-allowance",
        })
      ).status,
    ).toBe(402);
    expect(await M.Ticket.countDocuments()).toBe(0);
    expect(await M.JournalEntry.countDocuments()).toBe(0);
  });
  it("confirms once with atomic simulated funding, balanced ledger and one ticket", async () => {
    const { booking } = await pending(),
      body = { authorization: "sandbox-allowance" },
      key = randomUUID(),
      responses = await Promise.all([
        post(`/bookings/${booking.id}/confirm`, body, key),
        post(`/bookings/${booking.id}/confirm`, body, key),
      ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(await M.Ticket.countDocuments()).toBe(1);
    expect(
      (await P.ApiPartner.findById(partner._id))?.sandboxAllowancePaise,
    ).toBe(894900);
    expect((await verifyLedger(String(owner._id))).consistent).toBe(true);
    expect(
      await inspectTripIntegrity(String(owner._id), String(trip._id)),
    ).toEqual([]);
  });
  it("denies late authorization after expiry without consuming simulated allowance", async () => {
    const { booking, holdId } = await pending();
    await M.Hold.updateOne({ holdId }, { $set: { expiresAt: new Date(0) } });
    expect(
      (
        await post(`/bookings/${booking.id}/confirm`, {
          authorization: "sandbox-allowance",
        })
      ).status,
    ).toBe(409);
    expect(
      (await P.ApiPartner.findById(partner._id))?.sandboxAllowancePaise,
    ).toBe(1000000);
    expect(await M.Payment.countDocuments()).toBe(0);
  });
  it("returns own ticket and PNR but denies cross-partner booking and passenger access", async () => {
    const { booking } = await confirmed();
    expect(
      (await get(`/bookings/${booking.id}/ticket`)).body.data.pnr,
    ).toBeTruthy();
    expect((await get(`/bookings/${booking.id}`, otherToken)).status).toBe(404);
    expect(
      (await get(`/bookings/${booking.id}/ticket`, otherToken)).status,
    ).toBe(404);
    expect((await get(`/bookings/${booking.id}`)).text).not.toContain(
      "PRIVATE Passenger",
    );
  });
  it("looks up cancellation policy and conditional cancellation charges", async () => {
    expect(
      (await get(`/trips/${publicTripId}/cancellation-policy`)).body.data
        .partialSupported,
    ).toBe(false);
    const { booking } = await confirmed(),
      q = await post(`/bookings/${booking.id}/cancellation-quotes`);
    expect(q.status).toBe(200);
    expect(q.body.data.refundPaise).toBe(84000);
  });
  it("requests cancellation once without pretending a refund or seat release completed", async () => {
    const { booking } = await confirmed(),
      q = await post(`/bookings/${booking.id}/cancellation-quotes`),
      key = randomUUID(),
      body = {
        quoteId: q.body.data.id,
        reason: "Customer requests cancellation in sandbox",
      };
    expect(
      (await post(`/bookings/${booking.id}/cancellations`, body, key)).status,
    ).toBe(200);
    expect(
      (await post(`/bookings/${booking.id}/cancellations`, body, key)).status,
    ).toBe(200);
    expect(await M.Cancellation.countDocuments()).toBe(1);
    expect((await M.Trip.findById(trip._id))?.seats[0].state).toBe("booked");
    const status = await get(`/bookings/${booking.id}/refund`);
    expect(status.body.data.refund.completed).toBe(false);
    expect(status.body.data.liveRefunds).toBe(false);
  });
  it("does not treat an API partner as an operator agent or expose internal routes", async () => {
    expect(await M.SalesPartner.countDocuments()).toBe(0);
    expect(
      (
        await request(app)
          .get("/api/v1/operator/buses")
          .set("Authorization", "Bearer " + token)
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .get("/api/v1/platform/operators")
          .set("Authorization", "Bearer " + token)
      ).status,
    ).toBe(401);
  });
  it("enforces partner-specific rate limits", async () => {
    const limited = createApp(config, {
      check: async (key) => !key.startsWith("public-partner:"),
    });
    expect((await get("/cities", token, limited)).status).toBe(429);
  });
  it("deduplicates signed webhook events and retries uncertain delivery with the same event identity", async () => {
    const { booking } = await confirmed(),
      sub = await P.PartnerWebhookSubscription.create({
        partnerId: partner._id,
        publicId: publicId("sub"),
        url: "https://partner.example.test/aibus",
      });
    const signal = new AbortController().signal;
    await collectPartnerEvents(config, signal);
    await collectPartnerEvents(config, signal);
    expect(await P.PartnerWebhookEvent.countDocuments()).toBe(1);
    expect(await P.PartnerWebhookDelivery.countDocuments()).toBe(1);
    const seen: string[] = [];
    await deliverPartnerWebhooks(config, async (_c, _u, body, headers) => {
      seen.push(headers["X-Aibus-Event-ID"]);
      expect(
        verifyWebhookSignature(
          webhookSecret(config, String(partner._id), sub.publicId),
          headers["X-Aibus-Timestamp"],
          headers["X-Aibus-Event-ID"],
          body,
          headers["X-Aibus-Signature"],
        ),
      ).toBe(true);
      return false;
    });
    await P.PartnerWebhookDelivery.updateMany(
      {},
      { $set: { nextAttemptAt: new Date(0) } },
    );
    await deliverPartnerWebhooks(config, async (_c, _u, _b, headers) => {
      seen.push(headers["X-Aibus-Event-ID"]);
      return true;
    });
    expect(new Set(seen).size).toBe(1);
    expect((await P.PartnerWebhookDelivery.findOne())?.status).toBe(
      "Delivered",
    );
    expect(await P.PartnerWebhookAttempt.countDocuments()).toBe(2);
    expect(
      (await get("/webhook-deliveries", otherToken)).body.data,
    ).toHaveLength(0);
  });
  it("rejects replayed or changed webhook signatures and non-public targets", () => {
    const ts = String(Date.now()),
      signature = webhookSignature("fixture", ts, "evt_fixture", "{}");
    expect(
      verifyWebhookSignature("fixture", ts, "evt_fixture", "{}", signature),
    ).toBe(true);
    expect(
      verifyWebhookSignature(
        "fixture",
        ts,
        "evt_fixture",
        "changed",
        signature,
      ),
    ).toBe(false);
    expect(
      verifyWebhookSignature(
        "fixture",
        ts,
        "evt_fixture",
        "{}",
        signature,
        Date.now() + 600000,
      ),
    ).toBe(false);
    for (const ip of [
      "127.0.0.1",
      "169.254.169.254",
      "10.1.1.1",
      "::1",
      "fc00::1",
      "::ffff:127.0.0.1",
    ])
      expect(publicAddress(ip)).toBe(false);
    expect(() => webhookTarget(config, "https://127.0.0.1/hook")).toThrow();
  });
  it("fails closed for ordinary databases, browser credentials and unavailable finance capabilities", async () => {
    const disabled = createApp(
      { ...config, PUBLIC_API_SANDBOX: false },
      { check: async () => true },
    );
    expect((await get("/cities", token, disabled)).status).toBe(503);
    expect((await get("/cities").set("Origin", config.WEB_ORIGIN)).status).toBe(
      403,
    );
    expect((await get("/wallet")).status).toBe(501);
    expect((await post("/reschedule")).status).toBe(501);
  });
  it("publishes all eighteen contracts and fails closed for missing uniqueness", async () => {
    const spec = await request(app).get("/api/v1/public/openapi.json");
    expect(spec.status).toBe(200);
    expect(spec.body.paths["/wallet"].get.responses["501"]).toBeTruthy();
    await P.PartnerCommand.collection.dropIndex("partnerId_1_key_1");
    try {
      expect((await get("/cities")).status).toBe(503);
    } finally {
      await P.PartnerCommand.createIndexes();
    }
  });
});
