import mongoose from "mongoose";
import { CarRoute } from "../models/car-route.model.js";
import { CarTrip } from "../models/car-trip.model.js";
import { fail } from "../utils/response.js";
import { z } from "zod";

const objectIdRegex = /^[a-fA-F0-9]{24}$/;

function assertValidObjectId(id: string, paramName = "id"): void {
  if (!id || !objectIdRegex.test(id)) {
    fail(400, "INVALID_ID", `Invalid ObjectId provided for ${paramName}`);
  }
}

export const stopInputSchema = z.object({
  name: z.string().trim().min(2).max(100),
  time: z.string().optional(),
  address: z.string().trim().max(200).optional(),
});

export const routeInputSchema = z
  .object({
    name: z.string().trim().max(100).optional(),
    source: z.string().trim().min(2).max(50),
    destination: z.string().trim().min(2).max(50),
    estimatedDurationMinutes: z.number().int().min(10).max(2880),
    distanceKm: z.number().min(0).optional(),
    boarding: z.array(stopInputSchema).min(1, "At least one boarding point is required"),
    dropping: z.array(stopInputSchema).min(1, "At least one dropping point is required"),
  })
  .strict()
  .refine(
    (data) => data.source.trim().toLowerCase() !== data.destination.trim().toLowerCase(),
    {
      message: "Source city and destination city must be different",
      path: ["destination"],
    }
  );

export async function createRoute(operatorId: string, input: z.infer<typeof routeInputSchema>) {
  assertValidObjectId(operatorId, "operatorId");
  const validated = routeInputSchema.parse(input);

  const normalizedSource = validated.source.trim();
  const normalizedDest = validated.destination.trim();

  // Prevent duplicate active route for the same operator
  const existing = await CarRoute.findOne({
    operatorId,
    source: { $regex: new RegExp(`^${normalizedSource}$`, "i") },
    destination: { $regex: new RegExp(`^${normalizedDest}$`, "i") },
    status: "Active",
  }).lean();

  if (existing) {
    fail(
      409,
      "DUPLICATE_ROUTE",
      `An active route between '${normalizedSource}' and '${normalizedDest}' already exists for this operator.`
    );
  }

  const routeName = validated.name || `${normalizedSource} → ${normalizedDest}`;

  const route = await CarRoute.create({
    ...validated,
    operatorId,
    name: routeName,
    source: normalizedSource,
    destination: normalizedDest,
    status: "Active",
  });

  return route.toObject();
}

export async function listRoutes(
  operatorId: string,
  query: { search?: string; status?: string; page?: number; limit?: number } = {}
) {
  assertValidObjectId(operatorId, "operatorId");
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter: Record<string, any> = { operatorId };

  if (query.status) {
    filter.status = query.status;
  } else {
    filter.status = { $ne: "Archived" };
  }

  if (query.search) {
    const term = query.search.trim();
    filter.$or = [
      { source: { $regex: term, $options: "i" } },
      { destination: { $regex: term, $options: "i" } },
      { name: { $regex: term, $options: "i" } },
    ];
  }

  const [routes, total] = await Promise.all([
    CarRoute.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    CarRoute.countDocuments(filter),
  ]);

  return {
    data: routes,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function getRouteById(operatorId: string, routeId: string) {
  assertValidObjectId(operatorId, "operatorId");
  assertValidObjectId(routeId, "routeId");

  const route = await CarRoute.findOne({ _id: routeId, operatorId }).lean();
  if (!route) {
    fail(404, "ROUTE_NOT_FOUND", "Route not found or belongs to another operator");
  }
  return route;
}

export async function updateRoute(
  operatorId: string,
  routeId: string,
  input: Partial<z.infer<typeof routeInputSchema>>
) {
  assertValidObjectId(operatorId, "operatorId");
  assertValidObjectId(routeId, "routeId");

  const route = await CarRoute.findOne({ _id: routeId, operatorId });
  if (!route) {
    fail(404, "ROUTE_NOT_FOUND", "Route not found or belongs to another operator");
  }

  // If changing source or destination, verify no active trips exist
  const sourceChanging = input.source && input.source.trim().toLowerCase() !== route.source.toLowerCase();
  const destChanging = input.destination && input.destination.trim().toLowerCase() !== route.destination.toLowerCase();

  if (sourceChanging || destChanging) {
    const activeTrips = await CarTrip.exists({
      routeId,
      status: { $in: ["Scheduled", "Boarding", "On Road"] },
      departureAt: { $gt: new Date() },
    });
    if (activeTrips) {
      fail(
        409,
        "ROUTE_REFERENCED_BY_ACTIVE_TRIPS",
        "Cannot modify source or destination of a route currently referenced by active scheduled trips"
      );
    }

    const newSource = input.source ? input.source.trim() : route.source;
    const newDest = input.destination ? input.destination.trim() : route.destination;

    if (newSource.toLowerCase() === newDest.toLowerCase()) {
      fail(400, "INVALID_ROUTE_TERMINI", "Source and destination must be different cities");
    }

    route.source = newSource;
    route.destination = newDest;
  }

  if (input.name) route.name = input.name.trim();
  if (input.estimatedDurationMinutes !== undefined) route.estimatedDurationMinutes = input.estimatedDurationMinutes;
  if (input.distanceKm !== undefined) route.distanceKm = input.distanceKm;
  if (input.boarding) route.boarding = input.boarding as any;
  if (input.dropping) route.dropping = input.dropping as any;

  await route.save();
  return route.toObject();
}

export async function updateRouteStatus(
  operatorId: string,
  routeId: string,
  status: "Active" | "Inactive" | "Archived"
) {
  assertValidObjectId(operatorId, "operatorId");
  assertValidObjectId(routeId, "routeId");

  const route = await CarRoute.findOne({ _id: routeId, operatorId });
  if (!route) {
    fail(404, "ROUTE_NOT_FOUND", "Route not found or belongs to another operator");
  }

  if (status === "Inactive" || status === "Archived") {
    const activeTrip: any = await CarTrip.findOne({
      routeId,
      status: { $in: ["Scheduled", "Boarding", "On Road"] },
      departureAt: { $gt: new Date() },
    }).lean();

    if (activeTrip) {
      fail(
        409,
        "ROUTE_REFERENCED_BY_ACTIVE_TRIPS",
        `Cannot change route status to '${status}' while active upcoming trip (${activeTrip._id}) exists`
      );
    }
  }

  route.status = status;
  await route.save();
  return route.toObject();
}
