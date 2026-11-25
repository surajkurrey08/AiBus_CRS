import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import jwt from "jsonwebtoken";
import { createCarCrsApp } from "../src/app.js";
import { signCarToken } from "../src/middleware/auth.middleware.js";
import { Car } from "../src/models/car.model.js";
import { CarTrip } from "../src/models/car-trip.model.js";
import { CarRoute } from "../src/models/car-route.model.js";

describe("Car Master REST API Integration Tests (/api/v1/operator/cars)", () => {
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

  const sampleSeats = [
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
  ];

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

  describe("Authentication & Tenant Isolation", () => {
    it("rejects request missing Authorization header", async () => {
      const res = await request(app).get("/api/v1/operator/cars");
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("MISSING_AUTH_TOKEN");
    });

    it("rejects token issued for Bus CRS (system !== 'car_crs')", async () => {
      const busToken = jwt.sign(
        {
          userId: "user-bus",
          operatorId: operatorA.toHexString(),
          role: "operator_admin",
          permissions: ["*"],
          system: "bus_crs", // Foreign context
        },
        JWT_SECRET
      );

      const res = await request(app)
        .get("/api/v1/operator/cars")
        .set("Authorization", `Bearer ${busToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("INVALID_SYSTEM_CONTEXT");
    });

    it("strictly isolates car listings between operators", async () => {
      await Car.create({
        operatorId: operatorA,
        registration: "MH12AA0001",
        make: "Maruti",
        modelName: "Dzire",
        category: "4-Passenger Sedan",
        advertisedCapacity: 5,
        totalPhysicalSeats: 5,
        driverSeatsCount: 1,
        bookablePassengerCapacity: 4,
      });

      await Car.create({
        operatorId: operatorB,
        registration: "MH14BB0002",
        make: "Toyota",
        modelName: "Innova",
        category: "7-Passenger MUV",
        advertisedCapacity: 8,
        totalPhysicalSeats: 8,
        driverSeatsCount: 1,
        bookablePassengerCapacity: 7,
      });

      const resA = await request(app)
        .get("/api/v1/operator/cars")
        .set("Authorization", `Bearer ${tokenA}`);

      expect(resA.status).toBe(200);
      expect(resA.body.data).toHaveLength(1);
      expect(resA.body.data[0].registration).toBe("MH12AA0001");

      const resB = await request(app)
        .get("/api/v1/operator/cars")
        .set("Authorization", `Bearer ${tokenB}`);

      expect(resB.status).toBe(200);
      expect(resB.body.data).toHaveLength(1);
      expect(resB.body.data[0].registration).toBe("MH14BB0002");
    });
  });

  describe("Car Registration & Capacity Validation (POST /cars)", () => {
    it("successfully creates a valid 4-passenger sedan with 5 physical seats (1 driver + 4 passenger)", async () => {
      const res = await request(app)
        .post("/api/v1/operator/cars")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          registration: "MH-12-PQ-4567",
          make: "Hyundai",
          modelName: "Aura",
          category: "4-Passenger Sedan",
          advertisedCapacity: 5,
          totalPhysicalSeats: 5,
          driverSeatsCount: 1,
          bookablePassengerCapacity: 4,
          driveOrientation: "RHD",
        });

      expect(res.status).toBe(201);
      expect(res.body.data.registration).toBe("MH12PQ4567");
      expect(res.body.data.bookablePassengerCapacity).toBe(4);
      expect(res.body.data.totalPhysicalSeats).toBe(5);
      expect(res.body.data.status).toBe("Active");
    });

    it("successfully creates a valid 7-passenger MUV with 8 physical seats (1 driver + 7 passenger)", async () => {
      const res = await request(app)
        .post("/api/v1/operator/cars")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          registration: "MH-14-XY-8899",
          make: "Toyota",
          modelName: "Innova Crysta",
          category: "7-Passenger MUV",
          advertisedCapacity: 8,
          totalPhysicalSeats: 8,
          driverSeatsCount: 1,
          bookablePassengerCapacity: 7,
          driveOrientation: "RHD",
        });

      expect(res.status).toBe(201);
      expect(res.body.data.registration).toBe("MH14XY8899");
      expect(res.body.data.bookablePassengerCapacity).toBe(7);
      expect(res.body.data.totalPhysicalSeats).toBe(8);
    });

    it("rejects car registration when passenger capacity equals total physical seats (driver seat ignored)", async () => {
      const res = await request(app)
        .post("/api/v1/operator/cars")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          registration: "MH-12-AB-9999",
          make: "Toyota",
          modelName: "Innova",
          category: "7-Passenger MUV",
          advertisedCapacity: 7,
          totalPhysicalSeats: 7,
          driverSeatsCount: 1,
          bookablePassengerCapacity: 7, // INVALID: 7 physical cannot seat 1 driver + 7 passenger (needs 8)
          driveOrientation: "RHD",
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.details[0].message).toMatch(/driverSeatsCount/i);
    });

    it("rejects duplicate registration across operators (case/space-insensitive)", async () => {
      await request(app)
        .post("/api/v1/operator/cars")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          registration: "DL 01 AB 1234",
          make: "Maruti",
          modelName: "Dzire",
          category: "4-Passenger Sedan",
          advertisedCapacity: 5,
          totalPhysicalSeats: 5,
          driverSeatsCount: 1,
          bookablePassengerCapacity: 4,
        });

      const res = await request(app)
        .post("/api/v1/operator/cars")
        .set("Authorization", `Bearer ${tokenB}`)
        .send({
          registration: "dl-01-ab-1234", // Same normalized registration
          make: "Maruti",
          modelName: "Dzire",
          category: "4-Passenger Sedan",
          advertisedCapacity: 5,
          totalPhysicalSeats: 5,
          driverSeatsCount: 1,
          bookablePassengerCapacity: 4,
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("DUPLICATE_REGISTRATION");
    });
  });

  describe("Car Details & Updates (GET /cars/:id, PATCH /cars/:id)", () => {
    it("prevents operator B from accessing operator A's car record", async () => {
      const carA = await Car.create({
        operatorId: operatorA,
        registration: "MH12CC3333",
        make: "Honda",
        modelName: "Amaze",
        category: "4-Passenger Sedan",
        advertisedCapacity: 5,
        totalPhysicalSeats: 5,
        driverSeatsCount: 1,
        bookablePassengerCapacity: 4,
      });

      const res = await request(app)
        .get(`/api/v1/operator/cars/${carA._id}`)
        .set("Authorization", `Bearer ${tokenB}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("CAR_NOT_FOUND");
    });

    it("updates non-capacity attributes successfully", async () => {
      const carA = await Car.create({
        operatorId: operatorA,
        registration: "MH12DD4444",
        make: "Maruti",
        modelName: "Dzire",
        category: "4-Passenger Sedan",
        advertisedCapacity: 5,
        totalPhysicalSeats: 5,
        driverSeatsCount: 1,
        bookablePassengerCapacity: 4,
      });

      const res = await request(app)
        .patch(`/api/v1/operator/cars/${carA._id}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          assignedDriver: {
            name: "Rajesh Kumar",
            phone: "+919876543210",
            licenseNumber: "MH12-2015-0012345",
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.data.assignedDriver.name).toBe("Rajesh Kumar");
    });

    it("prevents modifying capacity if scheduled trips exist for the car", async () => {
      const carA = await Car.create({
        operatorId: operatorA,
        registration: "MH12EE5555",
        make: "Maruti",
        modelName: "Dzire",
        category: "4-Passenger Sedan",
        advertisedCapacity: 5,
        totalPhysicalSeats: 5,
        driverSeatsCount: 1,
        bookablePassengerCapacity: 4,
      });

      const route = await CarRoute.create({
        operatorId: operatorA,
        source: "Pune",
        destination: "Mumbai",
        distanceKm: 150,
        estimatedDurationMinutes: 180,
        boarding: [{ name: "Pune Station", address: "Station Road" }],
        dropping: [{ name: "Dadar", address: "TT Circle" }],
      });

      await CarTrip.create({
        operatorId: operatorA,
        carId: carA._id,
        routeId: route._id,
        journeyDate: "2026-11-26",
        departureAt: new Date(Date.now() + 24 * 3600 * 1000),
        estimatedArrivalAt: new Date(Date.now() + 27 * 3600 * 1000),
        turnaroundBufferMinutes: 30,
        status: "Scheduled",
        seats: sampleSeats,
      });

      const res = await request(app)
        .patch(`/api/v1/operator/cars/${carA._id}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          bookablePassengerCapacity: 7, // Attempt to modify capacity while trips exist
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("ACTIVE_TRIPS_EXIST");
    });
  });

  describe("Car Status Management (PATCH /cars/:id/status)", () => {
    it("updates car status to 'Under Maintenance'", async () => {
      const carA = await Car.create({
        operatorId: operatorA,
        registration: "MH12FF6666",
        make: "Maruti",
        modelName: "Dzire",
        category: "4-Passenger Sedan",
        advertisedCapacity: 5,
        totalPhysicalSeats: 5,
        driverSeatsCount: 1,
        bookablePassengerCapacity: 4,
      });

      const res = await request(app)
        .patch(`/api/v1/operator/cars/${carA._id}/status`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ status: "Under Maintenance" });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("Under Maintenance");
    });

    it("prevents archiving a car that has upcoming scheduled trips", async () => {
      const carA = await Car.create({
        operatorId: operatorA,
        registration: "MH12GG7777",
        make: "Maruti",
        modelName: "Dzire",
        category: "4-Passenger Sedan",
        advertisedCapacity: 5,
        totalPhysicalSeats: 5,
        driverSeatsCount: 1,
        bookablePassengerCapacity: 4,
      });

      const route = await CarRoute.create({
        operatorId: operatorA,
        source: "Pune",
        destination: "Nashik",
        distanceKm: 210,
        estimatedDurationMinutes: 240,
        boarding: [{ name: "Shivajinagar", address: "Stand" }],
        dropping: [{ name: "CBS Nashik", address: "CBS" }],
      });

      await CarTrip.create({
        operatorId: operatorA,
        carId: carA._id,
        routeId: route._id,
        journeyDate: "2026-11-26",
        departureAt: new Date(Date.now() + 12 * 3600 * 1000),
        estimatedArrivalAt: new Date(Date.now() + 16 * 3600 * 1000),
        turnaroundBufferMinutes: 30,
        status: "Scheduled",
        seats: sampleSeats,
      });

      const res = await request(app)
        .patch(`/api/v1/operator/cars/${carA._id}/status`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ status: "Archived" });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("CAR_REFERENCED_BY_ACTIVE_TRIPS");
    });
  });
});
