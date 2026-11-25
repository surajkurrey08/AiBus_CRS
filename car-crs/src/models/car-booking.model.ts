import { Schema } from "mongoose";
import { createCarModel, objectId, tenantFields } from "./shared/car-schema.js";

const carBookingLegSchema = new Schema(
  {
    legType: { type: String, enum: ["outbound", "return"], required: true },
    tripId: { type: objectId, required: true, ref: "CarTrip" },
    carId: { type: objectId, required: true, ref: "Car" },
    routeDescription: { type: String, required: true },
    departureAt: { type: Date, required: true },
    estimatedArrivalAt: { type: Date, required: true },
    holdId: { type: String, required: true },
    seats: [
      {
        seatId: { type: String, required: true },
        passengerName: { type: String, required: true },
        farePaise: { type: Number, required: true, min: 0 },
      },
    ],
    grossPaise: { type: Number, required: true, min: 0 },
    taxPaise: { type: Number, default: 0, min: 0 },
    discountPaise: { type: Number, default: 0, min: 0 },
    totalPaise: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ["Pending", "Confirmed", "Cancelled", "Completed"],
      default: "Pending",
      required: true,
    },
    ticketId: objectId,
  },
  { _id: false, strict: "throw" }
);

export const CarBooking = createCarModel(
  "CarBooking",
  {
    ...tenantFields,
    bookingType: {
      type: String,
      enum: ["ONE_WAY", "ROUND_TRIP"],
      required: true,
    },
    pnr: { type: String, required: true, unique: true, uppercase: true },
    reference: { type: String, required: true, unique: true },
    userId: { type: objectId, required: true },
    agentId: objectId,
    channel: {
      type: String,
      enum: ["operator", "customer", "agent", "partner"],
      default: "operator",
      required: true,
    },
    legs: {
      type: [carBookingLegSchema],
      required: true,
      validate: [
        {
          validator: function (this: any, legs: any[]) {
            if (this.bookingType === "ONE_WAY") {
              return legs.length === 1 && legs[0].legType === "outbound";
            }
            if (this.bookingType === "ROUND_TRIP") {
              if (legs.length !== 2) return false;
              const hasOutbound = legs[0].legType === "outbound";
              const hasReturn = legs[1].legType === "return";
              if (!hasOutbound || !hasReturn) return false;
              // Return departure must be strictly after outbound departure
              const outboundDep = new Date(legs[0].departureAt);
              const returnDep = new Date(legs[1].departureAt);
              const outboundArr = new Date(legs[0].estimatedArrivalAt);
              return returnDep > outboundDep && returnDep >= outboundArr;
            }
            return false;
          },
          message: "Leg configuration invalid for the specified bookingType",
        },
      ],
    },
    totalGrossPaise: { type: Number, required: true, min: 0 },
    totalTaxPaise: { type: Number, default: 0, min: 0 },
    totalDiscountPaise: { type: Number, default: 0, min: 0 },
    totalPayablePaise: { type: Number, required: true, min: 0 },
    paymentStatus: {
      type: String,
      enum: ["Pending", "Paid", "Refund Pending", "Partially Refunded", "Refunded", "Failed"],
      default: "Pending",
      required: true,
    },
    paidAt: Date,
    contact: {
      phone: { type: String, required: true },
      email: String,
    },
    idempotencyKey: { type: String, required: true },
    requestHash: { type: String, required: true },
  },
  [
    { keys: { operatorId: 1, idempotencyKey: 1 }, options: { unique: true } },
    { keys: { operatorId: 1, bookingType: 1, createdAt: -1 } },
  ]
);
