import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { CarBooking } from "../src/models/car-booking.model.js";
import { CarSeatHold } from "../src/models/car-hold.model.js";
import { CarTicket } from "../src/models/car-ticket.model.js";

describe("Car Booking Foundation (ONE_WAY & ROUND_TRIP)", () => {
  let mongo: MongoMemoryReplSet;
  const operatorId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const tripOutboundId = new mongoose.Types.ObjectId();
  const tripReturnId = new mongoose.Types.ObjectId();
  const carOutboundId = new mongoose.Types.ObjectId();
  const carReturnId = new mongoose.Types.ObjectId();

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
    await CarBooking.deleteMany({});
    await CarSeatHold.deleteMany({});
    await CarTicket.deleteMany({});
  });

  it("creates a valid ONE_WAY booking with single outbound leg", async () => {
    const booking = await CarBooking.create({
      operatorId,
      bookingType: "ONE_WAY",
      pnr: "CAR-1W0001",
      reference: "ref-1w-0001-uuid",
      userId,
      channel: "operator",
      legs: [
        {
          legType: "outbound",
          tripId: tripOutboundId,
          carId: carOutboundId,
          routeDescription: "Pune -> Mumbai",
          departureAt: new Date("2026-11-25T08:00:00.000Z"),
          estimatedArrivalAt: new Date("2026-11-25T12:00:00.000Z"),
          holdId: "hold-outbound-1234",
          seats: [
            { seatId: "FP", passengerName: "Aarav Sharma", farePaise: 55000 },
            { seatId: "2L", passengerName: "Priya Sharma", farePaise: 50000 },
          ],
          grossPaise: 105000,
          taxPaise: 5250,
          discountPaise: 0,
          totalPaise: 110250,
          status: "Confirmed",
        },
      ],
      totalGrossPaise: 105000,
      totalTaxPaise: 5250,
      totalDiscountPaise: 0,
      totalPayablePaise: 110250,
      contact: { phone: "9876543210", email: "aarav@example.com" },
      idempotencyKey: "idem-1w-0001-key",
      requestHash: "hash-1w-0001",
    });

    expect(booking.pnr).toBe("CAR-1W0001");
    expect(booking.legs).toHaveLength(1);
    expect(booking.legs[0].legType).toBe("outbound");
    expect(booking.legs[0].seats).toHaveLength(2);
  });

  it("creates a valid ROUND_TRIP booking with outbound and return legs", async () => {
    const outboundDep = new Date("2026-11-25T08:00:00.000Z");
    const outboundArr = new Date("2026-11-25T12:00:00.000Z");
    const returnDep = new Date("2026-11-27T14:00:00.000Z");
    const returnArr = new Date("2026-11-27T18:00:00.000Z");

    const booking = await CarBooking.create({
      operatorId,
      bookingType: "ROUND_TRIP",
      pnr: "CAR-RT0001",
      reference: "ref-rt-0001-uuid",
      userId,
      channel: "customer",
      legs: [
        {
          legType: "outbound",
          tripId: tripOutboundId,
          carId: carOutboundId,
          routeDescription: "Pune -> Mumbai",
          departureAt: outboundDep,
          estimatedArrivalAt: outboundArr,
          holdId: "hold-rt-out-1234",
          seats: [{ seatId: "FP", passengerName: "Rohan Patel", farePaise: 55000 }],
          grossPaise: 55000,
          taxPaise: 2750,
          discountPaise: 0,
          totalPaise: 57750,
          status: "Confirmed",
        },
        {
          legType: "return",
          tripId: tripReturnId,
          carId: carReturnId,
          routeDescription: "Mumbai -> Pune",
          departureAt: returnDep,
          estimatedArrivalAt: returnArr,
          holdId: "hold-rt-ret-5678",
          seats: [{ seatId: "2R", passengerName: "Rohan Patel", farePaise: 50000 }],
          grossPaise: 50000,
          taxPaise: 2500,
          discountPaise: 0,
          totalPaise: 52500,
          status: "Confirmed",
        },
      ],
      totalGrossPaise: 105000,
      totalTaxPaise: 5250,
      totalDiscountPaise: 5000, // round-trip discount
      totalPayablePaise: 105250,
      contact: { phone: "9876543211", email: "rohan@example.com" },
      idempotencyKey: "idem-rt-0001-key",
      requestHash: "hash-rt-0001",
    });

    expect(booking.pnr).toBe("CAR-RT0001");
    expect(booking.legs).toHaveLength(2);
    expect(booking.legs[0].legType).toBe("outbound");
    expect(booking.legs[1].legType).toBe("return");
    expect(booking.legs[1].carId.toString()).toBe(carReturnId.toString()); // Separate car on return
  });

  it("rejects ROUND_TRIP booking where return departure is before outbound departure", async () => {
    const outboundDep = new Date("2026-11-25T08:00:00.000Z");
    const returnDepEarlier = new Date("2026-11-24T08:00:00.000Z"); // Chronologically impossible

    await expect(
      CarBooking.create({
        operatorId,
        bookingType: "ROUND_TRIP",
        pnr: "CAR-INVALID-RT",
        reference: "ref-invalid-rt",
        userId,
        legs: [
          {
            legType: "outbound",
            tripId: tripOutboundId,
            carId: carOutboundId,
            routeDescription: "Pune -> Mumbai",
            departureAt: outboundDep,
            estimatedArrivalAt: new Date("2026-11-25T12:00:00.000Z"),
            holdId: "hold-out",
            seats: [{ seatId: "FP", passengerName: "Test", farePaise: 50000 }],
            grossPaise: 50000,
            totalPaise: 50000,
          },
          {
            legType: "return",
            tripId: tripReturnId,
            carId: carReturnId,
            routeDescription: "Mumbai -> Pune",
            departureAt: returnDepEarlier,
            estimatedArrivalAt: new Date("2026-11-24T12:00:00.000Z"),
            holdId: "hold-ret",
            seats: [{ seatId: "FP", passengerName: "Test", farePaise: 50000 }],
            grossPaise: 50000,
            totalPaise: 50000,
          },
        ],
        totalGrossPaise: 100000,
        totalPayablePaise: 100000,
        contact: { phone: "9876543210" },
        idempotencyKey: "idem-invalid-rt",
        requestHash: "hash-invalid-rt",
      })
    ).rejects.toThrow();
  });

  it("rejects ONE_WAY booking that provides 2 legs", async () => {
    await expect(
      CarBooking.create({
        operatorId,
        bookingType: "ONE_WAY",
        pnr: "CAR-INVALID-1W",
        reference: "ref-invalid-1w",
        userId,
        legs: [
          {
            legType: "outbound",
            tripId: tripOutboundId,
            carId: carOutboundId,
            routeDescription: "Pune -> Mumbai",
            departureAt: new Date("2026-11-25T08:00:00.000Z"),
            estimatedArrivalAt: new Date("2026-11-25T12:00:00.000Z"),
            holdId: "h1",
            seats: [{ seatId: "FP", passengerName: "Test", farePaise: 50000 }],
            grossPaise: 50000,
            totalPaise: 50000,
          },
          {
            legType: "return",
            tripId: tripReturnId,
            carId: carReturnId,
            routeDescription: "Mumbai -> Pune",
            departureAt: new Date("2026-11-26T08:00:00.000Z"),
            estimatedArrivalAt: new Date("2026-11-26T12:00:00.000Z"),
            holdId: "h2",
            seats: [{ seatId: "FP", passengerName: "Test", farePaise: 50000 }],
            grossPaise: 50000,
            totalPaise: 50000,
          },
        ],
        totalGrossPaise: 100000,
        totalPayablePaise: 100000,
        contact: { phone: "9876543210" },
        idempotencyKey: "idem-invalid-1w",
        requestHash: "hash-invalid-1w",
      })
    ).rejects.toThrow();
  });

  it("verifies seat hold rejects attempt to hold driver seat 'D'", async () => {
    await expect(
      CarSeatHold.create({
        operatorId,
        tripId: tripOutboundId,
        userId,
        holdId: "hold-driver-attempt",
        seatIds: ["D"], // DRIVER SEAT
        amountPaise: 0,
        expiresAt: new Date(Date.now() + 300000),
      })
    ).rejects.toThrow(/cannot hold the driver seat/);
  });

  it("issues leg-specific tickets for a round-trip booking", async () => {
    const outboundTicket = await CarTicket.create({
      operatorId,
      bookingId: new mongoose.Types.ObjectId(),
      pnr: "CAR-RT0001",
      ticketNumber: "TKT-RT0001-OUT",
      legType: "outbound",
      tripId: tripOutboundId,
      carId: carOutboundId,
      seatIds: ["FP"],
      passengers: [{ name: "Rohan Patel", seatId: "FP" }],
      issuedAt: new Date(),
    });

    const returnTicket = await CarTicket.create({
      operatorId,
      bookingId: outboundTicket.bookingId,
      pnr: "CAR-RT0001",
      ticketNumber: "TKT-RT0001-RET",
      legType: "return",
      tripId: tripReturnId,
      carId: carReturnId,
      seatIds: ["2R"],
      passengers: [{ name: "Rohan Patel", seatId: "2R" }],
      issuedAt: new Date(),
    });

    expect(outboundTicket.ticketNumber).toBe("TKT-RT0001-OUT");
    expect(returnTicket.ticketNumber).toBe("TKT-RT0001-RET");
    expect(outboundTicket.status).toBe("valid");
    expect(returnTicket.status).toBe("valid");
  });
});
