import { createCarModel, objectId, tenantFields } from "./shared/car-schema.js";

export const CarSeatHold = createCarModel(
  "CarSeatHold",
  {
    ...tenantFields,
    tripId: { type: objectId, required: true, ref: "CarTrip" },
    userId: { type: objectId, required: true },
    holdId: { type: String, required: true, unique: true },
    legType: { type: String, enum: ["outbound", "return", "single"], default: "single" },
    seatIds: {
      type: [String],
      required: true,
      validate: {
        validator: function (v: string[]) {
          return Array.isArray(v) && v.length > 0 && !v.includes("D"); // Never allow driver seat
        },
        message: "Hold must include at least one passenger seat and cannot hold the driver seat ('D')",
      },
    },
    amountPaise: { type: Number, required: true, min: 0 },
    expiresAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ["held", "released", "consumed", "expired"],
      default: "held",
      required: true,
    },
  },
  [
    { keys: { expiresAt: 1 }, options: { expireAfterSeconds: 86400 } },
    { keys: { tripId: 1, status: 1, expiresAt: 1 } },
  ]
);
