import mongoose from "mongoose";
import { CarBooking } from "../models/car-booking.model.js";
import { CarTicket } from "../models/car-ticket.model.js";
import { CarTrip } from "../models/car-trip.model.js";
import { postCancellationFinancialJournal } from "./car-finance.service.js";
import { fail } from "../utils/response.js";

/**
 * Calculates authoritative cancellation refund quote based on hours before departure.
 */
export async function quoteCancellation(bookingId: string, operatorId?: string) {
  const filter: any = {};
  if (/^[a-fA-F0-9]{24}$/.test(bookingId)) {
    filter.$or = [{ _id: bookingId }, { pnr: bookingId.toUpperCase() }];
  } else {
    filter.pnr = bookingId.toUpperCase();
  }

  if (operatorId) {
    filter.operatorId = new mongoose.Types.ObjectId(operatorId);
  }

  const booking: any = await CarBooking.findOne(filter).lean();
  if (!booking) {
    fail(404, "BOOKING_NOT_FOUND", `Car booking '${bookingId}' not found`);
  }

  if (booking.paymentStatus === "Refunded" || booking.legs.every((l: any) => l.status === "Cancelled")) {
    fail(400, "ALREADY_CANCELLED", "Booking is already cancelled and refunded");
  }

  // Earliest departure determines policy tier
  const earliestDeparture = new Date(
    Math.min(...booking.legs.map((l: any) => +new Date(l.departureAt)))
  );

  const hoursRemaining = (earliestDeparture.getTime() - Date.now()) / (1000 * 60 * 60);

  let cancellationFeePercent = 10; // Default: > 24 hours
  if (hoursRemaining <= 2) {
    cancellationFeePercent = 100; // Within 2 hours: non-refundable
  } else if (hoursRemaining <= 12) {
    cancellationFeePercent = 50; // 2-12 hours: 50% fee
  } else if (hoursRemaining <= 24) {
    cancellationFeePercent = 25; // 12-24 hours: 25% fee
  }

  const totalPaidPaise = booking.totalPayablePaise;
  const cancellationFeePaise = Math.round((totalPaidPaise * cancellationFeePercent) / 100);
  const refundablePaise = totalPaidPaise - cancellationFeePaise;

  return {
    bookingId: booking._id,
    pnr: booking.pnr,
    bookingType: booking.bookingType,
    totalPaidPaise,
    cancellationFeePercent,
    cancellationFeePaise,
    refundablePaise,
    hoursBeforeDeparture: Math.max(0, Math.round(hoursRemaining * 10) / 10),
    eligible: refundablePaise > 0,
  };
}

/**
 * Cancels a confirmed booking, safely releases seat inventory, cancels tickets,
 * and posts reversing financial journal.
 */
export async function cancelBooking(
  bookingId: string,
  operatorId: string,
  params: { reason: string; cancelledBy?: string }
) {
  const filter: any = {};
  if (/^[a-fA-F0-9]{24}$/.test(bookingId)) {
    filter.$or = [{ _id: bookingId }, { pnr: bookingId.toUpperCase() }];
  } else {
    filter.pnr = bookingId.toUpperCase();
  }

  if (operatorId) {
    filter.operatorId = new mongoose.Types.ObjectId(operatorId);
  }

  const booking = await CarBooking.findOne(filter);
  if (!booking) {
    fail(404, "BOOKING_NOT_FOUND", `Car booking '${bookingId}' not found`);
  }

  if (booking.paymentStatus === "Refunded") {
    fail(400, "ALREADY_CANCELLED", "Booking is already cancelled and refunded");
  }

  // 1. Calculate refund quote
  const quote = await quoteCancellation(booking._id.toString(), operatorId);

  // 2. Release seat inventory on all booked trips
  for (const leg of booking.legs) {
    const trip = await CarTrip.findById(leg.tripId);
    if (trip) {
      const bookedSeatIds = new Set(leg.seats.map((s: any) => s.seatId));
      let modified = false;

      for (const s of trip.seats) {
        if (bookedSeatIds.has(s.seatId) && String(s.bookingId) === String(booking._id)) {
          s.state = "available";
          s.bookingId = undefined as any;
          s.passengerName = undefined as any;
          s.holdId = undefined as any;
          s.holdUntil = undefined as any;
          modified = true;
        }
      }

      if (modified) {
        trip.markModified("seats");
        await trip.save();
      }
    }
    leg.status = "Cancelled";
  }

  // 3. Invalidate Car Tickets
  await CarTicket.updateMany(
    { bookingId: booking._id },
    {
      status: "cancelled",
      cancellationReason: params.reason,
      cancelledAt: new Date(),
    }
  );

  // 4. Update Booking status
  booking.paymentStatus = quote.refundablePaise > 0 ? "Refunded" : "Failed";
  booking.markModified("legs");
  await booking.save();

  // 5. Post Reversing Financial Ledger Journal
  if (quote.refundablePaise > 0) {
    await postCancellationFinancialJournal({
      operatorId,
      bookingId: booking._id.toString(),
      pnr: booking.pnr,
      refundablePaise: quote.refundablePaise,
      cancellationFeePaise: quote.cancellationFeePaise,
      reason: params.reason,
    });
  }

  return {
    bookingId: booking._id,
    pnr: booking.pnr,
    status: "Cancelled",
    cancelled: true,
    paymentStatus: booking.paymentStatus,
    refundStatus: booking.paymentStatus,
    totalPaidPaise: quote.totalPaidPaise,
    cancellationFeePaise: quote.cancellationFeePaise,
    refundablePaise: quote.refundablePaise,
    reason: params.reason,
    cancelledAt: new Date(),
  };
}

/**
 * Retrieves refund status for a cancelled booking.
 */
export async function getRefundStatus(bookingId: string, operatorId?: string) {
  const filter: any = {};
  if (/^[a-fA-F0-9]{24}$/.test(bookingId)) {
    filter.$or = [{ _id: bookingId }, { pnr: bookingId.toUpperCase() }];
  } else {
    filter.pnr = bookingId.toUpperCase();
  }

  if (operatorId) {
    filter.operatorId = new mongoose.Types.ObjectId(operatorId);
  }

  const booking: any = await CarBooking.findOne(filter).lean();
  if (!booking) {
    fail(404, "BOOKING_NOT_FOUND", `Car booking '${bookingId}' not found`);
  }

  const isCancelled = booking.paymentStatus === "Refunded" || booking.paymentStatus === "Partially Refunded";

  return {
    bookingId: booking._id,
    pnr: booking.pnr,
    paymentStatus: booking.paymentStatus,
    isCancelled,
    totalPaidPaise: booking.totalPayablePaise,
    legs: booking.legs.map((l: any) => ({
      legType: l.legType,
      status: l.status,
      seats: l.seats,
    })),
  };
}
