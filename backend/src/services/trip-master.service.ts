import mongoose from "mongoose";
import * as M from "../models/index.js";
import { fail, type Principal } from "../utils/core.js";
import { multiScheduleInput } from "../validators/trip-master.schemas.js";
import {
  createScheduledTrip,
  ownedTripResource,
} from "./trip-scheduling.service.js";
export async function planServiceTrips(
  auth: Principal,
  raw: unknown,
  session?: mongoose.ClientSession,
) {
  const input = multiScheduleInput.parse(raw);
  const entries: any[] = [];
  for (const serviceId of input.serviceIds) {
    const service = await ownedTripResource(
      M.BusService,
      auth,
      serviceId,
      session,
    );
    if (service.status !== "Active")
      fail(409, "SERVICE_INACTIVE", "Select active services");
    const route = await ownedTripResource(
      M.Route,
      auth,
      String(service.routeId),
      session,
    );
    const bus = await ownedTripResource(
      M.Bus,
      auth,
      String(service.busId),
      session,
    );
    const layout = await M.Layout.findOne({
      operatorId: auth.operatorId,
      busId: bus._id,
    })
      .session(session || null)
      .lean();
    for (
      let date = new Date(input.from + "T12:00:00Z");
      date <= new Date(input.to + "T12:00:00Z");
      date = new Date(+date + 86400000)
    ) {
      if (!service.daysOfWeek.includes(date.getUTCDay())) continue;
      const journeyDate = date.toISOString().slice(0, 10);
      const departure = new Date(
        `${journeyDate}T${service.departure}:00+05:30`,
      );
      const arrival = new Date(+departure + route.durationMinutes * 60000);
      const existing = await M.Trip.findOne({
        operatorId: auth.operatorId,
        serviceId,
        journeyDate,
      })
        .session(session || null)
        .select("_id status")
        .lean();
      let state = "Ready";
      if (existing) state = "Existing";
      else if (departure <= new Date()) state = "Past departure";
      else if (bus.status !== "Active" || route.status !== "Active")
        state = "Inactive bus or route";
      else if (!layout || (layout.seats as any[]).length !== bus.capacity)
        state = "Layout required";
      else {
        const conflict = await M.Trip.exists({
          operatorId: auth.operatorId,
          busId: bus._id,
          status: { $ne: "Cancelled" },
          departureAt: { $lt: arrival },
          $or: [
            { arrivalAt: { $gt: departure } },
            { arrivalAt: null, departureAt: { $gte: departure } },
          ],
        }).session(session || null);
        const plannedConflict = entries.some(
          (entry) =>
            entry.busId === String(bus._id) &&
            entry.state === "Ready" &&
            new Date(entry.departureAt) < arrival &&
            new Date(entry.arrivalAt) > departure,
        );
        if (conflict || plannedConflict) state = "Bus conflict";
      }
      entries.push({
        serviceId,
        serviceName: service.name,
        routeId: String(route._id),
        route: `${route.source} → ${route.destination}`,
        busId: String(bus._id),
        registration: bus.registration,
        journeyDate,
        departureAt: departure.toISOString(),
        arrivalAt: arrival.toISOString(),
        state,
        ...(existing
          ? { tripId: String(existing._id), existingStatus: existing.status }
          : {}),
      });
      if (entries.length > 100)
        fail(
          400,
          "BATCH_LIMIT",
          "Schedule at most 100 journeys per batch. Choose a shorter range or fewer services",
        );
    }
  }
  if (!entries.length)
    fail(400, "EMPTY_SCHEDULE", "No selected service runs on these dates");
  return entries;
}
export async function scheduleServiceTrips(
  auth: Principal,
  input: unknown,
  requestId?: string,
) {
  let result: any;
  await mongoose.connection.transaction(async (session) => {
    const entries = await planServiceTrips(auth, input, session);
    const blocked = entries.find(
      (entry) => !["Ready", "Existing"].includes(entry.state),
    );
    if (blocked)
      fail(
        409,
        "SCHEDULE_CONFLICT",
        `${blocked.serviceName} on ${blocked.journeyDate}: ${blocked.state}`,
      );
    const trips: string[] = [];
    for (const entry of entries) {
      if (entry.state === "Existing") {
        trips.push(entry.tripId);
        continue;
      }
      const trip = await createScheduledTrip(
        auth,
        {
          serviceId: entry.serviceId,
          busId: entry.busId,
          routeId: entry.routeId,
          journeyDate: entry.journeyDate,
          departureAt: entry.departureAt,
        },
        { session, requestId },
      );
      trips.push(String(trip._id));
    }
    result = {
      created: entries.filter((entry) => entry.state === "Ready").length,
      existing: entries.filter((entry) => entry.state === "Existing").length,
      tripIds: trips,
      entries,
    };
  });
  return result;
}
export async function tripMasterReport(
  auth: Principal,
  from: string,
  to: string,
) {
  if (to < from || +new Date(to) - +new Date(from) > 365 * 86400000)
    fail(400, "INVALID_DATE_RANGE", "Choose a date range of up to one year");
  const owner = { operatorId: auth.operatorId };
  const trips = await M.Trip.find({
    ...owner,
    journeyDate: { $gte: from, $lte: to },
  })
    .select(
      "_id busId routeId serviceName journeyDate departureAt arrivalAt status operationStage actualDepartureAt actualArrivalAt startOdometerKm endOdometerKm fuelConsumedMillilitres",
    )
    .sort({ departureAt: 1 })
    .lean();
  const ids = trips.map((trip) => trip._id);
  const [buses, routes, fuels, stops, bookings] = await Promise.all([
    M.Bus.find({
      ...owner,
      _id: { $in: trips.map((trip) => trip.busId) },
    }).lean(),
    M.Route.find({
      ...owner,
      _id: { $in: trips.map((trip) => trip.routeId) },
    }).lean(),
    M.TripFuel.find({
      ...owner,
      tripId: { $in: ids },
      status: "Recorded",
    }).lean(),
    M.TripStopRecord.find({ ...owner, tripId: { $in: ids } }).lean(),
    M.Booking.find({ ...owner, tripId: { $in: ids }, status: "Confirmed" })
      .select(
        "passengers.boarding passengers.dropping commissionPaise salesPartnerId totalPaise",
      )
      .lean(),
  ]);
  const financial = auth.permissions.includes("finance:read");
  const rows = trips.map((trip: any) => {
    const fuel = fuels.filter((row) => String(row.tripId) === String(trip._id));
    const visits = stops.filter(
      (row) => String(row.tripId) === String(trip._id),
    );
    const distance =
      trip.startOdometerKm !== undefined && trip.endOdometerKm !== undefined
        ? trip.endOdometerKm - trip.startOdometerKm
        : null;
    const route = routes.find(
      (row) => String(row._id) === String(trip.routeId),
    );
    return {
      id: String(trip._id),
      date: trip.journeyDate,
      service: trip.serviceName || "Single trip",
      route: route
        ? `${route.source} → ${route.destination}`
        : "Route unavailable",
      registration:
        buses.find((bus) => String(bus._id) === String(trip.busId))
          ?.registration || "Bus unavailable",
      status: trip.operationStage || trip.status,
      departureDelayMinutes: trip.actualDepartureAt
        ? Math.round(
            (+new Date(trip.actualDepartureAt) - +new Date(trip.departureAt)) /
              60000,
          )
        : null,
      arrivalDelayMinutes:
        trip.actualArrivalAt && trip.arrivalAt
          ? Math.round(
              (+new Date(trip.actualArrivalAt) - +new Date(trip.arrivalAt)) /
                60000,
            )
          : null,
      distanceKm: distance,
      mileageKmPerLitre:
        distance !== null && trip.fuelConsumedMillilitres > 0
          ? Math.round(
              (distance / (trip.fuelConsumedMillilitres / 1000)) * 100,
            ) / 100
          : null,
      purchasedLitres:
        fuel.reduce((sum, row: any) => sum + row.litresMillilitres, 0) / 1000,
      stoppageMinutes: Math.round(
        visits.reduce(
          (sum, visit: any) =>
            sum + (+new Date(visit.departedAt) - +new Date(visit.arrivedAt)),
          0,
        ) / 60000,
      ),
      ...(financial
        ? {
            fuelExpensePaise: fuel.reduce(
              (sum, row: any) => sum + row.amountPaise,
              0,
            ),
          }
        : {}),
    };
  });
  const analysis = new Map<
    string,
    { kind: string; point: string; passengers: number }
  >();
  for (const booking of bookings)
    for (const passenger of booking.passengers as any[])
      for (const kind of ["boarding", "dropping"] as const) {
        if (!passenger[kind]) continue;
        const key = kind + "|" + passenger[kind];
        const previous = analysis.get(key) || {
          kind: kind === "boarding" ? "Pickup" : "Drop",
          point: passenger[kind],
          passengers: 0,
        };
        previous.passengers++;
        analysis.set(key, previous);
      }
  const timed = rows.filter((row) => row.departureDelayMinutes !== null);
  return {
    rows,
    pickupDropAnalysis: [...analysis.values()].sort(
      (a, b) => b.passengers - a.passengers,
    ),
    summary: {
      trips: rows.length,
      recordedDepartures: timed.length,
      onTimeDepartures: timed.filter((row) => row.departureDelayMinutes! <= 0)
        .length,
      distanceKm: rows.reduce((sum, row) => sum + (row.distanceKm || 0), 0),
      purchasedLitres: rows.reduce((sum, row) => sum + row.purchasedLitres, 0),
      ...(financial
        ? {
            fuelExpensePaise: rows.reduce(
              (sum, row) => sum + (row.fuelExpensePaise || 0),
              0,
            ),
            commissionPaise: bookings.reduce(
              (sum, booking: any) => sum + (booking.commissionPaise || 0),
              0,
            ),
          }
        : {}),
    },
  };
}
