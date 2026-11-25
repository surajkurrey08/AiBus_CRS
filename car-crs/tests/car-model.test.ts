import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { Car } from "../src/models/car.model.js";

describe("Car Model Foundation & Capacity Validation", () => {
  let mongo: MongoMemoryReplSet;
  const operatorA = new mongoose.Types.ObjectId();
  const operatorB = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
      binary: { version: "7.0.14" },
    });
    await mongoose.connect(mongo.getUri("aibus_car_crs"));
    await Car.init();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    await Car.deleteMany({});
  });

  it("successfully creates a valid 4-passenger-seat sedan (5 physical seats = 1 driver + 4 bookable)", async () => {
    const car = await Car.create({
      operatorId: operatorA,
      registration: "MH-12-AB-1234",
      make: "Maruti Suzuki",
      modelName: "Dzire",
      category: "4-Passenger Sedan",
      advertisedCapacity: 5,
      totalPhysicalSeats: 5,
      driverSeatsCount: 1,
      bookablePassengerCapacity: 4,
      driveOrientation: "RHD",
    });

    expect(car._id).toBeDefined();
    expect(car.registration).toBe("MH12AB1234"); // formatted
    expect(car.bookablePassengerCapacity).toBe(4);
    expect(car.totalPhysicalSeats).toBe(5);
  });

  it("successfully creates a valid 7-passenger-seat MUV (8 physical seats = 1 driver + 7 bookable)", async () => {
    const car = await Car.create({
      operatorId: operatorA,
      registration: "MH-14-CD-5678",
      make: "Toyota",
      modelName: "Innova Crysta 8-Seater",
      category: "7-Passenger MUV",
      advertisedCapacity: 8,
      totalPhysicalSeats: 8,
      driverSeatsCount: 1,
      bookablePassengerCapacity: 7,
      driveOrientation: "RHD",
    });

    expect(car.bookablePassengerCapacity).toBe(7);
    expect(car.totalPhysicalSeats).toBe(8);
  });

  it("rejects vehicle where advertised capacity confuses physical seats and passenger capacity", async () => {
    // If a car has 5 physical seats, it CANNOT have 5 bookable passenger seats because driver requires 1 seat
    await expect(
      Car.create({
        operatorId: operatorA,
        registration: "MH-12-EF-9999",
        make: "Hyundai",
        modelName: "Aura",
        category: "4-Passenger Sedan",
        advertisedCapacity: 5,
        totalPhysicalSeats: 5,
        driverSeatsCount: 1,
        bookablePassengerCapacity: 5, // INVALID: 1 driver + 5 passenger = 6 != 5
        driveOrientation: "RHD",
      })
    ).rejects.toThrow();
  });

  it("enforces unique vehicle registration number", async () => {
    await Car.create({
      operatorId: operatorA,
      registration: "MH12XY0001",
      make: "Tata",
      modelName: "Tigor",
      category: "4-Passenger Sedan",
      advertisedCapacity: 5,
      totalPhysicalSeats: 5,
      driverSeatsCount: 1,
      bookablePassengerCapacity: 4,
    });

    // Same registration under different operator must still be rejected
    await expect(
      Car.create({
        operatorId: operatorB,
        registration: "MH 12 XY 0001",
        make: "Tata",
        modelName: "Tigor",
        category: "4-Passenger Sedan",
        advertisedCapacity: 5,
        totalPhysicalSeats: 5,
        driverSeatsCount: 1,
        bookablePassengerCapacity: 4,
      })
    ).rejects.toThrow(/E11000 duplicate key error/);
  });

  it("preserves operator isolation in queries", async () => {
    await Car.create({
      operatorId: operatorA,
      registration: "MH12AA1111",
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
      registration: "MH14BB2222",
      make: "Toyota",
      modelName: "Ertiga",
      category: "6-Passenger SUV",
      advertisedCapacity: 7,
      totalPhysicalSeats: 7,
      driverSeatsCount: 1,
      bookablePassengerCapacity: 6,
    });

    const carsA = await Car.find({ operatorId: operatorA });
    expect(carsA).toHaveLength(1);
    expect(carsA[0].registration).toBe("MH12AA1111");

    const carsB = await Car.find({ operatorId: operatorB });
    expect(carsB).toHaveLength(1);
    expect(carsB[0].registration).toBe("MH14BB2222");
  });
});
