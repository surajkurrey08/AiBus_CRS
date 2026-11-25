import { mapping, model, objectId, tenantFields } from "./shared/schema.js";

export const Car = model(
  "Car",
  {
    ...tenantFields,
    registration: {
      type: String,
      required: true,
      set: (v: string) => v.toUpperCase().replace(/[\s-]/g, ""),
    },
    registrationNumber: {
      type: String,
      required: true,
      trim: true,
    },
    make: { type: String, required: true, trim: true },
    model: { type: String, required: true, trim: true },
    modelName: {
      type: String,
      trim: true,
      default: function (this: any) {
        return this.model;
      },
    },
    year: {
      type: Number,
      default: () => new Date().getFullYear(),
    },
    vehicleCategory: {
      type: String,
      required: true,
      enum: [
        "4-Passenger Sedan",
        "7-Passenger MUV",
        "4-Passenger Hatchback",
        "6-Passenger SUV",
      ],
      default: "4-Passenger Sedan",
    },
    category: {
      type: String,
      enum: [
        "4-Passenger Sedan",
        "7-Passenger MUV",
        "4-Passenger Hatchback",
        "6-Passenger SUV",
      ],
      default: function (this: any) {
        return this.vehicleCategory;
      },
    },
    totalPhysicalSeats: {
      type: Number,
      required: true,
      min: 5,
      max: 9,
    },
    driverSeatsCount: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
      max: 1,
    },
    bookablePassengerCapacity: {
      type: Number,
      required: true,
      min: 1,
      max: 8,
    },
    color: { type: String, default: "" },
    status: {
      type: String,
      enum: [
        "Active",
        "Inactive",
        "Maintenance",
        "Under Maintenance",
        "Archived",
      ],
      default: "Active",
    },
    activeLayoutId: objectId,
    schedulingRevision: { type: Number, default: 0 },
    ...mapping,
  },
  [
    { keys: { operatorId: 1, status: 1 } },
    { keys: { operatorId: 1, category: 1 } },
    { keys: { operatorId: 1, registration: 1 }, options: { unique: true } },
  ],
);
