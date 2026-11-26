import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { readConfig } from "../../src/config/env.js";
import * as M from "../../src/models/index.js";
import { hashPassword } from "../../src/modules/auth/index.js";
import { createHold, createBooking, confirmDirectBooking } from "../../src/services/inventory.service.js";
import { rolePermissions, type Principal } from "../../src/utils/core.js";

let mongo: MongoMemoryReplSet;
const config = readConfig({
  NODE_ENV: "test",
  MONGODB_URI: "mongodb://127.0.0.1/car_trip_test",
  JWT_SECRET: "c".repeat(64),
  WEB_ORIGIN: "http://127.0.0.1:5173",
});
const limiter = { check: async () => true };
const app = createApp(config, limiter, async () => true);

describe("Operator Car Trip Master Scheduling Integration", () => {
  let operator: any;
  let token: string;
  let carSedan: any;
  let carMuv: any;
  let route: any;

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
      binary: { version: "7.0.14" },
    });
    await mongoose.connect(mongo.getUri("car_trip_test"));
    await Promise.all(Object.values(mongoose.models).map(model => model.init()));

    const passwordHash = await hashPassword("SecurePass123!");

    operator = await M.Operator.create({
      company: "Car CRS Travels",
      email: "ops@carcrs.test",
      status: "approved",
    });

    await M.User.create({
      operatorId: operator._id,
      name: "Ops Admin",
      email: "ops@carcrs.test",
      passwordHash,
      role: "operator_admin",
      active: true,
    });

    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "ops@carcrs.test", password: "SecurePass123!" });
    token = login.body.data.accessToken;

    carSedan = await M.Car.create({
      operatorId: operator._id,
      registrationNumber: "CG-04-MG-2001",
      registration: "CG04MG2001",
      make: "Maruti",
      model: "Dzire",
      modelName: "Dzire",
      vehicleCategory: "4-Passenger Sedan",
      category: "4-Passenger Sedan",
      totalPhysicalSeats: 5,
      bookablePassengerCapacity: 4,
      status: "Active",
    });

    carMuv = await M.Car.create({
      operatorId: operator._id,
      registrationNumber: "MH-02-CD-5678",
      registration: "MH02CD5678",
      make: "Toyota",
      model: "Innova",
      modelName: "Innova",
      vehicleCategory: "7-Passenger MUV",
      category: "7-Passenger MUV",
      totalPhysicalSeats: 8,
      bookablePassengerCapacity: 7,
      status: "Active",
    });

    route = await M.Route.create({
      operatorId: operator._id,
      source: "Raipur",
      destination: "Bilaspur",
      boarding: [{ name: "Raipur Station", time: "08:00" }],
      dropping: [{ name: "Bilaspur Stand", time: "12:00" }],
      departure: "08:00",
      arrival: "12:00",
      durationMinutes: 240,
      status: "Active",
    });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  it("saves and schedules a 12-passenger mini bus using its own seat layout", async () => {
    const auth = `Bearer ${token}`;
    const vehicle = await request(app).post("/api/v1/operator/cars").set("Authorization", auth).send({
      registrationNumber: "CG04MB1200", make: "Force", model: "Traveller",
      vehicleCategory: "Mini Bus", totalPhysicalSeats: 13, bookablePassengerCapacity: 12,
    });
    expect(vehicle.status).toBe(201);
    const carId = vehicle.body.data._id;
    const payload = {
      carId, routeId: String(route._id), journeyDate: "2030-12-02",
      departureAt: "2030-12-02T08:00:00+05:30", arrivalAt: "2030-12-02T12:00:00+05:30",
      baseFarePaise: 45000,
    };
    expect((await request(app).post("/api/v1/operator/trips").set("Authorization", auth).send(payload)).body.error.code).toBe("LAYOUT_REQUIRED");
    const seats = [{ number: "D", row: 0, column: 3 }, ...Array.from({ length: 12 }, (_, index) => ({
      number: `CS-${index + 1}`, row: 1 + Math.floor(index / 4), column: index % 4,
    }))];
    const saved = await request(app).put(`/api/v1/operator/cars/${carId}/layout`).set("Authorization", auth).send({ seats });
    expect(saved.status).toBe(200);
    expect(saved.body.data.seatLayout).toEqual(seats);
    const template = await request(app).post("/api/v1/operator/vehicle-layouts").set("Authorization", auth)
      .send({ name: "Traveller 12", vehicleType: "Mini Bus", seats });
    expect(template.status).toBe(201);
    const fromTemplate = {
      registrationNumber: "CG04MB1201", make: "Force", model: "Traveller", layoutTemplateId: template.body.data._id,
      totalPhysicalSeats: 5, bookablePassengerCapacity: 4,
    };
    const mismatch = await request(app).post("/api/v1/operator/cars").set("Authorization", auth)
      .send({ ...fromTemplate, vehicleCategory: "Bus" });
    expect(mismatch.body.error.code).toBe("LAYOUT_TYPE_MISMATCH");
    const assigned = await request(app).post("/api/v1/operator/cars").set("Authorization", auth)
      .send({ ...fromTemplate, vehicleCategory: "Mini Bus" });
    expect(assigned.status).toBe(201);
    expect(assigned.body.data).toMatchObject({ seatLayout: seats, totalPhysicalSeats: 13, bookablePassengerCapacity: 12 });
    const templatePath = `/api/v1/operator/vehicle-layouts/${template.body.data._id}`;
    expect((await request(app).delete(templatePath).set("Authorization", auth)).status).toBe(200);
    const remaining = await request(app).get("/api/v1/operator/vehicle-layouts").set("Authorization", auth);
    expect(remaining.body.data.map((layout: { _id: string }) => layout._id)).not.toContain(template.body.data._id);
    expect(await M.Car.findById(assigned.body.data._id).lean()).toMatchObject({ seatLayout: seats });
    const trip = await request(app).post("/api/v1/operator/trips").set("Authorization", auth).send(payload);
    expect(trip.status).toBe(201);
    const stored = await M.Trip.findById(trip.body.data._id).lean();
    expect(stored).toMatchObject({ vehicleCategory: "Mini Bus", bookableCapacity: 12, totalPhysicalSeats: 13 });
    expect(stored?.seats).toHaveLength(13);
    expect(stored?.seats).toEqual(expect.arrayContaining([
      expect.objectContaining({ number: "D", state: "blocked", isBookable: false }),
      expect.objectContaining({ number: "CS-12", row: 3, column: 3, farePaise: 45000, state: "available" }),
    ]));
  });

  it("should successfully schedule a 4-Passenger Sedan car trip with 5 physical seats (1 driver + 4 pax)", async () => {
    const journeyDate = "2030-11-28";
    const departureAt = "2030-11-28T08:00:00+05:30";
    const estimatedArrivalAt = "2030-11-28T12:00:00+05:30";

    const res = await request(app)
      .post("/api/v1/operator/trips")
      .set("Authorization", `Bearer ${token}`)
      .send({
        carId: String(carSedan._id),
        routeId: String(route._id),
        journeyDate,
        departureAt,
        estimatedArrivalAt,
        tripType: "ONE_WAY",
        baseFareRupees: 500,
        status: "Scheduled",
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.carId).toBe(String(carSedan._id));
    expect(res.body.data.bookableCapacity).toBe(4);
    expect(res.body.data.totalPhysicalSeats).toBe(5);
    expect(res.body.data.status).toBe("Scheduled");

    // Verify seats snapshot: exactly 1 driver seat + 4 bookable seats
    const seats = res.body.data.seats;
    expect(seats).toHaveLength(5);

    const driverSeat = seats.find((s: any) => s.number === "D" || s.isDriver);
    expect(driverSeat).toBeDefined();
    expect(driverSeat.isDriver).toBe(true);
    expect(driverSeat.state).toBe("blocked");
    expect(driverSeat.farePaise).toBe(0);

    const frontPax = seats.find((s: any) => s.number === "FP");
    expect(frontPax).toBeDefined();
    expect(frontPax.isBookable).toBe(true);
    expect(frontPax.state).toBe("available");
    // Front passenger has 10% premium: 500 * 1.1 = 550 rupees = 55000 paise
    expect(frontPax.farePaise).toBe(55000);

    const midPax = seats.find((s: any) => s.number === "2M");
    expect(midPax).toBeDefined();
    // Middle seat has 10% discount: 500 * 0.9 = 450 rupees = 45000 paise
    expect(midPax.farePaise).toBe(45000);
  });

  it("should successfully schedule a 7-Passenger MUV car trip with 8 physical seats (1 driver + 7 pax)", async () => {
    const journeyDate = "2030-11-29";
    const departureAt = "2030-11-29T09:00:00+05:30";
    const estimatedArrivalAt = "2030-11-29T14:00:00+05:30";

    const res = await request(app)
      .post("/api/v1/operator/trips")
      .set("Authorization", `Bearer ${token}`)
      .send({
        carId: String(carMuv._id),
        routeId: String(route._id),
        journeyDate,
        departureAt,
        estimatedArrivalAt,
        tripType: "ROUND_TRIP",
        baseFareRupees: 800,
        status: "Draft",
      });

    expect(res.status).toBe(201);
    expect(res.body.data.bookableCapacity).toBe(7);
    expect(res.body.data.totalPhysicalSeats).toBe(8);
    expect(res.body.data.status).toBe("Draft");

    const seats = res.body.data.seats;
    expect(seats).toHaveLength(8);

    const tripId = res.body.data._id;

    // Test publishing Draft trip
    const pubRes = await request(app)
      .post(`/api/v1/operator/trips/${tripId}/publish`)
      .set("Authorization", `Bearer ${token}`);

    expect(pubRes.status).toBe(200);
    expect(pubRes.body.data.status).toBe("Scheduled");
    expect(pubRes.body.data.bookingOpen).toBe(true);

    // Test close sales
    const closeRes = await request(app)
      .post(`/api/v1/operator/trips/${tripId}/close-sales`)
      .set("Authorization", `Bearer ${token}`);

    expect(closeRes.status).toBe(200);
    expect(closeRes.body.data.bookingOpen).toBe(false);
  });

  it("rejects a missing owned route instead of inventing operational stop data", async () => {
 const count=await M.Route.countDocuments({operatorId:operator._id});
 const res=await request(app).post("/api/v1/operator/trips").set("Authorization", "Bearer "+token).send({carId:String(carSedan._id),routeName:"Durg → Jagdalpur",journeyDate:"2030-11-30",departureAt:"2030-11-30T10:00:00+05:30",estimatedArrivalAt:"2030-11-30T14:00:00+05:30",baseFareRupees:650});
 expect(res.status).toBe(404);expect(await M.Route.countDocuments({operatorId:operator._id})).toBe(count);
 });

  it("should reject scheduling overlapping trip for the same car", async () => {
    const journeyDate = "2030-11-28";
    const departureAt = "2030-11-28T09:00:00+05:30"; // overlaps with 08:00 - 12:00
    const estimatedArrivalAt = "2030-11-28T13:00:00+05:30";

    const res = await request(app)
      .post("/api/v1/operator/trips")
      .set("Authorization", `Bearer ${token}`)
      .send({
        carId: String(carSedan._id),
        routeId: String(route._id),
        journeyDate,
        departureAt,
        estimatedArrivalAt,
        tripType: "ONE_WAY",
        baseFareRupees: 500,
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CAR_SCHEDULE_CONFLICT");
  });

  it("should list operator car trips with availableSeatsCount populated", async () => {
    const res = await request(app)
      .get("/api/v1/operator/trips")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);

    const trip = res.body.data[0];
    expect(trip.availableSeatsCount).toBeDefined();
    expect(typeof trip.availableSeatsCount).toBe("number");
  });

  it("books a real scheduled car passenger seat once and refuses the driver seat", async () => {
    const trip:any=await M.Trip.findOne({carId:carSedan._id,status:"Scheduled"}).lean();
    const user=await M.User.findOne({operatorId:operator._id});
    const auth:Principal={operatorId:String(operator._id),userId:String(user!._id),role:"operator_admin",permissions:rolePermissions.operator_admin,sessionId:"isolated-car-booking"};
    await M.PricingPolicy.create({operatorId:operator._id,taxBasisPoints:0,chargePaise:0,chargesTaxable:false,operatorDiscountMaxPaise:0,requireAge:false,requireGender:false,requireMobile:false,gstEnabled:false,version:1});
    await expect(createHold(auth,String(trip._id),["D"])).rejects.toMatchObject({code:"SEAT_UNAVAILABLE"});
    const hold:any=await createHold(auth,String(trip._id),["FP"]);
    const booking:any=await createBooking(
      auth,
      {
        tripId: String(trip._id),
        holdId: hold.holdId,
        passengers: [{ seat: "FP", name: "Car test passenger" }],
      },
      "car-full-booking-test-key",
      "customer",
    );
    expect(booking.totalPaise).toBe(55000);expect(booking.status).toBe("Pending payment");
    const confirmed=await confirmDirectBooking(auth,String(booking._id));
    expect(confirmed.status).toBe("Confirmed");expect(confirmed.pnr).toBeTruthy();
    await expect(createHold(auth,String(trip._id),["FP"])).rejects.toMatchObject({code:"SEAT_UNAVAILABLE"});
    expect(await M.Ticket.countDocuments({bookingId:booking._id})).toBe(1);
    expect(await M.JournalEntry.countDocuments({bookingId:booking._id})).toBe(1);
  });
});
