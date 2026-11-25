import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createCarCrsApp } from "../src/app.js";
import { signCarToken } from "../src/middleware/auth.middleware.js";
import { Car } from "../src/models/car.model.js";
import { CarSeatLayout } from "../src/models/car-seat-layout.model.js";
import { CarTrip } from "../src/models/car-trip.model.js";
import { CarRoute } from "../src/models/car-route.model.js";
import { getStandard4PassengerLayout, getStandard7PassengerLayout } from "../src/services/car-layout.service.js";

describe("Car Seat Layout Designer & Versioning REST API (/api/v1/operator)", () => {
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
    await CarSeatLayout.deleteMany({});
    await CarTrip.deleteMany({});
    await CarRoute.deleteMany({});
  });

  describe("Layout Templates API (GET /car-layout-templates)", () => {
    it("returns standard 4-seater and 7-seater templates with non-bookable driver seat", async () => {
      const res = await request(app)
        .get("/api/v1/operator/car-layout-templates")
        .set("Authorization", `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      const templates = res.body.data;
      expect(templates).toHaveLength(2);

      const sedan = templates.find((t: any) => t.templateId === "tpl-4-passenger-sedan");
      expect(sedan).toBeDefined();
      expect(sedan.totalPhysicalSeats).toBe(5);
      expect(sedan.bookablePassengerCapacity).toBe(4);

      // Verify driver seat is non-bookable
      const sedanDriver = sedan.seats.find((s: any) => s.isDriver);
      expect(sedanDriver).toBeDefined();
      expect(sedanDriver.isBookable).toBe(false);
      expect(sedanDriver.seatId).toBe("D");

      const muv = templates.find((t: any) => t.templateId === "tpl-7-passenger-muv");
      expect(muv).toBeDefined();
      expect(muv.totalPhysicalSeats).toBe(8);
      expect(muv.bookablePassengerCapacity).toBe(7);

      const muvDriver = muv.seats.find((s: any) => s.isDriver);
      expect(muvDriver).toBeDefined();
      expect(muvDriver.isBookable).toBe(false);
    });
  });

  describe("Layout Dry-Run Validation (POST /car-layouts/validate)", () => {
    it("validates physically correct 4-passenger layout", async () => {
      const seats = getStandard4PassengerLayout("RHD", 50000);
      const res = await request(app)
        .post("/api/v1/operator/car-layouts/validate")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          seats,
          expectedPassengerCapacity: 4,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.valid).toBe(true);
      expect(res.body.data.bookableSeatsCount).toBe(4);
      expect(res.body.data.totalPhysicalSeats).toBe(5);
    });

    it("rejects layout where driver seat is configured as bookable", async () => {
      const seats = getStandard4PassengerLayout("RHD", 50000).map((s) => {
        if (s.isDriver) return { ...s, isBookable: true };
        return s;
      });

      const res = await request(app)
        .post("/api/v1/operator/car-layouts/validate")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          seats,
          expectedPassengerCapacity: 4,
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_LAYOUT");
      expect(res.body.error.message).toMatch(/Driver seat must NEVER be marked as bookable/i);
    });

    it("rejects layout when bookable seats count mismatches expected passenger capacity", async () => {
      const seats = getStandard4PassengerLayout("RHD", 50000);
      const res = await request(app)
        .post("/api/v1/operator/car-layouts/validate")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          seats,
          expectedPassengerCapacity: 7, // Mismatch (provided 4, expected 7)
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_LAYOUT");
      expect(res.body.error.message).toMatch(/Capacity mismatch/i);
    });
  });

  describe("Layout Assignment & Versioning (PUT /cars/:id/layout)", () => {
    it("assigns initial layout to a newly registered car", async () => {
      const car = await Car.create({
        operatorId: operatorA,
        registration: "MH12KL1010",
        make: "Maruti",
        modelName: "Dzire",
        category: "4-Passenger Sedan",
        advertisedCapacity: 5,
        totalPhysicalSeats: 5,
        driverSeatsCount: 1,
        bookablePassengerCapacity: 4,
      });

      const seats = getStandard4PassengerLayout("RHD", 60000);
      const res = await request(app)
        .put(`/api/v1/operator/cars/${car._id}/layout`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          name: "Standard Dzire Layout",
          driveOrientation: "RHD",
          seats,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.version).toBe(1);
      expect(res.body.data.seats).toHaveLength(5);

      const updatedCar = await Car.findById(car._id);
      expect(updatedCar?.activeLayoutId?.toHexString()).toBe(res.body.data._id);
    });

    it("updates layout in-place when car has no active scheduled trips", async () => {
      const car = await Car.create({
        operatorId: operatorA,
        registration: "MH12MN2020",
        make: "Maruti",
        modelName: "Dzire",
        category: "4-Passenger Sedan",
        advertisedCapacity: 5,
        totalPhysicalSeats: 5,
        driverSeatsCount: 1,
        bookablePassengerCapacity: 4,
      });

      // Initial layout assignment
      await request(app)
        .put(`/api/v1/operator/cars/${car._id}/layout`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          name: "Dzire Initial Layout",
          seats: getStandard4PassengerLayout("RHD", 50000),
        });

      // Modify seat fares
      const updatedSeats = getStandard4PassengerLayout("RHD", 55000);
      const res = await request(app)
        .put(`/api/v1/operator/cars/${car._id}/layout`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          name: "Dzire Updated Layout",
          seats: updatedSeats,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.version).toBe(1); // Same version because no trips reference it
      expect(res.body.data.name).toBe("Dzire Updated Layout");

      // Verify only 1 layout record exists in database
      const allLayouts = await CarSeatLayout.find({ carId: car._id });
      expect(allLayouts).toHaveLength(1);
    });

    it("creates version 2 layout when car is referenced by an active scheduled trip, preserving trip snapshot", async () => {
      const car = await Car.create({
        operatorId: operatorA,
        registration: "MH12OP3030",
        make: "Toyota",
        modelName: "Innova Crysta",
        category: "7-Passenger MUV",
        advertisedCapacity: 8,
        totalPhysicalSeats: 8,
        driverSeatsCount: 1,
        bookablePassengerCapacity: 7,
      });

      const initialSeats = getStandard7PassengerLayout("RHD", 75000);

      // Initial assignment -> Version 1
      const assignRes = await request(app)
        .put(`/api/v1/operator/cars/${car._id}/layout`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          name: "Innova Layout v1",
          seats: initialSeats,
        });

      expect(assignRes.status).toBe(200);
      const version1Id = assignRes.body.data._id;
      expect(assignRes.body.data.version).toBe(1);

      // Create a Route and Scheduled Trip referencing car and its version 1 layout
      const route = await CarRoute.create({
        operatorId: operatorA,
        source: "Pune",
        destination: "Mumbai",
        distanceKm: 150,
        estimatedDurationMinutes: 180,
        boarding: [{ name: "Pune", address: "Pune" }],
        dropping: [{ name: "Mumbai", address: "Mumbai" }],
      });

      const trip = await CarTrip.create({
        operatorId: operatorA,
        carId: car._id,
        routeId: route._id,
        journeyDate: "2026-11-26",
        departureAt: new Date(Date.now() + 24 * 3600 * 1000),
        estimatedArrivalAt: new Date(Date.now() + 28 * 3600 * 1000),
        turnaroundBufferMinutes: 30,
        status: "Scheduled",
        seats: initialSeats.map((s) => ({
          seatId: s.seatId,
          label: s.label,
          row: s.row,
          column: s.column,
          isDriver: s.isDriver,
          isBookable: s.isBookable,
          category: s.category,
          baseFarePaise: s.baseFarePaise,
          farePaise: s.baseFarePaise || 0,
          state: "available",
        })),
      });

      // Now operator updates the car's layout fares for future trips
      const modifiedSeats = getStandard7PassengerLayout("RHD", 90000);
      const updateRes = await request(app)
        .put(`/api/v1/operator/cars/${car._id}/layout`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          name: "Innova Layout v2 - Higher Base Fare",
          seats: modifiedSeats,
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.data.version).toBe(2);
      expect(updateRes.body.data._id).not.toBe(version1Id);

      // Verify both layouts exist in database
      const allLayouts = await CarSeatLayout.find({ carId: car._id }).sort({ version: 1 });
      expect(allLayouts).toHaveLength(2);
      expect(allLayouts[0].version).toBe(1);
      expect(allLayouts[1].version).toBe(2);

      // Verify car now points to version 2
      const updatedCar = await Car.findById(car._id);
      expect(updatedCar?.activeLayoutId?.toHexString()).toBe(updateRes.body.data._id);

      // Verify existing trip's inventory snapshot is unchanged
      const savedTrip = await CarTrip.findById(trip._id);
      expect(savedTrip?.seats[0].baseFarePaise).toBe(initialSeats.find((s) => s.seatId === savedTrip?.seats[0].seatId)?.baseFarePaise);
    });
  });

  describe("Get Active Car Layout (GET /cars/:id/layout)", () => {
    it("returns active layout for vehicle owner", async () => {
      const car = await Car.create({
        operatorId: operatorA,
        registration: "MH12QR4040",
        make: "Maruti",
        modelName: "Dzire",
        category: "4-Passenger Sedan",
        advertisedCapacity: 5,
        totalPhysicalSeats: 5,
        driverSeatsCount: 1,
        bookablePassengerCapacity: 4,
      });

      await request(app)
        .put(`/api/v1/operator/cars/${car._id}/layout`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          name: "Dzire Layout",
          seats: getStandard4PassengerLayout("RHD", 50000),
        });

      const res = await request(app)
        .get(`/api/v1/operator/cars/${car._id}/layout`)
        .set("Authorization", `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.vehicleCategory).toBe("4-Passenger Sedan");
      expect(res.body.data.bookablePassengerCapacity).toBe(4);
    });

    it("denies access to car layout for foreign operator", async () => {
      const car = await Car.create({
        operatorId: operatorA,
        registration: "MH12ST5050",
        make: "Maruti",
        modelName: "Dzire",
        category: "4-Passenger Sedan",
        advertisedCapacity: 5,
        totalPhysicalSeats: 5,
        driverSeatsCount: 1,
        bookablePassengerCapacity: 4,
      });

      const res = await request(app)
        .get(`/api/v1/operator/cars/${car._id}/layout`)
        .set("Authorization", `Bearer ${tokenB}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("CAR_NOT_FOUND");
    });
  });
});
