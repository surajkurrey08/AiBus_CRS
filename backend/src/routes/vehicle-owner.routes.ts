import { Router, type Request } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { asyncRoute, fail, ok } from "../utils/core.js";
import { tenant } from "../middleware/authorization.js";
import { hashPassword } from "../modules/auth/index.js";
import * as M from "../models/index.js";
import { dateOnly, id } from "../validators/common.schemas.js";
import { strongPassword } from "../validators/account-input.schemas.js";

function requireOperatorAdmin(req: Request) {
  if (
    req.auth.role !== "operator_admin" ||
    !req.auth.permissions.includes("fleet:write")
  )
    fail(
      403,
      "FORBIDDEN",
      "Vehicle owner management requires an operator admin",
    );
}

export function vehicleOwnerManagementRouter() {
  const router = Router();
  router.get(
    "/vehicle-owners",
    asyncRoute(async (req, res) => {
      requireOperatorAdmin(req);
      const scope = tenant(req);
      const [owners, accounts] = await Promise.all([
        M.FleetOwner.find({ ...scope, status: "Active" })
          .select("name email")
          .sort({ name: 1 })
          .lean(),
        M.User.find({ ...scope, role: "vehicle_owner" })
          .select("fleetOwnerId email")
          .lean(),
      ]);
      const logins = new Map(
        accounts.map((account) => [
          String(account.fleetOwnerId),
          account.email,
        ]),
      );
      ok(
        res,
        owners.map((owner) => ({
          id: String(owner._id),
          name: owner.name,
          email: owner.email,
          loginEmail: logins.get(String(owner._id)),
        })),
      );
    }),
  );

  router.post(
    "/vehicle-owners",
    asyncRoute(async (req, res) => {
      requireOperatorAdmin(req);
      const input = z
        .object({
          ownerId: id.optional(),
          name: z.string().trim().min(2).max(120).optional(),
          email: z
            .string()
            .trim()
            .email()
            .max(254)
            .transform((value) => value.toLowerCase()),
          password: strongPassword,
        })
        .strict()
        .refine(
          (value) => Boolean(value.ownerId) !== Boolean(value.name),
          "Choose an existing owner or enter a new owner name",
        )
        .parse(req.body);
      const scope = tenant(req);
      const passwordHash = await hashPassword(input.password);
      const result = await mongoose.connection.transaction(async (session) => {
        const owner = input.ownerId
          ? await M.FleetOwner.findOne({
              ...scope,
              _id: input.ownerId,
              status: "Active",
            }).session(session)
          : (
              await M.FleetOwner.create(
                [{ ...scope, name: input.name, email: input.email }],
                { session },
              )
            )[0];
        if (!owner)
          return fail(
            404,
            "OWNER_NOT_FOUND",
            "Choose an active owner from your fleet",
          );
        if (input.ownerId)
          await M.FleetOwner.updateOne(
            { ...scope, _id: owner._id },
            { $inc: { loginRevision: 1 } },
            { session },
          );
        if (
          await M.User.exists({
            ...scope,
            fleetOwnerId: owner._id,
            role: "vehicle_owner",
          }).session(session)
        )
          return fail(
            409,
            "OWNER_ACCOUNT_EXISTS",
            "This owner already has a login",
          );
        await M.User.create(
          [
            {
              ...scope,
              fleetOwnerId: owner._id,
              name: owner.name,
              email: input.email,
              passwordHash,
              role: "vehicle_owner",
            },
          ],
          { session },
        );
        await M.Audit.create(
          [
            {
              ...scope,
              actorId: req.auth.userId,
              action: "fleet.owner.account.create",
              resourceId: String(owner._id),
              requestId: req.requestId,
            },
          ],
          { session },
        );
        return {
          id: String(owner._id),
          name: owner.name,
          loginEmail: input.email,
        };
      });
      ok(res, result, undefined, 201);
    }),
  );

  router.patch(
    "/cars/:id/owner",
    asyncRoute(async (req, res) => {
      requireOperatorAdmin(req);
      const carId = id.parse(req.params.id);
      const { ownerId, expectedOwnerId } = z
        .object({ ownerId: id.nullable(), expectedOwnerId: id.nullable() })
        .strict()
        .parse(req.body);
      const scope = tenant(req);
      await mongoose.connection.transaction(async (session) => {
        if (
          ownerId &&
          !(await M.FleetOwner.exists({
            ...scope,
            _id: ownerId,
            status: "Active",
          }).session(session))
        )
          return fail(
            404,
            "OWNER_NOT_FOUND",
            "Choose an active owner from your fleet",
          );
        const updated = await M.Car.updateOne(
          {
            ...scope,
            _id: carId,
            providerId: null,
            ownerId: expectedOwnerId,
          },
          { $set: { ownerId }, $inc: { schedulingRevision: 1 } },
          { session },
        );
        if (!updated.matchedCount)
          return fail(
            409,
            "VEHICLE_CHANGED",
            "Vehicle is unavailable or its owner changed. Refresh and try again",
          );
        await M.Audit.create(
          [
            {
              ...scope,
              actorId: req.auth.userId,
              action: "fleet.vehicle.owner.assign",
              resourceId: carId,
              requestId: req.requestId,
              metadata: { previousOwnerId: expectedOwnerId, ownerId },
            },
          ],
          { session },
        );
      });
      ok(res, { ownerId });
    }),
  );
  return router;
}

export function vehicleOwnerRouter() {
  const router = Router();
  router.get(
    "/overview",
    asyncRoute(async (req, res) => {
      if (req.auth.role !== "vehicle_owner")
        return fail(403, "FORBIDDEN", "Vehicle owner access required");
      const query = z
        .object({
          from: dateOnly,
          to: dateOnly,
          page: z.coerce.number().int().min(1).max(1000).default(1),
        })
        .strict()
        .refine(
          (value) => value.from <= value.to,
          "End date must follow the start date",
        )
        .parse(req.query);
      const scope = tenant(req);
      const account = await M.User.findOne({
        ...scope,
        _id: req.auth.userId,
        role: "vehicle_owner",
        active: true,
      })
        .select("fleetOwnerId")
        .lean();
      if (!account?.fleetOwnerId)
        return fail(
          403,
          "OWNER_INACTIVE",
          "Vehicle owner access is unavailable",
        );
      const ownerId = account.fleetOwnerId;
      const filter = {
        ...scope,
        fleetOwnerId: ownerId,
        journeyDate: { $gte: query.from, $lte: query.to },
      };
      const [cars, buses, rows, totalTrips] = await Promise.all([
        M.Car.find({ ...scope, ownerId })
          .select(
            "registrationNumber make model vehicleCategory bookablePassengerCapacity status",
          )
          .lean(),
        M.Bus.find({ ...scope, ownerId })
          .select("registration name type capacity status")
          .lean(),
        M.Trip.find(filter)
          .select(
            "tripNumber routeName routeId carRegistration departureAt arrivalAt journeyDate status seats.number seats.state seats.isDriver seats.isBookable seats.category",
          )
          .sort({ departureAt: 1, _id: 1 })
          .skip((query.page - 1) * 25)
          .limit(25)
          .lean(),
        M.Trip.countDocuments(filter),
      ]);
      const routes = await M.Route.find({
        ...scope,
        _id: { $in: rows.map((trip) => trip.routeId) },
      })
        .select("source destination")
        .lean();
      const routeNames = new Map(
        routes.map((route) => [
          String(route._id),
          `${route.source} → ${route.destination}`,
        ]),
      );
      ok(res, {
        vehicles: [
          ...cars.map((car) => ({
            id: String(car._id),
            registration: car.registrationNumber,
            name: `${car.make} ${car.model}`,
            category: car.vehicleCategory,
            capacity: car.bookablePassengerCapacity,
            status: car.status,
          })),
          ...buses.map((bus) => ({
            id: String(bus._id),
            registration: bus.registration,
            name: bus.name,
            category: bus.type,
            capacity: bus.capacity,
            status: bus.status,
          })),
        ],
        trips: rows.map((trip) => {
          const seats = (
            trip.seats as {
              number: string;
              state: string;
              isDriver?: boolean;
              isBookable?: boolean;
              category?: string;
            }[]
          ).filter(
            (seat) =>
              !seat.isDriver &&
              seat.isBookable !== false &&
              seat.number !== "D" &&
              seat.category !== "driver",
          );
          return {
            id: String(trip._id),
            number: trip.tripNumber,
            route: trip.routeName || routeNames.get(String(trip.routeId)),
            registration: trip.carRegistration,
            departureAt: trip.departureAt,
            arrivalAt: trip.arrivalAt,
            status: trip.status,
            capacity: seats.length,
            bookedSeats: seats.filter((seat) => seat.state === "booked").length,
          };
        }),
        totalTrips,
      });
    }),
  );
  return router;
}
