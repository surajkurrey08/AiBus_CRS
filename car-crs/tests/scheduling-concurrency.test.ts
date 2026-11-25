import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { Car } from "../src/models/car.model.js";
import { CarTrip } from "../src/models/car-trip.model.js";
import { CarRoute } from "../src/models/car-route.model.js";
import { getStandard4PassengerLayout } from "../src/services/car-layout.service.js";
import { scheduleCarTripConcurrencySafe } from "../src/services/car-scheduling.service.js";

describe("Car Scheduling Concurrency Safety & Race-Condition Prevention", () => {
  let mongo: MongoMemoryReplSet;
  const operatorId = new mongoose.Types.ObjectId();
  let carAId: mongoose.Types.ObjectId;
  let carBId: mongoose.Types.ObjectId;
  let routeId: mongoose.Types.ObjectId;

  const validInventorySeats = getStandard4PassengerLayout("RHD", 50000).map((s) => ({
    seatId: s.seatId,
    label: s.label,
    row: s.row,
    column: s.column,
    isDriver: s.isDriver,
    isBookable: s.isBookable,
    category: s.category,
    baseFarePaise: s.baseFarePaise,
    farePaise: s.baseFarePaise || 50000,
    state: "available",
  }));

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
      binary: { version: "7.0.14" },
    });
    await mongoose.connect(mongo.getUri("aibus_car_crs"));

    const carA = await Car.create({
      operatorId,
      registration: "MH12CC0001",
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
      registration: "MH12CC0002",
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
      distanceKm: 150,
      estimatedDurationMinutes: 180,
      boarding: [{ name: "Pune", address: "Pune" }],
      dropping: [{ name: "Mumbai", address: "Mumbai" }],
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

  it("safely prevents double-scheduling when concurrent requests attempt to book the exact same car at the same time", async () => {
    const departure = new Date("2026-11-26T09:00:00.000Z");
    const arrival = new Date("2026-11-26T12:00:00.000Z");

    const request1 = scheduleCarTripConcurrencySafe(operatorId.toHexString(), {
      carId: carAId,
      routeId,
      journeyDate: "2026-11-26",
      departureAt: departure,
      estimatedArrivalAt: arrival,
      turnaroundBufferMinutes: 30,
      seats: validInventorySeats,
    });

    const request2 = scheduleCarTripConcurrencySafe(operatorId.toHexString(), {
      carId: carAId,
      routeId,
      journeyDate: "2026-11-26",
      departureAt: departure,
      estimatedArrivalAt: arrival,
      turnaroundBufferMinutes: 30,
      seats: validInventorySeats,
    });

    // Fire both concurrently
    const results = await Promise.allSettled([request1, request2]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Exactly one must succeed and exactly one must fail
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // Verify rejection reason is scheduling overlap conflict
    const error = (rejected[0] as PromiseRejectedResult).reason;
    expect(error.message).toMatch(/TRIP_SCHEDULING_CONFLICT/);

    // Verify exactly one trip was saved in the database
    const savedTrips = await CarTrip.find({ carId: carAId });
    expect(savedTrips).toHaveLength(1);
  });

  it("allows concurrent scheduling for two DIFFERENT cars during identical time intervals", async () => {
    const departure = new Date("2026-11-27T10:00:00.000Z");
    const arrival = new Date("2026-11-27T13:00:00.000Z");

    const requestA = scheduleCarTripConcurrencySafe(operatorId.toHexString(), {
      carId: carAId,
      routeId,
      journeyDate: "2026-11-27",
      departureAt: departure,
      estimatedArrivalAt: arrival,
      turnaroundBufferMinutes: 30,
      seats: validInventorySeats,
    });

    const requestB = scheduleCarTripConcurrencySafe(operatorId.toHexString(), {
      carId: carBId,
      routeId,
      journeyDate: "2026-11-27",
      departureAt: departure,
      estimatedArrivalAt: arrival,
      turnaroundBufferMinutes: 30,
      seats: validInventorySeats,
    });

    const results = await Promise.allSettled([requestA, requestB]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Both must succeed
    expect(fulfilled).toHaveLength(2);
    expect(rejected).toHaveLength(0);

    const savedTripsA = await CarTrip.find({ carId: carAId, journeyDate: "2026-11-27" });
    const savedTripsB = await CarTrip.find({ carId: carBId, journeyDate: "2026-11-27" });
    expect(savedTripsA).toHaveLength(1);
    expect(savedTripsB).toHaveLength(1);
  });

  it("allows scheduling consecutive non-overlapping trips for the same vehicle respecting turnaround time", async () => {
    // Trip 1: 06:00 to 09:00 + 30m buffer -> effective arrival 09:30
    const trip1Dep = new Date("2026-11-28T06:00:00.000Z");
    const trip1Arr = new Date("2026-11-28T09:00:00.000Z");

    // Trip 2: 10:00 to 13:00 (Starts 30m after buffer ends)
    const trip2Dep = new Date("2026-11-28T10:00:00.000Z");
    const trip2Arr = new Date("2026-11-28T13:00:00.000Z");

    const trip1 = await scheduleCarTripConcurrencySafe(operatorId.toHexString(), {
      carId: carAId,
      routeId,
      journeyDate: "2026-11-28",
      departureAt: trip1Dep,
      estimatedArrivalAt: trip1Arr,
      turnaroundBufferMinutes: 30,
      seats: validInventorySeats,
    });

    const trip2 = await scheduleCarTripConcurrencySafe(operatorId.toHexString(), {
      carId: carAId,
      routeId,
      journeyDate: "2026-11-28",
      departureAt: trip2Dep,
      estimatedArrivalAt: trip2Arr,
      turnaroundBufferMinutes: 30,
      seats: validInventorySeats,
    });

    expect(trip1._id).toBeDefined();
    expect(trip2._id).toBeDefined();

    const trips = await CarTrip.find({ carId: carAId, journeyDate: "2026-11-28" }).sort({ departureAt: 1 });
    expect(trips).toHaveLength(2);
  });
});
