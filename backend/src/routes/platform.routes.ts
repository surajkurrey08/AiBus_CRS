import express from "express";
import mongoose from "mongoose";
import { z } from "zod";
import type { Config } from "../config/env.js";
import { Audit, Operator, Outbox, Bus, Route, Trip } from "../models/index.js";
import { authenticate } from "../middleware/auth.middleware.js";
import {
  AppError,
  asyncRoute,
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
