import { Router } from "express";
import { asyncRoute, ok, fail } from "../utils/response.js";
import { requireCarPermission } from "../middleware/auth.middleware.js";
import {
  getCarLayoutTemplates,
  getCarActiveLayout,
  assignOrUpdateCarLayoutWithVersioning,
  validatePhysicalCarLayout,
} from "../services/car-layout.service.js";
import { carSeatLayoutInputSchema } from "../validators/car.validators.js";

export const carLayoutRouter = Router();

// Get Standard Layout Templates (4-passenger sedan and 7-passenger MUV)
carLayoutRouter.get(
  "/car-layout-templates",
  requireCarPermission("car:layout:read"),
  asyncRoute(async (_req, res) => {
    const templates = getCarLayoutTemplates();
    return ok(res, templates);
  })
);

// Dry-run validate layout
carLayoutRouter.post(
  "/car-layouts/validate",
  requireCarPermission("car:layout:read"),
  asyncRoute(async (req, res) => {
    const seats = req.body.seats;
    if (!Array.isArray(seats)) {
      fail(400, "INVALID_LAYOUT", "Request payload must contain 'seats' array");
    }
    const expected = Number(req.body.expectedPassengerCapacity ?? req.body.bookablePassengerCapacity) || 4;
    validatePhysicalCarLayout(seats, expected);
    const bookableCount = seats.filter((s: any) => s.isBookable && !s.isDriver).length;
    return ok(res, {
      valid: true,
      totalPhysicalSeats: seats.length,
      bookableSeatsCount: bookableCount,
      expectedPassengerCapacity: expected,
    });
  })
);

// Get Active Layout for Car
carLayoutRouter.get(
  "/cars/:id/layout",
  requireCarPermission("car:layout:read"),
  asyncRoute(async (req, res) => {
    const operatorId = req.carAuth!.operatorId;
    const carId = String(req.params.id);
    const layout = await getCarActiveLayout(operatorId, carId);
    return ok(res, layout);
  })
);

// Assign or Update Layout for Car with Versioning Protection
carLayoutRouter.put(
  "/cars/:id/layout",
  requireCarPermission("car:layout:write"),
  asyncRoute(async (req, res) => {
    const operatorId = req.carAuth!.operatorId;
    const carId = String(req.params.id);
    const layout = await assignOrUpdateCarLayoutWithVersioning(operatorId, carId, req.body);
    return ok(res, layout);
  })
);
