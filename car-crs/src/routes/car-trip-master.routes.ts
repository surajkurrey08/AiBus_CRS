import { Router } from "express";
import { asyncRoute, ok } from "../utils/response.js";
import { requireCarPermission } from "../middleware/auth.middleware.js";
import {
  createCarTrip,
  publishCarTrip,
  closeCarTripSales,
  cancelCarTrip,
  listOperatorTrips,
  getCarTripDetails,
  updateCarTrip,
  setSeatBlockStatus,
} from "../services/car-trip-master.service.js";
import { z } from "zod";

export const carTripMasterRouter = Router();

// Create new scheduled car trip
carTripMasterRouter.post(
  "/trips",
  requireCarPermission("car:fleet:write"),
  asyncRoute(async (req, res) => {
    const operatorId = req.carAuth!.operatorId;
    const trip = await createCarTrip(operatorId, req.body);
    return ok(res, trip, undefined, 201);
  })
);

// List operator trips with filters
carTripMasterRouter.get(
  "/trips",
  requireCarPermission("car:fleet:read"),
  asyncRoute(async (req, res) => {
    const operatorId = req.carAuth!.operatorId;
    const result = await listOperatorTrips(operatorId, req.query);
    return ok(res, result.data, result.meta);
  })
);

// Get trip details
carTripMasterRouter.get(
  "/trips/:id",
  requireCarPermission("car:fleet:read"),
  asyncRoute(async (req, res) => {
    const operatorId = req.carAuth!.operatorId;
    const tripId = String(req.params.id);
    const trip = await getCarTripDetails(operatorId, tripId);
    return ok(res, trip);
  })
);

// Update trip properties
carTripMasterRouter.patch(
  "/trips/:id",
  requireCarPermission("car:fleet:write"),
  asyncRoute(async (req, res) => {
    const operatorId = req.carAuth!.operatorId;
    const tripId = String(req.params.id);
    const trip = await updateCarTrip(operatorId, tripId, req.body);
    return ok(res, trip);
  })
);

// Publish trip (Draft -> Scheduled)
carTripMasterRouter.post(
  "/trips/:id/publish",
  requireCarPermission("car:fleet:write"),
  asyncRoute(async (req, res) => {
    const operatorId = req.carAuth!.operatorId;
    const tripId = String(req.params.id);
    const trip = await publishCarTrip(operatorId, tripId);
    return ok(res, trip);
  })
);

// Close sales for trip
carTripMasterRouter.post(
  "/trips/:id/close-sales",
  requireCarPermission("car:fleet:write"),
  asyncRoute(async (req, res) => {
    const operatorId = req.carAuth!.operatorId;
    const tripId = String(req.params.id);
    const trip = await closeCarTripSales(operatorId, tripId);
    return ok(res, trip);
  })
);

// Cancel trip with reason
carTripMasterRouter.post(
  "/trips/:id/cancel",
  requireCarPermission("car:fleet:write"),
  asyncRoute(async (req, res) => {
    const operatorId = req.carAuth!.operatorId;
    const tripId = String(req.params.id);
    const trip = await cancelCarTrip(operatorId, tripId, req.body);
    return ok(res, trip);
  })
);

// Block / unblock individual seat
carTripMasterRouter.patch(
  "/trips/:id/seats/:seatId/block",
  requireCarPermission("car:fleet:write"),
  asyncRoute(async (req, res) => {
    const operatorId = req.carAuth!.operatorId;
    const tripId = String(req.params.id);
    const seatId = String(req.params.seatId);
    const blockSchema = z.object({
      block: z.boolean(),
      reason: z.string().optional(),
    });
    const { block, reason } = blockSchema.parse(req.body);
    const result = await setSeatBlockStatus(operatorId, tripId, seatId, block, reason);
    return ok(res, result);
  })
);
