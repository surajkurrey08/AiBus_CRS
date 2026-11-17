import mongoose from "mongoose";
import * as M from "../models/index.js";
import { fail, type Principal } from "../utils/core.js";
import { tripInput } from "../validators/operator.schemas.js";
import { lockTripCrew } from "./bus-master.service.js";
export async function ownedTripResource(
  model: mongoose.Model<any>,
  auth: Principal,
  recordId: string,
  session?: mongoose.ClientSession,
) {
  const record = await model
    .findOne({ _id: recordId, operatorId: auth.operatorId })
    .session(session || null)
    .lean();
  if (!record) fail(404, "NOT_FOUND", "Record not found");
  return record as any;
}
export async function createScheduledTrip(
  auth: Principal,
  raw: unknown,
  options: { session?: mongoose.ClientSession; requestId?: string } = {},
) {
  if (!auth.permissions.includes("routes:write"))
    fail(403, "FORBIDDEN", "Trip scheduling permission is required");
  const input = tripInput.parse(raw);
  if (input.seatSideFares && !auth.permissions.includes("pricing:write"))
    fail(403, "FORBIDDEN", "You do not have permission to set trip fares");
  const create = async (session: mongoose.ClientSession) => {
    const owner = { operatorId: auth.operatorId };
    const bus = await ownedTripResource(M.Bus, auth, input.busId, session);
    const route = await ownedTripResource(
      M.Route,
      auth,
      input.routeId,
      session,
    );
    if (bus.status !== "Active" || route.status !== "Active")
      fail(409, "INACTIVE_RESOURCE", "Bus and route must be active");
    if (bus.providerId || route.providerId)
      fail(
        403,
        "EXTERNAL_INVENTORY",
        "Imported inventory must be scheduled through its authoritative provider",
      );
    const departure = new Date(input.departureAt);
    if (departure <= new Date())
      fail(400, "PAST_DEPARTURE", "Departure must be in the future");
    const localDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(departure);
    if (localDate !== input.journeyDate)
      fail(
        400,
        "JOURNEY_DATE_MISMATCH",
        "Journey date must match departure in Asia/Kolkata",
      );
    const arrivalAt = input.arrivalAt
      ? new Date(input.arrivalAt)
      : new Date(+departure + route.durationMinutes * 60000);
    if (arrivalAt <= departure)
      fail(400, "INVALID_ARRIVAL", "Arrival must follow departure");
    const layout = await M.Layout.findOne({ ...owner, busId: input.busId })
      .session(session)
      .lean();
    if (!layout)
      fail(
        409,
        "LAYOUT_REQUIRED",
        "Configure the bus seat layout before creating a trip",
      );
    if ((layout!.seats as any[]).length !== bus.capacity)
      fail(
        409,
        "LAYOUT_CAPACITY_MISMATCH",
        "Seat layout capacity must match the bus",
      );
    let service: any;
    if (input.serviceId) {
      service = await ownedTripResource(
        M.BusService,
        auth,
        input.serviceId,
        session,
      );
      if (
        service.status !== "Active" ||
        String(service.routeId) !== input.routeId
      )
        fail(
          409,
          "SERVICE_MISMATCH",
          "Select an active service for this route",
        );
      await M.BusService.updateOne(
        { _id: service._id, ...owner },
        { $inc: { __v: 1 } },
        { session },
      );
    }
    if (input.scheduleId) {
      const schedule = await ownedTripResource(
        M.Schedule,
        auth,
        input.scheduleId,
        session,
      );
      if (
        String(schedule.busId) !== input.busId ||
        String(schedule.routeId) !== input.routeId ||
        schedule.status !== "Active"
      )
        fail(
          400,
          "SCHEDULE_MISMATCH",
          "Schedule does not match this bus and route",
        );
      const day = new Date(`${input.journeyDate}T12:00:00+05:30`).getUTCDay();
      if (
        input.journeyDate < schedule.startDate ||
        input.journeyDate > schedule.endDate ||
        (!(schedule.specialDates || []).includes(input.journeyDate) &&
          !(schedule.daysOfWeek || []).includes(day))
      )
        fail(
          400,
          "SCHEDULE_DATE_MISMATCH",
          "Journey date does not match the selected schedule",
        );
    }
    const fare = await M.Fare.findOne({ ...owner, routeId: input.routeId })
      .session(session)
      .lean();
    const weekday = new Date(`${input.journeyDate}T12:00:00+05:30`).getUTCDay();
    const special = ((fare?.specialDates as any[]) || []).find(
      (value) => value.date === input.journeyDate,
    );
    const base =
      special?.amountPaise ??
      ([0, 6].includes(weekday) ? fare?.weekendPaise : undefined) ??
      fare?.basePaise;
    const sideFares =
      input.seatSideFares ||
      (service
        ? { doublePaise: service.doublePaise, singlePaise: service.singlePaise }
        : undefined);
    const seats = (layout!.seats as any[]).map((seat) => ({
      number: seat.number,
      deck: seat.deck,
      row: seat.row,
      column: seat.column,
      category: seat.category,
      farePaise:
        (sideFares
          ? seat.category === "sleeper" && seat.column === 3
            ? sideFares.singlePaise
            : sideFares.doublePaise
          : undefined) ??
        ((fare?.seatFares as any[]) || []).find(
          (value) => value.number === seat.number,
        )?.amountPaise ??
        special?.amountPaise ??
        (seat.category === "sleeper" && seat.column === 3
          ? (([0, 6].includes(weekday)
              ? fare?.singleWeekendPaise
              : undefined) ?? fare?.singlePaise)
          : undefined) ??
        base ??
        seat.farePaise,
      state: "available",
    }));
    if (
      seats.some(
        (seat) => !Number.isSafeInteger(seat.farePaise) || seat.farePaise <= 0,
      )
    )
      fail(
        409,
        "FARES_REQUIRED",
        "Set route fares or trip prices before scheduling",
      );
    const guarded = await M.Bus.updateOne(
      { _id: input.busId, ...owner, status: "Active" },
      { $inc: { __v: 1 } },
      { session },
    );
    if (guarded.matchedCount !== 1)
      fail(409, "BUS_UNAVAILABLE", "Bus is inactive or no longer available");
    if (
      await M.Trip.exists({
        ...owner,
        busId: input.busId,
        status: { $ne: "Cancelled" },
        departureAt: { $lt: arrivalAt },
        $or: [
          { arrivalAt: { $gt: departure } },
          { arrivalAt: null, departureAt: { $gte: departure } },
        ],
      }).session(session)
    )
      fail(
        409,
        "BUS_SCHEDULE_CONFLICT",
        "The bus is assigned to an overlapping trip",
      );
    const crewIds = input.crewIds || (service?.crewIds || []).map(String);
    await lockTripCrew(
      auth,
      crewIds,
      undefined,
      departure,
      arrivalAt,
      input.journeyDate,
      session,
    );
    const [trip] = await M.Trip.create(
      [
        {
          ...input,
          ...owner,
          crewIds,
          arrivalAt,
          inventoryOwner: "internal",
          seats,
          ...(sideFares ? { seatSideFares: sideFares } : {}),
          ...(service
            ? { serviceName: service.name, serviceCode: service.code }
            : {}),
        },
      ],
      { session },
    );
    await M.Audit.create(
      [
        {
          ...owner,
          actorId: auth.userId,
          action: "trip.create",
          resourceId: String(trip._id),
          requestId: options.requestId,
        },
      ],
      { session },
    );
    await M.Outbox.create(
      [
        {
          ...owner,
          event: "trip.status.updated",
          resourceId: String(trip._id),
        },
      ],
      { session },
    );
    return trip.toObject();
  };
  if (options.session) return create(options.session);
  let result: any;
  await mongoose.connection.transaction(async (session) => {
    result = await create(session);
  });
  return result;
}
