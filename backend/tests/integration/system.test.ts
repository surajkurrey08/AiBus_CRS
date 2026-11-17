import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterEach, vi } from "vitest";
import mongoose from "mongoose";
import request from "supertest";
import { createServer } from "node:http";
import { io as connectSocket } from "socket.io-client";
import { randomUUID, createHmac } from "node:crypto";
import { createApp } from "../../src/app.js";
import { readConfig } from "../../src/config/env.js";
import * as M from "../../src/models/index.js";
import { hashPassword } from "../../src/modules/auth/index.js";
import {
  createHold,
  createBooking,
  applyVerifiedPayment,
} from "../../src/services/inventory.service.js";
import {
  reconcileExpiredHolds,
  reconcileExternalBookings,
  publishOutbox,
} from "../../src/jobs/booking.jobs.js";
import { attachRealtime } from "../../src/realtime/socket.js";
import {
  rolePermissions,
  AppError,
  type Principal,
} from "../../src/utils/core.js";
import { safeProviderRead } from "../../src/integrations/providers.js";
import { issueQuote, priceTrip } from "../../src/services/pricing.service.js";
let mongo: MongoMemoryReplSet;
const config = readConfig({
  NODE_ENV: "test",
  MONGODB_URI: "mongodb://127.0.0.1/test",
  JWT_SECRET: "x".repeat(64),
  WEB_ORIGIN: "http://127.0.0.1:5173",
});
const app = createApp(config, { check: async () => true });
const paymentConfig = {
  ...config,
  RAZORPAY_KEY_ID: "rzp_test_fixture",
  RAZORPAY_KEY_SECRET: "fixture-key-secret-not-real",
  RAZORPAY_WEBHOOK_SECRET: "fixture-webhook-secret-not-real",
};
const paymentApp = createApp(paymentConfig, { check: async () => true });
afterEach(() => vi.restoreAllMocks());
let a: Principal,
  b: Principal,
  tokenA: string,
  tokenB: string,
  readerToken: string,
  tripId: string,
  busId: string,
  routeId: string;
const password = "Aibus-test-password-2026!";
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    binary: { version: "7.0.14" },
  });
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});
beforeEach(async () => {
  for (const model of Object.values(mongoose.models))
    await model.deleteMany({});
  const hash = await hashPassword(password);
  const oa = await M.Operator.create({
      company: "Operator A",
      email: "a@example.test",
      status: "approved",
    }),
    ob = await M.Operator.create({
      company: "Operator B",
      email: "b@example.test",
      status: "approved",
    });
  const ua = await M.User.create({
      operatorId: oa._id,
      name: "Admin A",
      email: "a@example.test",
      passwordHash: hash,
      role: "operator_admin",
    }),
    ub = await M.User.create({
      operatorId: ob._id,
      name: "Admin B",
      email: "b@example.test",
      passwordHash: hash,
      role: "operator_admin",
    });
  await M.User.create({
    operatorId: oa._id,
    name: "Reader",
    email: "reader@example.test",
    passwordHash: hash,
    role: "read_only",
  });
  const la = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "a@example.test", password }),
    lb = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "b@example.test", password }),
    lr = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "reader@example.test", password });
  tokenA = la.body.data.accessToken;
  tokenB = lb.body.data.accessToken;
  readerToken = lr.body.data.accessToken;
  a = {
    userId: String(ua._id),
    operatorId: String(oa._id),
    role: "operator_admin",
    sessionId: "test",
    permissions: rolePermissions.operator_admin,
  };
  b = { ...a, userId: String(ub._id), operatorId: String(ob._id) };
  await M.PricingPolicy.create({
    operatorId: oa._id,
    taxBasisPoints: 0,
    chargePaise: 0,
    chargesTaxable: false,
    operatorDiscountMaxPaise: 0,
    requireAge: false,
    requireGender: false,
    requireMobile: false,
    gstEnabled: false,
    version: 1,
  });
  const bus = await M.Bus.create({
    operatorId: oa._id,
    registration: "TS 09 AA 1000",
    name: "Aibus",
    type: "AC Sleeper",
    capacity: 3,
  });
  busId = String(bus._id);
  const route = await M.Route.create({
    operatorId: oa._id,
    source: "Hyderabad",
    destination: "Bangalore",
    boarding: [{ name: "Miyapur" }],
    dropping: [{ name: "Hebbal" }],
    departure: "21:30",
    arrival: "06:30",
    durationMinutes: 540,
  });
  routeId = String(route._id);
  const trip = await M.Trip.create({
    operatorId: oa._id,
    busId,
    routeId,
    journeyDate: "2030-11-13",
    departureAt: new Date("2030-11-13T21:30:00+05:30"),
    seats: ["L1", "L2", "L3"].map((number, i) => ({
      number,
      deck: "lower",
      row: 0,
      column: i,
      category: "sleeper",
      farePaise: 145000,
      state: "available",
    })),
  });
  tripId = String(trip._id);
});
const get = (path: string, token = tokenA) =>
  request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${token}`);
const post = (path: string, data: unknown, token = tokenA) =>
  request(app)
    .post(`/api/v1${path}`)
    .set("Authorization", `Bearer ${token}`)
    .send(data);
describe("route seat-side fares", () => {
  it("uses Schedule form prices for both decks over route defaults without changing the route fares", async () => {
    await M.Bus.updateOne({ _id: busId }, { $set: { capacity: 6 } });
    await M.Layout.create({
      operatorId: a.operatorId,
      busId,
      name: "2+1 sleeper",
      seats: ["lower", "upper"].flatMap((deck) =>
        [0, 1, 3].map((column, i) => ({
          number: `${deck === "lower" ? "L" : "U"}${i + 1}`,
          deck,
          row: 0,
          column,
          category: "sleeper",
          farePaise: 0,
        })),
      ),
    });
    await post("/operator/fares", {
      routeId,
      basePaise: 100000,
      singlePaise: 120000,
      specialDates: [{ date: "2030-11-18", amountPaise: 150000 }],
      seatFares: [{ number: "L1", amountPaise: 180000 }],
    });
    const result = await post("/operator/trips", {
      busId,
      routeId,
      journeyDate: "2030-11-18",
      departureAt: "2030-11-18T21:30:00+05:30",
      seatSideFares: { doublePaise: 220000, singlePaise: 250050 },
    });
    expect(result.status).toBe(201);
    expect(result.body.data.seats.map((s: any) => s.farePaise)).toEqual([
      220000, 220000, 250050, 220000, 220000, 250050,
    ]);
    const stored = await M.Trip.findById(result.body.data._id).lean();
    expect(stored!.seatSideFares).toMatchObject({
      doublePaise: 220000,
      singlePaise: 250050,
    });
    const quote = await priceTrip(a, stored, ["L1", "U3"]);
    expect(quote.grossPaise).toBe(470050);
    expect((await M.Fare.findOne({ routeId }).lean())!.basePaise).toBe(100000);
  });
  it("rejects incomplete, nonpositive and fractional-paise Schedule prices", async () => {
    for (const seatSideFares of [
      { doublePaise: 220000 },
      { doublePaise: 0, singlePaise: 250000 },
      { doublePaise: 220000, singlePaise: 250000.5 },
    ]) {
      const result = await post("/operator/trips", {
        busId,
        routeId,
        journeyDate: "2030-11-18",
        departureAt: "2030-11-18T21:30:00+05:30",
        seatSideFares,
      });
      expect(result.status).toBe(400);
    }
    expect(await M.Trip.countDocuments()).toBe(1);
  });
  it("persists Fares-tab prices and snapshots double/single prices on both decks for weekdays and weekends", async () => {
    await M.Bus.updateOne({ _id: busId }, { $set: { capacity: 6 } });
    await M.Layout.create({
      operatorId: a.operatorId,
      busId,
      name: "2+1 sleeper",
      seats: ["lower", "upper"].flatMap((deck) =>
        [0, 1, 3].map((column, i) => ({
          number: `${deck === "lower" ? "L" : "U"}${i + 1}`,
          deck,
          row: 0,
          column,
          category: "sleeper",
          farePaise: 0,
        })),
      ),
    });
    const fare = await post("/operator/fares", {
      routeId,
      basePaise: 220000,
      singlePaise: 250000,
      weekendPaise: 230000,
      singleWeekendPaise: 270000,
    });
    expect(fare.status).toBe(200);
    expect(fare.body.data.singlePaise).toBe(250000);
    const weekday = await post("/operator/trips", {
      busId,
      routeId,
      journeyDate: "2030-11-18",
      departureAt: "2030-11-18T21:30:00+05:30",
    });
    expect(weekday.status).toBe(201);
    expect(weekday.body.data.seats.map((s: any) => s.farePaise)).toEqual([
      220000, 220000, 250000, 220000, 220000, 250000,
    ]);
    const quote = await priceTrip(a, weekday.body.data, ["L1", "U3"]);
    expect(quote.seatFares.map((s: any) => s.basePaise)).toEqual([
      220000, 250000,
    ]);
    const weekend = await post("/operator/trips", {
      busId,
      routeId,
      journeyDate: "2030-11-23",
      departureAt: "2030-11-23T21:30:00+05:30",
    });
    expect(weekend.status).toBe(201);
    expect(weekend.body.data.seats.map((s: any) => s.farePaise)).toEqual([
      230000, 230000, 270000, 230000, 230000, 270000,
    ]);
    const unchanged = await M.Trip.findById(tripId).lean();
    expect(unchanged!.seats.map((s: any) => s.farePaise)).toEqual([
      145000, 145000, 145000,
    ]);
  });
  it("does not schedule a layout with unset prices and points to Fares", async () => {
    await M.Layout.create({
      operatorId: a.operatorId,
      busId,
      name: "Unpriced",
      seats: [0, 1, 3].map((column, i) => ({
        number: `L${i + 1}`,
        deck: "lower",
        row: 0,
        column,
        category: "sleeper",
        farePaise: 0,
      })),
    });
    const result = await post("/operator/trips", {
      busId,
      routeId,
      journeyDate: "2030-11-18",
      departureAt: "2030-11-18T21:30:00+05:30",
    });
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("FARES_REQUIRED");
    expect(await M.Trip.countDocuments()).toBe(1);
  });
});

describe("Area Master", () => {
  async function createArea() {
    const source = await post("/operator/area-master/cities", {
      name: "Hyderabad",
      state: "Telangana",
    });
    const destination = await post("/operator/area-master/cities", {
      name: "Bangalore",
      state: "Karnataka",
    });
    expect(source.status).toBe(201);
    expect(destination.status).toBe(201);
    const first = await post("/operator/area-master/locations", {
      cityId: source.body.data._id,
      name: "Miyapur",
      usage: "Pickup",
      address: "Miyapur bus stop",
    });
    const second = await post("/operator/area-master/locations", {
      cityId: source.body.data._id,
      name: "Ameerpet",
      usage: "Both",
    });
    const drop = await post("/operator/area-master/locations", {
      cityId: destination.body.data._id,
      name: "Majestic",
      usage: "Drop",
    });
    expect(first.status).toBe(201);
    expect(drop.status).toBe(201);
    return {
      source: source.body.data,
      destination: destination.body.data,
      first: first.body.data,
      second: second.body.data,
      drop: drop.body.data,
    };
  }
  it("creates cities, locations and POI with duplicate, coordinate and tenant validation", async () => {
    const area = await createArea();
    expect(
      (
        await post("/operator/area-master/cities", {
          name: " hyderabad ",
          state: "telangana",
        })
      ).status,
    ).toBe(409);
    const poi = await post("/operator/area-master/pois", {
      cityId: area.source._id,
      name: "Metro station",
      category: "Railway station",
      latitude: 17.49,
      longitude: 78.39,
    });
    expect(poi.status).toBe(201);
    const linked = await post("/operator/area-master/locations", {
      cityId: area.source._id,
      name: "Metro pickup",
      usage: "Pickup",
      landmarkId: poi.body.data._id,
    });
    expect(linked.status).toBe(201);
    expect(
      (
        await post("/operator/area-master/locations", {
          cityId: area.destination._id,
          name: "Wrong city",
          usage: "Drop",
          landmarkId: poi.body.data._id,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post("/operator/area-master/pois", {
          cityId: area.source._id,
          name: "Incomplete",
          category: "Landmark",
          latitude: 1,
        })
      ).status,
    ).toBe(400);
    expect(
      (await get(`/operator/area-master/cities/${area.source._id}`, tokenB))
        .status,
    ).toBe(404);
    expect(
      (
        await post(
          "/operator/area-master/locations",
          { cityId: area.source._id, name: "Foreign", usage: "Pickup" },
          tokenB,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await post(
          "/operator/area-master/cities",
          { name: "Forbidden", state: "Region" },
          readerToken,
        )
      ).status,
    ).toBe(403);
  });
  it("assigns ordered route stops and uses active master locations in counter search and booking validation", async () => {
    const area = await createArea();
    const input = {
      sourceCityId: area.source._id,
      destinationCityId: area.destination._id,
      boarding: [
        { locationId: area.second._id, time: "20:00" },
        { locationId: area.first._id, time: "20:30" },
      ],
      dropping: [{ locationId: area.drop._id, time: "06:00" }],
      expectedVersion: 0,
    };
    const saved = await request(app)
      .put(`/api/v1/operator/area-master/routes/${routeId}/stops`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send(input);
    expect(saved.status).toBe(200);
    expect(saved.body.data.boarding.map((stop: any) => stop.name)).toEqual([
      "Ameerpet",
      "Miyapur",
    ]);
    expect(saved.body.data.boarding[0].time).toBe("20:00");
    const stale = await request(app)
      .put(`/api/v1/operator/area-master/routes/${routeId}/stops`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send(input);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("ROUTE_CHANGED");
    const searchPath =
      "/operator/counter/trips?from=Hyderabad&to=Bangalore&journeyDate=2030-11-13";
    expect(
      (await get(searchPath)).body.data[0].boarding.map(
        (stop: any) => stop.name,
      ),
    ).toEqual(["Ameerpet", "Miyapur"]);
    const changed = await request(app)
      .patch(`/api/v1/operator/area-master/locations/${area.second._id}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({
        cityId: area.source._id,
        name: "Ameerpet updated",
        usage: "Both",
        status: "Inactive",
      });
    expect(changed.status).toBe(200);
    expect(
      (await get(searchPath)).body.data[0].boarding.map(
        (stop: any) => stop.name,
      ),
    ).toEqual(["Miyapur"]);
    const hold: any = await createHold(a, tripId, ["L1"]);
    await expect(
      createBooking(
        a,
        {
          tripId,
          holdId: hold.holdId,
          passengers: [
            {
              name: "Passenger",
              seat: "L1",
              boarding: "Ameerpet",
              dropping: "Majestic",
            },
          ],
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "BOARDING_INVALID" });
  });
  it("rejects pickup/drop usage mismatches without changing the route", async () => {
    const area = await createArea();
    const badPickup = await post("/operator/area-master/locations", {
      cityId: area.source._id,
      name: "Drop only",
      usage: "Drop",
    });
    const result = await request(app)
      .put(`/api/v1/operator/area-master/routes/${routeId}/stops`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({
        sourceCityId: area.source._id,
        destinationCityId: area.destination._id,
        boarding: [{ locationId: badPickup.body.data._id }],
        dropping: [{ locationId: area.drop._id }],
        expectedVersion: 0,
      });
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe("STOP_ROUTE_MISMATCH");
    expect((await M.Route.findById(routeId).lean())!.boarding[0].name).toBe(
      "Miyapur",
    );
  });
});

describe("Bus Master", () => {
  it("manages tenant-owned owners, coaches, chart templates, vehicle records and GPS mappings", async () => {
    const owner = await post("/operator/bus-master/owners", {
      name: "Fleet Owner",
      phone: "9876543210",
    });
    const coach = await post("/operator/bus-master/coaches", {
      name: "Sleeper coach",
      type: "AC Sleeper",
      arrangement: "2+1",
      decks: 2,
      amenities: ["Charging"],
    });
    expect(owner.status).toBe(201);
    expect(coach.status).toBe(201);
    const assignment = await request(app)
      .patch(`/api/v1/operator/bus-master/buses/${busId}/assignments`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ ownerId: owner.body.data._id, coachTypeId: coach.body.data._id });
    expect(assignment.status).toBe(200);
    const template = await post("/operator/bus-master/charts", {
      name: "Three berth chart",
      seats: [0, 1, 3].map((column, i) => ({
        number: `L${i + 1}`,
        deck: "lower",
        row: 0,
        column,
        category: "sleeper",
        farePaise: 0,
      })),
    });
    expect(template.status).toBe(201);
    expect(
      (
        await post(`/operator/bus-master/buses/${busId}/chart`, {
          templateId: template.body.data._id,
        })
      ).status,
    ).toBe(200);
    expect((await M.Trip.findById(tripId).lean())!.seats[0].farePaise).toBe(
      145000,
    );
    const document = await post("/operator/bus-master/documents", {
      busId,
      kind: "Insurance",
      reference: "POL-123",
      issuedOn: "2029-01-01",
      expiresOn: "2030-01-01",
    });
    expect(document.status).toBe(201);
    expect(
      (
        await post("/operator/bus-master/documents", {
          busId,
          kind: "Insurance",
          reference: "BAD",
          issuedOn: "2031-01-01",
          expiresOn: "2030-01-01",
        })
      ).status,
    ).toBe(400);
    const gps = await post("/operator/bus-master/gps", {
      busId,
      provider: "Provider configured later",
      deviceId: "GPS-001",
    });
    expect(gps.status).toBe(201);
    expect(
      (await get(`/operator/bus-master/gps/${gps.body.data._id}/status`)).body
        .data,
    ).toMatchObject({
      telemetryStatus: "Not connected",
      lastReportedAt: null,
      latitude: null,
    });
    expect(
      (await get(`/operator/bus-master/owners/${owner.body.data._id}`, tokenB))
        .status,
    ).toBe(404);
    expect(
      (
        await post(
          "/operator/bus-master/owners",
          { name: "Forbidden", phone: "1234567890" },
          readerToken,
        )
      ).status,
    ).toBe(403);
    const foreignOwner = await post(
      "/operator/bus-master/owners",
      { name: "Other company", phone: "1234567890" },
      tokenB,
    );
    expect(
      (
        await request(app)
          .patch(`/api/v1/operator/bus-master/buses/${busId}/assignments`)
          .set("Authorization", `Bearer ${tokenA}`)
          .send({ ownerId: foreignOwner.body.data._id })
      ).status,
    ).toBe(404);
  });
  it("requires matching chart capacity and prevents concurrent overlapping crew assignments", async () => {
    const seats = [0, 1, 3].map((column, i) => ({
      number: `L${i + 1}`,
      deck: "lower",
      row: 0,
      column,
      category: "sleeper",
      farePaise: 145000,
    }));
    await M.Layout.create({
      operatorId: a.operatorId,
      busId,
      name: "Bus layout",
      seats,
    });
    const otherBus = await M.Bus.create({
      operatorId: a.operatorId,
      registration: "MH12ZZ9999",
      name: "Other bus",
      type: "AC Sleeper",
      capacity: 3,
    });
    await M.Layout.create({
      operatorId: a.operatorId,
      busId: otherBus._id,
      name: "Other layout",
      seats,
    });
    const driver = await post("/operator/bus-master/crew", {
      name: "Driver",
      phone: "9876543210",
      role: "Driver",
      licenceNumber: "DL-123",
      licenceExpiry: "2032-01-01",
    });
    expect(driver.status).toBe(201);
    const input = {
      routeId,
      journeyDate: "2030-11-18",
      departureAt: "2030-11-18T21:30:00+05:30",
      crewIds: [driver.body.data._id],
    };
    const attempts = await Promise.all([
      post("/operator/trips", { ...input, busId }),
      post("/operator/trips", { ...input, busId: String(otherBus._id) }),
    ]);
    expect(attempts.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(attempts.find((r) => r.status === 409)!.body.error.code).toBe(
      "CREW_SCHEDULE_CONFLICT",
    );
    const shortChart = await post("/operator/bus-master/charts", {
      name: "Wrong capacity",
      seats: [seats[0]],
    });
    expect(
      (
        await post(`/operator/bus-master/buses/${busId}/chart`, {
          templateId: shortChart.body.data._id,
        })
      ).status,
    ).toBe(409);
  });
  it("rejects an expired driver licence for a future trip", async () => {
    const driver = await post("/operator/bus-master/crew", {
      name: "Expired Driver",
      phone: "9876543210",
      role: "Driver",
      licenceNumber: "OLD-DL",
      licenceExpiry: "2029-01-01",
    });
    const result = await request(app)
      .patch(`/api/v1/operator/bus-master/trips/${tripId}/crew`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ crewIds: [driver.body.data._id] });
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("DRIVER_LICENCE_EXPIRED");
    const conductor = await post("/operator/bus-master/crew", {
      name: "Conductor",
      phone: "9876543210",
      role: "Conductor",
    });
    const saved = await request(app)
      .patch(`/api/v1/operator/bus-master/trips/${tripId}/crew`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ crewIds: [conductor.body.data._id] });
    expect(saved.status).toBe(200);
    expect(saved.body.data.crewIds).toEqual([conductor.body.data._id]);
  });
});

describe("platform admin panel", () => {
  it("returns searchable paginated operators, overview and company-only details to administrators", async () => {
    await M.User.create({
      name: "Platform",
      email: "platform@example.test",
      passwordHash: await hashPassword(password),
      role: "super_admin",
    });
    await M.Operator.create({
      company: "Pending Travels",
      email: "pending@example.test",
    });
    const login = await request(app)
      .post("/api/v1/auth/login")
      .set("Origin", "http://127.0.0.1:5174")
      .set("X-Aibus-Client", "admin")
      .send({ email: "platform@example.test", password });
    expect(login.status).toBe(200);
    const token = login.body.data.accessToken;
    const overview = await get("/platform/overview", token);
    expect(overview.body.data).toMatchObject({
      totalOperators: 3,
      operators: { approved: 2, pending: 1 },
      buses: 1,
      routes: 1,
      scheduledTrips: 1,
    });
    const filtered = await get(
      "/platform/operators?search=Operator%20A&status=approved",
      token,
    );
    expect(filtered.body.data).toHaveLength(1);
    expect(filtered.body.data[0].company).toBe("Operator A");
    const page = await get(
      "/platform/operators?status=approved&limit=1&page=2",
      token,
    );
    expect(page.body.meta).toMatchObject({ total: 2, pages: 2, page: 2 });
    expect(
      (await get("/platform/operators?search=%5B", token)).body.data,
    ).toHaveLength(0);
    const details = await get(`/platform/operators/${a.operatorId}`, token);
    expect(details.body.data.counts).toEqual({
      buses: 1,
      routes: 1,
      scheduledTrips: 1,
    });
    expect(details.body.data).not.toHaveProperty("passengers");
    expect((await get("/platform/overview")).status).toBe(403);
    expect((await get(`/platform/operators/${a.operatorId}`)).status).toBe(403);
  });
  it("keeps admin refresh cookies separate from operator sessions and rejects operator admin-panel login", async () => {
    await M.User.create({
      name: "Platform",
      email: "platform@example.test",
      passwordHash: await hashPassword(password),
      role: "super_admin",
    });
    const operatorLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "a@example.test", password });
    const adminLogin = await request(app)
      .post("/api/v1/auth/login")
      .set("Origin", "http://127.0.0.1:5174")
      .set("X-Aibus-Client", "admin")
      .send({ email: "platform@example.test", password });
    expect(adminLogin.status).toBe(200);
    expect(adminLogin.headers["set-cookie"][0]).toMatch(
      /^aibus_admin_refresh=/,
    );
    const cookies = [
      operatorLogin.headers["set-cookie"][0],
      adminLogin.headers["set-cookie"][0],
    ]
      .map((c: string) => c.split(";")[0])
      .join("; ");
    const adminRefresh = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Origin", "http://127.0.0.1:5174")
      .set("X-Aibus-Client", "admin")
      .set("Cookie", cookies);
    expect(adminRefresh.body.data.user.role).toBe("super_admin");
    const operatorRefresh = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Origin", config.WEB_ORIGIN)
      .set("Cookie", cookies);
    expect(operatorRefresh.body.data.user.role).toBe("operator_admin");
    const refused = await request(app)
      .post("/api/v1/auth/login")
      .set("Origin", "http://127.0.0.1:5174")
      .set("X-Aibus-Client", "admin")
      .send({ email: "a@example.test", password });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("ADMIN_REQUIRED");
  });
});

describe("authentication and isolation", () => {
  it("rejects anonymous resources, NoSQL input, forged tenant ownership and cross-operator reads", async () => {
    expect((await request(app).get("/api/v1/operator/buses")).status).toBe(401);
    expect(
      (
        await request(app)
          .post("/api/v1/auth/login")
          .send({ email: { $ne: null }, password })
      ).status,
    ).toBe(400);
    expect((await get(`/operator/buses/${busId}`, tokenB)).status).toBe(404);
    expect((await get("/operator/buses", tokenB)).body.meta.total).toBe(0);
    const result = await post("/operator/buses", {
      registration: "TS 10 AA 9999",
      name: "Other",
      type: "AC Sleeper",
      capacity: 3,
      operatorId: b.operatorId,
    });
    expect(result.status).toBe(400);
    expect((await get(`/operator/trips/${tripId}/seats`, tokenB)).status).toBe(
      404,
    );
  });
  it("denies write permissions and excludes passenger PII from read-only bookings", async () => {
    expect(
      (
        await post(
          "/operator/trips/" + tripId + "/block",
          { seats: ["L1"] },
          readerToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (await get(`/operator/trips/${tripId}/manifest`, readerToken)).status,
    ).toBe(403);
    expect((await get("/operator/settlements", readerToken)).status).toBe(403);
    expect((await get("/operator/staff", readerToken)).status).toBe(403);
    const hold: any = await createHold(a, tripId, ["L1"]);
    await createBooking(
      a,
      {
        tripId,
        holdId: hold.holdId,
        passengers: [
          { name: "Private Passenger", phone: "+919876543210", seat: "L1" },
        ],
      },
      randomUUID(),
    );
    const result = await get("/operator/bookings", readerToken);
    expect(JSON.stringify(result.body)).not.toContain("Private Passenger");
    expect(JSON.stringify(result.body)).not.toContain("9876543210");
  });
  it("rotates refresh tokens, detects replay and revokes related access sessions", async () => {
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "a@example.test", password });
    const cookie = login.headers["set-cookie"][0].split(";")[0];
    expect(login.headers["set-cookie"][0]).toContain("HttpOnly");
    const refreshed = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Origin", config.WEB_ORIGIN)
      .set("Cookie", cookie);
    expect(refreshed.status).toBe(200);
    expect((await get("/auth/me", login.body.data.accessToken)).status).toBe(
      401,
    );
    const replay = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Origin", config.WEB_ORIGIN)
      .set("Cookie", cookie);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe("TOKEN_REUSE");
    expect(
      (await get("/auth/me", refreshed.body.data.accessToken)).status,
    ).toBe(401);
  });
  it("rejects cross-site cookie mutations and suspended accounts", async () => {
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "a@example.test", password });
    const cookie = login.headers["set-cookie"][0].split(";")[0];
    expect(
      (
        await request(app)
          .post("/api/v1/auth/refresh")
          .set("Origin", "https://evil.example")
          .set("Cookie", cookie)
      ).status,
    ).toBe(403);
    await M.Operator.updateOne(
      { _id: a.operatorId },
      { $set: { status: "suspended" } },
    );
    expect((await get("/operator/buses")).status).toBe(403);
  });
  it("registers pending operators and only platform administrators can approve them", async () => {
    const registered = await request(app).post("/api/v1/auth/register").send({
      company: "New Travels",
      name: "New Admin",
      email: "new@example.test",
      password,
      phone: "+919876543210",
      address: "Hyderabad",
    });
    expect(registered.status).toBe(201);
    expect(
      (
        await request(app)
          .post("/api/v1/auth/login")
          .send({ email: "new@example.test", password })
      ).status,
    ).toBe(403);
    const pending = await M.Operator.findOne({ email: "new@example.test" });
    expect(
      (
        await request(app)
          .patch(`/api/v1/platform/operators/${pending!._id}/status`)
          .set("Authorization", `Bearer ${tokenA}`)
          .send({ status: "approved" })
      ).status,
    ).toBe(403);
    await M.User.create({
      name: "Platform",
      email: "platform@example.test",
      passwordHash: await hashPassword(password),
      role: "super_admin",
    });
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "platform@example.test", password });
    const approved = await request(app)
      .patch(`/api/v1/platform/operators/${pending!._id}/status`)
      .set("Authorization", `Bearer ${login.body.data.accessToken}`)
      .send({ status: "approved" });
    expect(approved.status).toBe(200);
    expect(
      (
        await request(app)
          .post("/api/v1/auth/login")
          .send({ email: "new@example.test", password })
      ).status,
    ).toBe(200);
  });
  it("rejects expired and invalid JWTs and allows session logout", async () => {
    expect((await get("/operator/buses", "invalid")).status).toBe(401);
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "a@example.test", password });
    await request(app)
      .post("/api/v1/auth/logout")
      .set("Origin", config.WEB_ORIGIN)
      .set("Cookie", login.headers["set-cookie"][0].split(";")[0]);
    expect((await get("/auth/me", login.body.data.accessToken)).status).toBe(
      401,
    );
  });
});
describe("authoritative inventory and money transitions", () => {
  it("allows exactly one winner for simultaneous requests for the same seat", async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, () => createHold(a, tripId, ["L1"])),
    );
    expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await M.Hold.countDocuments({ operatorId: a.operatorId, status: "held" }),
    ).toBe(1);
  });
  it("blocks/release seats atomically and prevents holds by another tenant", async () => {
    expect(
      (await post(`/operator/trips/${tripId}/block`, { seats: ["L1"] })).status,
    ).toBe(200);
    expect(
      (await post(`/operator/trips/${tripId}/holds`, { seats: ["L1"] })).status,
    ).toBe(409);
    expect(
      (await post(`/operator/trips/${tripId}/unblock`, { seats: ["L1"] }))
        .status,
    ).toBe(200);
    expect(
      (await post(`/operator/trips/${tripId}/holds`, { seats: ["L1", "L1"] }))
        .status,
    ).toBe(400);
    await expect(createHold(b, tripId, ["L1"])).rejects.toMatchObject({
      status: 404,
    });
  });
  it("rejects reservation holds for an already booked seat", async () => {
    await M.Trip.updateOne(
      { _id: tripId },
      { $set: { "seats.0.state": "booked" } },
    );
    expect(
      (await post(`/operator/trips/${tripId}/holds`, { seats: ["L1"] })).status,
    ).toBe(409);
    expect(await M.Hold.countDocuments({ tripId, status: "held" })).toBe(0);
  });
  it("creates pending bookings idempotently and never issues a ticket before payment", async () => {
    const hold: any = await createHold(a, tripId, ["L1"]),
      input = {
        tripId,
        holdId: hold.holdId,
        passengers: [{ name: "Passenger", seat: "L1" }],
      },
      key = randomUUID();
    const first: any = await createBooking(a, input, key),
      duplicate: any = await createBooking(a, input, key);
    expect(String(first._id)).toBe(String(duplicate._id));
    expect(first.status).toBe("Pending payment");
    const pendingTrip = await M.Trip.findById(tripId).lean();
    expect(pendingTrip!.seats[0].state).toBe("held");
    expect(String(pendingTrip!.seats[0].bookingId)).toBe(String(first._id));
    expect(
      (await post(`/operator/trips/${tripId}/holds`, { seats: ["L1"] })).status,
    ).toBe(409);
    expect(first.pnr).toBeUndefined();
    expect((await get(`/operator/bookings/${first._id}/ticket`)).status).toBe(
      409,
    );
    await expect(
      createBooking(
        a,
        { ...input, passengers: [{ name: "Other", seat: "L1" }] },
        key,
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(
      (await post(`/operator/bookings/${first._id}/payment`, {})).status,
    ).toBe(503);
  });
  it("processes duplicate verified payment callbacks once and generates one valid ticket", async () => {
    const hold: any = await createHold(a, tripId, ["L1"]);
    const booking: any = await createBooking(
      a,
      {
        tripId,
        holdId: hold.holdId,
        passengers: [{ name: "Passenger", seat: "L1" }],
      },
      randomUUID(),
    );
    const event = {
      verified: true as const,
      providerId: "sandbox-test",
      eventId: "evt-1",
      externalId: "pay-1",
      operatorId: a.operatorId!,
      bookingId: String(booking._id),
      amountPaise: 145000,
      currency: "INR" as const,
      status: "captured" as const,
    };
    await Promise.all([
      applyVerifiedPayment(event),
      applyVerifiedPayment(event),
    ]);
    expect(await M.Payment.countDocuments()).toBe(1);
    expect(await M.Ticket.countDocuments()).toBe(1);
    const confirmed = await M.Booking.findById(booking._id).lean();
    expect(confirmed!.status).toBe("Confirmed");
    await reconcileExpiredHolds();
    const lockedTrip = await M.Trip.findById(tripId).lean();
    expect(lockedTrip!.seats[0].state).toBe("booked");
    expect(String(lockedTrip!.seats[0].bookingId)).toBe(String(booking._id));
    expect(
      (await post(`/operator/trips/${tripId}/holds`, { seats: ["L1"] })).status,
    ).toBe(409);
    expect(confirmed!.pnr).toBeTruthy();
    expect((await get(`/operator/bookings/${booking._id}/ticket`)).status).toBe(
      200,
    );
    expect(
      (await get(`/operator/bookings/${booking._id}/ticket`, tokenB)).status,
    ).toBe(404);
    await expect(
      applyVerifiedPayment({ ...event, amountPaise: 1 }),
    ).rejects.toMatchObject({ code: "EVENT_CONFLICT" });
  });
  it("does not issue a ticket for late captured payment after the held seat expires", async () => {
    const hold: any = await createHold(a, tripId, ["L1"]);
    const booking: any = await createBooking(
      a,
      {
        tripId,
        holdId: hold.holdId,
        passengers: [{ name: "Passenger", seat: "L1" }],
      },
      randomUUID(),
    );
    await M.Trip.updateOne(
      { _id: tripId },
      { $set: { "seats.0.holdUntil": new Date(Date.now() - 1000) } },
    );
    await applyVerifiedPayment({
      verified: true,
      providerId: "sandbox-test",
      eventId: "late",
      externalId: "pay-late",
      operatorId: a.operatorId!,
      bookingId: String(booking._id),
      amountPaise: 145000,
      currency: "INR",
      status: "captured",
    });
    expect((await M.Booking.findById(booking._id))!.status).toBe(
      "Reconciliation required",
    );
    expect(await M.Ticket.countDocuments()).toBe(0);
  });
  it("rejects amount mismatch, external inventory and unsigned webhooks without side effects", async () => {
    const hold: any = await createHold(a, tripId, ["L1"]),
      booking: any = await createBooking(
        a,
        {
          tripId,
          holdId: hold.holdId,
          passengers: [{ name: "Passenger", seat: "L1" }],
        },
        randomUUID(),
      );
    await expect(
      applyVerifiedPayment({
        verified: true,
        providerId: "test",
        eventId: "wrong",
        externalId: "pay-wrong",
        operatorId: a.operatorId!,
        bookingId: String(booking._id),
        amountPaise: 1,
        currency: "INR",
        status: "captured",
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_MISMATCH" });
    expect(await M.Payment.countDocuments()).toBe(0);
    expect(
      (
        await request(app)
          .post("/api/v1/webhooks/fake")
          .send({ status: "captured" })
      ).status,
    ).toBe(503);
    await M.Trip.updateOne(
      { _id: tripId },
      { $set: { inventoryOwner: "external" } },
    );
    expect((await get(`/operator/trips/${tripId}/seats`)).status).toBe(503);
  });
  it("expires pending holds and reconciles bookings without making external calls", async () => {
    const hold: any = await createHold(a, tripId, ["L1"]),
      booking: any = await createBooking(
        a,
        {
          tripId,
          holdId: hold.holdId,
          passengers: [{ name: "Passenger", seat: "L1" }],
        },
        randomUUID(),
      );
    await M.Hold.updateOne(
      { holdId: hold.holdId },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    await M.Trip.updateOne(
      { _id: tripId },
      { $set: { "seats.0.holdUntil": new Date(Date.now() - 1000) } },
    );
    await reconcileExpiredHolds();
    expect((await M.Booking.findById(booking._id))!.status).toBe("Failed");
    expect((await M.Trip.findById(tripId))!.seats[0].state).toBe("available");
    expect(await reconcileExternalBookings()).toEqual({
      available: false,
      checked: 0,
    });
  });
  it("uses actual recorded settlement totals and integer-paise reports", async () => {
    const report = await get(
      "/operator/reports/revenue?from=2026-01-01&to=2026-12-31",
    );
    expect(report.status).toBe(200);
    expect(report.body.data.grossPaise).toBe(0);
    expect(report.body.data.settledPaise).toBe(0);
    expect((await get("/operator/settlements")).body.data).toEqual([]);
  });
});
describe("shared booking counter engine", () => {
  it("searches only owned trips with accurate availability and rejects injected search fields", async () => {
    const result = await get(
      "/operator/counter/trips?from=Hyderabad&to=Bangalore&journeyDate=2030-11-13",
    );
    expect(result.status).toBe(200);
    expect(result.body.data).toHaveLength(1);
    expect(result.body.data[0]).toMatchObject({
      id: tripId,
      totalSeats: 3,
      availableSeats: 3,
      baseFarePaise: 145000,
    });
    expect(
      (await get("/operator/counter/trips?journeyDate=2030-11-13", tokenB)).body
        .data,
    ).toEqual([]);
    expect(
      (
        await get(
          "/operator/counter/trips?journeyDate=2030-11-13&operatorId=" +
            a.operatorId,
        )
      ).status,
    ).toBe(400);
    expect(
      (await get(`/operator/counter/trips/${tripId}/bookings`, tokenB)).status,
    ).toBe(404);
  });
  it("requires an explicit tax policy and restricts changes to pricing-authorized staff", async () => {
    await M.PricingPolicy.deleteMany({ operatorId: a.operatorId });
    await expect(issueQuote(a, tripId, ["L1"], {})).rejects.toMatchObject({
      code: "PRICING_POLICY_REQUIRED",
    });
    const body = {
      taxBasisPoints: 500,
      chargePaise: 10000,
      chargesTaxable: true,
      operatorDiscountMaxPaise: 20000,
      requireAge: true,
      requireGender: true,
      requireMobile: true,
      gstEnabled: true,
      expectedVersion: 0,
    };
    expect(
      (
        await request(app)
          .put("/api/v1/operator/pricing-policy")
          .set("Authorization", `Bearer ${readerToken}`)
          .send(body)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .put("/api/v1/operator/pricing-policy")
          .set("Authorization", `Bearer ${tokenA}`)
          .send(body)
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .put("/api/v1/operator/pricing-policy")
          .set("Authorization", `Bearer ${tokenA}`)
          .send(body)
      ).status,
    ).toBe(409);
  });
  it("quotes server-side taxes/charges/discounts and rejects client totals and forged sources", async () => {
    await M.PricingPolicy.updateOne(
      { operatorId: a.operatorId },
      {
        $set: {
          taxBasisPoints: 500,
          chargePaise: 10000,
          chargesTaxable: true,
          operatorDiscountMaxPaise: 20000,
        },
      },
    );
    const quoted = await issueQuote(a, tripId, ["L1", "L2"], {
      operatorDiscountPaise: 10000,
    });
    expect(quoted.pricing).toMatchObject({
      grossPaise: 290000,
      discountPaise: 10000,
      taxPaise: 14500,
      chargePaise: 10000,
      totalPaise: 304500,
    });
    const noDiscountAuth = { ...a, permissions: rolePermissions.booking_staff };
    const trip = await M.Trip.findOne({
      _id: tripId,
      operatorId: a.operatorId,
    }).lean();
    await expect(
      priceTrip(noDiscountAuth, trip, ["L1"], { operatorDiscountPaise: 100 }),
    ).rejects.toMatchObject({ code: "DISCOUNT_FORBIDDEN" });
    const hold: any = await createHold(a, tripId, ["L1"]);
    const body = {
      tripId,
      holdId: hold.holdId,
      passengers: [{ name: "Passenger", seat: "L1" }],
      totalPaise: 1,
    };
    expect(
      (
        await post("/operator/bookings", body).set(
          "Idempotency-Key",
          randomUUID(),
        )
      ).status,
    ).toBe(400);
    delete (body as any).totalPaise;
    expect(
      (
        await post("/operator/bookings", { ...body, source: "customer" }).set(
          "Idempotency-Key",
          randomUUID(),
        )
      ).status,
    ).toBe(400);
  });
  it("binds quotes to hold, user and policy version without consuming invalid attempts", async () => {
    const hold: any = await createHold(a, tripId, ["L1"]);
    const quoted = await issueQuote(a, tripId, ["L1"], {}, hold.holdId);
    await M.PricingPolicy.updateOne(
      { operatorId: a.operatorId },
      { $inc: { version: 1 }, $set: { taxBasisPoints: 500 } },
    );
    await expect(
      createBooking(
        a,
        {
          tripId,
          holdId: hold.holdId,
          quoteId: quoted.quoteId,
          passengers: [{ name: "Passenger", seat: "L1" }],
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "REQUOTE_REQUIRED" });
    expect(
      (await M.Hold.findOne({ operatorId: a.operatorId, holdId: hold.holdId }))!
        .status,
    ).toBe("held");
    const fresh = await issueQuote(a, tripId, ["L1"], {}, hold.holdId);
    const booking: any = await createBooking(
      a,
      {
        tripId,
        holdId: hold.holdId,
        quoteId: fresh.quoteId,
        passengers: [
          {
            name: "Passenger",
            seat: "L1",
            boarding: "Miyapur",
            dropping: "Hebbal",
          },
        ],
      },
      randomUUID(),
    );
    expect(booking).toMatchObject({
      totalPaise: 152250,
      taxPaise: 7250,
      source: "operator",
      status: "Pending payment",
    });
    expect(booking.pnr).toBeUndefined();
    expect(
      (await M.Quote.findOne({ _id: fresh.quoteId, operatorId: a.operatorId }))!
        .status,
    ).toBe("consumed");
  });
  it("enforces seat-specific passenger requirements and valid trip stops", async () => {
    await M.PricingPolicy.updateOne(
      { operatorId: a.operatorId },
      { $set: { requireAge: true, requireGender: true, requireMobile: true } },
    );
    const hold: any = await createHold(a, tripId, ["L1"]);
    await expect(
      createBooking(
        a,
        {
          tripId,
          holdId: hold.holdId,
          passengers: [
            { name: "Passenger", seat: "L1", phone: "+919876543210" },
          ],
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "AGE_REQUIRED" });
    await expect(
      createBooking(
        a,
        {
          tripId,
          holdId: hold.holdId,
          passengers: [
            {
              name: "Passenger",
              seat: "L1",
              age: 30,
              gender: "female",
              phone: "+919876543210",
              boarding: "Not on this route",
            },
          ],
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "BOARDING_INVALID" });
    const created: any = await createBooking(
      a,
      {
        tripId,
        holdId: hold.holdId,
        contact: { phone: "+919876543210", email: "passenger@example.test" },
        passengers: [
          {
            name: "Passenger",
            seat: "L1",
            age: 30,
            gender: "female",
            boarding: "Miyapur",
            dropping: "Hebbal",
          },
        ],
      },
      randomUUID(),
    );
    expect(created.passengers[0]).toMatchObject({
      age: 30,
      gender: "female",
      seat: "L1",
      dropping: "Hebbal",
    });
  });
  it("reserves quotas atomically and requires release before booking", async () => {
    expect(
      (
        await post(
          `/operator/trips/${tripId}/quota`,
          { seats: ["L1"], action: "assign", label: "Crew allocation" },
          readerToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await post(`/operator/trips/${tripId}/quota`, {
          seats: ["L1"],
          action: "assign",
          label: "Crew allocation",
        })
      ).status,
    ).toBe(200);
    expect(
      (await get(`/operator/trips/${tripId}/seats`)).body.data.seats[0],
    ).toMatchObject({ state: "quota", quotaLabel: "Crew allocation" });
    await expect(createHold(a, tripId, ["L1"])).rejects.toMatchObject({
      code: "SEAT_UNAVAILABLE",
    });
    expect(
      (
        await post(`/operator/trips/${tripId}/quota`, {
          seats: ["L1"],
          action: "release",
        })
      ).status,
    ).toBe(200);
    expect(((await createHold(a, tripId, ["L1"])) as any).holdId).toBeTruthy();
  });
  it("stops new holds and bookings, but preserves already-created pending-payment confirmation", async () => {
    const hold: any = await createHold(a, tripId, ["L1"]);
    const booking: any = await createBooking(
      a,
      {
        tripId,
        holdId: hold.holdId,
        passengers: [{ name: "Passenger", seat: "L1" }],
      },
      randomUUID(),
    );
    const stopped = await request(app)
      .patch(`/api/v1/operator/trips/${tripId}/booking-status`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ open: false, expectedVersion: 0 });
    expect(stopped.status).toBe(200);
    await expect(createHold(a, tripId, ["L2"])).rejects.toMatchObject({
      code: "BOOKING_STOPPED",
    });
    await applyVerifiedPayment({
      verified: true,
      providerId: "test",
      externalId: "paid-before-stop",
      eventId: "evt-before-stop",
      operatorId: a.operatorId!,
      bookingId: String(booking._id),
      amountPaise: 145000,
      currency: "INR",
      status: "captured",
    });
    expect((await M.Booking.findById(booking._id))!.status).toBe("Confirmed");
    expect(
      (
        await request(app)
          .patch(`/api/v1/operator/trips/${tripId}/booking-status`)
          .set("Authorization", `Bearer ${tokenA}`)
          .send({ open: true, expectedVersion: 0 })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .patch(`/api/v1/operator/trips/${tripId}/booking-status`)
          .set("Authorization", `Bearer ${tokenA}`)
          .send({ open: true, expectedVersion: 1 })
      ).status,
    ).toBe(200);
  });
  it("cancels only unpaid pending bookings and reconciles a late capture without issuing a ticket", async () => {
    const hold: any = await createHold(a, tripId, ["L1"]);
    const booking: any = await createBooking(
      a,
      {
        tripId,
        holdId: hold.holdId,
        passengers: [{ name: "Passenger", seat: "L1" }],
      },
      randomUUID(),
    );
    expect(
      (
        await post(
          `/operator/bookings/${booking._id}/cancel-pending`,
          { reason: "Passenger changed plans" },
          tokenB,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await post(`/operator/bookings/${booking._id}/cancel-pending`, {
          reason: "Passenger changed plans",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await post(`/operator/bookings/${booking._id}/cancel-pending`, {
          reason: "Duplicate request",
        })
      ).status,
    ).toBe(200);
    expect((await M.Trip.findById(tripId))!.seats[0].state).toBe("available");
    await applyVerifiedPayment({
      verified: true,
      providerId: "test",
      externalId: "late-after-cancel",
      eventId: "late-after-cancel",
      operatorId: a.operatorId!,
      bookingId: String(booking._id),
      amountPaise: 145000,
      currency: "INR",
      status: "captured",
    });
    expect((await M.Booking.findById(booking._id))!.status).toBe(
      "Reconciliation required",
    );
    expect(await M.Ticket.countDocuments()).toBe(0);
  });
  it("modifies passengers with optimistic version checks while preserving booked seats and money", async () => {
    const hold: any = await createHold(a, tripId, ["L1"]);
    const booking: any = await createBooking(
      a,
      {
        tripId,
        holdId: hold.holdId,
        passengers: [{ name: "Passenger", seat: "L1" }],
      },
      randomUUID(),
    );
    const update = {
      expectedVersion: 0,
      passengers: [
        {
          name: "Updated Passenger",
          seat: "L1",
          boarding: "Miyapur",
          dropping: "Hebbal",
        },
      ],
    };
    const path = `/api/v1/operator/bookings/${booking._id}/passengers`;
    expect(
      (
        await request(app)
          .patch(path)
          .set("Authorization", `Bearer ${tokenB}`)
          .send(update)
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .patch(path)
          .set("Authorization", `Bearer ${tokenA}`)
          .send({ ...update, passengers: [{ name: "Other seat", seat: "L2" }] })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .patch(path)
          .set("Authorization", `Bearer ${tokenA}`)
          .send(update)
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .patch(path)
          .set("Authorization", `Bearer ${tokenA}`)
          .send(update)
      ).status,
    ).toBe(409);
    const saved = await M.Booking.findById(booking._id).lean();
    expect(saved!.totalPaise).toBe(145000);
    expect(saved!.passengers[0].name).toBe("Updated Passenger");
  });
  it("restricts financial metadata and ticket downloads; source counts reflect stored records only", async () => {
    const hold: any = await createHold(a, tripId, ["L1"]);
    const booking: any = await createBooking(
      a,
      {
        tripId,
        holdId: hold.holdId,
        passengers: [{ name: "Passenger", seat: "L1" }],
      },
      randomUUID(),
    );
    expect(
      (await get(`/operator/bookings/${booking._id}/payments`, readerToken))
        .status,
    ).toBe(403);
    expect(
      (await get(`/operator/bookings/${booking._id}/ticket.html`)).status,
    ).toBe(409);
    await applyVerifiedPayment({
      verified: true,
      providerId: "test",
      externalId: "counter-test-ticket",
      eventId: "counter-test-ticket",
      operatorId: a.operatorId!,
      bookingId: String(booking._id),
      amountPaise: 145000,
      currency: "INR",
      status: "captured",
    });
    const ticket = await get(`/operator/bookings/${booking._id}/ticket.html`);
    expect(ticket.status).toBe(200);
    expect(ticket.text).toContain("CONFIRMED E-TICKET");
    expect(ticket.text).toContain("Passenger");
    expect(
      (await get(`/operator/bookings/${booking._id}/ticket.html`, tokenB))
        .status,
    ).toBe(409);
    const records = await get(`/operator/counter/trips/${tripId}/bookings`);
    expect(records.body.data.sourceCounts).toEqual({
      operator: 1,
      customer: 0,
      agent: 0,
      external: 0,
    });
    const limited = await get(
      `/operator/counter/trips/${tripId}/bookings`,
      readerToken,
    );
    expect(JSON.stringify(limited.body)).not.toContain("Passenger");
    expect(
      (await get(`/operator/counter/trips/${tripId}/bookings?source=customer`))
        .body.data.bookings,
    ).toEqual([]);
  });
});
describe("trusted source attribution", () => {
  it("uses the shared holds and engine for a verified customer channel without accepting a frontend source claim", async () => {
    const hold: any = await createHold(a, tripId, ["L1"]),
      key = randomUUID(),
      input = {
        tripId,
        holdId: hold.holdId,
        passengers: [{ name: "Customer Passenger", seat: "L1" }],
      };
    const booking: any = await createBooking(a, input, key, "customer");
    expect(booking.source).toBe("customer");
    await expect(createHold(a, tripId, ["L1"])).rejects.toMatchObject({
      code: "SEAT_UNAVAILABLE",
    });
    const list = await get(
      `/operator/counter/trips/${tripId}/bookings?source=customer`,
    );
    expect(list.body.data.bookings).toHaveLength(1);
    expect(list.body.data.sourceCounts).toEqual({
      operator: 0,
      customer: 1,
      agent: 0,
      external: 0,
    });
    await expect(
      createBooking(a, input, key, "operator"),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
});
describe("provider failures and realtime", () => {
  it("retries only read failures and propagates provider errors", async () => {
    let calls = 0;
    const value = await safeProviderRead(async () => {
      calls++;
      if (calls < 2) throw new AppError(503, "UPSTREAM", "unavailable");
      return "ok";
    });
    expect(value).toBe("ok");
    expect(calls).toBe(2);
    calls = 0;
    await expect(
      safeProviderRead(async () => {
        calls++;
        throw new AppError(400, "BAD_REQUEST", "invalid");
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(calls).toBe(1);
  });
  it("rejects anonymous sockets and scopes invalidation events to authenticated operator rooms", async () => {
    const server = createServer(app),
      io = attachRealtime(server, config);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address() as { port: number },
      url = `http://127.0.0.1:${address.port}`;
    const ca = connectSocket(url, {
        auth: { token: tokenA },
        transports: ["websocket"],
      }),
      cb = connectSocket(url, {
        auth: { token: tokenB },
        transports: ["websocket"],
      });
    try {
      await Promise.all([
        new Promise<void>((resolve, reject) => {
          ca.on("connect", resolve);
          ca.on("connect_error", reject);
        }),
        new Promise<void>((resolve, reject) => {
          cb.on("connect", resolve);
          cb.on("connect_error", reject);
        }),
      ]);
      let leaked = false;
      cb.on("seat.availability.changed", () => {
        leaked = true;
      });
      const received = new Promise<any>((resolve) =>
        ca.once("seat.availability.changed", resolve),
      );
      await M.Outbox.create({
        operatorId: a.operatorId,
        event: "seat.availability.changed",
        resourceId: tripId,
      });
      await publishOutbox(io);
      expect((await received).resourceId).toBe(tripId);
      expect(leaked).toBe(false);
      const anonymous = connectSocket(url, {
        transports: ["websocket"],
        reconnection: false,
      });
      await new Promise<void>((resolve) =>
        anonymous.once("connect_error", () => {
          anonymous.close();
          resolve();
        }),
      );
    } finally {
      ca.close();
      cb.close();
      await new Promise<void>((resolve) => io.close(() => resolve()));
      server.close();
    }
  });
});

describe("Razorpay Test Mode adapter (mock provider transport)", () => {
  const orderId = "order_fixture123",
    paymentId = "pay_fixture123";
  const hmac = (value: string, secret = paymentConfig.RAZORPAY_KEY_SECRET) =>
    createHmac("sha256", secret).update(value).digest("hex");
  const paymentPost = (
    bookingId: string,
    suffix = "",
    body: any = {},
    token = tokenA,
  ) =>
    request(paymentApp)
      .post("/api/v1/operator/bookings/" + bookingId + "/payment" + suffix)
      .set("Authorization", "Bearer " + token)
      .send(body);
  async function pending() {
    const hold: any = await createHold(a, tripId, ["L1"]);
    return (await createBooking(
      a,
      {
        tripId,
        holdId: hold.holdId,
        passengers: [
          { name: "Sandbox Passenger", seat: "L1", phone: "9999999999" },
        ],
      },
      randomUUID(),
    )) as any;
  }
  function provider(
    booking: any,
    options: {
      status?: string;
      amount?: number;
      foreignOrder?: boolean;
      refunded?: number;
    } = {},
  ) {
    const order = {
      id: orderId,
      amount: booking.totalPaise,
      currency: "INR",
      receipt: "aibus_" + booking._id,
      partial_payment: false,
    };
    const payment = () => ({
      id: paymentId,
      order_id: options.foreignOrder ? "order_foreign" : orderId,
      amount: options.amount ?? booking.totalPaise,
      currency: "INR",
      status: options.status || "captured",
      captured: !options.status || options.status === "captured",
      amount_refunded: options.refunded || 0,
    });
    return vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url, init) => {
        const endpoint = String(url).replace("https://api.razorpay.com/v1", "");
        if (endpoint === "/orders" && init?.method === "POST") {
          expect(JSON.parse(String(init.body))).toMatchObject({
            amount: booking.totalPaise,
            currency: "INR",
            partial_payment: false,
          });
          return new Response(JSON.stringify(order));
        }
        if (endpoint.startsWith("/orders?"))
          return new Response(JSON.stringify({ items: [order] }));
        if (endpoint === "/orders/" + orderId + "/payments")
          return new Response(JSON.stringify({ items: [payment()] }));
        if (endpoint === "/payments/" + paymentId)
          return new Response(JSON.stringify(payment()));
        if (endpoint === "/payments/" + paymentId + "/capture") {
          options.status = "captured";
          return new Response(JSON.stringify(payment()));
        }
        throw Error("Unexpected provider endpoint " + endpoint);
      });
  }
  const proof = () => ({
    razorpay_order_id: orderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: hmac(orderId + "|" + paymentId),
  });
  it("creates at most one gateway order under concurrent checkout requests", async () => {
    const booking = await pending(),
      transport = provider(booking),
      id = String(booking._id);
    const results = await Promise.all([
      paymentPost(id),
      paymentPost(id),
      paymentPost(id),
    ]);
    expect(results.some((r) => r.status === 200)).toBe(true);
    expect(results.every((r) => [200, 409].includes(r.status))).toBe(true);
    expect(
      transport.mock.calls.filter(
        ([url, options]) =>
          String(url).endsWith("/orders") && options?.method === "POST",
      ),
    ).toHaveLength(1);
    expect(await M.PaymentOrder.countDocuments({ bookingId: id })).toBe(1);
  });
  it("never blindly retries an uncertain capture and can recover its eventual captured status", async () => {
    const booking = await pending(),
      options = { status: "authorized" },
      transport = provider(booking, options),
      id = String(booking._id);
    const original = transport.getMockImplementation()!;
    transport.mockImplementation(async (...args) => {
      if (String(args[0]).endsWith("/capture"))
        throw Error("capture response lost");
      return original(...args);
    });
    await paymentPost(id);
    expect((await paymentPost(id, "/verify", proof())).body.data.status).toBe(
      "Pending payment",
    );
    expect((await paymentPost(id, "/verify", proof())).body.data.status).toBe(
      "Pending payment",
    );
    expect(
      transport.mock.calls.filter(([url]) => String(url).endsWith("/capture")),
    ).toHaveLength(1);
    options.status = "captured";
    expect((await paymentPost(id, "/verify", proof())).body.data.status).toBe(
      "Confirmed",
    );
    expect(await M.Ticket.countDocuments({ bookingId: id })).toBe(1);
  });
  it("uses the server amount, reuses one order, verifies capture and issues only one ticket across callback/webhook replay", async () => {
    const booking = await pending(),
      transport = provider(booking),
      id = String(booking._id);
    const start = await paymentPost(id);
    expect(start.status).toBe(200);
    expect(start.body.data).toMatchObject({
      mode: "test",
      amountPaise: 145000,
      orderId,
      keyId: "rzp_test_fixture",
    });
    expect(JSON.stringify(start.body)).not.toContain(
      paymentConfig.RAZORPAY_KEY_SECRET,
    );
    expect((await paymentPost(id)).status).toBe(200);
    expect(
      transport.mock.calls.filter(
        ([u, o]) => String(u).endsWith("/orders") && o?.method === "POST",
      ),
    ).toHaveLength(1);
    const verified = await paymentPost(id, "/verify", proof());
    expect(verified.status).toBe(200);
    expect(verified.body.data.status).toBe("Confirmed");
    expect((await paymentPost(id, "/verify", proof())).status).toBe(200);
    const raw = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: paymentId, order_id: orderId } } },
    });
    for (let i = 0; i < 2; i++)
      expect(
        (
          await request(paymentApp)
            .post("/api/v1/webhooks/razorpay")
            .set("Content-Type", "application/json")
            .set(
              "x-razorpay-signature",
              hmac(raw, paymentConfig.RAZORPAY_WEBHOOK_SECRET),
            )
            .send(raw)
        ).status,
      ).toBe(200);
    expect(await M.Ticket.countDocuments({ bookingId: id })).toBe(1);
    expect(
      await M.Payment.countDocuments({ bookingId: id, status: "captured" }),
    ).toBe(1);
    expect((await M.Trip.findById(tripId).lean())!.seats[0].state).toBe(
      "booked",
    );
    expect(
      (await get("/operator/trips/" + tripId + "/manifest")).body.data
        .passengers,
    ).toHaveLength(1);
  });
  it("rejects unauthenticated, cross-tenant and read-only payment access and forged signatures", async () => {
    const booking = await pending(),
      transport = provider(booking),
      id = String(booking._id);
    expect(
      (
        await request(paymentApp).post(
          "/api/v1/operator/bookings/" + id + "/payment",
        )
      ).status,
    ).toBe(401);
    expect((await paymentPost(id, "", {}, tokenB)).status).toBe(404);
    expect((await paymentPost(id, "", {}, readerToken)).status).toBe(403);
    expect(transport).not.toHaveBeenCalled();
    await paymentPost(id);
    expect(
      (
        await paymentPost(id, "/verify", {
          ...proof(),
          razorpay_signature: "0".repeat(64),
        })
      ).status,
    ).toBe(400);
    expect(
      (await paymentPost(id, "/verify", { ...proof(), amount: 1 })).status,
    ).toBe(400);
    expect(await M.Ticket.countDocuments()).toBe(0);
  });
  it("rejects wrong payment amounts, other orders and previously refunded payments", async () => {
    const booking = await pending(),
      options = { amount: 1, foreignOrder: false, refunded: 0 },
      id = String(booking._id);
    provider(booking, options);
    await paymentPost(id);
    expect((await paymentPost(id, "/verify", proof())).status).toBe(409);
    options.amount = booking.totalPaise;
    options.foreignOrder = true;
    expect((await paymentPost(id, "/verify", proof())).status).toBe(409);
    options.foreignOrder = false;
    options.refunded = 100;
    expect((await paymentPost(id, "/verify", proof())).status).toBe(409);
    expect(await M.Ticket.countDocuments()).toBe(0);
    expect((await M.Booking.findById(id).lean())!.status).toBe(
      "Pending payment",
    );
  });
  it("captures an authorized payment once and confirms only after fetching captured status", async () => {
    const booking = await pending(),
      options = { status: "authorized" },
      transport = provider(booking, options),
      id = String(booking._id);
    await paymentPost(id);
    expect((await paymentPost(id, "/verify", proof())).body.data.status).toBe(
      "Confirmed",
    );
    await paymentPost(id, "/verify", proof());
    expect(
      transport.mock.calls.filter(([u]) => String(u).endsWith("/capture")),
    ).toHaveLength(1);
  });
  it("keeps failed attempts pending and can reconcile a later capture without a browser callback", async () => {
    const booking = await pending(),
      options = { status: "failed" },
      id = String(booking._id);
    provider(booking, options);
    await paymentPost(id);
    expect((await paymentPost(id, "/verify", proof())).body.data.status).toBe(
      "Pending payment",
    );
    expect((await M.Booking.findById(id).lean())!.status).toBe(
      "Pending payment",
    );
    options.status = "captured";
    expect((await paymentPost(id, "/reconcile")).body.data.status).toBe(
      "Confirmed",
    );
  });
  it("rejects expired payment starts and reconciles late capture without stealing a newly held seat", async () => {
    const booking = await pending(),
      id = String(booking._id),
      transport = provider(booking);
    await paymentPost(id);
    await M.Trip.updateOne(
      { _id: tripId },
      { $set: { "seats.0.holdUntil": new Date(Date.now() - 1000) } },
    );
    await M.Hold.updateOne(
      { holdId: booking.holdId },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    await reconcileExpiredHolds();
    expect((await paymentPost(id)).status).toBe(409);
    const replacement: any = await createHold(a, tripId, ["L1"]);
    const result = await paymentPost(id, "/verify", proof());
    expect(result.status).toBe(200);
    expect(result.body.data.status).toBe("Reconciliation required");
    expect((await M.Trip.findById(tripId).lean())!.seats[0].holdId).toBe(
      replacement.holdId,
    );
    expect(await M.Ticket.countDocuments()).toBe(0);
    expect(
      transport.mock.calls.filter(
        ([u, o]) => String(u).endsWith("/orders") && o?.method === "POST",
      ),
    ).toHaveLength(1);
  });
  it("requires raw webhook HMAC and never trusts an unsigned status field", async () => {
    const booking = await pending(),
      id = String(booking._id);
    provider(booking);
    await paymentPost(id);
    const raw = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: paymentId, order_id: orderId } } },
    });
    expect(
      (
        await request(paymentApp)
          .post("/api/v1/webhooks/razorpay")
          .set("Content-Type", "application/json")
          .send(raw)
      ).status,
    ).toBe(400);
    expect(
      (
        await request(paymentApp)
          .post("/api/v1/webhooks/razorpay")
          .set("Content-Type", "application/json")
          .set(
            "x-razorpay-signature",
            hmac(raw, paymentConfig.RAZORPAY_WEBHOOK_SECRET),
          )
          .send(raw + " ")
      ).status,
    ).toBe(400);
    expect(await M.Ticket.countDocuments()).toBe(0);
  });
  it("recovers an uncertain order by receipt without issuing a second create request", async () => {
    const booking = await pending(),
      id = String(booking._id);
    let calls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      calls++;
      throw Error("connection interrupted after write");
    });
    expect((await paymentPost(id)).status).toBe(503);
    expect(calls).toBe(1);
    vi.restoreAllMocks();
    const transport = provider(booking);
    expect((await paymentPost(id)).status).toBe(200);
    expect(
      transport.mock.calls.every(([, options]) => options?.method === "GET"),
    ).toBe(true);
  });
});

describe("Trip Master", () => {
  async function serviceFixture() {
    await M.Layout.create({
      operatorId: a.operatorId,
      busId,
      name: "2+1",
      seats: [0, 1, 3].map((column, i) => ({
        number: `L${i + 1}`,
        deck: "lower",
        row: 0,
        column,
        category: "sleeper",
        farePaise: 0,
      })),
    });
    const response = await post("/operator/trip-master/services", {
      name: "Daily sleeper",
      code: "HYD-BLR",
      busId,
      routeId,
      departure: "21:30",
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      doublePaise: 220000,
      singlePaise: 250000,
      status: "Active",
    });
    expect(response.status).toBe(201);
    return response.body.data;
  }
  it("previews and schedules service trips with distinct side fares, safely skips retries, and isolates tenants", async () => {
    const service = await serviceFixture();
    const input = {
      serviceIds: [service._id],
      from: "2030-12-01",
      to: "2030-12-02",
    };
    const preview = await post(
      "/operator/trip-master/scheduling/preview",
      input,
    );
    expect(preview.body.data.map((r: any) => r.state)).toEqual([
      "Ready",
      "Ready",
    ]);
    const created = await post(
      "/operator/trip-master/scheduling/create",
      input,
    );
    expect(created.status).toBe(201);
    expect(created.body.data.created).toBe(2);
    const trip = await M.Trip.findById(created.body.data.tripIds[0]).lean();
    expect((trip!.seats as any[]).map((s) => s.farePaise)).toEqual([
      220000, 220000, 250000,
    ]);
    const again = await post("/operator/trip-master/scheduling/create", input);
    expect(again.body.data.created).toBe(0);
    expect(again.body.data.existing).toBe(2);
    expect(
      (await get(`/operator/trip-master/services/${service._id}`, tokenB))
        .status,
    ).toBe(404);
    expect(
      (
        await post(
          "/operator/trip-master/scheduling/create",
          input,
          readerToken,
        )
      ).status,
    ).toBe(403);
    const availability = await get(
      `/operator/trip-master/availability?journeyDate=2030-12-01&serviceIds=${service._id}`,
    );
    expect(availability.body.data[0].available).toBe(3);
  });
  it("rolls back an entire batch if one date conflicts", async () => {
    const service = await serviceFixture();
    const result = await post("/operator/trip-master/scheduling/create", {
      serviceIds: [service._id],
      from: "2030-11-12",
      to: "2030-11-14",
    });
    expect(result.status).toBe(409);
    expect(await M.Trip.countDocuments({ serviceId: service._id })).toBe(0);
  });
  it("records ordered operations idempotently and calculates actual delay and mileage without exposing expenses to readers", async () => {
    await M.Trip.updateOne(
      { _id: tripId },
      {
        $set: {
          departureAt: new Date(Date.now() - 3600000),
          arrivalAt: new Date(Date.now() - 1800000),
          journeyDate: "2026-11-15",
        },
      },
    );
    const base = "/operator/trip-master/trips/" + tripId;
    const body = {
      stage: "Boarding",
      at: new Date(Date.now() - 3500000).toISOString(),
      expectedVersion: 0,
    };
    const first = await request(app)
      .post(`/api/v1${base}/operations`)
      .set("Authorization", `Bearer ${tokenA}`)
      .set("Idempotency-Key", "boarding-fixture-0001")
      .send(body);
    expect(first.status).toBe(200);
    const repeated = await request(app)
      .post(`/api/v1${base}/operations`)
      .set("Authorization", `Bearer ${tokenA}`)
      .set("Idempotency-Key", "boarding-fixture-0001")
      .send(body);
    expect(repeated.status).toBe(200);
    expect(await M.TripOperation.countDocuments()).toBe(1);
    const wrong = await request(app)
      .post(`/api/v1${base}/operations`)
      .set("Authorization", `Bearer ${tokenA}`)
      .set("Idempotency-Key", randomUUID())
      .send({ ...body, stage: "Completed", expectedVersion: 1 });
    expect(wrong.status).toBe(409);
    for (const [stage, version, odometerKm, minutes] of [
      ["Departed", 1, 1000, 50],
      ["Arrived", 2, 1100, 20],
      ["Completed", 3, undefined, 10],
    ] as const) {
      const result = await request(app)
        .post(`/api/v1${base}/operations`)
        .set("Authorization", `Bearer ${tokenA}`)
        .set("Idempotency-Key", randomUUID())
        .send({
          stage,
          expectedVersion: version,
          at: new Date(Date.now() - minutes * 60000).toISOString(),
          ...(odometerKm !== undefined ? { odometerKm } : {}),
          ...(stage === "Arrived" ? { fuelConsumedMillilitres: 20000 } : {}),
        });
      expect(result.status, result.body.error?.message).toBe(200);
    }
    const report = await get(
      "/operator/trip-master/reports?from=2026-11-15&to=2026-11-15",
    );
    expect(report.body.data.rows[0].distanceKm).toBe(100);
    expect(report.body.data.rows[0].mileageKmPerLitre).toBe(5);
    expect(report.body.data.rows[0].departureDelayMinutes).toBe(10);
    const reader = await get(
      "/operator/trip-master/reports?from=2026-11-15&to=2026-11-15",
      readerToken,
    );
    expect(reader.body.data.summary.fuelExpensePaise).toBeUndefined();
    expect(reader.body.data.rows[0].fuelExpensePaise).toBeUndefined();
  });
  it("records fuel once across concurrent retries, voids it with an audit trail, and validates stop references", async () => {
    const key = randomUUID(),
      payload = {
        tripId,
        litresMillilitres: 50000,
        amountPaise: 500000,
        at: new Date().toISOString(),
      };
    const send = () =>
      request(app)
        .post("/api/v1/operator/trip-master/fuel")
        .set("Authorization", `Bearer ${tokenA}`)
        .set("Idempotency-Key", key)
        .send(payload);
    const results = await Promise.all([send(), send()]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(await M.TripFuel.countDocuments()).toBe(1);
    expect(
      (
        await post(
          `/operator/trip-master/fuel/${results[0].body.data._id}/void`,
          { reason: "Duplicate receipt" },
        )
      ).status,
    ).toBe(200);
    expect((await get("/operator/trip-master/fuel", readerToken)).status).toBe(
      403,
    );
    const stop = await request(app)
      .post("/api/v1/operator/trip-master/stops")
      .set("Authorization", `Bearer ${tokenA}`)
      .set("Idempotency-Key", randomUUID())
      .send({
        tripId,
        kind: "Other",
        name: "Rest stop",
        arrivedAt: new Date(Date.now() - 600000).toISOString(),
        departedAt: new Date(Date.now() - 300000).toISOString(),
      });
    expect(stop.status).toBe(201);
    const foreign = await request(app)
      .post("/api/v1/operator/trip-master/stops")
      .set("Authorization", `Bearer ${tokenB}`)
      .set("Idempotency-Key", randomUUID())
      .send({
        tripId,
        kind: "Other",
        name: "Rest stop",
        arrivedAt: new Date().toISOString(),
        departedAt: new Date().toISOString(),
      });
    expect(foreign.status).toBe(404);
  });
  it("prevents a tablet from being assigned to two trips and allows assignment after release", async () => {
    const tablet = await post("/operator/trip-master/tablets", {
      name: "Dispatch tablet",
      serialNumber: "TAB-01",
      status: "Active",
    });
    expect(tablet.status).toBe(201);
    const t2 = await M.Trip.create({
      operatorId: a.operatorId,
      busId,
      routeId,
      journeyDate: "2030-12-01",
      departureAt: new Date("2030-12-01T21:30:00+05:30"),
      seats: [],
    });
    const results = await Promise.all([
      post("/operator/trip-master/tablet-assignments", {
        tabletId: tablet.body.data._id,
        tripId,
      }),
      post("/operator/trip-master/tablet-assignments", {
        tabletId: tablet.body.data._id,
        tripId: String(t2._id),
      }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const assignment = results.find((r) => r.status === 201)!.body.data;
    expect(
      (
        await post(
          `/operator/trip-master/tablet-assignments/${assignment._id}/release`,
          {},
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await post("/operator/trip-master/tablet-assignments", {
          tabletId: tablet.body.data._id,
          tripId,
        })
      ).status,
    ).toBe(201);
  });
  it("snapshots server-calculated agent commission in bookings without changing passenger totals", async () => {
    const partner = await post("/operator/trip-master/partners", {
      name: "Travel agent",
      kind: "Agent",
      phone: "9876543210",
      status: "Active",
    });
    expect(partner.status).toBe(201);
    const rule = await post("/operator/trip-master/commissions", {
      partnerId: partner.body.data._id,
      tripId,
      basis: "Base fare",
      kind: "Percent",
      basisPoints: 1000,
      status: "Active",
    });
    expect(rule.status).toBe(201);
    const held = await createHold(a, tripId, ["L1"]);
    const booking: any = await createBooking(
      a,
      {
        tripId,
        holdId: held.holdId,
        passengers: [{ name: "Test passenger", seat: "L1" }],
        salesPartnerId: partner.body.data._id,
      },
      randomUUID(),
    );
    expect(booking.totalPaise).toBe(145000);
    expect(booking.commissionPaise).toBe(14500);
    expect(booking.commissionSnapshot.basis).toBe("Base fare");
    expect(
      (
        await post(
          "/operator/trip-master/commissions",
          {
            partnerId: partner.body.data._id,
            tripId,
            basis: "Base fare",
            kind: "Percent",
            basisPoints: 1000,
            status: "Active",
          },
          tokenB,
        )
      ).status,
    ).toBe(404);
  });
});

describe("Trip Master rule precedence and connections", () => {
  it("uses discounted base fare before tax and overrides service commission with the trip rule", async () => {
    const { partnerCommission } =
      await import("../../src/services/commission.service.js");
    const service = await M.BusService.create({
      operatorId: a.operatorId,
      name: "Service",
      code: "SVC",
      busId,
      routeId,
      departure: "21:30",
      daysOfWeek: [1],
      doublePaise: 100000,
      singlePaise: 120000,
      status: "Active",
    });
    await M.Trip.updateOne(
      { _id: tripId },
      { $set: { serviceId: service._id } },
    );
    const partner = await M.SalesPartner.create({
      operatorId: a.operatorId,
      name: "Branch",
      kind: "Branch",
      phone: "9876543210",
      status: "Active",
    });
    await M.CommissionRule.create({
      operatorId: a.operatorId,
      partnerId: partner._id,
      serviceId: service._id,
      basis: "Grand total",
      kind: "Fixed",
      fixedPaise: 5000,
      status: "Active",
    });
    const trip = await M.Trip.findById(tripId).lean();
    expect(
      (
        await partnerCommission(
          a,
          trip,
          { grossPaise: 145000, discountPaise: 20000, totalPaise: 131250 },
          String(partner._id),
        )
      ).commissionPaise,
    ).toBe(5000);
    await M.CommissionRule.create({
      operatorId: a.operatorId,
      partnerId: partner._id,
      tripId,
      basis: "Base fare",
      kind: "Percent",
      basisPoints: 1000,
      status: "Active",
    });
    expect(
      (
        await partnerCommission(
          a,
          trip,
          { grossPaise: 145000, discountPaise: 20000, totalPaise: 131250 },
          String(partner._id),
        )
      ).commissionPaise,
    ).toBe(12500);
  });
  it("validates connection cities and transfer times and rejects unowned linked trips", async () => {
    await M.Trip.updateOne(
      { _id: tripId },
      { $set: { arrivalAt: new Date("2030-11-14T06:30:00+05:30") } },
    );
    const route = await M.Route.create({
      operatorId: a.operatorId,
      source: "Bangalore",
      destination: "Chennai",
      departure: "07:30",
      arrival: "14:30",
      durationMinutes: 420,
    });
    const next = await M.Trip.create({
      operatorId: a.operatorId,
      routeId: route._id,
      busId,
      journeyDate: "2030-11-14",
      departureAt: new Date("2030-11-14T07:30:00+05:30"),
      arrivalAt: new Date("2030-11-14T14:30:00+05:30"),
      seats: [],
    });
    const payload = {
      fromTripId: tripId,
      toTripId: String(next._id),
      kind: "Connection",
      transferMinutes: 120,
      status: "Active",
    };
    expect((await post("/operator/trip-master/links", payload)).status).toBe(
      409,
    );
    expect(
      (
        await post("/operator/trip-master/links", {
          ...payload,
          transferMinutes: 45,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await post(
          "/operator/trip-master/links",
          { ...payload, transferMinutes: 45 },
          tokenB,
        )
      ).status,
    ).toBe(404);
  });
});
