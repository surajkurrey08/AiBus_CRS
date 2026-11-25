import mongoose from "mongoose";
import crypto from "node:crypto";
import { CarTrip } from "../models/car-trip.model.js";
import { CarSeatHold } from "../models/car-hold.model.js";
import { CarBooking } from "../models/car-booking.model.js";
import { CarTicket } from "../models/car-ticket.model.js";
import { Car } from "../models/car.model.js";
import { CarRoute } from "../models/car-route.model.js";
import { postBookingFinancialJournal } from "./car-finance.service.js";
import { validateHoldForBooking } from "./car-hold.service.js";
import { fail } from "../utils/response.js";
import { z } from "zod";
import { confirmBookingSchema } from "../validators/car-booking.validators.js";

function generatePnr(): string {
  // PNR format: CAR + 7 alphanumeric characters (e.g., CAR7B9X2K4)
  const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // Excluding easily confused 0,1,I,O
  let randomPart = "";
  const bytes = crypto.randomBytes(7);
  for (let i = 0; i < 7; i++) {
    randomPart += chars[bytes[i] % chars.length];
  }
  return `CAR${randomPart}`;
}

function computeRequestHash(payload: Record<string, unknown>): string {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export type ConfirmBookingInput = z.infer<typeof confirmBookingSchema>;

/**
 * Confirms a Car CRS booking with real-time seat inventory state transition,
 * authoritative fare verification, PNR generation, Ticket issuance, and
 * double-entry ledger posting.
 *
 * Supported: ONE_WAY and ROUND_TRIP for 4-passenger and 7-passenger cars.
 */
export async function confirmBooking(
  operatorId: string,
  userId: string,
  channel: "operator" | "customer" | "agent" | "partner",
  rawInput: ConfirmBookingInput
) {
  const input = confirmBookingSchema.parse(rawInput);
  const requestHash = computeRequestHash(input as any);

  // 1. Idempotency Check
  const existingBooking: any = await CarBooking.findOne({
    operatorId: new mongoose.Types.ObjectId(operatorId),
    idempotencyKey: input.idempotencyKey,
  }).lean();

  if (existingBooking) {
    if (existingBooking.requestHash !== requestHash) {
      fail(
        409,
        "IDEMPOTENCY_CONFLICT",
        "An existing booking exists with this idempotency key but with different parameters"
      );
    }
    // Idempotent replay: fetch and return existing tickets and booking
    const tickets = await CarTicket.find({ bookingId: existingBooking._id }).lean();
    return {
      booking: existingBooking,
      tickets,
      pnr: existingBooking.pnr,
      reference: existingBooking.reference,
      bookingType: existingBooking.bookingType,
      totalPayablePaise: existingBooking.totalPayablePaise,
      paymentStatus: existingBooking.paymentStatus,
      replayed: true,
    };
  }

  // 2. Validate Holds
  const outboundHoldId = input.outboundHoldId || input.holdId!;
  const outboundHold = await CarSeatHold.findOne({
    holdId: outboundHoldId,
  });

  if (!outboundHold) {
    fail(404, "HOLD_NOT_FOUND", `Active hold '${outboundHoldId}' not found`);
  }

  if (outboundHold.status === "expired" || new Date(outboundHold.expiresAt) <= new Date()) {
    if (outboundHold.status !== "expired") {
      outboundHold.status = "expired";
      await outboundHold.save();
    }
    fail(410, "HOLD_EXPIRED", "Seat hold has expired. Please re-hold your seats.");
  }

  if (outboundHold.status !== "held") {
    fail(400, "HOLD_INVALID_STATUS", `Seat hold is '${outboundHold.status}' and cannot be confirmed.`);
  }

  // Verify outbound seats match
  const requestedOutboundSeats = input.passengers.map((p) => p.seatId);
  await validateHoldForBooking(
    outboundHold.tripId.toString(),
    outboundHold.holdId,
    requestedOutboundSeats
  );

  let returnHold: any = null;
  if (input.bookingType === "ROUND_TRIP") {
    returnHold = await CarSeatHold.findOne({
      holdId: input.returnHoldId!,
    });

    if (!returnHold) {
      fail(404, "RETURN_HOLD_NOT_FOUND", `Active return hold '${input.returnHoldId}' not found`);
    }

    if (returnHold.status === "expired" || new Date(returnHold.expiresAt) <= new Date()) {
      if (returnHold.status !== "expired") {
        returnHold.status = "expired";
        await returnHold.save();
      }
      fail(410, "RETURN_HOLD_EXPIRED", "Return seat hold has expired. Please re-hold seats.");
    }

    if (returnHold.status !== "held") {
      fail(400, "RETURN_HOLD_INVALID_STATUS", `Return seat hold is '${returnHold.status}' and cannot be confirmed.`);
    }

    const returnPassengers = input.returnPassengers || input.passengers;
    const requestedReturnSeats = returnPassengers.map((p) => p.seatId);
    await validateHoldForBooking(
      returnHold.tripId.toString(),
      returnHold.holdId,
      requestedReturnSeats
    );
  }

  // 3. Fetch Authoritative Trip and Route Data
  const outboundTrip = await CarTrip.findById(outboundHold.tripId);
  if (!outboundTrip || outboundTrip.status !== "Scheduled" || !outboundTrip.bookingOpen) {
    fail(400, "TRIP_UNAVAILABLE", "Outbound trip is no longer open for booking");
  }

  const outboundCar: any = await Car.findById(outboundTrip.carId).lean();
  const outboundRoute: any = await CarRoute.findById(outboundTrip.routeId).lean();

  let returnTrip: any = null;
  let returnCar: any = null;
  let returnRoute: any = null;

  if (input.bookingType === "ROUND_TRIP") {
    returnTrip = await CarTrip.findById(returnHold.tripId);
    if (!returnTrip || returnTrip.status !== "Scheduled" || !returnTrip.bookingOpen) {
      fail(400, "RETURN_TRIP_UNAVAILABLE", "Return trip is no longer open for booking");
    }

    if (new Date(returnTrip.departureAt) <= new Date(outboundTrip.estimatedArrivalAt)) {
      fail(
        400,
        "INVALID_RETURN_TIMING",
        "Return trip departure must be strictly after outbound arrival"
      );
    }

    returnCar = await Car.findById(returnTrip.carId).lean();
    returnRoute = await CarRoute.findById(returnTrip.routeId).lean();
  }

  // 4. Calculate Authoritative Seat Fares (Never trust client pricing)
  const outboundPassengerSeats: any[] = [];
  let outboundGrossPaise = 0;

  for (const p of input.passengers) {
    const seat: any = outboundTrip.seats.find((s: any) => s.seatId === p.seatId);
    if (!seat) {
      fail(404, "SEAT_NOT_FOUND", `Seat '${p.seatId}' does not exist on outbound trip`);
    }
    if (seat.isDriver) {
      fail(400, "SEAT_NOT_BOOKABLE", "Driver seat cannot be booked");
    }

    outboundPassengerSeats.push({
      seatId: seat.seatId,
      passengerName: p.name,
      farePaise: seat.farePaise,
    });
    outboundGrossPaise += seat.farePaise;
  }

  let returnPassengerSeats: any[] = [];
  let returnGrossPaise = 0;

  if (input.bookingType === "ROUND_TRIP") {
    const returnPassengers = input.returnPassengers || input.passengers;
    for (const p of returnPassengers) {
      const seat: any = returnTrip.seats.find((s: any) => s.seatId === p.seatId);
      if (!seat) {
        fail(404, "SEAT_NOT_FOUND", `Seat '${p.seatId}' does not exist on return trip`);
      }
      if (seat.isDriver) {
        fail(400, "SEAT_NOT_BOOKABLE", "Driver seat cannot be booked");
      }

      returnPassengerSeats.push({
        seatId: seat.seatId,
        passengerName: p.name,
        farePaise: seat.farePaise,
      });
      returnGrossPaise += seat.farePaise;
    }
  }

  const totalGrossPaise = outboundGrossPaise + returnGrossPaise;
  const totalPayablePaise = totalGrossPaise; // Add tax/discount if configured

  // 5. Payment Validation
  if (
    input.payment.amountPaise !== undefined &&
    input.payment.amountPaise !== totalPayablePaise
  ) {
    fail(
      400,
      "FARE_MISMATCH",
      `Payment amount ₹${(input.payment.amountPaise / 100).toFixed(2)} does not match authoritative fare ₹${(totalPayablePaise / 100).toFixed(2)}`
    );
  }

  // 6. Generate Unique PNR and Reference
  let pnr = generatePnr();
  while (await CarBooking.findOne({ pnr })) {
    pnr = generatePnr();
  }
  const reference = `REF-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  const bookingObjectId = new mongoose.Types.ObjectId();

  // 7. Atomic Seat State Transition (held -> booked)
  // Transition Outbound Seats
  const outboundSeatSet = new Set(requestedOutboundSeats);
  for (const s of outboundTrip.seats) {
    if (outboundSeatSet.has(s.seatId)) {
      if (s.state !== "held" || s.holdId !== outboundHoldId) {
        fail(409, "SEAT_STATE_CONFLICT", `Outbound seat '${s.seatId}' is no longer held for you`);
      }
      s.state = "booked";
      s.bookingId = bookingObjectId as any;
      const passenger = input.passengers.find((p) => p.seatId === s.seatId);
      s.passengerName = passenger ? passenger.name : "Passenger";
    }
  }
  outboundTrip.markModified("seats");
  await outboundTrip.save();

  // If Round Trip, transition Return Seats
  if (input.bookingType === "ROUND_TRIP") {
    try {
      const returnPassengers = input.returnPassengers || input.passengers;
      const returnSeatSet = new Set(returnPassengers.map((p) => p.seatId));
      for (const s of returnTrip.seats) {
        if (returnSeatSet.has(s.seatId)) {
          if (s.state !== "held" || s.holdId !== returnHold.holdId) {
            fail(409, "SEAT_STATE_CONFLICT", `Return seat '${s.seatId}' is no longer held for you`);
          }
          s.state = "booked";
          s.bookingId = bookingObjectId as any;
          const passenger = returnPassengers.find((p) => p.seatId === s.seatId);
          s.passengerName = passenger ? passenger.name : "Passenger";
        }
      }
      returnTrip.markModified("seats");
      await returnTrip.save();
    } catch (err) {
      // Compensating rollback: Revert outbound seats back to held
      for (const s of outboundTrip.seats) {
        if (outboundSeatSet.has(s.seatId)) {
          s.state = "held";
          s.bookingId = undefined as any;
        }
      }
      outboundTrip.markModified("seats");
      await outboundTrip.save().catch(() => {});
      throw err;
    }
  }

  // 8. Create CarBooking Record
  const outboundRouteDesc = `${outboundRoute?.source || "Source"} → ${outboundRoute?.destination || "Destination"}`;
  const legs: any[] = [
    {
      legType: "outbound",
      tripId: outboundTrip._id,
      carId: outboundTrip.carId,
      routeDescription: outboundRouteDesc,
      departureAt: outboundTrip.departureAt,
      estimatedArrivalAt: outboundTrip.estimatedArrivalAt,
      holdId: outboundHoldId,
      seats: outboundPassengerSeats,
      grossPaise: outboundGrossPaise,
      taxPaise: 0,
      discountPaise: 0,
      totalPaise: outboundGrossPaise,
      status: "Confirmed",
    },
  ];

  if (input.bookingType === "ROUND_TRIP") {
    const returnRouteDesc = `${returnRoute?.source || "Source"} → ${returnRoute?.destination || "Destination"}`;
    legs.push({
      legType: "return",
      tripId: returnTrip._id,
      carId: returnTrip.carId,
      routeDescription: returnRouteDesc,
      departureAt: returnTrip.departureAt,
      estimatedArrivalAt: returnTrip.estimatedArrivalAt,
      holdId: returnHold.holdId,
      seats: returnPassengerSeats,
      grossPaise: returnGrossPaise,
      taxPaise: 0,
      discountPaise: 0,
      totalPaise: returnGrossPaise,
      status: "Confirmed",
    });
  }

  const booking = await CarBooking.create({
    _id: bookingObjectId,
    operatorId: new mongoose.Types.ObjectId(operatorId),
    bookingType: input.bookingType,
    pnr,
    reference,
    userId: new mongoose.Types.ObjectId(userId),
    agentId: input.agentId ? new mongoose.Types.ObjectId(input.agentId) : undefined,
    channel,
    legs,
    totalGrossPaise,
    totalTaxPaise: 0,
    totalDiscountPaise: 0,
    totalPayablePaise,
    paymentStatus: "Paid",
    paidAt: new Date(),
    contact: input.contact,
    idempotencyKey: input.idempotencyKey,
    requestHash,
  });

  // 9. Generate CarTicket(s)
  const outboundTicket = await CarTicket.create({
    operatorId: new mongoose.Types.ObjectId(operatorId),
    bookingId: booking._id,
    pnr,
    ticketNumber: `TKT-${pnr}-OUT`,
    legType: "outbound",
    tripId: outboundTrip._id,
    carId: outboundTrip.carId,
    seatIds: requestedOutboundSeats,
    passengers: input.passengers,
    issuedAt: new Date(),
    status: "valid",
  });

  const createdTickets: any[] = [outboundTicket];

  if (input.bookingType === "ROUND_TRIP") {
    const returnPassengers = input.returnPassengers || input.passengers;
    const returnTicket = await CarTicket.create({
      operatorId: new mongoose.Types.ObjectId(operatorId),
      bookingId: booking._id,
      pnr,
      ticketNumber: `TKT-${pnr}-RET`,
      legType: "return",
      tripId: returnTrip._id,
      carId: returnTrip.carId,
      seatIds: returnPassengers.map((p) => p.seatId),
      passengers: returnPassengers,
      issuedAt: new Date(),
      status: "valid",
    });
    createdTickets.push(returnTicket);
  }

  // Link ticket IDs back to booking legs
  booking.legs[0].ticketId = outboundTicket._id;
  if (input.bookingType === "ROUND_TRIP") {
    booking.legs[1].ticketId = createdTickets[1]._id;
  }
  await booking.save();

  // 10. Mark Hold(s) Consumed
  outboundHold.status = "consumed";
  await outboundHold.save();

  if (returnHold) {
    returnHold.status = "consumed";
    await returnHold.save();
  }

  // 11. Post Balanced Double-Entry Financial Ledger Journal
  const commissionPaise =
    channel === "agent" ? Math.round(totalPayablePaise * 0.05) : 0; // 5% default agent commission

  await postBookingFinancialJournal({
    operatorId,
    bookingId: booking._id.toString(),
    pnr,
    totalPayablePaise,
    agentId: input.agentId,
    commissionPaise,
    channel,
  });

  return {
    booking,
    tickets: createdTickets,
    pnr: booking.pnr,
    reference: booking.reference,
    bookingType: booking.bookingType,
    totalPayablePaise: booking.totalPayablePaise,
    paymentStatus: booking.paymentStatus,
  };
}

/**
 * Retrieves booking details by ID or PNR.
 */
export async function getBookingByIdOrPnr(idOrPnr: string, operatorId?: string) {
  const filter: any = {};
  if (/^[a-fA-F0-9]{24}$/.test(idOrPnr)) {
    filter.$or = [{ _id: idOrPnr }, { pnr: idOrPnr.toUpperCase() }];
  } else {
    filter.pnr = idOrPnr.toUpperCase();
  }

  if (operatorId) {
    filter.operatorId = new mongoose.Types.ObjectId(operatorId);
  }

  const booking: any = await CarBooking.findOne(filter).lean();
  if (!booking) {
    fail(404, "BOOKING_NOT_FOUND", `Car booking '${idOrPnr}' was not found`);
  }

  const tickets = await CarTicket.find({ bookingId: booking._id }).lean();

  return {
    ...booking,
    tickets,
  };
}

/**
 * Retrieves tickets for a booking, ensuring driver details are masked from passenger tickets.
 */
export async function getBookingTickets(bookingId: string) {
  const filter: any = {};
  if (/^[a-fA-F0-9]{24}$/.test(bookingId)) {
    filter.bookingId = new mongoose.Types.ObjectId(bookingId);
  } else {
    filter.pnr = bookingId.toUpperCase();
  }

  const tickets: any[] = await CarTicket.find(filter)
    .populate("tripId", "tripNumber vehicleCategory departureAt estimatedArrivalAt journeyDate")
    .populate("carId", "registration make modelName category driveOrientation")
    .lean();

  if (!tickets || tickets.length === 0) {
    fail(404, "TICKETS_NOT_FOUND", "No tickets found for booking");
  }

  // Format and mask driver details
  return tickets.map((t) => ({
    ticketNumber: t.ticketNumber,
    pnr: t.pnr,
    legType: t.legType,
    status: t.status,
    issuedAt: t.issuedAt,
    tripNumber: t.tripId?.tripNumber,
    vehicleCategory: t.tripId?.vehicleCategory || t.carId?.category,
    carModel: t.carId ? `${t.carId.make} ${t.carId.modelName}` : undefined,
    registration: t.carId?.registration,
    departureAt: t.tripId?.departureAt,
    estimatedArrivalAt: t.tripId?.estimatedArrivalAt,
    seatIds: t.seatIds,
    passengers: t.passengers,
  }));
}
