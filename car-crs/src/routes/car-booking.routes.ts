import express from "express";
import {
  createSeatHold,
  createRoundTripSeatHold,
  getSeatHold,
  releaseSeatHold,
} from "../services/car-hold.service.js";
import {
  confirmBooking,
  getBookingByIdOrPnr,
  getBookingTickets,
} from "../services/car-booking.service.js";
import {
  quoteCancellation,
  cancelBooking,
  getRefundStatus,
} from "../services/car-cancellation.service.js";
import {
  createHoldSchema,
  createRoundTripHoldSchema,
  confirmBookingSchema,
  cancelBookingSchema,
} from "../validators/car-booking.validators.js";
import { fail, ok } from "../utils/response.js";
import { CarBooking } from "../models/car-booking.model.js";
import { requireCarPermission } from "../middleware/auth.middleware.js";

export const carBookingRouter = express.Router();

function getOperatorAndUser(req: express.Request) {
  if (req.carProvider) return { ...req.carProvider, channel: "partner" as const };
  if (!req.carAuth) fail(401, "UNAUTHENTICATED", "Authentication required");
  return { operatorId: req.carAuth.operatorId, userId: req.carAuth.userId, channel: "operator" as const };
}

carBookingRouter.use((req, res, next) => {
  if (req.carProvider) return next();
  return requireCarPermission(req.method === "GET" ? "car:bookings:read" : "car:bookings:write")(req, res, next);
});

// Resolve a stable, owned booking before reading its tickets or changing its state.
carBookingRouter.param("bookingId", async (req, _res, next, id: string) => {
  const { operatorId } = getOperatorAndUser(req);
  const key = /^[a-f0-9]{24}$/i.test(id) ? { _id: id } : { pnr: id.toUpperCase() };
  const booking = await CarBooking.findOne({
    ...key, operatorId, ...(req.carProvider ? { userId: req.carProvider.userId, channel: "partner" } : {}),
  }).select("_id");
  if (!booking) fail(404, "BOOKING_NOT_FOUND", "Booking not found");
  req.params.bookingId = String(booking._id);
  next();
});

// 1. Create Seat Hold (One Way)
carBookingRouter.post("/holds", async (req, res, next) => {
  try {
    const validated = createHoldSchema.parse(req.body);
    const { operatorId, userId } = getOperatorAndUser(req);

    const result = await createSeatHold({
      operatorId,
      userId,
      tripId: validated.tripId,
      seatIds: validated.seatIds,
      legType: validated.legType || "single",
      holdDurationSeconds: validated.holdDurationSeconds,
    });

    return ok(res, result, undefined, 201);
  } catch (err) {
    next(err);
  }
});

// 2. Create Round Trip Seat Hold
carBookingRouter.post("/holds/round-trip", async (req, res, next) => {
  try {
    const validated = createRoundTripHoldSchema.parse(req.body);
    const { operatorId, userId } = getOperatorAndUser(req);

    const result = await createRoundTripSeatHold({
      operatorId,
      userId,
      outboundTripId: validated.outboundTripId,
      outboundSeatIds: validated.outboundSeatIds,
      returnTripId: validated.returnTripId,
      returnSeatIds: validated.returnSeatIds,
      holdDurationSeconds: validated.holdDurationSeconds,
    });

    return ok(res, result, undefined, 201);
  } catch (err) {
    next(err);
  }
});

// 3. Get Seat Hold
carBookingRouter.get("/holds/:id", async (req, res, next) => {
  try {
    const { operatorId, userId } = getOperatorAndUser(req);
    const hold = await getSeatHold(req.params.id, { operatorId, userId });
    return ok(res, hold);
  } catch (err) {
    next(err);
  }
});

// 4. Release Seat Hold
carBookingRouter.delete("/holds/:id", async (req, res, next) => {
  try {
    const { userId, operatorId } = getOperatorAndUser(req);
    const result = await releaseSeatHold(req.params.id, userId, operatorId);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

// 5. Confirm Booking (One Way & Round Trip)
carBookingRouter.post("/bookings/confirm", async (req, res, next) => {
  try {
    const validated = confirmBookingSchema.parse(req.body);
    const { operatorId, userId, channel } = getOperatorAndUser(req);

    if (req.carProvider && (validated.agentId || validated.payment.mode !== "sandbox"))
      fail(400, "SANDBOX_PAYMENT_REQUIRED", "Use sandbox payment for provider bookings");
    const result = await confirmBooking(
      operatorId,
      userId,
      req.carAuth && validated.agentId && req.body.channel === "agent" ? "agent" : channel,
      validated
    );

    return ok(res, result, undefined, 201);
  } catch (err) {
    next(err);
  }
});

// 6. Get Booking Details by ID or PNR
carBookingRouter.get("/bookings/:bookingId", async (req, res, next) => {
  try {
    const { operatorId } = getOperatorAndUser(req);
    const booking = await getBookingByIdOrPnr(req.params.bookingId, operatorId);
    return ok(res, booking);
  } catch (err) {
    next(err);
  }
});

// 7. Get Booking Tickets
carBookingRouter.get("/bookings/:bookingId/tickets", async (req, res, next) => {
  try {
    const tickets = await getBookingTickets(req.params.bookingId);
    return ok(res, tickets);
  } catch (err) {
    next(err);
  }
});

// 8. Cancellation Quote
carBookingRouter.post("/bookings/:bookingId/cancellation-quote", async (req, res, next) => {
  try {
    const quote = await quoteCancellation(req.params.bookingId);
    return ok(res, quote);
  } catch (err) {
    next(err);
  }
});

// 9. Cancel Booking
carBookingRouter.post("/bookings/:bookingId/cancel", async (req, res, next) => {
  try {
    const validated = cancelBookingSchema.parse(req.body);
    const { operatorId } = getOperatorAndUser(req);
    const result = await cancelBooking(req.params.bookingId, operatorId, validated);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

// 10. Refund Status
carBookingRouter.get("/bookings/:bookingId/refund-status", async (req, res, next) => {
  try {
    const status = await getRefundStatus(req.params.bookingId);
    return ok(res, status);
  } catch (err) {
    next(err);
  }
});
