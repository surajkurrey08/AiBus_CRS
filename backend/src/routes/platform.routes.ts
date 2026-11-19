import express from "express";
import mongoose from "mongoose";
import { z } from "zod";
import type { Config } from "../config/env.js";
import { Audit, Booking, Operator, Outbox, Bus, Route, Trip, User, SalesPartner } from "../models/index.js";
import { authenticate } from "../middleware/auth.middleware.js";
import {
  AppError,
  asyncRoute,
  dateOnly,
  id,
  literalRegex,
  ok,
  pagination,
  permit,
} from "../utils/core.js";
export function platformRouter(config: Config) {
  const platform = express.Router();
  platform.use(authenticate(config), permit("platform:manage"));
  platform.get(
    "/overview",
    asyncRoute(async (_req, res) => {
      const [statuses, buses, routes, trips] = await Promise.all([
        Operator.aggregate([
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ]),
        Bus.countDocuments(),
        Route.countDocuments(),
        Trip.countDocuments({ status: "Scheduled" }),
      ]);
      const operators = Object.fromEntries(
        statuses.map((s) => [s._id, s.count]),
      );
      ok(res, {
        operators,
        totalOperators: statuses.reduce((sum, s) => sum + s.count, 0),
        buses,
        routes,
        scheduledTrips: trips,
      });
    }),
  );
  platform.get(
    "/records/bookings",
    asyncRoute(async (req, res) => {
      const q = z.object({
        channel: z.enum(["api", "operator"]).default("api"),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(50).default(20),
        search: z.string().trim().max(100).default(""),
        status: z.enum(["Pending payment", "Confirmed", "Failed", "Cancelled", "Reconciliation required"]).optional(),
        operatorId: z.string().optional(),
        from: dateOnly.optional(),
        to: dateOnly.optional(),
      }).strict().parse(req.query);
      const operatorId = q.operatorId ? id.parse(q.operatorId) : undefined;
      const apiSources = ["api", "customer", "external"];
      const operatorSources = ["operator", "agent"];
      const sources = q.channel === "api" ? apiSources : operatorSources;
      const createdAt: Record<string, Date> = {};
      if (q.from) createdAt.$gte = new Date(`${q.from}T00:00:00+05:30`);
      if (q.to) createdAt.$lte = new Date(`${q.to}T23:59:59.999+05:30`);
      const filter: Record<string, any> = {
        source: { $in: sources },
        ...(operatorId ? { operatorId } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(Object.keys(createdAt).length ? { createdAt } : {}),
      };
      const countsFilter = { ...filter };
      delete countsFilter.source;
      if (q.search) {
        const expression = literalRegex(q.search);
        filter.$or = [{ reference: expression }, { pnr: expression }];
        if (/^[a-f\d]{24}$/i.test(q.search)) filter.$or.push({ _id: new mongoose.Types.ObjectId(q.search) });
      }
      const [bookings, total, channelCounts] = await Promise.all([
        Booking.find(filter).sort({ createdAt: -1, _id: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
        Booking.countDocuments(filter),
        Booking.aggregate([
          { $match: countsFilter },
          { $group: { _id: "$source", count: { $sum: 1 } } },
        ]),
      ]);
      const operatorIds = [...new Set(bookings.map((b: any) => String(b.operatorId)))];
      const tripIds = [...new Set(bookings.map((b: any) => String(b.tripId)))];
      const userIds = [...new Set(bookings.map((b: any) => String(b.userId)))];
      const [operators, trips, users] = await Promise.all([
        Operator.find({ _id: { $in: operatorIds } }).select("company").lean(),
        Trip.find({ _id: { $in: tripIds } }).select("routeId journeyDate departureAt").lean(),
        User.find({ _id: { $in: userIds } }).select("name email role salesPartnerId").lean(),
      ]);
      const partnerIds = [...new Set(bookings.flatMap((booking: any) => {
        const actor: any = users.find((value: any) => String(value._id) === String(booking.userId));
        const partnerId = booking.salesPartnerId || actor?.salesPartnerId;
        return partnerId ? [String(partnerId)] : [];
      }))];
      const routes = await Route.find({ _id: { $in: trips.map((t: any) => t.routeId) } }).select("source destination").lean();
      const partners: any[] = [];
      let pendingPartnerIds = partnerIds;
      while (pendingPartnerIds.length) {
        const unseen = pendingPartnerIds.filter((pid) => !partners.some((p) => String(p._id) === pid));
        if (!unseen.length) break;
        const batch = await SalesPartner.find({ _id: { $in: unseen } }).select("name kind parentPartnerId operatorId").lean();
        partners.push(...batch);
        pendingPartnerIds = batch.map((p: any) => p.parentPartnerId && String(p.parentPartnerId)).filter(Boolean);
      }
      const countMap = Object.fromEntries(channelCounts.map((row: any) => [row._id, row.count]));
      const apiCount = (countMap.api || 0) + (countMap.customer || 0) + (countMap.external || 0);
      const operatorCount = (countMap.operator || 0) + (countMap.agent || 0);
      const rows = bookings.map((booking: any) => {
        const trip: any = trips.find((value: any) => String(value._id) === String(booking.tripId));
        const route: any = routes.find((value: any) => String(value._id) === String(trip?.routeId));
        const user: any = users.find((value: any) => String(value._id) === String(booking.userId));
        const operator: any = operators.find((value: any) => String(value._id) === String(booking.operatorId));
        const chain: string[] = [];
        let partner: any = partners.find((value: any) => String(value._id) === String(booking.salesPartnerId || user?.salesPartnerId));
        const visited = new Set<string>();
        while (partner && !visited.has(String(partner._id))) {
          visited.add(String(partner._id));
          chain.unshift(`${partner.name} (${partner.kind})`);
          partner = partners.find((value: any) => String(value._id) === String(partner.parentPartnerId));
        }
        return {
          id: String(booking._id), reference: booking.reference, pnr: booking.pnr || null,
          source: booking.source, status: booking.status, paymentStatus: booking.paymentStatus,
          createdAt: booking.createdAt, totalPaise: booking.totalPaise,
          passengers: (booking.passengers || []).map((p: any) => ({ name: p.name, seat: p.seat, phone: p.phone, email: p.email, boarding: p.boarding, dropping: p.dropping })),
          operator: operator?.company || "Operator unavailable",
          operatorId: String(booking.operatorId),
          route: route ? `${route.source} → ${route.destination}` : "Route unavailable",
          journeyDate: trip?.journeyDate || null, departureAt: trip?.departureAt || null,
          enteredBy: user?.name || "System / API", enteredByEmail: user?.email || null,
          enteredByRole: user?.role || null, agentHierarchy: chain,
          totalPassengers: (booking.passengers || []).length,
        };
      });
      ok(res, { bookings: rows, counts: { api: apiCount, operator: operatorCount } }, {
        page: q.page, limit: q.limit, total, pages: Math.max(1, Math.ceil(total / q.limit)),
      });
    }),
  );
  platform.get(
    "/operators/:id",
    asyncRoute(async (req, res) => {
      const operatorId = id.parse(req.params.id);
      const operator = await Operator.findById(operatorId).lean();
      if (!operator) throw new AppError(404, "NOT_FOUND", "Operator not found");
      const [buses, routes, trips] = await Promise.all([
        Bus.countDocuments({ operatorId }),
        Route.countDocuments({ operatorId }),
        Trip.countDocuments({ operatorId, status: "Scheduled" }),
      ]);
      ok(res, {
        ...operator,
        counts: { buses, routes, scheduledTrips: trips },
      });
    }),
  );
  platform.get(
    "/operators",
    asyncRoute(async (req, res) => {
      const p = pagination(req);
      const filter = {
        ...(p.status
          ? {
              status: z
                .enum(["pending", "approved", "suspended", "rejected"])
                .parse(p.status),
            }
          : {}),
        ...(p.search
          ? {
              $or: [
                { company: literalRegex(p.search) },
                { email: literalRegex(p.search) },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        Operator.find(filter)
          .sort({ createdAt: -1 })
          .skip((p.page - 1) * p.limit)
          .limit(p.limit)
          .lean(),
        Operator.countDocuments(filter),
      ]);
      ok(res, rows, {
        page: p.page,
        limit: p.limit,
        total,
        pages: Math.max(1, Math.ceil(total / p.limit)),
      });
    }),
  );
  platform.patch(
    "/operators/:id/status",
    asyncRoute(async (req, res) => {
      const operatorId = id.parse(req.params.id),
        { status } = z
          .object({ status: z.enum(["approved", "suspended", "rejected"]) })
          .strict()
          .parse(req.body);
      let value: any;
      await mongoose.connection.transaction(async (session) => {
        value = await Operator.findOneAndUpdate(
          { _id: operatorId },
          {
            $set: {
              status,
              approvedBy: req.auth.userId,
              approvedAt: new Date(),
            },
          },
          { new: true, session },
        );
        if (!value) throw new AppError(404, "NOT_FOUND", "Operator not found");
        await Audit.create(
          [
            {
              operatorId,
              actorId: req.auth.userId,
              action: `operator.${status}`,
              resourceId: operatorId,
              requestId: req.requestId,
            },
          ],
          { session },
        );
        await Outbox.create(
          [
            {
              operatorId,
              event: "operator.status.updated",
              resourceId: operatorId,
            },
          ],
          { session },
        );
      });
      ok(res, value);
    }),
  );
  return platform;
}
