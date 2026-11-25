import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createCarCrsApp } from "../src/app.js";
import { Car } from "../src/models/car.model.js";
import { CarRoute } from "../src/models/car-route.model.js";
import { CarTrip } from "../src/models/car-trip.model.js";
import { CarSeatLayout } from "../src/models/car-seat-layout.model.js";
import { getStandard4PassengerLayout, getStandard7PassengerLayout } from "../src/services/car-layout.service.js";

describe("Car Search & Availability REST API (/api/v1/car)", () => {
  let mongo: MongoMemoryReplSet;
  const JWT_SECRET = "test-secret-key-car-crs-12345";
  const app = createCarCrsApp(JWT_SECRET);

  const operatorId = new mongoose.Types.ObjectId();
  let carSedanId: string;
  let carMuvId: string;
  let routeOutboundId: string;
  let routeReturnId: string;
  let trip1Id: string;
  let tripReturnId: string;

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
      binary: { version: "7.0.14" },
    });
    await mongoose.connect(mongo.getUri("aibus_car_crs"));

    // 1. Create Cars & Layouts
    const sedan = await Car.create({
      operatorId,
      registration: "MH12CS1111",
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
      name: "Sedan Layout",
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

    const muv = await Car.create({
      operatorId,
      registration: "MH14CM2222",
      make: "Toyota",
      modelName: "Innova",
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
      name: "MUV Layout",
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

    // 2. Create Routes: Pune <-> Mumbai
    const outboundRoute = await CarRoute.create({
      operatorId,
      source: "Pune",
      destination: "Mumbai",
      distanceKm: 150,
      estimatedDurationMinutes: 180,
      boarding: [{ name: "Swargate", address: "Pune" }, { name: "Wakad", address: "Highway" }],
      dropping: [{ name: "Vashi", address: "Navi Mumbai" }, { name: "Dadar", address: "Mumbai" }],
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

    // Create Outbound Trip: Pune -> Mumbai on 2026-12-10 (08:00 to 11:00)
    const trip1 = await CarTrip.create({
      operatorId,
      tripNumber: "TRIP-20261210-PUN-MUM-01",
      tripType: "ONE_WAY",
      carId: carSedanId,
      routeId: routeOutboundId,
      vehicleCategory: "4-Passenger Sedan",
      totalPhysicalSeats: 5,
      bookableCapacity: 4,
      journeyDate: "2026-12-10",
      departureAt: new Date("2026-12-10T08:00:00.000Z"),
      estimatedArrivalAt: new Date("2026-12-10T11:00:00.000Z"),
      turnaroundBufferMinutes: 30,
      status: "Scheduled",
      bookingOpen: true,
      seats: [
        {
          seatId: "D",
          label: "Driver",
          row: 1,
          column: 2,
          isDriver: true,
          isBookable: false,
          category: "driver",
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
          farePaise: 55000,
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
          farePaise: 50000,
          state: "booked", // already booked
        },
      ],
    });
    trip1Id = trip1._id.toString();

    // Create Return Trip: Mumbai -> Pune on 2026-12-12 (14:00 to 17:00)
    const tripReturn = await CarTrip.create({
      operatorId,
      tripNumber: "TRIP-20261212-MUM-PUN-01",
      tripType: "ONE_WAY",
      carId: carMuvId,
      routeId: routeReturnId,
      vehicleCategory: "7-Passenger MUV",
      totalPhysicalSeats: 8,
      bookableCapacity: 7,
      journeyDate: "2026-12-12",
      departureAt: new Date("2026-12-12T14:00:00.000Z"),
      estimatedArrivalAt: new Date("2026-12-12T17:00:00.000Z"),
      turnaroundBufferMinutes: 30,
      status: "Scheduled",
      bookingOpen: true,
      seats: [
        {
          seatId: "D",
          label: "Driver",
          row: 1,
          column: 3,
          isDriver: true,
          isBookable: false,
          category: "driver",
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
          farePaise: 82500,
          state: "available",
        },
        {
          seatId: "2L",
          label: "Middle Left",
          row: 2,
          column: 1,
          isDriver: false,
          isBookable: true,
          category: "window",
          farePaise: 75000,
          state: "available",
        },
        {
          seatId: "2M",
          label: "Middle Center",
          row: 2,
          column: 2,
          isDriver: false,
          isBookable: true,
          category: "middle",
          farePaise: 65000,
          state: "available",
        },
        {
          seatId: "2R",
          label: "Middle Right",
          row: 2,
          column: 3,
          isDriver: false,
          isBookable: true,
          category: "window",
          farePaise: 75000,
          state: "available",
        },
        {
          seatId: "3L",
          label: "Rear Left",
          row: 3,
          column: 1,
          isDriver: false,
          isBookable: true,
          category: "rear_window",
          farePaise: 70000,
          state: "available",
        },
        {
          seatId: "3M",
          label: "Rear Center",
          row: 3,
          column: 2,
          isDriver: false,
          isBookable: true,
          category: "middle",
          farePaise: 60000,
          state: "available",
        },
        {
          seatId: "3R",
          label: "Rear Right",
          row: 3,
          column: 3,
          isDriver: false,
          isBookable: true,
          category: "rear_window",
          farePaise: 70000,
          state: "available",
        },
      ],
    });
    tripReturnId = tripReturn._id.toString();
  });

  describe("Public Discovery APIs (GET /cities, GET /routes)", () => {
    it("returns active car cities", async () => {
      const res = await request(app).get("/api/v1/car/cities");
      expect(res.status).toBe(200);
      expect(res.body.data).toContain("Pune");
      expect(res.body.data).toContain("Mumbai");
    });

    it("returns active routes with boarding and dropping stops", async () => {
      const res = await request(app).get("/api/v1/car/routes?source=Pune");
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].destination).toBe("Mumbai");
      expect(res.body.data[0].boarding).toHaveLength(2);
    });
  });

  describe("One Way Search API (GET /trips/search)", () => {
    it("returns available scheduled car trips with seat count and starting fare in integer paise", async () => {
      const res = await request(app)
        .get("/api/v1/car/trips/search")
        .query({
          source: "Pune",
          destination: "Mumbai",
          journeyDate: "2026-12-10",
          passengerCount: 2,
        });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);

      const trip = res.body.data[0];
      expect(trip.tripNumber).toBe("TRIP-20261210-PUN-MUM-01");
      expect(trip.vehicleCategory).toBe("4-Passenger Sedan");
      expect(trip.bookableCapacity).toBe(4);
      expect(trip.availableSeatsCount).toBe(3); // FP, 2L, 2M (2R is booked, D is driver)
      expect(trip.minFarePaise).toBe(45000); // 2M middle seat is cheapest
      expect(trip.maxFarePaise).toBe(55000); // FP front passenger is premium
    });

    it("filters out trips when requested passengers exceed available seats", async () => {
      const res = await request(app)
        .get("/api/v1/car/trips/search")
        .query({
          source: "Pune",
          destination: "Mumbai",
          journeyDate: "2026-12-10",
          passengerCount: 4, // Only 3 seats are available
        });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });
  });

  describe("Round Trip Search API (POST /trips/round-trip-search)", () => {
    it("returns separate outbound and return trip options", async () => {
      const res = await request(app)
        .post("/api/v1/car/trips/round-trip-search")
        .send({
          source: "Pune",
          destination: "Mumbai",
          outboundDate: "2026-12-10",
          returnDate: "2026-12-12",
          passengerCount: 1,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.outboundTrips).toHaveLength(1);
      expect(res.body.data.returnTrips).toHaveLength(1);

      expect(res.body.data.outboundTrips[0].route.source).toBe("Pune");
      expect(res.body.data.outboundTrips[0].route.destination).toBe("Mumbai");

      expect(res.body.data.returnTrips[0].route.source).toBe("Mumbai");
      expect(res.body.data.returnTrips[0].route.destination).toBe("Pune");
    });

    it("rejects round trip search when returnDate is before outboundDate", async () => {
      const res = await request(app)
        .post("/api/v1/car/trips/round-trip-search")
        .send({
          source: "Pune",
          destination: "Mumbai",
          outboundDate: "2026-12-15",
          returnDate: "2026-12-10", // Invalid: return before outbound
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("Seat Inventory Availability (GET /trips/:id/seats)", () => {
    it("returns real-time seat inventory with Driver seat locked non-bookable", async () => {
      const res = await request(app).get(`/api/v1/car/trips/${trip1Id}/seats`);

      expect(res.status).toBe(200);
      const inventory = res.body.data;
      expect(inventory.vehicleCategory).toBe("4-Passenger Sedan");
      expect(inventory.seats).toHaveLength(5);

      // Driver seat check
      const driver = inventory.seats.find((s: any) => s.seatId === "D");
      expect(driver).toBeDefined();
      expect(driver.isDriver).toBe(true);
      expect(driver.isBookable).toBe(false);
      expect(driver.state).toBe("non_bookable");

      // Passenger seat states
      const fp = inventory.seats.find((s: any) => s.seatId === "FP");
      expect(fp.state).toBe("available");
      expect(fp.farePaise).toBe(55000);

      const seat2R = inventory.seats.find((s: any) => s.seatId === "2R");
      expect(seat2R.state).toBe("booked");
    });
  });

  describe("Authoritative Backend Fare Quote (POST /fares/quote)", () => {
    it("computes authoritative fare quote for One Way trip in integer paise", async () => {
      const res = await request(app)
        .post("/api/v1/car/fares/quote")
        .send({
          outboundTripId: trip1Id,
          outboundSeatIds: ["FP", "2L"],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.bookingType).toBe("ONE_WAY");
      expect(res.body.data.outbound.seats).toHaveLength(2);
      expect(res.body.data.outbound.subtotalPaise).toBe(105000); // 55000 + 50000
      expect(res.body.data.grandTotalPaise).toBe(105000);
    });

    it("computes combined round-trip fare quote with independent legs", async () => {
      const res = await request(app)
        .post("/api/v1/car/fares/quote")
        .send({
          outboundTripId: trip1Id,
          outboundSeatIds: ["FP"], // 55000
          returnTripId: tripReturnId,
          returnSeatIds: ["2L", "2R"], // 75000 + 75000 = 150000
        });

      expect(res.status).toBe(200);
      expect(res.body.data.bookingType).toBe("ROUND_TRIP");
      expect(res.body.data.outbound.subtotalPaise).toBe(55000);
      expect(res.body.data.return.subtotalPaise).toBe(150000);
      expect(res.body.data.grandTotalPaise).toBe(205000); // 55000 + 150000
    });

    it("rejects fare quote if customer attempts to book the Driver seat", async () => {
      const res = await request(app)
        .post("/api/v1/car/fares/quote")
        .send({
          outboundTripId: trip1Id,
          outboundSeatIds: ["D"], // Attempt to select driver seat
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("SEAT_NOT_BOOKABLE");
    });

    it("rejects fare quote if requested seat is already booked", async () => {
      const res = await request(app)
        .post("/api/v1/car/fares/quote")
        .send({
          outboundTripId: trip1Id,
          outboundSeatIds: ["2R"], // Already booked
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("SEAT_UNAVAILABLE");
    });
  });
});
