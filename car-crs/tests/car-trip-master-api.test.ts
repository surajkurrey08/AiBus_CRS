import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createCarCrsApp } from "../src/app.js";
import { signCarToken } from "../src/middleware/auth.middleware.js";
import { Car } from "../src/models/car.model.js";
import { CarRoute } from "../src/models/car-route.model.js";
import { CarTrip } from "../src/models/car-trip.model.js";
import { CarSeatLayout } from "../src/models/car-seat-layout.model.js";
import { getStandard4PassengerLayout, getStandard7PassengerLayout } from "../src/services/car-layout.service.js";

describe("Car Trip Master REST API Integration Tests (/api/v1/operator/trips)", () => {
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

  let carAId: string;
  let car7Id: string;
  let routeAId: string;
  let layoutAId: string;
  let layout7Id: string;

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
      binary: { version: "7.0.14" },
    });
    await mongoose.connect(mongo.getUri("aibus_car_crs"));

    // 4-Passenger Sedan
    const carA = await Car.create({
      operatorId: operatorA,
      registration: "MH12AA1000",
      make: "Maruti",
      modelName: "Dzire",
      category: "4-Passenger Sedan",
      advertisedCapacity: 5,
      totalPhysicalSeats: 5,
      driverSeatsCount: 1,
      bookablePassengerCapacity: 4,
    });
    carAId = carA._id.toString();

    const layoutA = await CarSeatLayout.create({
      operatorId: operatorA,
      carId: carA._id,
      name: "Standard Dzire Layout",
      vehicleCategory: "4-Passenger Sedan",
      totalPhysicalSeats: 5,
      bookablePassengerCapacity: 4,
      driveOrientation: "RHD",
      version: 1,
      seats: getStandard4PassengerLayout("RHD", 50000),
      status: "Active",
    });
    layoutAId = layoutA._id.toString();
    carA.activeLayoutId = layoutA._id as any;
    await carA.save();

    // 7-Passenger MUV
    const car7 = await Car.create({
      operatorId: operatorA,
      registration: "MH14BB2000",
      make: "Toyota",
      modelName: "Innova",
      category: "7-Passenger MUV",
      advertisedCapacity: 8,
      totalPhysicalSeats: 8,
      driverSeatsCount: 1,
      bookablePassengerCapacity: 7,
    });
    car7Id = car7._id.toString();

    const layout7 = await CarSeatLayout.create({
      operatorId: operatorA,
      carId: car7._id,
      name: "Standard Innova Layout",
      vehicleCategory: "7-Passenger MUV",
      totalPhysicalSeats: 8,
      bookablePassengerCapacity: 7,
      driveOrientation: "RHD",
      version: 1,
      seats: getStandard7PassengerLayout("RHD", 75000),
      status: "Active",
    });
    layout7Id = layout7._id.toString();
    car7.activeLayoutId = layout7._id as any;
    await car7.save();

    // Route
    const route = await CarRoute.create({
      operatorId: operatorA,
      source: "Pune",
      destination: "Mumbai",
      distanceKm: 150,
      estimatedDurationMinutes: 180,
      boarding: [{ name: "Swargate", address: "Pune" }],
      dropping: [{ name: "Dadar", address: "Mumbai" }],
    });
    routeAId = route._id.toString();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    await CarTrip.deleteMany({});
  });

  describe("Trip Creation & Physical Inventory Snapshot (POST /trips)", () => {
    it("creates a scheduled 4-passenger car trip with physical seat snapshot and seat-wise fares", async () => {
      const departure = new Date("2026-11-28T06:00:00.000Z");
      const arrival = new Date("2026-11-28T09:00:00.000Z");

      const res = await request(app)
        .post("/api/v1/operator/trips")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          carId: carAId,
          routeId: routeAId,
          journeyDate: "2026-11-28",
          departureAt: departure,
          estimatedArrivalAt: arrival,
          turnaroundBufferMinutes: 30,
          tripType: "ONE_WAY",
          status: "Scheduled",
          baseFarePaise: 50000,
        });

      expect(res.status).toBe(201);
      const trip = res.body.data;
      expect(trip.tripNumber).toMatch(/^TRIP-20261128-/);
      expect(trip.status).toBe("Scheduled");
      expect(trip.bookingOpen).toBe(true);
      expect(trip.vehicleCategory).toBe("4-Passenger Sedan");
      expect(trip.totalPhysicalSeats).toBe(5);
      expect(trip.bookableCapacity).toBe(4);
      expect(trip.seats).toHaveLength(5);

      // Verify Driver Seat is strictly non-bookable and fare is 0
      const driver = trip.seats.find((s: any) => s.seatId === "D");
      expect(driver).toBeDefined();
      expect(driver.isDriver).toBe(true);
      expect(driver.isBookable).toBe(false);
      expect(driver.farePaise).toBe(0);

      // Verify Passenger Seats and seat-wise pricing
      const frontPax = trip.seats.find((s: any) => s.seatId === "FP");
      expect(frontPax.isBookable).toBe(true);
      expect(frontPax.farePaise).toBe(55000); // 10% premium

      const rearWindow = trip.seats.find((s: any) => s.seatId === "2L");
      expect(rearWindow.farePaise).toBe(50000); // standard

      const rearMiddle = trip.seats.find((s: any) => s.seatId === "2M");
      expect(rearMiddle.farePaise).toBe(45000); // 10% discount
    });

    it("creates a 7-passenger MUV trip with 8 physical seats snapshot", async () => {
      const departure = new Date("2026-11-28T07:00:00.000Z");
      const arrival = new Date("2026-11-28T10:30:00.000Z");

      const res = await request(app)
        .post("/api/v1/operator/trips")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          carId: car7Id,
          routeId: routeAId,
          journeyDate: "2026-11-28",
          departureAt: departure,
          estimatedArrivalAt: arrival,
          status: "Scheduled",
          baseFarePaise: 80000,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.vehicleCategory).toBe("7-Passenger MUV");
      expect(res.body.data.totalPhysicalSeats).toBe(8);
      expect(res.body.data.bookableCapacity).toBe(7);
      expect(res.body.data.seats).toHaveLength(8);
    });

    it("rejects trip creation if vehicle is Under Maintenance", async () => {
      await Car.findByIdAndUpdate(carAId, { status: "Under Maintenance" });

      const res = await request(app)
        .post("/api/v1/operator/trips")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          carId: carAId,
          routeId: routeAId,
          journeyDate: "2026-11-28",
          departureAt: new Date("2026-11-28T14:00:00.000Z"),
          estimatedArrivalAt: new Date("2026-11-28T17:00:00.000Z"),
        });

      expect(res.status).toBe(404); // Not an active vehicle
      // Restore car status
      await Car.findByIdAndUpdate(carAId, { status: "Active" });
    });

    it("rejects overlapping trip creation for the same vehicle respecting turnaround buffer", async () => {
      // Existing Trip: 08:00 to 11:00 (+30m buffer -> effective 11:30)
      await request(app)
        .post("/api/v1/operator/trips")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          carId: carAId,
          routeId: routeAId,
          journeyDate: "2026-11-29",
          departureAt: new Date("2026-11-29T08:00:00.000Z"),
          estimatedArrivalAt: new Date("2026-11-29T11:00:00.000Z"),
          turnaroundBufferMinutes: 30,
        });

      // Proposed conflicting trip: 11:15 to 14:00 (Starts during 30m turnaround buffer)
      const res = await request(app)
        .post("/api/v1/operator/trips")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          carId: carAId,
          routeId: routeAId,
          journeyDate: "2026-11-29",
          departureAt: new Date("2026-11-29T11:15:00.000Z"),
          estimatedArrivalAt: new Date("2026-11-29T14:00:00.000Z"),
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("TRIP_SCHEDULING_CONFLICT");
    });

    it("denies creating trips for cars belonging to a different operator", async () => {
      const res = await request(app)
        .post("/api/v1/operator/trips")
        .set("Authorization", `Bearer ${tokenB}`) // Operator B tries using Operator A's car
        .send({
          carId: carAId,
          routeId: routeAId,
          journeyDate: "2026-11-30",
          departureAt: new Date("2026-11-30T09:00:00.000Z"),
          estimatedArrivalAt: new Date("2026-11-30T12:00:00.000Z"),
        });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("CAR_NOT_FOUND");
    });
  });

  describe("Trip Lifecycle: Publish, Close Sales, Cancel", () => {
    it("publishes a Draft trip to Scheduled and opens bookings", async () => {
      const createRes = await request(app)
        .post("/api/v1/operator/trips")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          carId: carAId,
          routeId: routeAId,
          journeyDate: "2026-12-01",
          departureAt: new Date("2026-12-01T08:00:00.000Z"),
          estimatedArrivalAt: new Date("2026-12-01T11:00:00.000Z"),
          status: "Draft",
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body.data.status).toBe("Draft");
      expect(createRes.body.data.bookingOpen).toBe(false);

      const tripId = createRes.body.data._id;
      const pubRes = await request(app)
        .post(`/api/v1/operator/trips/${tripId}/publish`)
        .set("Authorization", `Bearer ${tokenA}`);

      expect(pubRes.status).toBe(200);
      expect(pubRes.body.data.status).toBe("Scheduled");
      expect(pubRes.body.data.bookingOpen).toBe(true);
      expect(pubRes.body.data.publishedAt).toBeDefined();
    });

    it("closes sales for a scheduled trip", async () => {
      const createRes = await request(app)
        .post("/api/v1/operator/trips")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          carId: carAId,
          routeId: routeAId,
          journeyDate: "2026-12-02",
          departureAt: new Date("2026-12-02T08:00:00.000Z"),
          estimatedArrivalAt: new Date("2026-12-02T11:00:00.000Z"),
          status: "Scheduled",
        });

      const tripId = createRes.body.data._id;
      const closeRes = await request(app)
        .post(`/api/v1/operator/trips/${tripId}/close-sales`)
        .set("Authorization", `Bearer ${tokenA}`);

      expect(closeRes.status).toBe(200);
      expect(closeRes.body.data.bookingOpen).toBe(false);
      expect(closeRes.body.data.closedSalesAt).toBeDefined();
    });

    it("cancels a scheduled trip with reason", async () => {
      const createRes = await request(app)
        .post("/api/v1/operator/trips")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          carId: carAId,
          routeId: routeAId,
          journeyDate: "2026-12-03",
          departureAt: new Date("2026-12-03T08:00:00.000Z"),
          estimatedArrivalAt: new Date("2026-12-03T11:00:00.000Z"),
        });

      const tripId = createRes.body.data._id;
      const cancelRes = await request(app)
        .post(`/api/v1/operator/trips/${tripId}/cancel`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ reason: "Mechanical breakdown and emergency maintenance" });

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.data.status).toBe("Cancelled");
      expect(cancelRes.body.data.bookingOpen).toBe(false);
      expect(cancelRes.body.data.cancellationReason).toBe("Mechanical breakdown and emergency maintenance");
    });
  });

  describe("Operator Seat Controls: Block & Unblock Seat", () => {
    it("allows operator to block and unblock a passenger seat", async () => {
      const createRes = await request(app)
        .post("/api/v1/operator/trips")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          carId: carAId,
          routeId: routeAId,
          journeyDate: "2026-12-04",
          departureAt: new Date("2026-12-04T08:00:00.000Z"),
          estimatedArrivalAt: new Date("2026-12-04T11:00:00.000Z"),
        });

      const tripId = createRes.body.data._id;

      // Block seat 2M
      const blockRes = await request(app)
        .patch(`/api/v1/operator/trips/${tripId}/seats/2M/block`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ block: true, reason: "Reserved for courier package" });

      expect(blockRes.status).toBe(200);
      expect(blockRes.body.data.state).toBe("blocked");

      // Verify trip reflects blocked seat
      const detailRes = await request(app)
        .get(`/api/v1/operator/trips/${tripId}`)
        .set("Authorization", `Bearer ${tokenA}`);

      const seat2M = detailRes.body.data.seats.find((s: any) => s.seatId === "2M");
      expect(seat2M.state).toBe("blocked");

      // Unblock seat 2M
      const unblockRes = await request(app)
        .patch(`/api/v1/operator/trips/${tripId}/seats/2M/block`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ block: false });

      expect(unblockRes.status).toBe(200);
      expect(unblockRes.body.data.state).toBe("available");
    });

    it("rejects attempt to block or unblock the driver seat", async () => {
      const createRes = await request(app)
        .post("/api/v1/operator/trips")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          carId: carAId,
          routeId: routeAId,
          journeyDate: "2026-12-05",
          departureAt: new Date("2026-12-05T08:00:00.000Z"),
          estimatedArrivalAt: new Date("2026-12-05T11:00:00.000Z"),
        });

      const tripId = createRes.body.data._id;

      const res = await request(app)
        .patch(`/api/v1/operator/trips/${tripId}/seats/D/block`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ block: true });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("CANNOT_MODIFY_DRIVER_SEAT");
    });
  });
});
