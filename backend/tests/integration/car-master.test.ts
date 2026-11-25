import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { readConfig } from "../../src/config/env.js";
import * as M from "../../src/models/index.js";
import { hashPassword } from "../../src/modules/auth/index.js";

let mongo: MongoMemoryReplSet;
const config = readConfig({
  NODE_ENV: "test",
  MONGODB_URI: "mongodb://127.0.0.1/car_master_test",
  JWT_SECRET: "c".repeat(64),
  WEB_ORIGIN: "http://127.0.0.1:5173",
});
const limiter = { check: async () => true };
const app = createApp(config, limiter, async () => true);

describe("Operator Car Master Fleet API Integration", () => {
  let operatorA: any;
  let operatorB: any;
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
      binary: { version: "7.0.14" },
    });
    await mongoose.connect(mongo.getUri("car_master_test"));

    const passwordHash = await hashPassword("SecurePass123!");

    operatorA = await M.Operator.create({
      company: "Travels Operator A",
      email: "contact-a@example.test",
      status: "approved",
    });

    const userA = await M.User.create({
      operatorId: operatorA._id,
      name: "Admin A",
      email: "admin-a@example.test",
      passwordHash,
      role: "operator_admin",
      active: true,
    });

    operatorB = await M.Operator.create({
      company: "Travels Operator B",
      email: "contact-b@example.test",
      status: "approved",
    });

    const userB = await M.User.create({
      operatorId: operatorB._id,
      name: "Admin B",
      email: "admin-b@example.test",
      passwordHash,
      role: "operator_admin",
      active: true,
    });

    const loginA = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "admin-a@example.test", password: "SecurePass123!" });
    tokenA = loginA.body.data.accessToken;

    const loginB = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "admin-b@example.test", password: "SecurePass123!" });
    tokenB = loginB.body.data.accessToken;
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  it("registers a new car via POST /api/v1/operator/cars (as used by CarMaster UI)", async () => {
    const payload = {
      registrationNumber: "CG-04-MG-2001",
      make: "Maruti",
      model: "Dzire",
      year: 2021,
      vehicleCategory: "4-Passenger Sedan",
      color: "White",
      status: "Active",
      totalPhysicalSeats: 5,
      bookablePassengerCapacity: 4,
    };

    const res = await request(app)
      .post("/api/v1/operator/cars")
      .set("Authorization", `Bearer ${tokenA}`)
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.registrationNumber).toBe("CG-04-MG-2001");
    expect(res.body.data.registration).toBe("CG04MG2001");
    expect(res.body.data.make).toBe("Maruti");
    expect(res.body.data.model).toBe("Dzire");
    expect(res.body.data.vehicleCategory).toBe("4-Passenger Sedan");
    expect(res.body.data.totalPhysicalSeats).toBe(5);
    expect(res.body.data.bookablePassengerCapacity).toBe(4);
    expect(res.body.data.operatorId).toBe(operatorA._id.toString());
  });

  it("lists operator cars via GET /api/v1/operator/cars?limit=100", async () => {
    const res = await request(app)
      .get("/api/v1/operator/cars?limit=100")
      .set("Authorization", `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0].registrationNumber).toBe("CG-04-MG-2001");
  });

  it("enforces tenant isolation: Operator B cannot see Operator A's cars", async () => {
    const res = await request(app)
      .get("/api/v1/operator/cars?limit=100")
      .set("Authorization", `Bearer ${tokenB}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(0);
  });

  it("rejects duplicate car registration under the same operator", async () => {
    const payload = {
      registrationNumber: "CG-04-MG-2001",
      make: "Maruti",
      model: "Dzire",
      year: 2021,
      vehicleCategory: "4-Passenger Sedan",
      totalPhysicalSeats: 5,
      bookablePassengerCapacity: 4,
    };

    const res = await request(app)
      .post("/api/v1/operator/cars")
      .set("Authorization", `Bearer ${tokenA}`)
      .send(payload);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DUPLICATE_REGISTRATION");
  });

  it("updates car details and car status via PATCH endpoints", async () => {
    const listRes = await request(app)
      .get("/api/v1/operator/cars?limit=10")
      .set("Authorization", `Bearer ${tokenA}`);
    const carId = listRes.body.data[0]._id;

    // Update color
    const patchRes = await request(app)
      .patch(`/api/v1/operator/cars/${carId}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ color: "Midnight Black" });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.data.color).toBe("Midnight Black");

    // Update status
    const statusRes = await request(app)
      .patch(`/api/v1/operator/cars/${carId}/status`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ status: "Maintenance" });
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.data.status).toBe("Maintenance");
  });
});
