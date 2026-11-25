import { Router } from "express";
import { asyncRoute, ok } from "../utils/response.js";
import {
  getCarCities,
  getCarRoutes,
  searchOneWayTrips,
  searchRoundTrips,
  getTripPublicById,
  getTripSeatsPublic,
  quoteTripFare,
} from "../services/car-search.service.js";

export const carSearchRouter = Router();

// List active cities
carSearchRouter.get(
  "/cities",
  asyncRoute(async (_req, res) => {
    const cities = await getCarCities();
    return ok(res, cities);
  })
);

// List active routes with boarding / dropping stops
carSearchRouter.get(
  "/routes",
  asyncRoute(async (req, res) => {
    const routes = await getCarRoutes(req.query as any);
    return ok(res, routes);
  })
);

// Search available One Way car trips
carSearchRouter.get(
  "/trips/search",
  asyncRoute(async (req, res) => {
    const result = await searchOneWayTrips(req.query as any);
    return ok(res, result.data, result.meta);
  })
);

// Search available Round Trip car trips
carSearchRouter.post(
  "/trips/round-trip-search",
  asyncRoute(async (req, res) => {
    const result = await searchRoundTrips(req.body);
    return ok(res, result.data, result.meta);
  })
);

// Get public trip details
carSearchRouter.get(
  "/trips/:id",
  asyncRoute(async (req, res) => {
    const trip = await getTripPublicById(String(req.params.id));
    return ok(res, trip);
  })
);

// Get real-time seat inventory availability
carSearchRouter.get(
  "/trips/:id/seats",
  asyncRoute(async (req, res) => {
    const inventory = await getTripSeatsPublic(String(req.params.id));
    return ok(res, inventory);
  })
);

// Authoritative fare quotation for selected seats
carSearchRouter.post(
  "/fares/quote",
  asyncRoute(async (req, res) => {
    const quote = await quoteTripFare(req.body);
    return ok(res, quote);
  })
);
