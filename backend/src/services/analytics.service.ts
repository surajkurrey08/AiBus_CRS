import mongoose from "mongoose";
import {
  Booking,
  Bus,
  Refund,
  Route,
  Settlement,
  Trip,
} from "../models/index.js";
export async function analytics(operatorId: string, from: string, to: string) {
  const owner = new mongoose.Types.ObjectId(operatorId);
  const start = new Date(`${from}T00:00:00+05:30`),
    end = new Date(`${to}T23:59:59.999+05:30`);
  const [sales, refunds, settlements, activeBuses, trips, routes, financial] =
    await Promise.all([
      Booking.aggregate([
        {
          $match: { operatorId: owner, createdAt: { $gte: start, $lte: end } },
        },
        {
          $group: {
            _id: null,
            totalBookings: { $sum: 1 },
            confirmed: {
              $sum: { $cond: [{ $eq: ["$status", "Confirmed"] }, 1, 0] },
            },
            cancelled: {
              $sum: { $cond: [{ $eq: ["$status", "Cancelled"] }, 1, 0] },
            },
            grossPaise: {
              $sum: {
                $cond: [{ $eq: ["$paymentStatus", "Paid"] }, "$grossPaise", 0],
              },
            },
            discountPaise: {
              $sum: {
                $cond: [
                  { $eq: ["$paymentStatus", "Paid"] },
                  "$discountPaise",
                  0,
                ],
              },
            },
            commissionPaise: {
              $sum: {
                $cond: [
                  { $eq: ["$paymentStatus", "Paid"] },
                  "$commissionPaise",
                  0,
                ],
              },
            },
          },
        },
      ]),
      Refund.aggregate([
        {
          $match: {
            operatorId: owner,
            status: "Refunded",
            confirmedAt: { $gte: start, $lte: end },
          },
        },
        { $group: { _id: null, amountPaise: { $sum: "$amountPaise" } } },
      ]),
      Settlement.aggregate([
        {
          $match: {
            operatorId: owner,
            status: "settled",
            mode: { $ne: "Test" },
            settledAt: { $gte: start, $lte: end },
          },
        },
        { $group: { _id: null, netPaise: { $sum: "$netPaise" } } },
      ]),
      Bus.countDocuments({ operatorId, status: "Active" }),
      Trip.find({
        operatorId,
        journeyDate: { $gte: from, $lte: to },
        status: { $ne: "Cancelled" },
      }).lean(),
      Route.find({ operatorId }).lean(),
      Booking.aggregate([
        {
          $match: {
            operatorId: owner,
            paidAt: { $gte: start, $lte: end },
            paymentStatus: { $in: ["Paid", "Refund pending", "Refunded"] },
          },
        },
        {
          $group: {
            _id: null,
            grossPaise: { $sum: "$grossPaise" },
            discountPaise: { $sum: "$discountPaise" },
            commissionPaise: { $sum: "$commissionPaise" },
          },
        },
      ]),
    ]);
  const totals = sales[0] || {
    totalBookings: 0,
    confirmed: 0,
    cancelled: 0,
    grossPaise: 0,
    discountPaise: 0,
    commissionPaise: 0,
  };
  const refundPaise = refunds[0]?.amountPaise || 0;
  Object.assign(totals, {
    grossPaise: financial[0]?.grossPaise || 0,
    discountPaise: financial[0]?.discountPaise || 0,
    commissionPaise: financial[0]?.commissionPaise || 0,
  });
  let totalSeats = 0,
    bookedSeats = 0,
    availableSeats = 0;
  for (const trip of trips) {
    if (trip.inventoryOwner !== "internal") continue;
    const seats = trip.seats as { state: string; holdUntil?: Date }[];
    totalSeats += seats.length;
    bookedSeats += seats.filter((s) => s.state === "booked").length;
    availableSeats += seats.filter(
      (s) =>
        s.state === "available" ||
        (s.state === "held" && new Date(s.holdUntil!) <= new Date()),
    ).length;
  }
  const dailyRevenue = await Booking.aggregate([
    {
      $match: {
        operatorId: owner,
        paymentStatus: { $in: ["Paid", "Refund pending", "Refunded"] },
        paidAt: { $gte: start, $lte: end },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: {
            format: "%Y-%m-%d",
            date: "$paidAt",
            timezone: "Asia/Kolkata",
          },
        },
        grossPaise: { $sum: "$grossPaise" },
        discountPaise: { $sum: "$discountPaise" },
        commissionPaise: { $sum: "$commissionPaise" },
        ticketCount: { $sum: { $size: "$passengers" } },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  const performance = routes.map((r) => {
    const matched = trips.filter(
      (t) =>
        String(t.routeId) === String(r._id) && t.inventoryOwner === "internal",
    );
    const seats = matched.flatMap((t) => t.seats as { state: string }[]);
    return {
      routeId: String(r._id),
      route: `${r.source} → ${r.destination}`,
      trips: matched.length,
      capacity: seats.length,
      booked: seats.filter((s) => s.state === "booked").length,
      occupancy: seats.length
        ? Math.round(
            (seats.filter((s) => s.state === "booked").length / seats.length) *
              100,
          )
        : 0,
    };
  });
  const byBus = new Map<
    string,
    { busId: string; capacity: number; booked: number }
  >();
  for (const trip of trips) {
    if (trip.inventoryOwner !== "internal") continue;
    const busId = String(trip.busId),
      row = byBus.get(busId) || { busId, capacity: 0, booked: 0 };
    const seats = trip.seats as { state: string }[];
    row.capacity += seats.length;
    row.booked += seats.filter((s) => s.state === "booked").length;
    byBus.set(busId, row);
  }
  return {
    ...totals,
    _id: undefined,
    refundPaise,
    netEarningsPaise:
      totals.grossPaise -
      totals.discountPaise -
      totals.commissionPaise -
      refundPaise,
    settledPaise: settlements[0]?.netPaise || 0,
    activeBuses,
    totalSeats,
    bookedSeats,
    availableSeats,
    occupancy: totalSeats
      ? Number(((bookedSeats / totalSeats) * 100).toFixed(1))
      : 0,
    externalInventoryUnavailable: trips.some(
      (t) => t.inventoryOwner === "external",
    ),
    dailyRevenue,
    routePerformance: performance,
    busPerformance: [...byBus.values()],
    upcomingDepartures: trips
      .filter(
        (t) =>
          t.status === "Scheduled" &&
          new Date(t.departureAt as Date) > new Date(),
      )
      .sort(
        (a, b) =>
          +new Date(a.departureAt as Date) - +new Date(b.departureAt as Date),
      )
      .slice(0, 10),
  };
}
