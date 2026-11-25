import { carInventorySeatSchema, createCarModel, objectId, tenantFields } from "./shared/car-schema.js";
import { Schema } from "mongoose";

const fareRulesSchema = new Schema(
  {
    baseFarePaise: { type: Number, required: true, min: 0 },
    frontPassengerPremiumPaise: { type: Number, default: 0, min: 0 },
    windowSeatPaise: { type: Number, default: 0, min: 0 },
    middleDiscountPaise: { type: Number, default: 0, min: 0 },
  },
  { _id: false, strict: "throw", versionKey: false }
);

export const CarTrip = createCarModel(
  "CarTrip",
  {
    ...tenantFields,
    tripNumber: { type: String, trim: true },
    tripType: {
      type: String,
      enum: ["ONE_WAY", "ROUND_TRIP"],
      default: "ONE_WAY",
      required: true,
    },
    carId: { type: objectId, required: true, ref: "Car" },
    routeId: { type: objectId, required: true, ref: "CarRoute" },
    layoutId: { type: objectId, ref: "CarSeatLayout" },
    vehicleCategory: {
      type: String,
      enum: ["4-Passenger Sedan", "4-Passenger Hatchback", "6-Passenger SUV", "7-Passenger MUV"],
    },
    totalPhysicalSeats: { type: Number, min: 5, max: 9 },
    bookableCapacity: { type: Number, min: 4, max: 7 },
    journeyDate: { type: String, required: true }, // Format: YYYY-MM-DD
    departureAt: { type: Date, required: true },
    estimatedArrivalAt: { type: Date, required: true },
    turnaroundBufferMinutes: { type: Number, default: 30, min: 0, max: 240 },
    effectiveArrivalAt: {
      type: Date,
      required: true,
      default: function (this: any) {
        if (!this.estimatedArrivalAt) return new Date();
        const buffer = this.turnaroundBufferMinutes ?? 30;
        return new Date(+new Date(this.estimatedArrivalAt) + buffer * 60000);
      },
    },
    bookingOpen: { type: Boolean, default: true },
    status: {
      type: String,
      enum: ["Draft", "Scheduled", "Boarding", "On Road", "Arrived", "Completed", "Cancelled"],
      default: "Scheduled",
      required: true,
    },
    cancellationReason: { type: String, trim: true },
    publishedAt: Date,
    closedSalesAt: Date,
    revision: { type: Number, default: 0, min: 0 },
    fareRules: fareRulesSchema,
    fareOverridePaise: { type: Number, min: 0 },
    seats: {
      type: [carInventorySeatSchema],
      required: true,
      validate: [
        {
          validator: function (seats: any[]) {
            // Must have at least 1 driver seat and at least 4 bookable passenger seats
            const driverSeats = seats.filter((s) => s.isDriver === true);
            const bookableSeats = seats.filter((s) => s.isBookable === true && !s.isDriver);
            return driverSeats.length === 1 && bookableSeats.length >= 4;
          },
          message: "Trip inventory must have exactly one driver seat and at least 4 bookable seats",
        },
      ],
    },
  },
  [
    { keys: { operatorId: 1, journeyDate: 1 } },
    { keys: { carId: 1, departureAt: 1 } },
    { keys: { carId: 1, status: 1, departureAt: 1, effectiveArrivalAt: 1 } },
    { keys: { routeId: 1, journeyDate: 1, status: 1 } },
    { keys: { routeId: 1, status: 1, bookingOpen: 1, departureAt: 1 } },
  ]
);
