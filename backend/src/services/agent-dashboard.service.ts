import mongoose from "mongoose";
import * as M from "../models/index.js";
import { agencyBookingScope, authorizeAgent } from "./agent.service.js";
import { createdDuring } from "../validators/agent-dashboard.schemas.js";
import { resolveAreaRoutes } from "./area-master.service.js";
import { literalRegex, type Principal } from "../utils/core.js";
export const earnedCommissionCondition = {
  $and: [
    { $eq: ["$status", "Confirmed"] },
    { $eq: ["$paymentStatus", "Paid"] },
  ],
};
const sumWhen = (condition: any, field: string | number) => ({
  $sum: { $cond: [condition, field, 0] },
});
export async function agentBookingTotals(
  auth: Principal,
  period: { from?: string; to?: string } = {},
) {
  const scope = agencyBookingScope(auth.operatorId!, auth.agentId!);
  const match = {
    ...scope,
    operatorId: new mongoose.Types.ObjectId(auth.operatorId!),
    $or: [
      { agentId: new mongoose.Types.ObjectId(auth.agentId!) },
      {
        agentId: { $exists: false },
        salesPartnerId: new mongoose.Types.ObjectId(auth.agentId!),
      },
    ],
    ...createdDuring(period),
  };
  const groups = {
    totalSalesPaise: sumWhen(earnedCommissionCondition, "$grossPaise"),
    lastBookingAt: { $max: "$createdAt" },
    totalBookings: { $sum: 1 },
    confirmedBookings: sumWhen({ $eq: ["$status", "Confirmed"] }, 1),
    pendingBookings: sumWhen({ $eq: ["$status", "Pending payment"] }, 1),
    cancelledBookings: sumWhen({ $eq: ["$status", "Cancelled"] }, 1),
    refundedBookings: sumWhen({ $eq: ["$paymentStatus", "Refunded"] }, 1),
    commissionEarnedPaise: sumWhen(
      earnedCommissionCondition,
      "$commissionPaise",
    ),
    pendingCommissionPaise: sumWhen(
      {
        $and: [
          { $eq: ["$status", "Pending payment"] },
          { $eq: ["$paymentStatus", "Pending"] },
        ],
      },
      "$commissionPaise",
    ),
    excludedCancelledCommissionPaise: sumWhen(
      { $eq: ["$status", "Cancelled"] },
      "$commissionPaise",
    ),
    excludedRefundedCommissionPaise: sumWhen(
      { $eq: ["$paymentStatus", "Refunded"] },
      "$commissionPaise",
    ),
  };
  const [result] = await M.Booking.aggregate([
    { $match: match },
    {
      $facet: {
        totals: [{ $group: { _id: null, ...groups } }],
        days: [
          {
            $group: {
              _id: {
                $dateToString: {
                  date: "$createdAt",
                  format: "%Y-%m-%d",
                  timezone: "Asia/Kolkata",
                },
              },
              ...groups,
            },
          },
          { $sort: { _id: -1 } },
          { $limit: 367 },
        ],
      },
    },
  ]);
  const { _id, ...totals } = result?.totals[0] || {};
  return {
    period: {
      ...period,
      timezone: "Asia/Kolkata",
      basis: "Booking creation date",
    },
    totalBookings: 0,
    confirmedBookings: 0,
    pendingBookings: 0,
    cancelledBookings: 0,
    refundedBookings: 0,
    commissionEarnedPaise: 0,
    totalSalesPaise: 0,
    lastBookingAt: null,
    pendingCommissionPaise: 0,
    excludedCancelledCommissionPaise: 0,
    excludedRefundedCommissionPaise: 0,
    ...totals,
    dateWise: (result?.days || []).slice(0, 366).map((row: any) => {
      const { _id, ...stats } = row;
      return { date: _id, ...stats };
    }),
    dateWiseTruncated: (result?.days.length || 0) > 366,
    financialMeaning:
      "Eligibility from booking snapshots; not wallet balance, payout, or ledger adjustments",
  };
}
export async function agentCities(
  auth: Principal,
  search: string,
  page: number,
  limit: number,
) {
  const agency = await authorizeAgent(auth, "search");
  const routeIds = await M.Trip.distinct("routeId", {
    operatorId: auth.operatorId,
    inventoryOwner: "internal",
    status: "Scheduled",
    departureAt: { $gt: new Date() },
    bookingOpen: { $ne: false },
    ...(agency.allowedBusIds?.length
      ? { busId: { $in: agency.allowedBusIds } }
      : {}),
  });
  const routes: any[] = await M.Route.find({
    operatorId: auth.operatorId,
    _id: { $in: routeIds },
    status: "Active",
  })
    .select("source destination sourceCityId destinationCityId")
    .lean();
  const cities = new Map<string, { name: string; cityId?: string }>();
  for (const route of routes)
    for (const [name, cityId] of [
      [route.source, route.sourceCityId],
      [route.destination, route.destinationCityId],
    ])
      if (literalRegex(search).test(name))
        cities.set(name.trim().toLowerCase(), {
          name,
          ...(cityId ? { cityId: String(cityId) } : {}),
        });
  const values = [...cities.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "en-IN"),
  );
  return {
    cities: values.slice((page - 1) * limit, page * limit),
    total: values.length,
  };
}
export async function agentDashboard(auth: Principal, date: string) {
  const agency = await authorizeAgent(auth, "bookings");
  const canFinance = agency.permissions.includes("commissions"),
    canSearch = agency.permissions.includes("search");
  const totals = await agentBookingTotals(auth, { from: date, to: date });
  const routes = canSearch
    ? await M.Route.find({ operatorId: auth.operatorId, status: "Active" })
        .select("_id")
        .lean()
    : [];
  const [recent, authorizedTrips] = await Promise.all([
    M.Booking.find({
      ...agencyBookingScope(auth.operatorId!, auth.agentId!),
      ...createdDuring({ from: date, to: date }),
    })
      .sort({ createdAt: -1, _id: -1 })
      .limit(5)
      .lean(),
    canSearch
      ? M.Trip.countDocuments({
          operatorId: auth.operatorId,
          routeId: { $in: routes.map((r) => r._id) },
          journeyDate: date,
          departureAt: { $gt: new Date() },
          inventoryOwner: "internal",
          status: "Scheduled",
          bookingOpen: { $ne: false },
          ...(agency.allowedBusIds?.length
            ? { busId: { $in: agency.allowedBusIds } }
            : {}),
        })
      : Promise.resolve(null),
  ]);
  return {
    date,
    timezone: "Asia/Kolkata",
    totalBookings: totals.totalBookings,
    confirmedBookings: totals.confirmedBookings,
    pendingBookings: totals.pendingBookings,
    cancelledBookings: totals.cancelledBookings,
    authorizedTrips,
    ...(canFinance
      ? { commissionEarnedPaise: totals.commissionEarnedPaise }
      : {}),
    recentBookings: recent.map((b: any) => ({
      id: String(b._id),
      reference: b.reference,
      pnr: b.pnr,
      status: b.status,
      paymentStatus: b.paymentStatus,
      createdAt: b.createdAt,
      totalPaise: b.totalPaise,
    })),
    wallet: { available: agency.permissions.includes("wallet"), liveFundingAvailable: false },
    settlements: { available: agency.permissions.includes("settlements"), livePayoutAvailable: false },
  };
}
export async function ticketJourney(operatorId: string, booking: any) {
  const trip: any = await M.Trip.findOne({
    _id: booking.tripId,
    operatorId,
  }).lean();
  if (!trip) return null;
  const [routes, bus] = await Promise.all([
    resolveAreaRoutes(
      operatorId,
      await M.Route.find({ _id: trip.routeId, operatorId }).lean(),
    ),
    M.Bus.findOne({ _id: trip.busId, operatorId })
      .select("name registration type")
      .lean(),
  ]);
  return {
    source: routes[0]?.source,
    destination: routes[0]?.destination,
    journeyDate: trip.journeyDate,
    departureAt: trip.departureAt,
    arrivalAt: trip.arrivalAt,
    busName: bus?.name,
    registration: bus?.registration,
    busType: bus?.type,
  };
}
