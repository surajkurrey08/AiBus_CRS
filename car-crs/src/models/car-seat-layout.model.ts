import { Schema } from "mongoose";
import { createCarModel, objectId, tenantFields } from "./shared/car-schema.js";

const physicalSeatTemplateSchema = new Schema(
  {
    seatId: { type: String, required: true },
    label: { type: String, required: true },
    row: { type: Number, required: true, min: 1, max: 4 },
    column: { type: Number, required: true, min: 1, max: 4 },
    isDriver: { type: Boolean, required: true, default: false },
    isBookable: { type: Boolean, required: true, default: true },
    category: {
      type: String,
      enum: ["driver", "front_passenger", "window", "middle", "rear_window"],
      required: true,
    },
    baseFarePaise: { type: Number, required: true, min: 0, default: 0 },
  },
  { _id: false, strict: "throw" }
);

export const CarSeatLayout = createCarModel(
  "CarSeatLayout",
  {
    ...tenantFields,
    carId: { type: objectId, ref: "Car" },
    name: { type: String, required: true, trim: true },
    vehicleCategory: {
      type: String,
      required: true,
      enum: [
        "4-Passenger Sedan",
        "4-Passenger Hatchback",
        "6-Passenger SUV",
        "7-Passenger MUV",
      ],
    },
    totalPhysicalSeats: { type: Number, required: true, min: 5, max: 9 },
    bookablePassengerCapacity: { type: Number, required: true, min: 4, max: 7 },
    driveOrientation: { type: String, enum: ["RHD", "LHD"], default: "RHD", required: true },
    version: { type: Number, default: 1, required: true },
    seats: {
      type: [physicalSeatTemplateSchema],
      required: true,
      validate: [
        {
          validator: function (this: any, seats: any[]) {
            // Exactly 1 driver seat
            const driverSeats = seats.filter((s) => s.isDriver === true);
            return driverSeats.length === 1 && driverSeats[0].isBookable === false;
          },
          message: "Layout must contain exactly one driver seat, which must not be bookable",
        },
        {
          validator: function (this: any, seats: any[]) {
            // Bookable seats count must equal bookablePassengerCapacity
            const bookable = seats.filter((s) => s.isBookable === true && s.isDriver === false);
            return bookable.length === this.bookablePassengerCapacity;
          },
          message: "Bookable seats count must exactly match bookablePassengerCapacity",
        },
        {
          validator: function (seats: any[]) {
            // Unique seat IDs
            const ids = seats.map((s) => s.seatId);
            return new Set(ids).size === ids.length;
          },
          message: "All seats must have unique seatId identifiers",
        },
        {
          validator: function (seats: any[]) {
            // Unique row + column coordinates
            const coords = seats.map((s) => `${s.row}:${s.column}`);
            return new Set(coords).size === coords.length;
          },
          message: "Physical seats cannot overlap in row and column coordinates",
        },
      ],
    },
    status: { type: String, enum: ["Active", "Inactive"], default: "Active" },
  },
  [
    { keys: { operatorId: 1, name: 1, version: 1 }, options: { unique: true } },
    { keys: { operatorId: 1, vehicleCategory: 1 } },
  ]
);
