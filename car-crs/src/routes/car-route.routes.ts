import { Router } from "express";
import { asyncRoute, ok } from "../utils/response.js";
import { requireCarPermission } from "../middleware/auth.middleware.js";
import {
  createRoute,
  listRoutes,
  getRouteById,
  updateRoute,
  updateRouteStatus,
} from "../services/car-route.service.js";
import { z } from "zod";

export const carRouteRouter = Router();

// List Routes
carRouteRouter.get(
  "/routes",
  requireCarPermission("car:routes:read"),
  asyncRoute(async (req, res) => {
    const operatorId = req.carAuth!.operatorId;
    const query = {
      search: req.query.search as string | undefined,
      status: req.query.status as string | undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 20,
    };
    const result = await listRoutes(operatorId, query);
    return ok(res, result.data, result.meta);
  })
);

// Create Route
carRouteRouter.post(
  "/routes",
  requireCarPermission("car:routes:write"),
  asyncRoute(async (req, res) => {
    const operatorId = req.carAuth!.operatorId;
    const route = await createRoute(operatorId, req.body);
    return ok(res, route, undefined, 201);
  })
);

// Get Route Details
carRouteRouter.get(
  "/routes/:id",
  requireCarPermission("car:routes:read"),
  asyncRoute(async (req, res) => {
    const operatorId = req.carAuth!.operatorId;
    const routeId = String(req.params.id);
    const route = await getRouteById(operatorId, routeId);
    return ok(res, route);
  })
);

// Update Route
carRouteRouter.patch(
  "/routes/:id",
  requireCarPermission("car:routes:write"),
  asyncRoute(async (req, res) => {
    const operatorId = req.carAuth!.operatorId;
    const routeId = String(req.params.id);
    const route = await updateRoute(operatorId, routeId, req.body);
    return ok(res, route);
  })
);

// Update Route Status
carRouteRouter.patch(
  "/routes/:id/status",
  requireCarPermission("car:routes:write"),
  asyncRoute(async (req, res) => {
    const operatorId = req.carAuth!.operatorId;
    const routeId = String(req.params.id);
    const statusSchema = z.object({
      status: z.enum(["Active", "Inactive", "Archived"]),
    });
    const { status } = statusSchema.parse(req.body);
    const route = await updateRouteStatus(operatorId, routeId, status);
    return ok(res, route);
  })
);
