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
import { ok } from "../utils/response.js";
import mongoose from "mongoose";

export const carBookingRouter = express.Router();

function getOperatorAndUser(req: express.Request) {
  const operatorUser = (req as any).carAuth || (req as any).carOperator;
  const operatorId =
    operatorUser?.operatorId ||
    (req.headers["x-operator-id"] as string) ||
    "65f1a2b3c4d5e6f7a8b9c0d1";
  const userId =
    operatorUser?.userId ||
    (req.headers["x-user-id"] as string) ||
    new mongoose.Types.ObjectId().toString();
  const channel: "operator" | "customer" | "agent" | "partner" =
    operatorUser ? "operator" : "customer";

  return { operatorId, userId, channel };
}

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
    const hold = await getSeatHold(req.params.id);
    return ok(res, hold);
  } catch (err) {
    next(err);
  }
});

// 4. Release Seat Hold
carBookingRouter.delete("/holds/:id", async (req, res, next) => {
  try {
    const { userId } = getOperatorAndUser(req);
    const result = await releaseSeatHold(req.params.id, userId);
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

    const result = await confirmBooking(
      operatorId,
      userId,
      (req.body.channel as any) || channel,
      validated
    );

    return ok(res, result, undefined, 201);
  } catch (err) {
    next(err);
  }
});

// 6. Get Booking Details by ID or PNR
carBookingRouter.get("/bookings/:id", async (req, res, next) => {
  try {
    const operatorId =
      (req as any).carAuth?.operatorId || (req as any).carOperator?.operatorId;
    const booking = await getBookingByIdOrPnr(req.params.id, operatorId);
    return ok(res, booking);
  } catch (err) {
    next(err);
  }
});

// 7. Get Booking Tickets
carBookingRouter.get("/bookings/:id/tickets", async (req, res, next) => {
  try {
    const tickets = await getBookingTickets(req.params.id);
    return ok(res, tickets);
  } catch (err) {
    next(err);
  }
});

// 8. Cancellation Quote
carBookingRouter.post("/bookings/:id/cancellation-quote", async (req, res, next) => {
  try {
    const quote = await quoteCancellation(req.params.id);
    return ok(res, quote);
  } catch (err) {
    next(err);
  }
});

// 9. Cancel Booking
carBookingRouter.post("/bookings/:id/cancel", async (req, res, next) => {
  try {
    const validated = cancelBookingSchema.parse(req.body);
    const { operatorId } = getOperatorAndUser(req);
    const result = await cancelBooking(req.params.id, operatorId, validated);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

// 10. Refund Status
carBookingRouter.get("/bookings/:id/refund-status", async (req, res, next) => {
  try {
    const status = await getRefundStatus(req.params.id);
    return ok(res, status);
  } catch (err) {
    next(err);
  }
});
