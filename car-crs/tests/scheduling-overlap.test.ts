import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { CarTrip } from "../src/models/car-trip.model.js";
import { CarRoute } from "../src/models/car-route.model.js";
import { Car } from "../src/models/car.model.js";
import { getStandard4PassengerLayout } from "../src/services/car-layout.service.js";
import { assertNoTripOverlap, detectTripOverlap } from "../src/services/car-scheduling.service.js";

describe("Car Trip Overlap Detection & Reliable Scheduling", () => {
  let mongo: MongoMemoryReplSet;
  const operatorId = new mongoose.Types.ObjectId();
  let carAId: mongoose.Types.ObjectId;
  let carBId: mongoose.Types.ObjectId;
  let routeId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
      binary: { version: "7.0.14" },
    });
    await mongoose.connect(mongo.getUri("aibus_car_crs"));

    const carA = await Car.create({
      operatorId,
      registration: "MH12TR0001",
      make: "Maruti",
      modelName: "Dzire",
      category: "4-Passenger Sedan",
      advertisedCapacity: 5,
      totalPhysicalSeats: 5,
      driverSeatsCount: 1,
      bookablePassengerCapacity: 4,
    });
    carAId = carA._id as mongoose.Types.ObjectId;

    const carB = await Car.create({
      operatorId,
      registration: "MH12TR0002",
      make: "Maruti",
      modelName: "Dzire",
      category: "4-Passenger Sedan",
      advertisedCapacity: 5,
      totalPhysicalSeats: 5,
      driverSeatsCount: 1,
      bookablePassengerCapacity: 4,
    });
    carBId = carB._id as mongoose.Types.ObjectId;

    const route = await CarRoute.create({
      operatorId,
      source: "Pune",
      destination: "Mumbai",
      estimatedDurationMinutes: 240, // 4 hours
    });
    routeId = route._id as mongoose.Types.ObjectId;
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    await CarTrip.deleteMany({});
  });

  it("detects overlap when proposed trip departs during an active trip", async () => {
    // Existing Trip 1: 08:00 to 12:00 (turnaround 30m -> effective arrival 12:30)
    const trip1Dep = new Date("2026-11-25T08:00:00.000Z");
    const trip1Arr = new Date("2026-11-25T12:00:00.000Z");

    await CarTrip.create({
      operatorId,
      carId: carAId,
      routeId,
      journeyDate: "2026-11-25",
      departureAt: trip1Dep,
      estimatedArrivalAt: trip1Arr,
      turnaroundBufferMinutes: 30,
      seats: getStandard4PassengerLayout("RHD", 50000).map((s) => ({
        ...s,
        farePaise: s.baseFarePaise,
        state: "available",
      })),
    });

    // Proposed Trip 2: 10:00 to 14:00 (overlaps with Trip 1)
    const overlapResult = await detectTripOverlap({
      carId: carAId,
      departureAt: new Date("2026-11-25T10:00:00.000Z"),
      estimatedArrivalAt: new Date("2026-11-25T14:00:00.000Z"),
      turnaroundBufferMinutes: 30,
    });

    expect(overlapResult.hasOverlap).toBe(true);
    expect(overlapResult.reason).toContain("Trip interval overlaps with existing trip");

    await expect(
      assertNoTripOverlap({
        carId: carAId,
        departureAt: new Date("2026-11-25T10:00:00.000Z"),
        estimatedArrivalAt: new Date("2026-11-25T14:00:00.000Z"),
        turnaroundBufferMinutes: 30,
      })
    ).rejects.toThrow(/TRIP_SCHEDULING_CONFLICT/);
  });

  it("detects overlap during operational turnaround buffer", async () => {
    // Existing Trip 1: 08:00 to 12:00 (turnaround 30m -> effective arrival 12:30)
    await CarTrip.create({
      operatorId,
      carId: carAId,
      routeId,
      journeyDate: "2026-11-25",
      departureAt: new Date("2026-11-25T08:00:00.000Z"),
      estimatedArrivalAt: new Date("2026-11-25T12:00:00.000Z"),
      turnaroundBufferMinutes: 30,
      seats: getStandard4PassengerLayout("RHD", 50000).map((s) => ({
        ...s,
        farePaise: s.baseFarePaise,
        state: "available",
      })),
    });

    // Proposed departure at 12:15 (Trip has arrived at 12:00, but cleaning/turnaround runs until 12:30)
    const overlapResult = await detectTripOverlap({
      carId: carAId,
      departureAt: new Date("2026-11-25T12:15:00.000Z"),
      estimatedArrivalAt: new Date("2026-11-25T16:15:00.000Z"),
      turnaroundBufferMinutes: 30,
    });

    expect(overlapResult.hasOverlap).toBe(true);
  });

  it("permits trip after operational turnaround buffer expires", async () => {
    // Existing Trip 1: 08:00 to 12:00 (effective arrival 12:30)
    await CarTrip.create({
      operatorId,
      carId: carAId,
      routeId,
      journeyDate: "2026-11-25",
      departureAt: new Date("2026-11-25T08:00:00.000Z"),
      estimatedArrivalAt: new Date("2026-11-25T12:00:00.000Z"),
      turnaroundBufferMinutes: 30,
      seats: getStandard4PassengerLayout("RHD", 50000).map((s) => ({
        ...s,
        farePaise: s.baseFarePaise,
        state: "available",
      })),
    });

    // Proposed departure at 12:35 (turnaround completed at 12:30)
    const overlapResult = await detectTripOverlap({
      carId: carAId,
      departureAt: new Date("2026-11-25T12:35:00.000Z"),
      estimatedArrivalAt: new Date("2026-11-25T16:35:00.000Z"),
      turnaroundBufferMinutes: 30,
    });

    expect(overlapResult.hasOverlap).toBe(false);
  });

  it("does not conflict with trips assigned to another car", async () => {
    // Existing Trip on Car A: 08:00 to 12:00
    await CarTrip.create({
      operatorId,
      carId: carAId,
      routeId,
      journeyDate: "2026-11-25",
      departureAt: new Date("2026-11-25T08:00:00.000Z"),
      estimatedArrivalAt: new Date("2026-11-25T12:00:00.000Z"),
      turnaroundBufferMinutes: 30,
      seats: getStandard4PassengerLayout("RHD", 50000).map((s) => ({
        ...s,
        farePaise: s.baseFarePaise,
        state: "available",
      })),
    });

    // Scheduling Car B at same time is valid (different physical car)
    const overlapResult = await detectTripOverlap({
      carId: carBId,
      departureAt: new Date("2026-11-25T08:00:00.000Z"),
      estimatedArrivalAt: new Date("2026-11-25T12:00:00.000Z"),
      turnaroundBufferMinutes: 30,
    });

    expect(overlapResult.hasOverlap).toBe(false);
  });

  it("ignores cancelled trips during overlap check", async () => {
    // Cancelled Trip on Car A
    await CarTrip.create({
      operatorId,
      carId: carAId,
      routeId,
      journeyDate: "2026-11-25",
      departureAt: new Date("2026-11-25T08:00:00.000Z"),
      estimatedArrivalAt: new Date("2026-11-25T12:00:00.000Z"),
      status: "Cancelled",
      seats: getStandard4PassengerLayout("RHD", 50000).map((s) => ({
        ...s,
        farePaise: s.baseFarePaise,
        state: "available",
      })),
    });

    // Re-scheduling car during cancelled trip interval is permitted
    const overlapResult = await detectTripOverlap({
      carId: carAId,
      departureAt: new Date("2026-11-25T08:30:00.000Z"),
      estimatedArrivalAt: new Date("2026-11-25T12:30:00.000Z"),
      turnaroundBufferMinutes: 30,
    });

    expect(overlapResult.hasOverlap).toBe(false);
  });
});
