import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { randomUUID } from "node:crypto";
import * as M from "../../src/models/index.js";
import { runLeasedJob } from "../../src/services/job-runner.service.js";
import {
  inspectTripIntegrity,
  persistIssues,
  scanOperationalIntegrity,
} from "../../src/services/operations-integrity.service.js";
import {
  operationalReport,
  operationReportNames,
} from "../../src/services/operations-report.service.js";
import { createHold } from "../../src/services/inventory.service.js";
import { reconcileExpiredHolds } from "../../src/jobs/booking.jobs.js";
import { createApp } from "../../src/app.js";
import { readConfig } from "../../src/config/env.js";
import { hashPassword } from "../../src/services/auth.service.js";
import { rolePermissions, type Principal } from "../../src/utils/core.js";
let mongo: MongoMemoryReplSet,
  actor: Principal,
  trip: any,
  token: string,
  otherToken: string,
  rootToken: string,
  hash: string;
const password = "Operational-Fixture-Password-123!",
  config = readConfig({
    NODE_ENV: "test",
    MONGODB_URI: "mongodb://127.0.0.1/disposable",
    JWT_SECRET: "p".repeat(64),
  }),
  app = createApp(config, { check: async () => true });
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await Promise.all(
    Object.values(M)
      .filter((m: any) => m?.init)
      .map((m: any) => m.init()),
  );
  hash = await hashPassword(password);
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  for (const model of Object.values(mongoose.models))
    await model.collection.deleteMany({});
  const owner = await M.Operator.create({
      company: "Fixture A",
      email: "a@fixture.test",
      status: "approved",
    }),
    other = await M.Operator.create({
      company: "Fixture B",
      email: "b@fixture.test",
      status: "approved",
    });
  const user = await M.User.create({
    operatorId: owner._id,
    name: "Operations A",
    email: "ops@fixture.test",
    role: "operator_admin",
    passwordHash: hash,
  });
  await M.User.create({
    operatorId: other._id,
    name: "Operations B",
    email: "other@fixture.test",
    role: "operator_admin",
    passwordHash: hash,
  });
  await M.User.create({
    name: "Root",
    email: "root@fixture.test",
    role: "super_admin",
    passwordHash: hash,
  });
  const login = async (email: string, client = "operator") =>
    (
      await request(app)
        .post("/api/v1/auth/login")
        .set("X-Aibus-Client", client)
        .send({ email, password })
    ).body.data.accessToken;
  token = await login("ops@fixture.test");
  otherToken = await login("other@fixture.test");
  rootToken = await login("root@fixture.test", "admin");
  actor = {
    userId: String(user._id),
    operatorId: String(owner._id),
    role: "operator_admin",
    sessionId: "fixture",
    permissions: rolePermissions.operator_admin,
  };
  const bus = await M.Bus.create({
    operatorId: owner._id,
    registration: "MH12OP1234",
    name: "Fixture bus",
    type: "AC Sleeper",
    capacity: 2,
  });
  const route = await M.Route.create({
    operatorId: owner._id,
    source: "Pune",
    destination: "Mumbai",
    durationMinutes: 180,
    departure: "20:00",
    arrival: "23:00",
  });
  trip = await M.Trip.create({
    operatorId: owner._id,
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
});
const get = (path: string, auth = token) =>
  request(app)
    .get("/api/v1" + path)
    .set("Authorization", "Bearer " + auth);
const operation = (
  stage: string,
  version: number,
  auth = token,
  key = randomUUID(),
) =>
  request(app)
    .post(`/api/v1/operator/trip-master/trips/${trip._id}/operations`)
    .set("Authorization", "Bearer " + auth)
    .set("Idempotency-Key", key)
    .send({
      stage,
      at: new Date(Date.now() - 1000).toISOString(),
      expectedVersion: version,
    });
describe("Phase 6 operational reliability", () => {
  it("serializes concurrent logical jobs and records one execution", async () => {
    let calls = 0;
    const work = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 100));
    };
    await Promise.all([
      runLeasedJob("fixture", work),
      runLeasedJob("fixture", work),
    ]);
    expect(calls).toBe(1);
    expect(
      await M.OperationalJobRun.countDocuments({ status: "Succeeded" }),
    ).toBe(1);
  });
  it("recovers an abandoned lease and preserves failed ownership history", async () => {
    await M.OperationalJob.create({
      key: "restart",
      state: "Running",
      token: "old",
      leaseUntil: new Date(0),
      nextRunAt: new Date(0),
    });
    await M.OperationalJobRun.create({
      jobKey: "restart",
      token: "old",
      status: "Running",
    });
    await runLeasedJob("restart", async () => {});
    expect(
      await M.OperationalJobRun.findOne({ token: "old" }).lean(),
    ).toMatchObject({ status: "Lease lost" });
  });
  it("backs off failed jobs and stops at a bounded manual-review state", async () => {
    await runLeasedJob(
      "failure",
      async () => {
        throw Error("PRIVATE_SECRET");
      },
      { maxFailures: 1 },
    );
    expect(
      await M.OperationalJob.findOne({ key: "failure" }).lean(),
    ).toMatchObject({ state: "Manual review", lastCode: "JOB_FAILED" });
    let calls = 0;
    await runLeasedJob("failure", async () => {
      calls++;
    });
    expect(calls).toBe(0);
    expect(
      JSON.stringify(await M.OperationalJobRun.find().lean()),
    ).not.toContain("PRIVATE_SECRET");
  });
  it("fails closed when job uniqueness is absent", async () => {
    await M.OperationalJob.collection.dropIndex("key_1");
    try {
      await expect(
        runLeasedJob("unsafe", async () => {}),
      ).rejects.toMatchObject({ code: "JOB_INDEX_REQUIRED" });
    } finally {
      await M.OperationalJob.createIndexes();
    }
  });
  it("supports granular operational stages without replacing trip status", async () => {
    for (const [i, stage] of [
      "Boarding",
      "Boarding Completed",
      "Departed",
      "In Transit",
      "Arrived",
      "Completed",
    ].entries())
      expect((await operation(stage, i)).status).toBe(200);
    const saved = await M.Trip.findById(trip._id).lean();
    expect(saved).toMatchObject({
      status: "Completed",
      operationStage: "Completed",
      bookingOpen: false,
    });
    expect(saved?.actualDepartureAt).toBeTruthy();
    expect(saved?.actualArrivalAt).toBeTruthy();
  });
  it("rejects invalid stages and cross-operator operational updates", async () => {
    expect((await operation("Completed", 0)).status).toBe(409);
    expect((await operation("Boarding", 0, otherToken)).status).toBe(404);
  });
  it("replays a stage once while rejecting changed content under its key", async () => {
    const key = randomUUID(),
      at = new Date(Date.now() - 1000).toISOString(),
      path = `/api/v1/operator/trip-master/trips/${trip._id}/operations`,
      body = { stage: "Boarding", expectedVersion: 0, at };
    const send = (data: any) =>
      request(app)
        .post(path)
        .set("Authorization", "Bearer " + token)
        .set("Idempotency-Key", key)
        .send(data);
    expect((await send(body)).status).toBe(200);
    expect((await send(body)).status).toBe(200);
    expect((await send({ ...body, stage: "Completed" })).status).toBe(409);
    expect(await M.TripOperation.countDocuments()).toBe(1);
  });
  it("requires active bus assignment at departure", async () => {
    await operation("Boarding", 0);
    await M.Bus.updateOne(
      { _id: trip.busId },
      { $set: { status: "Inactive" } },
    );
    expect((await operation("Departed", 1)).status).toBe(409);
  });
  it("does not let an empty completed trip be cancelled", async () => {
    await M.Trip.updateOne(
      { _id: trip._id },
      { $set: { status: "Completed" } },
    );
    expect(
      (
        await request(app)
          .post(`/api/v1/operator/trips/${trip._id}/cancel`)
          .set("Authorization", "Bearer " + token)
      ).status,
    ).toBe(409);
  });
  it("detects confirmed-seat and ticket mismatches without rewriting history", async () => {
    const b = await M.Booking.create({
      operatorId: actor.operatorId,
      tripId: trip._id,
      userId: actor.userId,
      holdId: "fixture",
      reference: randomUUID(),
      status: "Confirmed",
      paymentStatus: "Paid",
      passengers: [{ name: "PRIVATE_PASSENGER", seat: "L1" }],
      grossPaise: 100000,
      totalPaise: 100000,
      idempotencyKey: randomUUID(),
      requestHash: "fixture",
    });
    const issues = await inspectTripIntegrity(
      actor.operatorId!,
      String(trip._id),
    );
    expect(issues.map((i) => i.code)).toEqual(
      expect.arrayContaining([
        "CONFIRMED_SEAT_MISMATCH",
        "CONFIRMED_TICKET_MISMATCH",
      ]),
    );
    expect(JSON.stringify(issues)).not.toContain("PRIVATE_PASSENGER");
    expect((await M.Booking.findById(b._id))?.status).toBe("Confirmed");
  });
  it("cleans an expired durable hold while preserving its immediate replacement", async () => {
    const old: any = await createHold(actor, String(trip._id), ["L1"]);
    await M.Hold.updateOne(
      { holdId: old.holdId },
      { $set: { expiresAt: new Date(0) } },
    );
    await M.Trip.updateOne(
      { _id: trip._id },
      { $set: { "seats.0.holdUntil": new Date(0) } },
    );
    const replacement: any = await createHold(actor, String(trip._id), ["L1"]);
    await reconcileExpiredHolds();
    expect((await M.Trip.findById(trip._id))?.seats[0].holdId).toBe(
      replacement.holdId,
    );
    expect((await M.Hold.findOne({ holdId: old.holdId }))?.status).toBe(
      "expired",
    );
  });
  it("durably deduplicates findings and resolves observations without repairing bookings", async () => {
    const issues = [
      { code: "FIXTURE", resourceId: "safe", category: "Inventory" },
    ];
    await persistIssues(actor.operatorId!, issues, String(trip._id));
    await persistIssues(actor.operatorId!, issues, String(trip._id));
    expect(await M.OperationalIssue.countDocuments()).toBe(1);
    await persistIssues(actor.operatorId!, [], String(trip._id));
    expect((await M.OperationalIssue.findOne())?.status).toBe("Resolved");
  });
  it("keeps financial monitoring and foreign tenant issues private", async () => {
    await persistIssues(actor.operatorId!, [
      { code: "FINANCE", resourceId: "safe", category: "Finance" },
    ]);
    expect(
      (await get("/operator/operations/issues", otherToken)).body.data,
    ).toHaveLength(0);
    expect(
      (
        await get(
          `/operator/operations/issues?operatorId=${actor.operatorId}`,
          otherToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (await get("/platform/operations/issues", rootToken)).body.data,
    ).toHaveLength(0);
  });
  it("reports fifteen operational categories with authorized CSV and no revenue fields", async () => {
    for (const name of operationReportNames) {
      const report = await operationalReport(actor, name, {
        from: "2030-11-20",
        to: "2030-11-20",
        page: 1,
        limit: 25,
      });
      expect(report.total).toBe(name.includes("delays") ? 0 : 1);
      expect(JSON.stringify(report)).not.toMatch(/commissionPaise|totalPaise/);
    }
    expect(
      (
        await get(
          "/operator/operations/reports/seat-occupancy.csv?from=2030-11-20&to=2030-11-20",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await get(
          "/operator/operations/reports/seat-occupancy.csv?from=2030-11-20&to=2030-11-20&operatorId=" +
            actor.operatorId,
          otherToken,
        )
      ).status,
    ).toBe(403);
  });
  it("exposes fail-closed readiness and safe correlated monitoring", async () => {
    const unavailable = createApp(
      config,
      { check: async () => true },
      async () => {
        throw Error("PRIVATE_CONNECTION_STRING");
      },
    );
    const r = await request(unavailable).get("/health/ready");
    expect(r.status).toBe(503);
    expect(r.headers["x-request-id"]).toBeTruthy();
    expect(JSON.stringify(r.body)).not.toContain("PRIVATE_");
    expect((await get("/platform/operations/health", token)).status).toBe(403);
    expect(
      (await get("/platform/operations/health", rootToken)).body.data.metrics
        .scope,
    ).toContain("Current API process");
  });
  it("isolates device assignment and exposes configuration rather than invented GPS", async () => {
    const tablet = await M.TripTablet.create({
      operatorId: actor.operatorId,
      name: "Fixture device",
      serialNumber: "DEVICE-1",
    });
    const r = await request(app)
      .post("/api/v1/operator/trip-master/tablet-assignments")
      .set("Authorization", "Bearer " + otherToken)
      .send({ tabletId: tablet._id, tripId: trip._id });
    expect(r.status).toBe(404);
    const tracker = await get(
      `/operator/trip-master/trips/${trip._id}/tracker`,
    );
    expect(tracker.body.data.gps.latitude).toBeNull();
    expect(tracker.body.data.integrations.gps).toBe(false);
  });
  it("records idempotent tenant-owned incidents with preserved audit", async () => {
    const key = randomUUID(),
      body = {
        kind: "Delay",
        reason: "Traffic at departure fixture",
        at: new Date().toISOString(),
      },
      send = (auth: string) =>
        request(app)
          .post(`/api/v1/operator/operations/trips/${trip._id}/incidents`)
          .set("Authorization", "Bearer " + auth)
          .set("Idempotency-Key", key)
          .send(body);
    expect((await send(otherToken)).status).toBe(404);
    expect((await send(token)).status).toBe(201);
    expect((await send(token)).status).toBe(201);
    expect(await M.TripIncident.countDocuments()).toBe(1);
  });
  it("runs inventory and financial observation scans without changing source balances", async () => {
    await scanOperationalIntegrity(new AbortController().signal);
    expect(await M.OperationalIssue.countDocuments({ status: "Open" })).toBe(0);
    expect(await M.JournalEntry.countDocuments()).toBe(0);
  });
});
