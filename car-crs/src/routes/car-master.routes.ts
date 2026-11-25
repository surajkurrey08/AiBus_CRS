import { Router } from "express";
import { asyncRoute, ok, fail } from "../utils/response.js";
import { requireCarPermission } from "../middleware/auth.middleware.js";
import {
  createCar,
  listCars,
  getCarById,
  updateCar,
  updateCarStatus,
} from "../services/car-master.service.js";
import { z } from "zod";

export const carMasterRouter = Router();

// List Cars
carMasterRouter.get(
  "/cars",
  requireCarPermission("car:fleet:read"),
  asyncRoute(async (req, res) => {
    const operatorId = req.carAuth!.operatorId;
    const query = {
      status: req.query.status as string | undefined,
      capacity: req.query.capacity ? Number(req.query.capacity) : undefined,
      search: req.query.search as string | undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 20,
    };
    const result = await listCars(operatorId, query);
    return ok(res, result.data, result.meta);
  })
);

// Register Car
carMasterRouter.post(
  "/cars",
  requireCarPermission("car:fleet:write"),
  asyncRoute(async (req, res) => {
    const operatorId = req.carAuth!.operatorId;
    const { layoutId, ...carData } = req.body;
    const car = await createCar(operatorId, carData, layoutId);
    return ok(res, car, undefined, 201);
  })
);

// Get Car Details
carMasterRouter.get(
  "/cars/:id",
  requireCarPermission("car:fleet:read"),
  asyncRoute(async (req, res) => {
    const operatorId = req.carAuth!.operatorId;
    const carId = String(req.params.id);
    const car = await getCarById(operatorId, carId);
    return ok(res, car);
  })
);

// Edit Car Information
carMasterRouter.patch(
  "/cars/:id",
  requireCarPermission("car:fleet:write"),
  asyncRoute(async (req, res) => {
    const operatorId = req.carAuth!.operatorId;
    const carId = String(req.params.id);
    const car = await updateCar(operatorId, carId, req.body);
    return ok(res, car);
  })
);

// Update Car Status
carMasterRouter.patch(
  "/cars/:id/status",
  requireCarPermission("car:fleet:write"),
  asyncRoute(async (req, res) => {
    const operatorId = req.carAuth!.operatorId;
    const carId = String(req.params.id);
    const statusSchema = z.object({
      status: z.enum(["Active", "Inactive", "Under Maintenance", "Archived"]),
    });
    const { status } = statusSchema.parse(req.body);
    const car = await updateCarStatus(operatorId, carId, status);
    return ok(res, car);
  })
);
