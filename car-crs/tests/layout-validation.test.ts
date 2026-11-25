import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { CarSeatLayout } from "../src/models/car-seat-layout.model.js";
import {
  getStandard4PassengerLayout,
  getStandard7PassengerLayout,
  getStandard6PassengerLayout,
  validatePhysicalCarLayout,
} from "../src/services/car-layout.service.js";

describe("Car Physical Seat Layout & Driver Exclusion", () => {
  let mongo: MongoMemoryReplSet;
  const operatorId = new mongoose.Types.ObjectId();

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
    await CarSeatLayout.deleteMany({});
  });

  it("creates a standard 4-passenger-seat layout with exactly 1 driver and 4 bookable seats", async () => {
    const seats = getStandard4PassengerLayout("RHD", 50000);
    expect(seats).toHaveLength(5); // 1 driver + 4 passenger

    const driverSeat = seats.find((s) => s.isDriver);
    expect(driverSeat).toBeDefined();
    expect(driverSeat?.seatId).toBe("D");
    expect(driverSeat?.isBookable).toBe(false);

    const bookableSeats = seats.filter((s) => s.isBookable);
    expect(bookableSeats).toHaveLength(4);

    const layout = await CarSeatLayout.create({
      operatorId,
      name: "Sedan Standard 4-Seat",
      vehicleCategory: "4-Passenger Sedan",
      totalPhysicalSeats: 5,
      bookablePassengerCapacity: 4,
      driveOrientation: "RHD",
      seats,
    });

    expect(layout._id).toBeDefined();
    expect(layout.seats).toHaveLength(5);
  });

  it("creates a standard 7-passenger-seat layout with 8 physical seats (1 driver + 7 bookable)", async () => {
    const seats = getStandard7PassengerLayout("RHD", 80000);
    expect(seats).toHaveLength(8); // 1 driver + 1 front + 3 middle + 3 rear = 8

    const driverSeat = seats.find((s) => s.isDriver);
    expect(driverSeat?.isBookable).toBe(false);

    const bookableSeats = seats.filter((s) => s.isBookable);
    expect(bookableSeats).toHaveLength(7);

    // Verify row counts
    const row1Passengers = seats.filter((s) => s.row === 1 && !s.isDriver);
    const row2Passengers = seats.filter((s) => s.row === 2);
    const row3Passengers = seats.filter((s) => s.row === 3);

    expect(row1Passengers).toHaveLength(1); // FP
    expect(row2Passengers).toHaveLength(3); // 2L, 2M, 2R
    expect(row3Passengers).toHaveLength(3); // 3L, 3M, 3R

    const layout = await CarSeatLayout.create({
      operatorId,
      name: "Innova 8-Seater (7 Bookable Passengers)",
      vehicleCategory: "7-Passenger MUV",
      totalPhysicalSeats: 8,
      bookablePassengerCapacity: 7,
      driveOrientation: "RHD",
      seats,
    });

    expect(layout.bookablePassengerCapacity).toBe(7);
  });

  it("verifies captain-seat 6-passenger layout (7 physical seats = 1 driver + 6 bookable)", async () => {
    const seats = getStandard6PassengerLayout("RHD", 70000);
    expect(seats).toHaveLength(7);
    const bookable = seats.filter((s) => s.isBookable);
    expect(bookable).toHaveLength(6);
  });

  it("strictly rejects layout where driver seat is marked bookable", async () => {
    const seats = getStandard4PassengerLayout("RHD");
    seats[0].isBookable = true; // Security flaw attempt: make driver bookable

    await expect(
      CarSeatLayout.create({
        operatorId,
        name: "Tampered Layout",
        vehicleCategory: "4-Passenger Sedan",
        totalPhysicalSeats: 5,
        bookablePassengerCapacity: 4,
        seats,
      })
    ).rejects.toThrow(/driver seat, which must not be bookable/);
  });

  it("strictly rejects layout where seat coordinates overlap", async () => {
    const seats = getStandard4PassengerLayout("RHD");
    // Duplicate coordinates: make 2M share row 2, col 1 with 2L
    seats[3].column = 1;

    await expect(
      CarSeatLayout.create({
        operatorId,
        name: "Overlapping Layout",
        vehicleCategory: "4-Passenger Sedan",
        totalPhysicalSeats: 5,
        bookablePassengerCapacity: 4,
        seats,
      })
    ).rejects.toThrow(/Physical seats cannot overlap in row and column coordinates/);
  });

  it("strictly rejects layout where bookable count does not match bookablePassengerCapacity", async () => {
    const seats = getStandard4PassengerLayout("RHD"); // 4 bookable

    await expect(
      CarSeatLayout.create({
        operatorId,
        name: "Mismatched Layout",
        vehicleCategory: "4-Passenger Sedan",
        totalPhysicalSeats: 8,
        bookablePassengerCapacity: 7, // claims 7 bookable, but seats array only has 4 bookable
        seats,
      })
    ).rejects.toThrow(/Bookable seats count must exactly match bookablePassengerCapacity/);
  });
});
