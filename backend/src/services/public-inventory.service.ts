import mongoose from "mongoose";
import * as M from "../models/index.js";
import * as P from "../models/public-api.model.js";
import { publicId, type PartnerIdentity } from "./public-auth.service.js";
import { resolveAreaRoutes } from "./area-master.service.js";
import { cityKey } from "./city-catalog.service.js";
import { fail, type Principal } from "../utils/core.js";

export function partnerPrincipal(
  identity: PartnerIdentity,
  operatorId: string,
): Principal {
  return {
    operatorId,
    userId: identity.partnerId,
    role: "booking_staff",
    sessionId: identity.credentialId,
    permissions: ["read", "bookings:write", "refunds:write"],
  };
}
export async function resourceId(kind: string, internalKey: string) {
  const id = publicId(kind);
  try {
    return (await P.PublicResource.findOneAndUpdate(
      { kind, internalKey },
      { $setOnInsert: { publicId: id } },
      { upsert: true, new: true },
    ))!.publicId;
  } catch (error) {
    if ((error as any).code !== 11000) throw error;
    return (await P.PublicResource.findOne({ kind, internalKey }))!.publicId;
  }
}
export async function internalResource(kind: string, id: string) {
  const mapping = await P.PublicResource.findOne({ publicId: id, kind }).lean();
  if (!mapping)
    fail(404, "RESOURCE_NOT_FOUND", "Authorized resource not found");
  return mapping!.internalKey;
}
export async function grantFilter(identity: PartnerIdentity) {
  const partner = await P.ApiPartner.findOne({
    _id: identity.partnerId,
    status: "Active",
  })
    .select("bookingCutoffMinutes")
    .lean();
  if (!partner) fail(401, "PARTNER_UNAUTHORIZED", "Partner is inactive");
  const grants = await P.PartnerInventoryGrant.find({
    partnerId: identity.partnerId,
    active: true,
    expiresAt: { $gt: new Date() },
  }).lean();
  const owners = await M.Operator.find({
    _id: { $in: grants.map((g) => g.operatorId) },
    status: "approved",
    salesBlocked: { $ne: true },
    publicSandboxInventory: true,
  })
    .select("_id")
    .lean();
  const ids = new Set(owners.map((o) => String(o._id)));
  const clauses = grants
    .filter(
      (g) =>
        ids.has(String(g.operatorId)) &&
        (g.kind !== "Operator" || String(g.operatorId) === String(g.targetId)),
    )
    .map((g) => ({
      operatorId: g.operatorId,
      ...(g.kind === "Operator"
        ? {}
        : {
            [({ Route: "routeId", Service: "serviceId", Trip: "_id" } as any)[
              g.kind
            ]]: g.targetId,
          }),
    }));
  return {
    inventoryOwner: "internal",
    status: "Scheduled",
    bookingOpen: { $ne: false },
    departureAt: {
      $gt: new Date(
        Date.now() + Number(partner!.bookingCutoffMinutes || 0) * 60000,
      ),
    },
    $or: clauses.length ? clauses : [{ _id: null }],
  };
}
export async function authorizedTrip(identity: PartnerIdentity, id: string) {
  const internal = await internalResource("trip", id);
  if (!mongoose.isValidObjectId(internal))
    fail(404, "RESOURCE_NOT_FOUND", "Authorized trip not found");
  const trip: any = await M.Trip.findOne({
    ...(await grantFilter(identity)),
    _id: internal,
  }).lean();
  if (!trip) fail(404, "RESOURCE_NOT_FOUND", "Authorized trip not found");
  const storedBus = await M.Bus.findOne({
      _id: trip.busId,
      operatorId: trip.operatorId,
      status: "Active",
    }).lean(),
    stored = await M.Route.findOne({
      _id: trip.routeId,
      operatorId: trip.operatorId,
      status: "Active",
    }).lean();
  const car:any = trip.carId ? await M.Car.findOne({_id:trip.carId,operatorId:trip.operatorId,status:"Active"}).lean() : null;
  const bus:any = car ? {...car,name:[car.make,car.model].filter(Boolean).join(" "),type:car.vehicleCategory,capacity:car.bookablePassengerCapacity} : storedBus;
  if (!bus || !stored)
    fail(404, "RESOURCE_NOT_FOUND", "Authorized trip not found");
  const [route] = await resolveAreaRoutes(String(trip.operatorId), [stored]);
  return {
    trip,
    bus: bus!,
    route: route!,
    auth: partnerPrincipal(identity, String(trip.operatorId)),
  };
}
export async function publicTrip(identity: PartnerIdentity, id: string) {
  const { trip, bus, route } = await authorizedTrip(identity, id),
    operator = await M.Operator.findById(trip.operatorId)
      .select("company")
      .lean();
  const now = new Date();
  const cityDetails = async (recordId: unknown) => {
    if (!recordId) return { CityKey: null, State: null, CatalogCityId: null };
    const city: any = await M.City.findOne({ _id: recordId, operatorId: trip.operatorId }).lean();
    const catalog: any = city?.catalogId ? await M.CatalogCity.findById(city.catalogId).select("cityId key").lean() : null;
    return { CityKey: catalog?.key || (city ? cityKey(city.name, city.state, city.country) : null), State: city?.state || null, CatalogCityId: catalog?.cityId || null };
  };
  return {
    id,
    operator: operator!.company,
    bus: { type: bus.type, amenities: bus.amenities || [] },
    route: {
      id: await resourceId("route", String(route._id)),
      from: {
        id: await resourceId(
          "city",
          route.sourceCityId
            ? String(route.sourceCityId)
            : "legacy:" + route.source.trim().toLowerCase(),
        ),
        name: route.source,
        ...(await cityDetails(route.sourceCityId)),
      },
      to: {
        id: await resourceId(
          "city",
          route.destinationCityId
            ? String(route.destinationCityId)
            : "legacy:" + route.destination.trim().toLowerCase(),
        ),
        name: route.destination,
        ...(await cityDetails(route.destinationCityId)),
      },
    },
    journeyDate: trip.journeyDate,
    departureAt: trip.departureAt,
    arrivalAt: trip.arrivalAt || null,
    availableSeats: trip.seats.filter(
      (s: any) =>
        s.state === "available" ||
        (s.state === "held" && new Date(s.holdUntil) <= now),
    ).length,
    seatCount: trip.seats.filter((s:any)=>!s.isDriver&&s.isBookable!==false).length,
    currency: "INR",
    environment: "sandbox",
  };
}
export async function authorizedTrips(
  identity: PartnerIdentity,
  journeyDate?: string,
) {
  const trips = await M.Trip.find({
    ...(await grantFilter(identity)),
    ...(journeyDate ? { journeyDate } : {}),
  })
    .select("_id")
    .sort({ departureAt: 1, _id: 1 })
    .limit(501)
    .lean();
  if (trips.length > 500)
    fail(
      413,
      "SEARCH_SCOPE_TOO_LARGE",
      "Narrow inventory grants or travel date",
    );
  const result = [];
  for (const trip of trips) {
    try {
      result.push(
        await publicTrip(identity, await resourceId("trip", String(trip._id))),
      );
    } catch (e) {
      if ((e as any).code !== "RESOURCE_NOT_FOUND") throw e;
    }
  }
  return result;
}
export async function partnerCommand(
  identity: PartnerIdentity,
  key: string,
  action: string,
  hash: string,
) {
  try {
    await P.PartnerCommand.updateOne(
      { partnerId: identity.partnerId, key },
      {
        $setOnInsert: {
          action,
          requestHash: hash,
          resourceId: publicId(action === "hold" ? "hold" : "booking"),
        },
      },
      { upsert: true },
    );
  } catch (error) {
    if ((error as any).code !== 11000) throw error;
  }
  const command = await P.PartnerCommand.findOne({
    partnerId: identity.partnerId,
    key,
  }).lean();
  if (!command || command.action !== action || command.requestHash !== hash)
    fail(
      409,
      "IDEMPOTENCY_CONFLICT",
      "Request key has already been used for different content",
    );
  return command!;
}
