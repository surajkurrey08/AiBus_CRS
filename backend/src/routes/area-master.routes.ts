import { Router, type Request } from "express";
import mongoose from "mongoose";
import * as M from "../models/index.js";
import {
  asyncRoute,
  fail,
  id,
  literalRegex,
  ok,
  pagination,
  permit,
  tenant,
} from "../utils/core.js";
import {
  cityInput,
  locationInput,
  poiInput,
  routeStopInput,
} from "../validators/area-master.schemas.js";
export const normalizedAreaName = (value: string) =>
  value.trim().replace(/\s+/g, " ").toLowerCase();
async function owned(
  model: mongoose.Model<any>,
  req: Request,
  recordId: string,
  session?: mongoose.ClientSession,
) {
  const row = await model
    .findOne({ _id: recordId, ...tenant(req) })
    .session(session || null)
    .lean();
  if (!row) fail(404, "NOT_FOUND", "Area record not found");
  return row as any;
}
async function audit(
  req: Request,
  action: string,
  resourceId: string,
  session: mongoose.ClientSession,
) {
  await M.Audit.create(
    [
      {
        ...tenant(req),
        actorId: req.auth.userId,
        action,
        resourceId,
        requestId: req.requestId,
      },
    ],
    { session },
  );
}
export function areaMasterRouter() {
  const router = Router();
  const resources = [
    {
      path: "cities",
      model: M.City,
      schema: cityInput,
      fields: ["name", "state", "country"],
      optional: [],
    },
    {
      path: "locations",
      model: M.AreaLocation,
      schema: locationInput,
      fields: ["name", "address", "phone", "usage"],
      optional: ["address", "landmarkId", "phone", "latitude", "longitude"],
    },
    {
      path: "pois",
      model: M.AreaPoi,
      schema: poiInput,
      fields: ["name", "address", "category"],
      optional: ["address", "latitude", "longitude"],
    },
  ];
  for (const resource of resources) {
    router.get(
      `/${resource.path}`,
      permit("read"),
      asyncRoute(async (req, res) => {
        const p = pagination(req);
        const cityId = req.query.cityId
          ? id.parse(req.query.cityId)
          : undefined;
        const filter = {
          ...tenant(req),
          ...(cityId && resource.path !== "cities" ? { cityId } : {}),
          ...(p.status ? { status: p.status } : {}),
          ...(p.search
            ? {
                $or: resource.fields.map((field) => ({
                  [field]: literalRegex(p.search),
                })),
              }
            : {}),
        };
        const sort =
          p.sort && [...resource.fields, "status", "createdAt"].includes(p.sort)
            ? p.sort
            : "name";
        const [rows, total] = await Promise.all([
          resource.model
            .find(filter)
            .sort({ [sort]: p.order === "desc" ? -1 : 1 })
            .skip((p.page - 1) * p.limit)
            .limit(p.limit)
            .lean(),
          resource.model.countDocuments(filter),
        ]);
        const cities =
          resource.path === "cities"
            ? []
            : await M.City.find({
                ...tenant(req),
                _id: { $in: rows.map((row: any) => row.cityId) },
              }).lean();
        ok(
          res,
          rows.map((row: any) => ({
            ...row,
            ...(row.cityId
              ? {
                  cityName:
                    cities.find(
                      (city) => String(city._id) === String(row.cityId),
                    )?.name || "City unavailable",
                }
              : {}),
          })),
          {
            page: p.page,
            limit: p.limit,
            total,
            pages: Math.max(1, Math.ceil(total / p.limit)),
          },
        );
      }),
    );
    router.get(
      `/${resource.path}/:id`,
      permit("read"),
      asyncRoute(async (req, res) =>
        ok(res, await owned(resource.model, req, id.parse(req.params.id))),
      ),
    );
    for (const method of ["post", "patch"] as const)
      router[method](
        `/${resource.path}${method === "patch" ? "/:id" : ""}`,
        permit("routes:write"),
        asyncRoute(async (req, res) => {
          const input = resource.schema.parse(req.body) as Record<string, any>;
          let result: any;
          await mongoose.connection.transaction(async (session) => {
            if (input.cityId) {
              const city = await owned(M.City, req, input.cityId, session);
              if (city.status !== "Active" && input.status === "Active")
                fail(409, "CITY_INACTIVE", "Select an active city");
            }
            if (input.landmarkId) {
              const poi = await owned(
                M.AreaPoi,
                req,
                input.landmarkId,
                session,
              );
              if (
                String(poi.cityId) !== input.cityId ||
                poi.status !== "Active"
              )
                fail(
                  400,
                  "LANDMARK_CITY_MISMATCH",
                  "Select an active landmark in the same city",
                );
            }
            if (resource.path === "cities")
              input.key = [input.name, input.state, input.country]
                .map(normalizedAreaName)
                .join("|");
            if (method === "patch") {
              const recordId = id.parse(req.params.id);
              await owned(resource.model, req, recordId, session);
              const unset = Object.fromEntries(
                resource.optional
                  .filter((key) => !(key in input))
                  .map((key) => [key, 1]),
              );
              result = await resource.model.findOneAndUpdate(
                { _id: recordId, ...tenant(req) },
                { $set: input, $unset: unset },
                { new: true, runValidators: true, session },
              );
            } else
              [result] = await resource.model.create(
                [{ ...input, ...tenant(req) }],
                { session },
              );
            await audit(
              req,
              `area_master.${resource.path}.${method === "post" ? "create" : "update"}`,
              String(result._id),
              session,
            );
          });
          ok(res, result, undefined, method === "post" ? 201 : 200);
        }),
      );
  }
  router.put(
    "/routes/:id/stops",
    permit("routes:write"),
    asyncRoute(async (req, res) => {
      const routeId = id.parse(req.params.id),
        input = routeStopInput.parse(req.body);
      let result: any;
      await mongoose.connection.transaction(async (session) => {
        const route = await owned(M.Route, req, routeId, session);
        if (route.providerId)
          fail(
            403,
            "EXTERNAL_ROUTE",
            "External route stops are managed by their provider",
          );
        const resolveStops = async (
          stops: typeof input.boarding,
          cityId: string,
          cityName: string,
          usage: "Pickup" | "Drop",
        ) => {
          const resolved = [];
          for (const point of stops) {
            const location = await owned(
              M.AreaLocation,
              req,
              point.locationId,
              session,
            );
            const city = await owned(
              M.City,
              req,
              String(location.cityId),
              session,
            );
            if (location.status !== "Active" || city.status !== "Active")
              fail(409, "STOP_INACTIVE", "Select active stops and cities");
            if (
              String(city._id) !== cityId ||
              normalizedAreaName(city.name) !== normalizedAreaName(cityName) ||
              ![usage, "Both"].includes(location.usage)
            )
              fail(
                400,
                "STOP_ROUTE_MISMATCH",
                "Pickup stops must match the route origin and drop stops its destination",
              );
            resolved.push({
              locationId: location._id,
              name: location.name,
              ...(location.address ? { address: location.address } : {}),
              ...(point.time ? { time: point.time } : {}),
            });
          }
          return resolved;
        };
        const boarding = await resolveStops(
          input.boarding,
          input.sourceCityId,
          route.source,
          "Pickup",
        );
        const dropping = await resolveStops(
          input.dropping,
          input.destinationCityId,
          route.destination,
          "Drop",
        );
        result = await M.Route.findOneAndUpdate(
          { _id: routeId, ...tenant(req), __v: input.expectedVersion },
          {
            $set: {
              boarding,
              dropping,
              sourceCityId: input.sourceCityId,
              destinationCityId: input.destinationCityId,
            },
            $inc: { __v: 1 },
          },
          { new: true, runValidators: true, session },
        );
        if (!result)
          fail(
            409,
            "ROUTE_CHANGED",
            "Route changed. Reload it before saving stop assignments",
          );
        await audit(req, "area_master.route.stops", routeId, session);
        await M.Outbox.create(
          [
            {
              ...tenant(req),
              event: "area.master.updated",
              resourceId: routeId,
            },
          ],
          { session },
        );
      });
      ok(res, result);
    }),
  );
  return router;
}
