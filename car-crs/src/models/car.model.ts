import { createCarModel, objectId, tenantFields } from "./shared/car-schema.js";

export const Car = createCarModel(
  "Car",
  {
    ...tenantFields,
    registration: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      set: (v: string) => v.toUpperCase().replace(/[\s-]/g, ""),
    },
    make: { type: String, required: true, trim: true },
    modelName: { type: String, required: true, trim: true },
    category: {
      type: String,
      required: true,
      enum: [
        "4-Passenger Sedan",
        "4-Passenger Hatchback",
        "6-Passenger SUV",
        "7-Passenger MUV",
      ],
    },
    advertisedCapacity: { type: Number, required: true, min: 4, max: 10 },
    totalPhysicalSeats: {
      type: Number,
      required: true,
      min: 5,
      max: 9,
      validate: {
        validator: function (this: any, val: number) {
          // Total physical seats must equal driverSeatsCount (1) + bookablePassengerCapacity
          const driverCount = this.driverSeatsCount ?? 1;
          const bookable = this.bookablePassengerCapacity;
          return val === driverCount + bookable;
        },
        message: "Total physical seats must equal driver seats (1) + bookable passenger capacity",
      },
    },
    driverSeatsCount: { type: Number, required: true, default: 1, min: 1, max: 1 },
    bookablePassengerCapacity: {
      type: Number,
      required: true,
      min: 1,
      max: 8,
      validate: {
        validator: function (v: number) {
          // Standard car CRS strictly validates 4 or 7 (or 6 for captain-seat 7-seaters)
          return [4, 6, 7].includes(v);
        },
        message: "Supported car passenger capacities are 4, 6, or 7 passenger seats",
      },
    },
    driveOrientation: { type: String, enum: ["RHD", "LHD"], default: "RHD", required: true },
    assignedDriver: {
      name: { type: String, trim: true },
      phone: { type: String, trim: true },
      licenseNumber: { type: String, trim: true },
    },
    activeLayoutId: objectId,
    status: {
      type: String,
      enum: ["Active", "Inactive", "Under Maintenance", "Archived"],
      default: "Active",
      required: true,
    },
    documents: [
      {
        docType: {
          type: String,
          enum: ["RC", "Insurance", "Permit", "Fitness", "Pollution"],
          required: true,
        },
        documentNumber: { type: String, required: true, trim: true },
        expiresAt: { type: Date, required: true },
        verified: { type: Boolean, default: false },
      },
    ],
    revision: { type: Number, default: 0 },
  },
  [
    { keys: { operatorId: 1, status: 1 } },
    { keys: { operatorId: 1, category: 1 } },
  ]
);
