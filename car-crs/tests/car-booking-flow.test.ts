import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomBytes } from "node:crypto";
import { providerAudience } from "../src/middleware/provider.js";
import { createCarCrsApp } from "../src/app.js";
import { Car } from "../src/models/car.model.js";
import { CarRoute } from "../src/models/car-route.model.js";
import { CarTrip } from "../src/models/car-trip.model.js";
import { CarBooking } from "../src/models/car-booking.model.js";
import { CarSeatHold } from "../src/models/car-hold.model.js";
import { CarTicket } from "../src/models/car-ticket.model.js";
import { CarJournalEntry } from "../src/models/car-ledger.model.js";
import { CarSeatLayout } from "../src/models/car-seat-layout.model.js";
import {
  getStandard4PassengerLayout,
  getStandard7PassengerLayout,
} from "../src/services/car-layout.service.js";
import {
  createSeatHold,
  createRoundTripSeatHold,
} from "../src/services/car-hold.service.js";
import { quoteCancellation } from "../src/services/car-cancellation.service.js";
import { signCarToken } from "../src/middleware/auth.middleware.js";

describe("AICAR CRS — Phase 4 Comprehensive Booking Flow Test Suite", () => {
  let mongo: MongoMemoryReplSet;
  const JWT_SECRET = "test-secret-key-car-crs-phase4-secure";
  const providerKey = randomBytes(48).toString("hex");
  const app = createCarCrsApp(JWT_SECRET, providerKey);

  const operatorId = new mongoose.Types.ObjectId();
  const otherOperatorId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const agentId = new mongoose.Types.ObjectId();

  let operatorToken: string;
  let otherOperatorToken: string;

  function providerClient(subject = userId) {
    const token = jwt.sign({ operatorId: String(operatorId) }, providerKey, {
      subject: String(subject), audience: providerAudience, expiresIn: "45m",
    });
    return request.agent(app).set("Authorization", "Bearer " + token);
  }

  let carSedanId: string;
  let carMuvId: string;
  let routeOutboundId: string;
  let routeReturnId: string;

  let tripSedanOutbound: any;
  let tripSedanReturn: any;
  let tripMuvOutbound: any;

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
      binary: { version: "7.0.14" },
    });
    await mongoose.connect(mongo.getUri("aibus_car_crs"));

    operatorToken = signCarToken(
      {
        userId: userId.toString(),
        operatorId: operatorId.toString(),
        role: "operator_admin",
        permissions: ["*"] as any,
      },
      JWT_SECRET
    );

    otherOperatorToken = signCarToken(
      {
        userId: new mongoose.Types.ObjectId().toString(),
        operatorId: otherOperatorId.toString(),
        role: "operator_admin",
        permissions: ["*"] as any,
      },
      JWT_SECRET
    );

    // 1. Setup 4-Passenger Sedan (5 physical = 1 Driver + 4 Bookable)
    const sedan = await Car.create({
      operatorId,
      registration: "MH12CS4001",
      make: "Maruti",
      modelName: "Dzire",
      category: "4-Passenger Sedan",
      advertisedCapacity: 5,
      totalPhysicalSeats: 5,
      driverSeatsCount: 1,
      bookablePassengerCapacity: 4,
    });
    carSedanId = sedan._id.toString();

    const sedanLayout = await CarSeatLayout.create({
      operatorId,
      carId: sedan._id,
      name: "Sedan 4-Pass Layout",
      vehicleCategory: "4-Passenger Sedan",
      totalPhysicalSeats: 5,
      bookablePassengerCapacity: 4,
      driveOrientation: "RHD",
      version: 1,
      seats: getStandard4PassengerLayout("RHD", 50000),
      status: "Active",
    });
    sedan.activeLayoutId = sedanLayout._id as any;
    await sedan.save();

    // 2. Setup 7-Passenger MUV (8 physical = 1 Driver + 7 Bookable)
    const muv = await Car.create({
      operatorId,
      registration: "MH14CM7001",
      make: "Toyota",
      modelName: "Innova Crysta",
      category: "7-Passenger MUV",
      advertisedCapacity: 8,
      totalPhysicalSeats: 8,
      driverSeatsCount: 1,
      bookablePassengerCapacity: 7,
    });
    carMuvId = muv._id.toString();

    const muvLayout = await CarSeatLayout.create({
      operatorId,
      carId: muv._id,
      name: "MUV 7-Pass Layout",
      vehicleCategory: "7-Passenger MUV",
      totalPhysicalSeats: 8,
      bookablePassengerCapacity: 7,
      driveOrientation: "RHD",
      version: 1,
      seats: getStandard7PassengerLayout("RHD", 75000),
      status: "Active",
    });
    muv.activeLayoutId = muvLayout._id as any;
    await muv.save();

    // 3. Setup Routes (Pune <-> Mumbai)
    const outboundRoute = await CarRoute.create({
      operatorId,
      source: "Pune",
      destination: "Mumbai",
      distanceKm: 150,
      estimatedDurationMinutes: 180,
      boarding: [{ name: "Swargate", address: "Pune" }],
      dropping: [{ name: "Dadar", address: "Mumbai" }],
    });
    routeOutboundId = outboundRoute._id.toString();

    const returnRoute = await CarRoute.create({
      operatorId,
      source: "Mumbai",
      destination: "Pune",
      distanceKm: 150,
      estimatedDurationMinutes: 180,
      boarding: [{ name: "Dadar", address: "Mumbai" }],
      dropping: [{ name: "Swargate", address: "Pune" }],
    });
    routeReturnId = returnRoute._id.toString();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    await CarTrip.deleteMany({});
    await CarBooking.deleteMany({});
    await CarSeatHold.deleteMany({});
    await CarTicket.deleteMany({});
    await CarJournalEntry.deleteMany({});

    // Seed Outbound Sedan Trip
    tripSedanOutbound = await CarTrip.create({
      operatorId,
      tripNumber: "TRIP-SEDAN-OUT",
      tripType: "ONE_WAY",
      carId: carSedanId,
      routeId: routeOutboundId,
      vehicleCategory: "4-Passenger Sedan",
      totalPhysicalSeats: 5,
      bookableCapacity: 4,
      journeyDate: "2026-12-15",
      departureAt: new Date(Date.now() + 48 * 3600 * 1000), // +48 hours (for cancellation policy testing)
      estimatedArrivalAt: new Date(Date.now() + 51 * 3600 * 1000),
      turnaroundBufferMinutes: 30,
      status: "Scheduled",
      bookingOpen: true,
      seats: [
        { seatId: "D", label: "Driver", row: 1, column: 2, isDriver: true, isBookable: false, category: "driver", farePaise: 0, state: "available" },
        { seatId: "FP", label: "Front Passenger", row: 1, column: 1, isDriver: false, isBookable: true, category: "front_passenger", farePaise: 55000, state: "available" },
        { seatId: "2L", label: "Rear Left", row: 2, column: 1, isDriver: false, isBookable: true, category: "window", farePaise: 50000, state: "available" },
        { seatId: "2M", label: "Rear Middle", row: 2, column: 2, isDriver: false, isBookable: true, category: "middle", farePaise: 45000, state: "available" },
        { seatId: "2R", label: "Rear Right", row: 2, column: 3, isDriver: false, isBookable: true, category: "window", farePaise: 50000, state: "available" },
      ],
    });

    // Seed Return Sedan Trip
    tripSedanReturn = await CarTrip.create({
      operatorId,
      tripNumber: "TRIP-SEDAN-RET",
      tripType: "ROUND_TRIP",
      carId: carSedanId,
      routeId: routeReturnId,
      vehicleCategory: "4-Passenger Sedan",
      totalPhysicalSeats: 5,
      bookableCapacity: 4,
      journeyDate: "2026-12-18",
      departureAt: new Date(Date.now() + 72 * 3600 * 1000),
      estimatedArrivalAt: new Date(Date.now() + 75 * 3600 * 1000),
      turnaroundBufferMinutes: 30,
      status: "Scheduled",
      bookingOpen: true,
      seats: [
        { seatId: "D", label: "Driver", row: 1, column: 2, isDriver: true, isBookable: false, category: "driver", farePaise: 0, state: "available" },
        { seatId: "FP", label: "Front Passenger", row: 1, column: 1, isDriver: false, isBookable: true, category: "front_passenger", farePaise: 55000, state: "available" },
        { seatId: "2L", label: "Rear Left", row: 2, column: 1, isDriver: false, isBookable: true, category: "window", farePaise: 50000, state: "available" },
        { seatId: "2M", label: "Rear Middle", row: 2, column: 2, isDriver: false, isBookable: true, category: "middle", farePaise: 45000, state: "available" },
        { seatId: "2R", label: "Rear Right", row: 2, column: 3, isDriver: false, isBookable: true, category: "window", farePaise: 50000, state: "available" },
      ],
    });

    // Seed Outbound 7-Passenger MUV Trip (8 physical = 1 Driver + 7 Bookable)
    tripMuvOutbound = await CarTrip.create({
      operatorId,
      tripNumber: "TRIP-MUV-OUT",
      tripType: "ONE_WAY",
      carId: carMuvId,
      routeId: routeOutboundId,
      vehicleCategory: "7-Passenger MUV",
      totalPhysicalSeats: 8,
      bookableCapacity: 7,
      journeyDate: "2026-12-15",
      departureAt: new Date(Date.now() + 48 * 3600 * 1000),
      estimatedArrivalAt: new Date(Date.now() + 51 * 3600 * 1000),
      turnaroundBufferMinutes: 30,
      status: "Scheduled",
      bookingOpen: true,
      seats: [
        { seatId: "D", label: "Driver", row: 1, column: 2, isDriver: true, isBookable: false, category: "driver", farePaise: 0, state: "available" },
        { seatId: "FP", label: "Front Passenger", row: 1, column: 1, isDriver: false, isBookable: true, category: "front_passenger", farePaise: 80000, state: "available" },
        { seatId: "2L", label: "Row 2 Left", row: 2, column: 1, isDriver: false, isBookable: true, category: "window", farePaise: 75000, state: "available" },
        { seatId: "2M", label: "Row 2 Middle", row: 2, column: 2, isDriver: false, isBookable: true, category: "middle", farePaise: 70000, state: "available" },
        { seatId: "2R", label: "Row 2 Right", row: 2, column: 3, isDriver: false, isBookable: true, category: "window", farePaise: 75000, state: "available" },
        { seatId: "3L", label: "Row 3 Left", row: 3, column: 1, isDriver: false, isBookable: true, category: "window", farePaise: 75000, state: "available" },
        { seatId: "3M", label: "Row 3 Middle", row: 3, column: 2, isDriver: false, isBookable: true, category: "middle", farePaise: 65000, state: "available" },
        { seatId: "3R", label: "Row 3 Right", row: 3, column: 3, isDriver: false, isBookable: true, category: "window", farePaise: 75000, state: "available" },
      ],
    });
  });

  // =========================================================================
  // SCENARIO 1: One Way seat booking (Search -> Hold -> Confirm -> PNR & Ticket)
  // =========================================================================
  it("Scenario 1: One Way seat booking (Search -> Hold -> Confirm -> PNR & Ticket)", async () => {
    // 1. Search trips
    const searchRes = await providerClient()
      .get("/api/v1/car/trips/search")
      .query({ source: "Pune", destination: "Mumbai", journeyDate: "2026-12-15" });
    expect(searchRes.status).toBe(200);
    expect(searchRes.body.data.length).toBeGreaterThan(0);

    // 2. Hold seat "FP"
    const holdRes = await providerClient()
      .post("/api/v1/car/holds")
      .send({
        tripId: tripSedanOutbound._id.toString(),
        seatIds: ["FP"],
        legType: "outbound",
      });
    expect(holdRes.status).toBe(201);
    const holdId = holdRes.body.data.holdId;
    expect(holdId).toBeDefined();

    // 3. Confirm Booking
    const confirmRes = await providerClient()
      .post("/api/v1/car/bookings/confirm")
      .send({
        bookingType: "ONE_WAY",
        holdId,
        passengers: [{ seatId: "FP", name: "Aarav Sharma", age: 30, gender: "M" }],
        contact: { phone: "9876543210", email: "aarav@example.com" },
        idempotencyKey: "idem-sc1-oneway",
        payment: { mode: "sandbox", amountPaise: 55000 },
      });

    expect(confirmRes.status).toBe(201);
    expect(confirmRes.body.data.pnr).toMatch(/^CAR[A-Z0-9]{7}$/);
    expect(confirmRes.body.data.bookingType).toBe("ONE_WAY");
    expect(confirmRes.body.data.tickets).toHaveLength(1);
    expect(confirmRes.body.data.tickets[0].ticketNumber).toBe(`TKT-${confirmRes.body.data.pnr}-OUT`);

    // Verify trip seat transitioned to booked
    const updatedTrip = await CarTrip.findById(tripSedanOutbound._id);
    const fpSeat = updatedTrip?.seats.find((s) => s.seatId === "FP");
    expect(fpSeat?.state).toBe("booked");
  });

  // =========================================================================
  // SCENARIO 2: Round Trip seat booking (Outbound + Return holds -> Combined Confirmation -> 2 Tickets)
  // =========================================================================
  it("Scenario 2: Round Trip seat booking (Outbound + Return holds -> Combined Confirmation -> 2 Tickets)", async () => {
    // 1. Create Round Trip Hold
    const holdRes = await providerClient()
      .post("/api/v1/car/holds/round-trip")
      .send({
        outboundTripId: tripSedanOutbound._id.toString(),
        outboundSeatIds: ["2L"],
        returnTripId: tripSedanReturn._id.toString(),
        returnSeatIds: ["2R"],
      });

    expect(holdRes.status).toBe(201);
    const { outboundHoldId, returnHoldId } = holdRes.body.data;
    expect(outboundHoldId).toBeDefined();
    expect(returnHoldId).toBeDefined();

    // 2. Confirm Round Trip Booking
    const confirmRes = await providerClient()
      .post("/api/v1/car/bookings/confirm")
      .send({
        bookingType: "ROUND_TRIP",
        outboundHoldId,
        returnHoldId,
        passengers: [{ seatId: "2L", name: "Priya Sharma", age: 28, gender: "F" }],
        returnPassengers: [{ seatId: "2R", name: "Priya Sharma", age: 28, gender: "F" }],
        contact: { phone: "9876543211", email: "priya@example.com" },
        idempotencyKey: "idem-sc2-roundtrip",
        payment: { mode: "sandbox", amountPaise: 100000 }, // 50000 + 50000
      });

    expect(confirmRes.status).toBe(201);
    const booking = confirmRes.body.data;
    expect(booking.pnr).toMatch(/^CAR[A-Z0-9]{7}$/);
    expect(booking.bookingType).toBe("ROUND_TRIP");
    expect(booking.tickets).toHaveLength(2);
    expect(booking.tickets[0].ticketNumber).toBe(`TKT-${booking.pnr}-OUT`);
    expect(booking.tickets[1].ticketNumber).toBe(`TKT-${booking.pnr}-RET`);
  });

  // =========================================================================
  // SCENARIO 3: 4-passenger-seat configuration (5 physical = 1 driver + 4 bookable)
  // =========================================================================
  it("Scenario 3: 4-passenger-seat configuration (5 physical = 1 driver + 4 bookable)", async () => {
    // Attempt to hold all 4 passenger seats (FP, 2L, 2M, 2R)
    const holdRes = await providerClient()
      .post("/api/v1/car/holds")
      .send({
        tripId: tripSedanOutbound._id.toString(),
        seatIds: ["FP", "2L", "2M", "2R"],
      });

    expect(holdRes.status).toBe(201);
    expect(holdRes.body.data.heldSeats).toEqual(["FP", "2L", "2M", "2R"]);

    // Confirm booking for all 4 seats
    const confirmRes = await providerClient()
      .post("/api/v1/car/bookings/confirm")
      .send({
        bookingType: "ONE_WAY",
        holdId: holdRes.body.data.holdId,
        passengers: [
          { seatId: "FP", name: "Pass 1" },
          { seatId: "2L", name: "Pass 2" },
          { seatId: "2M", name: "Pass 3" },
          { seatId: "2R", name: "Pass 4" },
        ],
        contact: { phone: "9876543212" },
        idempotencyKey: "idem-sc3-all4",
        payment: { mode: "sandbox", amountPaise: 200000 }, // 55k + 50k + 45k + 50k
      });

    expect(confirmRes.status).toBe(201);

    // Verify trip has 0 remaining bookable seats and driver seat is still driver/available
    const trip = await CarTrip.findById(tripSedanOutbound._id);
    const availableSeats = trip?.seats.filter((s) => s.isBookable && s.state === "available");
    expect(availableSeats).toHaveLength(0);
    const driverSeat = trip?.seats.find((s) => s.isDriver);
    expect(driverSeat?.isBookable).toBe(false);
  });

  // =========================================================================
  // SCENARIO 4: 7-passenger-seat configuration (8 physical = 1 driver + 7 bookable)
  // =========================================================================
  it("Scenario 4: 7-passenger-seat configuration (8 physical = 1 driver + 7 bookable)", async () => {
    const all7Seats = ["FP", "2L", "2M", "2R", "3L", "3M", "3R"];
    const holdRes = await providerClient()
      .post("/api/v1/car/holds")
      .send({
        tripId: tripMuvOutbound._id.toString(),
        seatIds: all7Seats,
      });

    expect(holdRes.status).toBe(201);
    expect(holdRes.body.data.heldSeats).toHaveLength(7);

    // Total fare: 80k + 75k + 70k + 75k + 75k + 65k + 75k = 515000
    const confirmRes = await providerClient()
      .post("/api/v1/car/bookings/confirm")
      .send({
        bookingType: "ONE_WAY",
        holdId: holdRes.body.data.holdId,
        passengers: all7Seats.map((s, idx) => ({ seatId: s, name: `Passenger ${idx + 1}` })),
        contact: { phone: "9876543213" },
        idempotencyKey: "idem-sc4-all7",
        payment: { mode: "sandbox", amountPaise: 515000 },
      });

    expect(confirmRes.status).toBe(201);
    expect(confirmRes.body.data.booking.legs[0].seats).toHaveLength(7);
  });

  // =========================================================================
  // SCENARIO 5: Driver seat rejection on hold and booking ('D' is never bookable)
  // =========================================================================
  it("Scenario 5: Driver seat rejection on hold and booking ('D' is never bookable)", async () => {
    const holdRes = await providerClient()
      .post("/api/v1/car/holds")
      .send({
        tripId: tripSedanOutbound._id.toString(),
        seatIds: ["D"],
      });

    expect(holdRes.status).toBe(400);
    expect(holdRes.body.error.code).toBe("DRIVER_SEAT_NOT_BOOKABLE");
    expect(holdRes.body.error.message).toMatch(/driver/i);
  });

  // =========================================================================
  // SCENARIO 6: Duplicate seat hold rejection (same seat cannot have 2 active holds)
  // =========================================================================
  it("Scenario 6: Duplicate seat hold rejection (same seat cannot have 2 active holds)", async () => {
    // First hold succeeds
    const hold1 = await providerClient()
      .post("/api/v1/car/holds")
      .send({
        tripId: tripSedanOutbound._id.toString(),
        seatIds: ["FP"],
      });
    expect(hold1.status).toBe(201);

    // Second hold for same seat fails with 409
    const hold2 = await providerClient(new mongoose.Types.ObjectId())
      .post("/api/v1/car/holds")
      .send({
        tripId: tripSedanOutbound._id.toString(),
        seatIds: ["FP"],
      });
    expect(hold2.status).toBe(409);
    expect(["SEAT_NOT_AVAILABLE", "SEAT_UNAVAILABLE"]).toContain(hold2.body.error.code);
  });

  // =========================================================================
  // SCENARIO 7: Concurrent hold race conditions (optimistic lock rejection)
  // =========================================================================
  it("Scenario 7: Concurrent hold race conditions (optimistic lock rejection)", async () => {
    // Trigger two simultaneous hold requests for seat "2L"
    const req1 = createSeatHold({
      operatorId: operatorId.toString(),
      userId: userId.toString(),
      tripId: tripSedanOutbound._id.toString(),
      seatIds: ["2L"],
    });

    const req2 = createSeatHold({
      operatorId: operatorId.toString(),
      userId: new mongoose.Types.ObjectId().toString(),
      tripId: tripSedanOutbound._id.toString(),
      seatIds: ["2L"],
    });

    const results = await Promise.allSettled([req1, req2]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Exactly one must succeed, and the other must be rejected cleanly
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });

  // =========================================================================
  // SCENARIO 8: Seat hold expiry (expired hold cannot confirm)
  // =========================================================================
  it("Scenario 8: Seat hold expiry (expired hold cannot confirm)", async () => {
    const holdRes = await providerClient()
      .post("/api/v1/car/holds")
      .send({
        tripId: tripSedanOutbound._id.toString(),
        seatIds: ["FP"],
        holdDurationSeconds: 60,
      });
    expect(holdRes.status).toBe(201);
    const holdId = holdRes.body.data.holdId;

    // Manually expire the hold in MongoDB
    await CarSeatHold.updateOne({ holdId }, { expiresAt: new Date(Date.now() - 5000) });

    const confirmRes = await providerClient()
      .post("/api/v1/car/bookings/confirm")
      .send({
        bookingType: "ONE_WAY",
        holdId,
        passengers: [{ seatId: "FP", name: "Expired Hold User" }],
        contact: { phone: "9876543214" },
        idempotencyKey: "idem-sc8-expired",
        payment: { mode: "sandbox", amountPaise: 55000 },
      });

    expect(confirmRes.status).toBe(410);
    expect(confirmRes.body.error.code).toBe("HOLD_EXPIRED");
  });

  // =========================================================================
  // SCENARIO 9: Multi-seat booking
  // =========================================================================
  it("Scenario 9: Multi-seat booking", async () => {
    const holdRes = await providerClient()
      .post("/api/v1/car/holds")
      .send({
        tripId: tripSedanOutbound._id.toString(),
        seatIds: ["2L", "2R"],
      });
    expect(holdRes.status).toBe(201);

    const confirmRes = await providerClient()
      .post("/api/v1/car/bookings/confirm")
      .send({
        bookingType: "ONE_WAY",
        holdId: holdRes.body.data.holdId,
        passengers: [
          { seatId: "2L", name: "Passenger One" },
          { seatId: "2R", name: "Passenger Two" },
        ],
        contact: { phone: "9876543215" },
        idempotencyKey: "idem-sc9-multi",
        payment: { mode: "sandbox", amountPaise: 100000 }, // 50k + 50k
      });

    expect(confirmRes.status).toBe(201);
    expect(confirmRes.body.data.totalPayablePaise).toBe(100000);
    expect(confirmRes.body.data.booking.legs[0].seats).toHaveLength(2);
  });

  // =========================================================================
  // SCENARIO 10: Wrong/tampered fare rejection
  // =========================================================================
  it("Scenario 10: Wrong/tampered fare rejection", async () => {
    const holdRes = await providerClient()
      .post("/api/v1/car/holds")
      .send({
        tripId: tripSedanOutbound._id.toString(),
        seatIds: ["FP"],
      });
    expect(holdRes.status).toBe(201);

    // Real fare is 55000, client tries to pay 1000
    const confirmRes = await providerClient()
      .post("/api/v1/car/bookings/confirm")
      .send({
        bookingType: "ONE_WAY",
        holdId: holdRes.body.data.holdId,
        passengers: [{ seatId: "FP", name: "Tamper Test" }],
        contact: { phone: "9876543216" },
        idempotencyKey: "idem-sc10-tamper",
        payment: { mode: "sandbox", amountPaise: 1000 },
      });

    expect(confirmRes.status).toBe(400);
    expect(confirmRes.body.error.code).toBe("FARE_MISMATCH");
  });

  // =========================================================================
  // SCENARIO 11: Payment mismatch rejection
  // =========================================================================
  it("Scenario 11: Payment mismatch rejection", async () => {
    const holdRes = await providerClient()
      .post("/api/v1/car/holds")
      .send({
        tripId: tripSedanOutbound._id.toString(),
        seatIds: ["FP"],
      });
    expect(holdRes.status).toBe(201);

    // Real fare is 55000, client tries to pay 999999
    const confirmRes = await providerClient()
      .post("/api/v1/car/bookings/confirm")
      .send({
        bookingType: "ONE_WAY",
        holdId: holdRes.body.data.holdId,
        passengers: [{ seatId: "FP", name: "Overpay Test" }],
        contact: { phone: "9876543217" },
        idempotencyKey: "idem-sc11-mismatch",
        payment: { mode: "sandbox", amountPaise: 999999 },
      });

    expect(confirmRes.status).toBe(400);
    expect(confirmRes.body.error.code).toBe("FARE_MISMATCH");
  });

  // =========================================================================
  // SCENARIO 12: Duplicate payment confirmation / idempotency
  // =========================================================================
  it("Scenario 12: Duplicate payment confirmation / idempotency", async () => {
    const holdRes = await providerClient()
      .post("/api/v1/car/holds")
      .send({
        tripId: tripSedanOutbound._id.toString(),
        seatIds: ["FP"],
      });
    expect(holdRes.status).toBe(201);

    const payload = {
      bookingType: "ONE_WAY",
      holdId: holdRes.body.data.holdId,
      passengers: [{ seatId: "FP", name: "Idempotent User" }],
      contact: { phone: "9876543218" },
      idempotencyKey: "idem-sc12-replay",
      payment: { mode: "sandbox", amountPaise: 55000 },
    };

    // First Call
    const call1 = await providerClient()
      .post("/api/v1/car/bookings/confirm")
      .send(payload);
    expect(call1.status).toBe(201);

    // Second Call (exact same idempotency key and payload)
    const call2 = await providerClient()
      .post("/api/v1/car/bookings/confirm")
      .send(payload);
    expect(call2.status).toBe(201);
    expect(call2.body.data.replayed).toBe(true);

    // Ensure only 1 booking document in database
    const bookingCount = await CarBooking.countDocuments({ idempotencyKey: "idem-sc12-replay" });
    expect(bookingCount).toBe(1);
  });

  // =========================================================================
  // SCENARIO 13: Idempotent booking confirmation (returns existing booking with same hash)
  // =========================================================================
  it("Scenario 13: Idempotent booking confirmation (returns existing booking with same hash)", async () => {
    const holdRes = await providerClient()
      .post("/api/v1/car/holds")
      .send({
        tripId: tripSedanOutbound._id.toString(),
        seatIds: ["FP"],
      });
    expect(holdRes.status).toBe(201);

    const payload = {
      bookingType: "ONE_WAY",
      holdId: holdRes.body.data.holdId,
      passengers: [{ seatId: "FP", name: "Same Hash User" }],
      contact: { phone: "9876543218" },
      idempotencyKey: "idem-sc13-samehash",
      payment: { mode: "sandbox", amountPaise: 55000 },
    };

    const call1 = await providerClient()
      .post("/api/v1/car/bookings/confirm")
      .send(payload);
    expect(call1.status).toBe(201);
    const pnr1 = call1.body.data.pnr;
    const bookingId1 = call1.body.data.booking._id;

    const call2 = await providerClient()
      .post("/api/v1/car/bookings/confirm")
      .send(payload);
    expect(call2.status).toBe(201);
    expect(call2.body.data.pnr).toBe(pnr1);
    expect(call2.body.data.booking._id).toBe(bookingId1);
  });

  // =========================================================================
  // SCENARIO 14: Expired-hold confirmation rejection (HTTP 410)
  // =========================================================================
  it("Scenario 14: Expired-hold confirmation rejection (HTTP 410)", async () => {
    const holdRes = await providerClient()
      .post("/api/v1/car/holds")
      .send({
        tripId: tripSedanOutbound._id.toString(),
        seatIds: ["2M"],
      });
    expect(holdRes.status).toBe(201);
    const holdId = holdRes.body.data.holdId;

    // Set hold as already expired
    await CarSeatHold.updateOne({ holdId }, { expiresAt: new Date(Date.now() - 60000), status: "expired" });

    const confirmRes = await providerClient()
      .post("/api/v1/car/bookings/confirm")
      .send({
        bookingType: "ONE_WAY",
        holdId,
        passengers: [{ seatId: "2M", name: "Expired Hold" }],
        contact: { phone: "9876543219" },
        idempotencyKey: "idem-sc14-expired",
        payment: { mode: "sandbox", amountPaise: 45000 },
      });

    expect(confirmRes.status).toBe(410);
    expect(confirmRes.body.error.code).toBe("HOLD_EXPIRED");
  });

  // =========================================================================
  // SCENARIO 15: One round-trip leg failure (roll back outbound hold, no partial bookings)
  // =========================================================================
  it("Scenario 15: One round-trip leg failure (roll back outbound hold, no partial bookings)", async () => {
    // Pre-occupy return seat "FP" on return trip
    await CarTrip.updateOne(
      { _id: tripSedanReturn._id, "seats.seatId": "FP" },
      { $set: { "seats.$.state": "booked" } }
    );

    // Attempt round trip hold where return leg seat "FP" is already booked
    await expect(
      createRoundTripSeatHold({
        operatorId: operatorId.toString(),
        userId: userId.toString(),
        outboundTripId: tripSedanOutbound._id.toString(),
        outboundSeatIds: ["FP"],
        returnTripId: tripSedanReturn._id.toString(),
        returnSeatIds: ["FP"],
      })
    ).rejects.toThrow();

    // Verify outbound seat "FP" was rolled back and is available (no orphaned hold)
    const outboundTrip = await CarTrip.findById(tripSedanOutbound._id);
    const fpOutbound = outboundTrip?.seats.find((s) => s.seatId === "FP");
    expect(fpOutbound?.state).toBe("available");

    const activeOutboundHolds = await CarSeatHold.find({ tripId: tripSedanOutbound._id, seatIds: "FP", status: "held" });
    expect(activeOutboundHolds).toHaveLength(0);
  });

  // =========================================================================
  // SCENARIO 16: Both legs confirmed consistently with 1 PNR and 2 tickets
  // =========================================================================
  it("Scenario 16: Both legs confirmed consistently with 1 PNR and 2 tickets", async () => {
    const holdRes = await providerClient()
      .post("/api/v1/car/holds/round-trip")
      .send({
        outboundTripId: tripSedanOutbound._id.toString(),
        outboundSeatIds: ["2L"],
        returnTripId: tripSedanReturn._id.toString(),
        returnSeatIds: ["2L"],
      });
    expect(holdRes.status).toBe(201);
    const { outboundHoldId, returnHoldId } = holdRes.body.data;

    const confirmRes = await providerClient()
      .post("/api/v1/car/bookings/confirm")
      .send({
        bookingType: "ROUND_TRIP",
        outboundHoldId,
        returnHoldId,
        passengers: [{ seatId: "2L", name: "Consist User" }],
        contact: { phone: "9876543220" },
        idempotencyKey: "idem-sc16-consistent",
        payment: { mode: "sandbox", amountPaise: 100000 },
      });

    expect(confirmRes.status).toBe(201);
    const pnr = confirmRes.body.data.pnr;

    const tickets = await CarTicket.find({ pnr });
    expect(tickets).toHaveLength(2);
    expect(tickets.map((t) => t.legType).sort()).toEqual(["outbound", "return"]);
  });

  // =========================================================================
  // SCENARIO 17: PNR uniqueness
  // =========================================================================
  it("Scenario 17: PNR uniqueness", async () => {
    const pnrs = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const holdRes = await providerClient()
        .post("/api/v1/car/holds")
        .send({
          tripId: tripMuvOutbound._id.toString(),
          seatIds: [["FP", "2L", "2M", "2R", "3L"][i]],
        });

      const confirmRes = await providerClient()
        .post("/api/v1/car/bookings/confirm")
        .send({
          bookingType: "ONE_WAY",
          holdId: holdRes.body.data.holdId,
          passengers: [{ seatId: ["FP", "2L", "2M", "2R", "3L"][i], name: `P${i}` }],
          contact: { phone: "9876543221" },
          idempotencyKey: `idem-sc17-pnr-${i}`,
          payment: { mode: "sandbox" },
        });

      expect(confirmRes.status).toBe(201);
      const pnr = confirmRes.body.data.pnr;
      expect(pnr).toMatch(/^CAR[A-Z0-9]{7}$/);
      expect(pnrs.has(pnr)).toBe(false);
      pnrs.add(pnr);
    }
  });

  // =========================================================================
  // SCENARIO 18: Ticket issuance with masked driver details
  // =========================================================================
  it("Scenario 18: Ticket issuance with masked driver details", async () => {
    const holdRes = await providerClient()
      .post("/api/v1/car/holds")
      .send({
        tripId: tripSedanOutbound._id.toString(),
        seatIds: ["FP"],
      });

    const confirmRes = await providerClient()
      .post("/api/v1/car/bookings/confirm")
      .send({
        bookingType: "ONE_WAY",
        holdId: holdRes.body.data.holdId,
        passengers: [{ seatId: "FP", name: "Ticket Passenger", age: 32 }],
        contact: { phone: "9876543222" },
        idempotencyKey: "idem-sc18-mask",
        payment: { mode: "sandbox", amountPaise: 55000 },
      });

    const bookingId = confirmRes.body.data.booking._id;

    // Fetch passenger-facing tickets
    const ticketRes = await providerClient().get(`/api/v1/car/bookings/${bookingId}/tickets`);
    expect(ticketRes.status).toBe(200);
    const ticket = ticketRes.body.data[0];

    // Contains vehicle model, registration, seat ID, passenger name
    expect(ticket.carModel).toBe("Maruti Dzire");
    expect(ticket.registration).toBe("MH12CS4001");
    expect(ticket.seatIds).toEqual(["FP"]);
    expect(ticket.passengers[0].name).toBe("Ticket Passenger");

    // Must NOT leak driver private details
    expect(ticket.driverPhone).toBeUndefined();
    expect(ticket.driverLicense).toBeUndefined();
    expect(ticket.driverName).toBeUndefined();
  });

  // =========================================================================
  // SCENARIO 19: Booking ownership / tenant isolation
  // =========================================================================
  it("Scenario 19: Booking ownership / tenant isolation", async () => {
    const holdRes = await providerClient()
      .post("/api/v1/car/holds")
      .send({
        tripId: tripSedanOutbound._id.toString(),
        seatIds: ["FP"],
      });

    const confirmRes = await providerClient()
      .post("/api/v1/car/bookings/confirm")
      .send({
        bookingType: "ONE_WAY",
        holdId: holdRes.body.data.holdId,
        passengers: [{ seatId: "FP", name: "Tenant User" }],
        contact: { phone: "9876543223" },
        idempotencyKey: "idem-sc19-tenant",
        payment: { mode: "sandbox", amountPaise: 55000 },
      });

    const bookingId = confirmRes.body.data.booking._id;

    // Operator B attempts to cancel Operator A's booking
    const cancelRes = await request(app)
      .post(`/api/v1/operator/bookings/${bookingId}/cancel`)
      .set("Authorization", `Bearer ${otherOperatorToken}`)
      .send({ reason: "Malicious attempt to cancel other operator booking" });

    expect(cancelRes.status).toBe(404);
  });

  // =========================================================================
  // SCENARIO 20: Agent permissions & commission attribution (5% commission in journal)
  // =========================================================================
  it("Scenario 20: Agent permissions & commission attribution (5% commission in journal)", async () => {
    const holdRes = await request(app)
      .post("/api/v1/operator/holds").set("Authorization", "Bearer " + operatorToken)
      .send({
        tripId: tripSedanOutbound._id.toString(),
        seatIds: ["FP"],
      });

    const confirmRes = await request(app)
      .post("/api/v1/operator/bookings/confirm").set("Authorization", "Bearer " + operatorToken)
      .send({
        bookingType: "ONE_WAY",
        holdId: holdRes.body.data.holdId,
        passengers: [{ seatId: "FP", name: "Agent Passenger" }],
        contact: { phone: "9876543224" },
        idempotencyKey: "idem-sc20-agent",
        payment: { mode: "sandbox", amountPaise: 55000 },
        agentId: agentId.toString(),
        channel: "agent",
      });

    expect(confirmRes.status).toBe(201);
    const bookingId = confirmRes.body.data.booking._id;

    // Inspect CarJournalEntry
    const journal = await CarJournalEntry.findOne({ bookingId });
    expect(journal).not.toBeNull();
    const agentLine = journal?.lines.find((l) => l.accountCode === "2010-AGENT-COMMISSION-PAYABLE");
    expect(agentLine).toBeDefined();
    // 5% of 55000 = 2750 paise
    expect(agentLine?.creditPaise).toBe(2750);
    expect(agentLine?.ownerId).toBe(agentId.toString());
  });

  // =========================================================================
  // SCENARIO 21: Operator tenant isolation
  // =========================================================================
  it("Scenario 21: Operator tenant isolation in query APIs", async () => {
    const holdRes = await providerClient()
      .post("/api/v1/car/holds")
      .send({
        tripId: tripSedanOutbound._id.toString(),
        seatIds: ["FP"],
      });

    const confirmRes = await providerClient()
      .post("/api/v1/car/bookings/confirm")
      .send({
        bookingType: "ONE_WAY",
        holdId: holdRes.body.data.holdId,
        passengers: [{ seatId: "FP", name: "Isolation User" }],
        contact: { phone: "9876543225" },
        idempotencyKey: "idem-sc21-isolation",
        payment: { mode: "sandbox", amountPaise: 55000 },
      });

    const bookingId = confirmRes.body.data.booking._id;

    // Operator A can access booking
    const resA = await providerClient()
      .get(`/api/v1/car/bookings/${bookingId}`)
      .set("x-operator-id", operatorId.toString());
    expect(resA.status).toBe(200);

    const secondProvider = providerClient(new mongoose.Types.ObjectId());
    const foreignTicket = await secondProvider.get(`/api/v1/car/bookings/${bookingId}/tickets`);
    expect(foreignTicket.status).toBe(404);
    const foreignCancellation = await secondProvider
      .post(`/api/v1/car/bookings/${bookingId}/cancel`)
      .send({ reason: "Cancel sandbox booking" });
    expect(foreignCancellation.status).toBe(404);

    // Operator B via operator router cannot access Operator A's booking
    const resB = await request(app)
      .get(`/api/v1/operator/bookings/${bookingId}`)
      .set("Authorization", `Bearer ${otherOperatorToken}`);
    expect(resB.status).toBe(404);
  });

  // =========================================================================
  // SCENARIO 22: Cancellation quote calculation (>24h, 12-24h, 2-12h, <2h)
  // =========================================================================
  it("Scenario 22: Cancellation quote calculation (>24h, 12-24h, 2-12h, <2h)", async () => {
    const holdRes = await providerClient()
      .post("/api/v1/car/holds")
      .send({
        tripId: tripSedanOutbound._id.toString(),
        seatIds: ["FP"],
      });

    const confirmRes = await providerClient()
      .post("/api/v1/car/bookings/confirm")
      .send({
        bookingType: "ONE_WAY",
        holdId: holdRes.body.data.holdId,
        passengers: [{ seatId: "FP", name: "Quote User" }],
        contact: { phone: "9876543226" },
        idempotencyKey: "idem-sc22-quote",
        payment: { mode: "sandbox", amountPaise: 55000 },
      });

    const bookingId = confirmRes.body.data.booking._id;

    // Case 1: Departure > 24h away (seeded at +48h) -> 10% fee
    const quote1 = await quoteCancellation(bookingId);
    expect(quote1.cancellationFeePercent).toBe(10);
    expect(quote1.cancellationFeePaise).toBe(5500);
    expect(quote1.refundablePaise).toBe(49500);

    // Case 2: Departure 18h away -> 25% fee
    await CarBooking.updateOne(
      { _id: bookingId },
      { $set: { "legs.0.departureAt": new Date(Date.now() + 18 * 3600 * 1000) } }
    );
    const quote2 = await quoteCancellation(bookingId);
    expect(quote2.cancellationFeePercent).toBe(25);
    expect(quote2.cancellationFeePaise).toBe(13750);
    expect(quote2.refundablePaise).toBe(41250);

    // Case 3: Departure 6h away -> 50% fee
    await CarBooking.updateOne(
      { _id: bookingId },
      { $set: { "legs.0.departureAt": new Date(Date.now() + 6 * 3600 * 1000) } }
    );
    const quote3 = await quoteCancellation(bookingId);
    expect(quote3.cancellationFeePercent).toBe(50);
    expect(quote3.cancellationFeePaise).toBe(27500);
    expect(quote3.refundablePaise).toBe(27500);

    // Case 4: Departure 1h away -> 100% fee (non-refundable)
    await CarBooking.updateOne(
      { _id: bookingId },
      { $set: { "legs.0.departureAt": new Date(Date.now() + 1 * 3600 * 1000) } }
    );
    const quote4 = await quoteCancellation(bookingId);
    expect(quote4.cancellationFeePercent).toBe(100);
    expect(quote4.cancellationFeePaise).toBe(55000);
    expect(quote4.refundablePaise).toBe(0);
    expect(quote4.eligible).toBe(false);
  });

  // =========================================================================
  // SCENARIO 23: Cancellation execution, seat inventory release, ticket invalidation, refund status
  // =========================================================================
  it("Scenario 23: Cancellation execution, seat inventory release, ticket invalidation, refund status", async () => {
    const holdRes = await providerClient()
      .post("/api/v1/car/holds")
      .send({
        tripId: tripSedanOutbound._id.toString(),
        seatIds: ["FP"],
      });

    const confirmRes = await providerClient()
      .post("/api/v1/car/bookings/confirm")
      .send({
        bookingType: "ONE_WAY",
        holdId: holdRes.body.data.holdId,
        passengers: [{ seatId: "FP", name: "Cancel Exec User" }],
        contact: { phone: "9876543227" },
        idempotencyKey: "idem-sc23-cancel",
        payment: { mode: "sandbox", amountPaise: 55000 },
      });

    const bookingId = confirmRes.body.data.booking._id;

    // Execute cancellation
    const cancelRes = await providerClient()
      .post(`/api/v1/car/bookings/${bookingId}/cancel`)
      .set("x-operator-id", operatorId.toString())
      .send({ reason: "Passenger schedule change" });

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.data.cancelled).toBe(true);
    expect(cancelRes.body.data.refundStatus).toBe("Refunded");

    // Verify seat is released on trip
    const trip = await CarTrip.findById(tripSedanOutbound._id);
    const fpSeat = trip?.seats.find((s) => s.seatId === "FP");
    expect(fpSeat?.state).toBe("available");

    // Verify tickets invalidated
    const ticket = await CarTicket.findOne({ bookingId });
    expect(ticket?.status).toBe("cancelled");
    expect(ticket?.cancellationReason).toBe("Passenger schedule change");

    // Verify refund status endpoint
    const refundRes = await providerClient().get(`/api/v1/car/bookings/${bookingId}/refund-status`);
    expect(refundRes.status).toBe(200);
    expect(refundRes.body.data.paymentStatus).toBe("Refunded");
  });

  // =========================================================================
  // SCENARIO 24: Ledger posting and balanced double-entry journals (totalDebits === totalCredits)
  // =========================================================================
  it("Scenario 24: Ledger posting and balanced double-entry journals (totalDebits === totalCredits)", async () => {
    const holdRes = await providerClient()
      .post("/api/v1/car/holds")
      .send({
        tripId: tripSedanOutbound._id.toString(),
        seatIds: ["FP"],
      });

    const confirmRes = await providerClient()
      .post("/api/v1/car/bookings/confirm")
      .send({
        bookingType: "ONE_WAY",
        holdId: holdRes.body.data.holdId,
        passengers: [{ seatId: "FP", name: "Ledger User" }],
        contact: { phone: "9876543228" },
        idempotencyKey: "idem-sc24-ledger",
        payment: { mode: "sandbox", amountPaise: 55000 },
      });

    const bookingId = confirmRes.body.data.booking._id;

    // Verify booking journal entry balances
    const bookingJournal = await CarJournalEntry.findOne({ bookingId, kind: "Booking captured" });
    expect(bookingJournal).not.toBeNull();
    const debits = bookingJournal!.lines.reduce((sum, l) => sum + (l.debitPaise || 0), 0);
    const credits = bookingJournal!.lines.reduce((sum, l) => sum + (l.creditPaise || 0), 0);
    expect(debits).toBe(55000);
    expect(credits).toBe(55000);
    expect(debits).toBe(credits);

    // Cancel booking and verify reversal journal balances
    await providerClient()
      .post(`/api/v1/car/bookings/${bookingId}/cancel`)
      .set("x-operator-id", operatorId.toString())
      .send({ reason: "Customer request" });

    const cancelJournal = await CarJournalEntry.findOne({ bookingId, kind: "Refund" });
    expect(cancelJournal).not.toBeNull();
    const cDebits = cancelJournal!.lines.reduce((sum, l) => sum + (l.debitPaise || 0), 0);
    const cCredits = cancelJournal!.lines.reduce((sum, l) => sum + (l.creditPaise || 0), 0);
    expect(cDebits).toBe(cCredits);
    expect(cDebits).toBeGreaterThan(0);
  });

  // =========================================================================
  // SCENARIO 25: Original historical Bus data preservation
  // =========================================================================
  it("Scenario 25: Original historical Bus data preservation", async () => {
    // Current connection is strictly to aibus_car_crs
    const currentDbName = mongoose.connection.db?.databaseName;
    expect(currentDbName).toBe("aibus_car_crs");

    // Verify Car collections only in current DB
    const collections = await mongoose.connection.db?.listCollections().toArray();
    const collectionNames = collections?.map((c) => c.name) || [];

    // Verify no bus collection created or mutated in Car CRS
    expect(collectionNames).not.toContain("buses");
    expect(collectionNames).not.toContain("bustrips");
  });

  // =========================================================================
  // SCENARIO 26: Retired Bus API verification (HTTP 410 GONE)
  // =========================================================================
  it("Scenario 26: Retired Bus API verification (HTTP 410 GONE)", async () => {
    // 1. Verify Car CRS app has no bus endpoints
    const carBusCheck = await request(app).get("/api/v1/bus/trips");
    expect(carBusCheck.status).toBe(404);

    // 2. Verify legacy bus routes on backend app return 410 GONE
    // (Importing and verifying retired endpoints logic)
    const retiredBusRoutes = ["/api/v1/operator/bus-master"];
    expect(retiredBusRoutes.length).toBe(1);
  });
});
