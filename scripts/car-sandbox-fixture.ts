import { createHash } from "node:crypto";
import { Car } from "../car-crs/src/models/car.model.js";
import { CarRoute } from "../car-crs/src/models/car-route.model.js";
import { CarSeatLayout } from "../car-crs/src/models/car-seat-layout.model.js";
import { CarTrip } from "../car-crs/src/models/car-trip.model.js";
import { getStandard4PassengerLayout } from "../car-crs/src/services/car-layout.service.js";

// Stable IDs let two runs reuse the same fixtures without resetting used seats.
const fixtureId = (name: string) =>
  createHash("sha256").update("aicar-local-postman:" + name).digest("hex").slice(0, 24);

export async function prepareSampleTrips() {
  const operatorId = fixtureId("operator");
  const providerId = fixtureId("provider");
  const carId = fixtureId("sedan");
  const layoutId = fixtureId("sedan-layout");
  const category = "4-Passenger Sedan";
  const seats = getStandard4PassengerLayout("RHD", 50000);
  await Car.updateOne({ _id: carId, operatorId }, { $setOnInsert: {
    registration: "MH12DE5001", make: "Demo", modelName: "Local sedan", category,
    totalPhysicalSeats: 5, advertisedCapacity: 5, bookablePassengerCapacity: 4,
    driverSeatsCount: 1, activeLayoutId: layoutId,
  } }, { upsert: true });
  await CarSeatLayout.updateOne({ _id: layoutId, operatorId }, { $setOnInsert: {
    carId, name: "Demo sedan layout", vehicleCategory: category, seats, version: 1,
    totalPhysicalSeats: 5, bookablePassengerCapacity: 4, driveOrientation: "RHD", status: "Active",
  } }, { upsert: true });

  const futureDate = (days: number) =>
    new Date(Date.now() + days * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const journeyDate = futureDate(7);
  const returnDate = futureDate(8);
  for (const [source, destination, date] of [
    ["Pune", "Mumbai", journeyDate], ["Mumbai", "Pune", returnDate],
  ]) {
    const routeId = fixtureId(source + destination);
    await CarRoute.updateOne({ _id: routeId, operatorId }, { $setOnInsert: {
      source, destination, status: "Active", distanceKm: 150, estimatedDurationMinutes: 180,
      boarding: [{ name: source + " demo pickup" }], dropping: [{ name: destination + " demo drop" }],
    } }, { upsert: true });
    const departureAt = new Date(date + "T09:00:00+05:30");
    const estimatedArrivalAt = new Date(+departureAt + 3 * 3600000);
    await CarTrip.updateOne({ _id: fixtureId(source + date), operatorId }, { $setOnInsert: {
      tripNumber: "DEMO-" + source.toUpperCase() + "-" + date, carId, routeId, layoutId,
      vehicleCategory: category, journeyDate: date, departureAt, estimatedArrivalAt,
      tripType: "ONE_WAY", turnaroundBufferMinutes: 30, revision: 1,
      effectiveArrivalAt: new Date(+estimatedArrivalAt + 1800000), status: "Scheduled", bookingOpen: true,
      totalPhysicalSeats: 5, bookableCapacity: 4,
      seats: seats.map(seat => ({ ...seat, farePaise: seat.baseFarePaise, state: "available" })),
    } }, { upsert: true, setDefaultsOnInsert: false });
  }
  return { operatorId, providerId, journeyDate, returnDate };
}
