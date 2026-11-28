import * as M from "../models/index.js";
import { fail } from "../utils/core.js";
import type { PartnerIdentity } from "./public-auth.service.js";
import { grantFilter, resourceId } from "./public-inventory.service.js";

type InventorySeat = {
  number: string;
  row?: number;
  column?: number;
  isDriver?: boolean;
  isBookable?: boolean;
  farePaise?: number;
  state: string;
  holdUntil?: Date;
};

export async function readPublishedCarInventory(operatorId: string, tripId: string) {
  const now = new Date();
  const trip = await M.Trip.findOne({
    _id: tripId,
    operatorId,
    carId: { $type: "objectId" },
    inventoryOwner: "internal",
    status: "Scheduled",
    bookingOpen: { $ne: false },
    departureAt: { $gt: now },
  }).lean();
  if (!trip) return fail(404, "TRIP_NOT_FOUND", "Published car trip not found");

  const [car, route, operator] = await Promise.all([
    M.Car.findOne({ _id: trip.carId, operatorId, status: "Active" })
      .select("make model modelName vehicleCategory").lean(),
    M.Route.findOne({ _id: trip.routeId, operatorId, status: "Active" })
      .select("source destination boarding dropping").lean(),
    M.Operator.exists({ _id: operatorId, status: "approved", salesBlocked: { $ne: true } }),
  ]);
  if (!car || !route || !operator)
    return fail(404, "TRIP_NOT_FOUND", "Published car trip not found");
  if (["Bus", "Mini Bus"].includes(String(car.vehicleCategory)))
    return fail(404, "TRIP_NOT_FOUND", "Published car trip not found");

  const seats = ((trip.seats ?? []) as InventorySeat[]).map((seat) => {
    const isDriver = seat.isDriver === true || seat.number === "D";
    const isBookable = !isDriver && seat.isBookable !== false;
    const expired = seat.state === "held" && seat.holdUntil && seat.holdUntil <= now;
    return {
      seatId: seat.number,
      row: seat.row,
      column: seat.column,
      isDriver,
      isBookable,
      farePaise: seat.farePaise,
      state: !isBookable ? "non_bookable" : expired ? "available" : seat.state,
    };
  });

  return {
    tripId: String(trip._id),
    tripNumber: trip.tripNumber,
    journeyDate: trip.journeyDate,
    departureAt: trip.departureAt,
    estimatedArrivalAt: trip.estimatedArrivalAt ?? trip.arrivalAt,
    vehicleCategory: trip.vehicleCategory,
    bookableCapacity: trip.bookableCapacity,
    totalPhysicalSeats: trip.totalPhysicalSeats,
    availableSeatsCount: seats.filter((seat) => seat.state === "available").length,
    car: { make: car.make, modelName: car.modelName ?? car.model },
    route: {
      source: route.source,
      destination: route.destination,
      boarding: route.boarding,
      dropping: route.dropping,
    },
    seats,
  };
}

type CarSearchQuery = {
  source: string; destination: string; journeyDate: string; page: number; limit: number;
};

export async function searchPartnerCarInventory(identity: PartnerIdentity, query: CarSearchQuery) {
  const grants = await grantFilter(identity);
  return searchCarInventory(
    grants.$or.flatMap((grant) => "operatorId" in grant ? [String(grant.operatorId)] : []),
    grants,
    query,
    (id) => resourceId("trip", id),
  );
}

export async function searchCarInventory(
  operatorIds: string[],
  filter: Record<string, unknown>,
  query: CarSearchQuery,
  mapId: (id: string) => Promise<string>,
) {
  const routes = await M.Route.find({
    operatorId: { $in: operatorIds },
    source: query.source,
    destination: query.destination,
    status: "Active",
  }).select("_id").lean();
  const candidates = await M.Trip.find({
    status: "Scheduled",
    inventoryOwner: "internal",
    bookingOpen: { $ne: false },
    departureAt: { $gt: new Date() },
    ...filter,
    operatorId: { $in: operatorIds },
    routeId: { $in: routes.map((route) => route._id) },
    carId: { $type: "objectId" },
    journeyDate: query.journeyDate,
  }).select("_id operatorId").sort({ departureAt: 1, _id: 1 }).limit(101).lean();
  if (candidates.length > 100)
    return fail(413, "SEARCH_SCOPE_TOO_LARGE", "Narrow inventory grants");

  const results = [];
  for (const trip of candidates) {
    try {
      const { tripId, ...inventory } = await readPublishedCarInventory(String(trip.operatorId), String(trip._id));
      results.push({ id: await mapId(tripId), ...inventory });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "TRIP_NOT_FOUND")) throw error;
    }
  }
  const offset = (query.page - 1) * query.limit;
  return { data: results.slice(offset, offset + query.limit), total: results.length };
}
