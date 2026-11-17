import type mongoose from "mongoose";
import { AreaLocation, City } from "../models/index.js";
export async function resolveAreaRoutes(
  operatorId: string,
  routes: any[],
  session?: mongoose.ClientSession,
) {
  const ids = routes.flatMap((route) =>
    [...(route.boarding || []), ...(route.dropping || [])].flatMap((stop) =>
      stop.locationId ? [stop.locationId] : [],
    ),
  );
  if (!ids.length) return routes;
  const points = await AreaLocation.find({
    operatorId,
    _id: { $in: ids },
    status: "Active",
  })
    .session(session || null)
    .lean();
  const cities = await City.find({
    operatorId,
    _id: { $in: points.map((point) => point.cityId) },
    status: "Active",
  })
    .session(session || null)
    .lean();
  const activeCities = new Set(cities.map((city) => String(city._id)));
  const locations = new Map(
    points
      .filter((point) => activeCities.has(String(point.cityId)))
      .map((point) => [String(point._id), point]),
  );
  const resolve = (stops: any[], usage: string) =>
    stops.flatMap((stop) => {
      if (!stop.locationId) return [stop];
      const location = locations.get(String(stop.locationId));
      if (!location || ![usage, "Both"].includes(String(location.usage)))
        return [];
      return [{ ...stop, name: location.name, address: location.address }];
    });
  return routes.map((route) => ({
    ...route,
    boarding: resolve(route.boarding || [], "Pickup"),
    dropping: resolve(route.dropping || [], "Drop"),
  }));
}
