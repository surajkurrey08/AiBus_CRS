import * as M from "../models/index.js";
import { tripMasterReport } from "./trip-master.service.js";
import { fail, type Principal } from "../utils/core.js";
export const operationReportNames = [
  "daily-trips",
  "scheduled-completed",
  "departure-delays",
  "arrival-delays",
  "bus-utilization",
  "seat-occupancy",
  "route-performance",
  "passenger-boarding",
  "cancellation-trends",
  "fuel-expenses",
  "distance",
  "mileage",
  "stoppage-duration",
  "crew-assignments",
  "booking-source",
] as const;
export async function operationalReport(
  auth: Principal,
  name: string,
  q: {
    from: string;
    to: string;
    tripId?: string;
    search?: string;
    page: number;
    limit: number;
  },
  exportAll = false,
) {
  if (!(operationReportNames as readonly string[]).includes(name))
    fail(404, "REPORT_UNKNOWN", "Unknown operational report");
  if (name === "fuel-expenses" && !auth.permissions.includes("finance:read"))
    fail(403, "FORBIDDEN", "Fuel expense permission required");
  const report = await tripMasterReport(auth, q.from, q.to);
  if (report.rows.length > 5000)
    fail(413, "REPORT_SCOPE", "Narrow the report date range");
  const tripIds = report.rows.map((t) => t.id),
    scope = { operatorId: auth.operatorId, tripId: { $in: tripIds } };
  const trips: any[] = await M.Trip.find({
    operatorId: auth.operatorId,
    _id: { $in: tripIds },
  })
    .select("seats crewIds departureAt arrivalAt operationStage status")
    .lean();
  const bookings: any[] = await M.Booking.find(scope)
    .select("tripId status source passengers.checkedInAt passengers.seat")
    .lean();
  const crew: any[] = await M.CrewMember.find({
    operatorId: auth.operatorId,
    _id: { $in: trips.flatMap((t) => t.crewIds || []) },
  })
    .select("name role")
    .lean();
  let rows: Record<string, any>[] = report.rows
    .filter((t) => !q.tripId || t.id === q.tripId)
    .map((row) => {
      const trip = trips.find((t) => String(t._id) === row.id),
        bs = bookings.filter((b) => String(b.tripId) === row.id),
        confirmed = bs.filter((b) => b.status === "Confirmed"),
        booked =
          trip?.seats.filter((s: any) => s.state === "booked").length || 0;
      return {
        ...row,
        scheduledDeparture: trip?.departureAt,
        scheduledArrival: trip?.arrivalAt,
        totalSeats: trip?.seats.length || 0,
        bookedSeats: booked,
        occupancyPercent: trip?.seats.length
          ? Math.round((booked * 10000) / trip.seats.length) / 100
          : 0,
        confirmedPassengers: confirmed.reduce(
          (n, b) => n + b.passengers.length,
          0,
        ),
        checkedIn: confirmed.reduce(
          (n, b) => n + b.passengers.filter((p: any) => p.checkedInAt).length,
          0,
        ),
        cancellations: bs.filter((b) => b.status === "Cancelled").length,
        crew: (trip?.crewIds || [])
          .map(
            (id: any) =>
              crew.find((c) => String(c._id) === String(id))?.name ||
              "Unassigned record",
          )
          .join(", "),
        operatorBookings: bs.filter((b) => b.source === "operator").length,
        agentBookings: bs.filter((b) => b.source === "agent").length,
        customerBookings: bs.filter((b) => b.source === "customer").length,
        externalBookings: bs.filter((b) => b.source === "external").length,
      };
    });
  const fields: Record<string, string[]> = {
    "daily-trips": ["status", "scheduledDeparture", "scheduledArrival"],
    "scheduled-completed": ["status"],
    "departure-delays": ["departureDelayMinutes"],
    "arrival-delays": ["arrivalDelayMinutes"],
    "bus-utilization": ["status", "distanceKm"],
    "seat-occupancy": ["totalSeats", "bookedSeats", "occupancyPercent"],
    "route-performance": [
      "status",
      "occupancyPercent",
      "departureDelayMinutes",
    ],
    "passenger-boarding": ["confirmedPassengers", "checkedIn"],
    "cancellation-trends": ["cancellations"],
    "fuel-expenses": ["fuelExpensePaise", "purchasedLitres"],
    distance: ["distanceKm"],
    mileage: ["mileageKmPerLitre"],
    "stoppage-duration": ["stoppageMinutes"],
    "crew-assignments": ["crew"],
    "booking-source": [
      "operatorBookings",
      "agentBookings",
      "customerBookings",
      "externalBookings",
    ],
  };
  if (name === "departure-delays")
    rows = rows.filter((r) => r.departureDelayMinutes > 0);
  if (name === "arrival-delays")
    rows = rows.filter((r) => r.arrivalDelayMinutes > 0);
  const columns = ["id", "date", "route", "registration", ...fields[name]];
  rows = rows.map((r) =>
    Object.fromEntries(columns.map((c) => [c, r[c] ?? null])),
  );
  if (q.search)
    rows = rows.filter((r) =>
      JSON.stringify(r).toLowerCase().includes(q.search!.toLowerCase()),
    );
  const total = rows.length;
  return {
    rows: exportAll
      ? rows
      : rows.slice((q.page - 1) * q.limit, q.page * q.limit),
    columns,
    total,
    page: q.page,
    limit: q.limit,
    pages: Math.max(1, Math.ceil(total / q.limit)),
    policy:
      "Operational observations only; null means no actual measurement. Not accounting revenue. Utilization is per-trip evidence, not fleet utilization hours.",
  };
}
