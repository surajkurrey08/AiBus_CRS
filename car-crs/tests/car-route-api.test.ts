import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createCarCrsApp } from "../src/app.js";
import { signCarToken } from "../src/middleware/auth.middleware.js";
import { Car } from "../src/models/car.model.js";
import { CarTrip } from "../src/models/car-trip.model.js";
import { CarRoute } from "../src/models/car-route.model.js";

describe("Car Route Master REST API Integration Tests (/api/v1/operator/routes)", () => {
  let mongo: MongoMemoryReplSet;
  const JWT_SECRET = "test-secret-key-car-crs-12345";
  const app = createCarCrsApp(JWT_SECRET);

  const operatorA = new mongoose.Types.ObjectId();
  const operatorB = new mongoose.Types.ObjectId();

  const tokenA = signCarToken(
    {
      userId: "user-op-a",
      operatorId: operatorA.toHexString(),
      role: "operator_admin",
      permissions: ["*"],
    },
    JWT_SECRET
  );

  const tokenB = signCarToken(
    {
      userId: "user-op-b",
      operatorId: operatorB.toHexString(),
      role: "operator_admin",
      permissions: ["*"],
    },
    JWT_SECRET
  );

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
      binary: { version: "7.0.14" },
    });
    await mongoose.connect(mongo.getUri("aibus_car_crs"));
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    await Car.deleteMany({});
    await CarTrip.deleteMany({});
    await CarRoute.deleteMany({});
  });

  describe("Route Creation & Validation (POST /routes)", () => {
    it("successfully creates a valid intercity car route with boarding and dropping points", async () => {
      const res = await request(app)
        .post("/api/v1/operator/routes")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          source: "Pune",
          destination: "Mumbai",
          distanceKm: 152,
          estimatedDurationMinutes: 180,
          boarding: [
            { name: "Pune Railway Station", address: "Platform 1 Gate" },
            { name: "Wakad Bridge", address: "Highway Chowk" },
          ],
          dropping: [
            { name: "Vashi Plaza", address: "Sion Panvel Highway" },
            { name: "Dadar Asiad Bus Stand", address: "Dadar East" },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.data.source).toBe("Pune");
      expect(res.body.data.destination).toBe("Mumbai");
      expect(res.body.data.distanceKm).toBe(152);
      expect(res.body.data.status).toBe("Active");
      expect(res.body.data.boarding).toHaveLength(2);
      expect(res.body.data.dropping).toHaveLength(2);
    });

    it("rejects route when source and destination are identical", async () => {
      const res = await request(app)
        .post("/api/v1/operator/routes")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          source: "Pune",
          destination: "pune", // Case-insensitive identical
          distanceKm: 10,
          estimatedDurationMinutes: 30,
          boarding: [{ name: "Swargate", address: "Pune" }],
          dropping: [{ name: "Shivajinagar", address: "Pune" }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.details[0].message).toMatch(/Source city and destination city must be different/i);
    });

    it("rejects duplicate active route between same source and destination for same operator", async () => {
      await request(app)
        .post("/api/v1/operator/routes")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          source: "Mumbai",
          destination: "Nashik",
          distanceKm: 165,
          estimatedDurationMinutes: 210,
          boarding: [{ name: "Thane", address: "Teen Hath Naka" }],
          dropping: [{ name: "Nashik", address: "Dwarka Circle" }],
        });

      const res = await request(app)
        .post("/api/v1/operator/routes")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          source: "mumbai",
          destination: "NASHIK",
          distanceKm: 165,
          estimatedDurationMinutes: 210,
          boarding: [{ name: "Thane", address: "Teen Hath Naka" }],
          dropping: [{ name: "Nashik", address: "Dwarka Circle" }],
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("DUPLICATE_ROUTE");
    });

    it("allows different operators to operate routes between identical source and destination", async () => {
      await request(app)
        .post("/api/v1/operator/routes")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          source: "Pune",
          destination: "Kolhapur",
          distanceKm: 235,
          estimatedDurationMinutes: 270,
          boarding: [{ name: "Katraj", address: "Tunnel bypass" }],
          dropping: [{ name: "Kolhapur CBS", address: "CBS" }],
        });

      const res = await request(app)
        .post("/api/v1/operator/routes")
        .set("Authorization", `Bearer ${tokenB}`)
        .send({
          source: "Pune",
          destination: "Kolhapur",
          distanceKm: 235,
          estimatedDurationMinutes: 270,
          boarding: [{ name: "Swargate", address: "Stand" }],
          dropping: [{ name: "Kolhapur Bypass", address: "Highway" }],
        });

      expect(res.status).toBe(201);
      expect(res.body.data.source).toBe("Pune");
    });

    it("rejects route with missing boarding or dropping points", async () => {
      const res = await request(app)
        .post("/api/v1/operator/routes")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          source: "Pune",
          destination: "Nagpur",
          distanceKm: 700,
          estimatedDurationMinutes: 600,
          boarding: [], // INVALID
          dropping: [{ name: "Nagpur", address: "Nagpur" }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("Route Queries & Details (GET /routes, GET /routes/:id)", () => {
    it("isolates routes by operator", async () => {
      await CarRoute.create({
        operatorId: operatorA,
        source: "Pune",
        destination: "Goa",
        distanceKm: 450,
        estimatedDurationMinutes: 540,
        boarding: [{ name: "Pune", address: "Pune" }],
        dropping: [{ name: "Panaji", address: "Goa" }],
      });

      await CarRoute.create({
        operatorId: operatorB,
        source: "Bengaluru",
        destination: "Mysuru",
        distanceKm: 145,
        estimatedDurationMinutes: 180,
        boarding: [{ name: "Majestic", address: "Bengaluru" }],
        dropping: [{ name: "Suburban", address: "Mysuru" }],
      });

      const resA = await request(app)
        .get("/api/v1/operator/routes")
        .set("Authorization", `Bearer ${tokenA}`);

      expect(resA.status).toBe(200);
      expect(resA.body.data).toHaveLength(1);
      expect(resA.body.data[0].destination).toBe("Goa");

      const resB = await request(app)
        .get("/api/v1/operator/routes")
        .set("Authorization", `Bearer ${tokenB}`);

      expect(resB.status).toBe(200);
      expect(resB.body.data).toHaveLength(1);
      expect(resB.body.data[0].destination).toBe("Mysuru");
    });

    it("prevents operator B from accessing operator A's route by ID", async () => {
      const routeA = await CarRoute.create({
        operatorId: operatorA,
        source: "Pune",
        destination: "Mahabaleshwar",
        distanceKm: 120,
        estimatedDurationMinutes: 150,
        boarding: [{ name: "Swargate", address: "Pune" }],
        dropping: [{ name: "Market", address: "Mahabaleshwar" }],
      });

      const res = await request(app)
        .get(`/api/v1/operator/routes/${routeA._id}`)
        .set("Authorization", `Bearer ${tokenB}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("ROUTE_NOT_FOUND");
    });
  });

  describe("Route Status & Active Trip Protection (PATCH /routes/:id/status)", () => {
    it("updates route status to 'Inactive'", async () => {
      const routeA = await CarRoute.create({
        operatorId: operatorA,
        source: "Pune",
        destination: "Solapur",
        distanceKm: 250,
        estimatedDurationMinutes: 300,
        boarding: [{ name: "Hadapsar", address: "Pune" }],
        dropping: [{ name: "Solapur Stand", address: "Solapur" }],
      });

      const res = await request(app)
        .patch(`/api/v1/operator/routes/${routeA._id}/status`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ status: "Inactive" });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("Inactive");
    });

    it("prevents deactivating or archiving a route if upcoming scheduled trips exist", async () => {
      const carA = await Car.create({
        operatorId: operatorA,
        registration: "MH12ZZ9999",
        make: "Maruti",
        modelName: "Dzire",
        category: "4-Passenger Sedan",
        advertisedCapacity: 5,
        totalPhysicalSeats: 5,
        driverSeatsCount: 1,
        bookablePassengerCapacity: 4,
      });

      const routeA = await CarRoute.create({
        operatorId: operatorA,
        source: "Pune",
        destination: "Shirdi",
        distanceKm: 200,
        estimatedDurationMinutes: 240,
        boarding: [{ name: "Viman Nagar", address: "Pune" }],
        dropping: [{ name: "Temple Gate", address: "Shirdi" }],
      });

      await CarTrip.create({
        operatorId: operatorA,
        carId: carA._id,
        routeId: routeA._id,
        journeyDate: "2026-11-26",
        departureAt: new Date(Date.now() + 18 * 3600 * 1000),
        estimatedArrivalAt: new Date(Date.now() + 22 * 3600 * 1000),
        turnaroundBufferMinutes: 30,
        status: "Scheduled",
        seats: [
          {
            seatId: "D",
            label: "Driver",
            row: 1,
            column: 2,
            isDriver: true,
            isBookable: false,
            category: "driver",
            baseFarePaise: 0,
            farePaise: 0,
            state: "available",
          },
          {
            seatId: "FP",
            label: "Front Passenger",
            row: 1,
            column: 1,
            isDriver: false,
            isBookable: true,
            category: "front_passenger",
            baseFarePaise: 50000,
            farePaise: 50000,
            state: "available",
          },
          {
            seatId: "2L",
            label: "Rear Left",
            row: 2,
            column: 1,
            isDriver: false,
            isBookable: true,
            category: "window",
            baseFarePaise: 50000,
            farePaise: 50000,
            state: "available",
          },
          {
            seatId: "2M",
            label: "Rear Middle",
            row: 2,
            column: 2,
            isDriver: false,
            isBookable: true,
            category: "middle",
            baseFarePaise: 45000,
            farePaise: 45000,
            state: "available",
          },
          {
            seatId: "2R",
            label: "Rear Right",
            row: 2,
            column: 3,
            isDriver: false,
            isBookable: true,
            category: "window",
            baseFarePaise: 50000,
            farePaise: 50000,
            state: "available",
          },
        ],
      });

      const res = await request(app)
        .patch(`/api/v1/operator/routes/${routeA._id}/status`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ status: "Archived" });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("ROUTE_REFERENCED_BY_ACTIVE_TRIPS");
    });
  });
});
