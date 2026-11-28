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

  it("provisions a separate owner session and preserves trip ownership after vehicle reassignment", async () => {
    const auth = `Bearer ${token}`;
    const first = await M.FleetOwner.create({ operatorId: operator._id, name: "Vehicle Owner A" });
    const password = "SecureOwner123!";
    const register = (body: { ownerId?: string; name?: string; email: string }) =>
      request(app).post("/api/v1/operator/vehicle-owners").set("Authorization", auth).send({ ...body, password });
    const firstEmail = "owner-a@carcrs.test";
    const firstLogin = await register({ ownerId: String(first._id), email: firstEmail });
    expect(firstLogin.status).toBe(201);
    const secondEmail = "owner-b@carcrs.test";
    const second = await register({ name: "Vehicle Owner B", email: secondEmail });
    expect(second.status).toBe(201);
    const ownerA = firstLogin.body.data.id, ownerB = second.body.data.id;
    const foreign = await M.Operator.create({ company: "Other fleet", email: "other-fleet@carcrs.test", status: "approved" });
    const foreignOwner = await M.FleetOwner.create({ operatorId: foreign._id, name: "Foreign owner" });
    const assign = (ownerId: string | null, expectedOwnerId: string | null) =>
      request(app).patch(`/api/v1/operator/cars/${carSedan._id}/owner`).set("Authorization", auth)
        .send({ ownerId, expectedOwnerId });
    expect((await assign(String(foreignOwner._id), null)).status).toBe(404);
    expect((await assign(ownerA, null)).status).toBe(200);
    const schedule = (day: string) => request(app).post("/api/v1/operator/trips").set("Authorization", auth).send({
      carId: String(carSedan._id), routeId: String(route._id), journeyDate: day,
      departureAt: `${day}T08:00:00+05:30`, arrivalAt: `${day}T12:00:00+05:30`, baseFarePaise: 45000,
    });
    const before = await schedule("2031-12-09");
    expect(before.status).toBe(201);
    expect((await assign(ownerB, null)).status).toBe(409);
    expect((await assign(ownerB, ownerA)).status).toBe(200);
    const after = await schedule("2031-12-10");
    expect(after.status).toBe(201);
    const login = (email: string) => request(app).post("/api/v1/auth/login").set("X-Aibus-Client", "owner")
      .set("Origin", "http://127.0.0.1:5177").send({ email, password });
    const a = await login(firstEmail), b = await login(secondEmail);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.headers["set-cookie"][0]).toContain("aibus_owner_refresh=");
    const aToken = `Bearer ${a.body.data.accessToken}`, bToken = `Bearer ${b.body.data.accessToken}`;
    const overview = "/api/v1/owner/overview?from=2031-12-09&to=2031-12-10";
    const viewA = await request(app).get(overview).set("Authorization", aToken);
    const viewB = await request(app).get(overview).set("Authorization", bToken);
    expect(viewA.status).toBe(200);
    expect(viewA.body.data.vehicles).toEqual([]);
    expect(viewA.body.data.trips).toEqual([expect.objectContaining({ id: before.body.data._id, capacity: 4, bookedSeats: 0 })]);
    expect(viewB.body.data.vehicles).toEqual([expect.objectContaining({ id: String(carSedan._id) })]);
    expect(viewB.body.data.trips).toEqual([expect.objectContaining({ id: after.body.data._id })]);
    expect(viewB.body.data.trips[0]).not.toHaveProperty("seats");
    expect((await request(app).get(overview + `&ownerId=${ownerB}`).set("Authorization", aToken)).status).toBe(400);
    expect((await request(app).get("/api/v1/operator/cars").set("Authorization", bToken)).status).toBe(403);
    expect((await request(app).get(overview).set("Authorization", auth)).status).toBe(403);
    expect((await request(app).post("/api/v1/auth/login").send({ email: firstEmail, password })).status).toBe(403);
  });

  it("persists amenities and reschedules an empty departure using its current version", async () => {
    const auth = `Bearer ${token}`;
    const payload = {
      carId: String(carSedan._id), routeId: String(route._id), journeyDate: "2031-12-02",
      departureAt: "2031-12-02T08:00:00+05:30", arrivalAt: "2031-12-02T12:00:00+05:30",
      baseFarePaise: 45000, amenities: ["AC", "USB charging"],
    };
    const created = await request(app).post("/api/v1/operator/trips").set("Authorization", auth).send(payload);
    expect(created.status).toBe(201);
    expect(created.body.data.amenities).toEqual(payload.amenities);
    const path = `/api/v1/operator/trips/${created.body.data._id}`;
    const updated = await request(app).patch(`${path}/amenities`).set("Authorization", auth)
      .send({ amenities: ["AC", "Wi-Fi"], expectedVersion: 0 });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toEqual({ amenities: ["AC", "Wi-Fi"], version: 1 });
    const timing = { departureAt: "2031-12-02T09:00:00+05:30", arrivalAt: "2031-12-02T13:00:00+05:30" };
    expect((await request(app).patch(`${path}/schedule`).set("Authorization", auth)
      .send({ ...timing, expectedVersion: 0 })).status).toBe(409);
    const changed = await request(app).patch(`${path}/schedule`).set("Authorization", auth)
      .send({ ...timing, expectedVersion: 1 });
    expect(changed.status).toBe(200);
    expect(changed.body.data).toMatchObject({ departureAt: "2031-12-02T03:30:00.000Z", version: 2 });
    const saved = await request(app).get(path).set("Authorization", auth);
    expect(saved.body.data.amenities).toEqual(["AC", "Wi-Fi"]);
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

  it("creates a route with viaLabel and viaStops and saves segmentFares on trips", async () => {
    const routeRes = await request(app)
      .post("/api/v1/operator/routes")
      .set("Authorization", `Bearer ${token}`)
      .send({
        source: "Pune",
        destination: "Mumbai",
        departure: "08:00",
        arrival: "11:00",
        durationMinutes: 180,
        distanceKm: 150,
        viaLabel: "NH01",
        viaStops: [
          { city: "Lonavla", distanceKm: 50, durationMinutes: 70 },
          { city: "Thana", distanceKm: 120, durationMinutes: 120 },
        ],
        boarding: [{ name: "Pune Main Stand", time: "08:00" }],
        dropping: [{ name: "M Bus Stand", time: "11:00" }],
        status: "Active",
      });
    expect(routeRes.status).toBe(201);
    expect(routeRes.body.data.viaLabel).toBe("NH01");
    expect(routeRes.body.data.viaStops).toHaveLength(2);

    const trip: any = await M.Trip.findOne({ carId: carSedan._id, status: "Scheduled" }).lean();
    const fareRes = await request(app)
      .patch(`/api/v1/operator/trips/${trip._id}/seat-fares`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        segmentFares: [
          { fromCity: "Pune", toCity: "Lonavla", distanceKm: 50, farePaise: 20000 },
          { fromCity: "Pune", toCity: "Mumbai", distanceKm: 150, farePaise: 50000 },
        ],
      });
    expect(fareRes.status).toBe(200);
    expect(fareRes.body.data.segmentFares).toHaveLength(2);

    const viaTripRes = await request(app)
      .post("/api/v1/operator/trips")
      .set("Authorization", `Bearer ${token}`)
      .send({
        carId: String(carSedan._id),
        routeId: routeRes.body.data._id,
        journeyDate: "2030-12-05",
        departureAt: "2030-12-05T08:00:00+05:30",
        estimatedArrivalAt: "2030-12-05T11:00:00+05:30",
        tripType: "ONE_WAY",
        baseFareRupees: 450,
        status: "Scheduled",
      });
    expect(viaTripRes.status).toBe(201);

    await request(app)
      .patch(`/api/v1/operator/trips/${viaTripRes.body.data._id}/seat-fares`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        segmentFares: [
          { fromCity: "Pune", toCity: "Thana", distanceKm: 120, farePaise: 36000 },
          { fromCity: "Pune", toCity: "Mumbai", distanceKm: 150, farePaise: 45000 },
        ],
      });

    const matchSearch = await request(app)
      .get("/api/v1/operator/counter/trips?from=pune&to=thana&journeyDate=2030-12-05")
      .set("Authorization", `Bearer ${token}`);
    expect(matchSearch.status).toBe(200);
    expect(matchSearch.body.data).toHaveLength(1);
    expect(matchSearch.body.data[0].matchedSegment).toEqual({
      fromCity: "Pune",
      toCity: "Thana",
      farePaise: 36000,
    });
    expect(matchSearch.body.data[0].baseFarePaise).toBe(36000);

    const reverseSearch = await request(app)
      .get("/api/v1/operator/counter/trips?from=thana&to=pune&journeyDate=2030-12-05")
      .set("Authorization", `Bearer ${token}`);
    expect(reverseSearch.status).toBe(200);
    expect(reverseSearch.body.data).toHaveLength(0);

    const savedCities = await M.City.find({ operatorId: operator._id }).lean();
    const savedNames = savedCities.map((c: any) => c.name);
    expect(savedNames).toEqual(
      expect.arrayContaining(["Pune", "Lonavla", "Thana", "Mumbai"]),
    );

    const citiesRes = await request(app)
      .get("/api/v1/operator/counter/cities")
      .set("Authorization", `Bearer ${token}`);
    expect(citiesRes.status).toBe(200);
    expect(citiesRes.body.data.cities).toEqual(
      expect.arrayContaining(["Pune", "Lonavla", "Thana", "Mumbai"]),
    );
    expect(citiesRes.body.data.destinationsByOrigin.pune).toEqual(
      expect.arrayContaining(["Lonavla", "Thana", "Mumbai"]),
    );
  });
});
