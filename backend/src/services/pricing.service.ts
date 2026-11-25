import { phoneNumber } from "../validators/account-input.schemas.js";
import { resolveAreaRoutes } from "./area-master.service.js";
import mongoose from "mongoose";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  Hold,
  Offer,
  PricingPolicy,
  Quote,
  Route,
  Trip,
} from "../models/index.js";
import { amount, fail, type Principal } from "../utils/core.js";
export const pricingOptions = z
  .object({
    promoCode: z
      .string()
      .regex(/^[A-Z\d_-]{3,24}$/)
      .optional(),
    operatorDiscountPaise: amount.default(0),
  })
  .strict();
export type PricingOptions = {
  promoCode?: string;
  operatorDiscountPaise?: number;
};
export const contactInput = z
  .object({
    phone: phoneNumber.optional(),
    email: z.string().email().max(254).optional(),
  })
  .strict();
export const gstInput = z
  .object({
    number: z
      .string()
      .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/),
    company: z.string().trim().min(1).max(150),
    address: z.string().trim().min(1).max(300),
  })
  .strict();
export const policyInput = z
  .object({
    taxBasisPoints: z.number().int().min(0).max(10000),
    chargePaise: amount,
    chargesTaxable: z.boolean(),
    operatorDiscountMaxPaise: amount,
    requireAge: z.boolean(),
    requireGender: z.boolean(),
    requireMobile: z.boolean(),
    gstEnabled: z.boolean(),
    expectedVersion: z.number().int().min(0),
  })
  .strict();
export async function priceTrip(
  auth: Principal,
  trip: any,
  numbers: string[],
  options: PricingOptions = {},
  session?: mongoose.ClientSession,
) {
  options = pricingOptions.parse(options);
  if (trip.inventoryOwner !== "internal")
    fail(
      503,
      "EXTERNAL_PRICING_UNAVAILABLE",
      "External pricing requires an authoritative provider adapter",
    );
  const policy = await PricingPolicy.findOne({ operatorId: auth.operatorId })
    .session(session || null)
    .lean();
  if (!policy)
    fail(
      409,
      "PRICING_POLICY_REQUIRED",
      "An authorized manager must configure tax and charge rules before bookings can be priced",
    );
  const seats = (trip.seats as any[]).filter((s) => numbers.includes(s.number));
  if (seats.length !== numbers.length)
    fail(400, "INVALID_SEAT", "One or more selected seats do not exist");
  const grossPaise = seats.reduce((n, s) => n + s.farePaise, 0);
  if (
    seats.some((s) => !Number.isSafeInteger(s.farePaise) || s.farePaise < 0) ||
    !Number.isSafeInteger(grossPaise)
  )
    fail(
      409,
      "FARE_CONFIGURATION_INVALID",
      "Trip fares must be non-negative integer paise",
    );
  const requested = options.operatorDiscountPaise || 0;
  let discountPaise = 0,
    offer: any = null;
  if (requested && !auth.permissions.includes("pricing:write"))
    fail(
      403,
      "DISCOUNT_FORBIDDEN",
      "You are not authorized to apply operator discounts",
    );
  if (requested && options.promoCode)
    fail(
      400,
      "DISCOUNT_CONFLICT",
      "Use either a coupon or an operator discount, not both",
    );
  if (
    requested > Number(policy!.operatorDiscountMaxPaise) ||
    requested > grossPaise
  )
    fail(
      400,
      "DISCOUNT_LIMIT",
      "Operator discount exceeds the configured limit or fare",
    );
  if (options.promoCode) {
    offer = await Offer.findOne({
      operatorId: auth.operatorId,
      code: options.promoCode,
      status: "Active",
      startDate: { $lte: trip.journeyDate },
      endDate: { $gte: trip.journeyDate },
      $or: [{ routeIds: { $size: 0 } }, { routeIds: trip.routeId }],
    })
      .session(session || null)
      .lean();
    if (!offer)
      fail(
        400,
        "OFFER_INELIGIBLE",
        "Coupon is not valid for this route and date",
      );
    discountPaise = Math.min(
      Math.floor((grossPaise * Number(offer.percent)) / 100),
      Number(offer.maxDiscountPaise ?? grossPaise),
    );
  } else discountPaise = requested;
  const chargePaise = Number(policy!.chargePaise),
    taxablePaise =
      grossPaise - discountPaise + (policy!.chargesTaxable ? chargePaise : 0);
  const taxPaise = Math.round(
    (taxablePaise * Number(policy!.taxBasisPoints)) / 10000,
  );
  const totalPaise = grossPaise - discountPaise + chargePaise + taxPaise;
  const rulesFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        policyId: String(policy!._id),
        version: policy!.version,
        offerId: offer ? String(offer._id) : null,
        percent: offer?.percent,
        max: offer?.maxDiscountPaise,
        start: offer?.startDate,
        end: offer?.endDate,
        status: offer?.status,
      }),
    )
    .digest("hex");
  return {
    currency: "INR",
    seatFares: seats.map((s) => ({ number: s.number, basePaise: s.farePaise })),
    grossPaise,
    discountPaise,
    taxablePaise,
    taxBasisPoints: Number(policy!.taxBasisPoints),
    taxPaise,
    chargePaise,
    chargesTaxable: !!policy!.chargesTaxable,
    totalPaise,
    policyVersion: Number(policy!.version),
    rulesFingerprint,
    offerId: offer ? String(offer._id) : undefined,
    promoCode: options.promoCode,
    operatorDiscountPaise: requested,
    requirements: {
      age: !!policy!.requireAge,
      gender: !!policy!.requireGender,
      mobile: !!policy!.requireMobile,
      gstEnabled: !!policy!.gstEnabled,
    },
  };
}
export async function issueQuote(
  auth: Principal,
  tripId: string,
  numbers: string[],
  options: PricingOptions,
  holdId?: string,
) {
  const trip = await Trip.findOne({
    _id: tripId,
    operatorId: auth.operatorId,
  }).lean();
  if (!trip) fail(404, "NOT_FOUND", "Trip not found");
  if (
    trip!.status !== "Scheduled" ||
    trip!.bookingOpen === false ||
    new Date(trip!.departureAt as Date) <= new Date()
  )
    fail(409, "TRIP_CLOSED", "Trip is not accepting new bookings");
  let expiresAt = new Date(Date.now() + 2 * 60000);
  if (holdId) {
    const hold = await Hold.findOne({
      operatorId: auth.operatorId,
      tripId,
      userId: auth.userId,
      holdId,
      status: "held",
      expiresAt: { $gt: new Date() },
    }).lean();
    if (
      !hold ||
      [...(hold.seats as string[])].sort().join("|") !==
        [...numbers].sort().join("|")
    )
      fail(
        409,
        "HOLD_INVALID",
        "Hold expired or does not match the selected seats",
      );
    expiresAt = new Date(
      Math.min(+expiresAt, +new Date(hold!.expiresAt as Date)),
    );
  }
  const now = new Date();
  for (const number of numbers) {
    const s = (trip!.seats as any[]).find((s) => s.number === number);
    if (!s) fail(400, "INVALID_SEAT", "Selected seat does not exist");
    const free =
      s.state === "available" ||
      (s.state === "held" && new Date(s.holdUntil) <= now);
    const owned =
      s.state === "held" &&
      holdId &&
      s.holdId === holdId &&
      String(s.holdUserId) === auth.userId &&
      new Date(s.holdUntil) > now;
    if (!free && !owned)
      fail(409, "SEAT_UNAVAILABLE", "Selected seat is not available");
  }
  const pricing = await priceTrip(auth, trip, numbers, {
    promoCode: options.promoCode,
    operatorDiscountPaise: options.operatorDiscountPaise,
  });
  const quote = await Quote.create({
    operatorId: auth.operatorId,
    userId: auth.userId,
    tripId,
    holdId,
    seats: numbers,
    pricing,
    expiresAt,
  });
  return { quoteId: String(quote._id), holdId, expiresAt, pricing };
}
export async function validatePassengers(
  auth: Principal,
  trip: any,
  passengers: any[],
  pricing: Awaited<ReturnType<typeof priceTrip>>,
  contact?: z.infer<typeof contactInput>,
  gst?: z.infer<typeof gstInput>,
  session?: mongoose.ClientSession,
) {
  const storedRoute = await Route.findOne({
    _id: trip.routeId,
    operatorId: auth.operatorId,
  })
    .session(session || null)
    .lean();
  const [route] = await resolveAreaRoutes(
    auth.operatorId!,
    storedRoute ? [storedRoute] : [],
    session,
  );
  if (!route) fail(409, "ROUTE_UNAVAILABLE", "Trip route is unavailable");
  if (
    pricing.requirements.mobile &&
    !contact?.phone &&
    !passengers.some((p) => p.phone)
  )
    fail(400, "CONTACT_REQUIRED", "A valid mobile number is required");
  if (gst && !pricing.requirements.gstEnabled)
    fail(
      400,
      "GST_UNAVAILABLE",
      "GST details are not enabled by this operator",
    );
  for (const p of passengers) {
    if (pricing.requirements.age && p.age === undefined)
      fail(400, "AGE_REQUIRED", `Age is required for seat ${p.seat}`);
    if (pricing.requirements.gender && !p.gender)
      fail(400, "GENDER_REQUIRED", `Gender is required for seat ${p.seat}`);
    if (
      p.boarding &&
      !(route!.boarding as any[]).some((stop) => stop.name === p.boarding)
    )
      fail(400, "BOARDING_INVALID", "Choose a valid trip boarding point");
    if (
      p.dropping &&
      !(route!.dropping as any[]).some((stop) => stop.name === p.dropping)
    )
      fail(400, "DROPPING_INVALID", "Choose a valid trip dropping point");
  }
}
