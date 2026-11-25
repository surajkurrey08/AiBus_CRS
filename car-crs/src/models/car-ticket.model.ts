import { passengerSchema, createCarModel, objectId, tenantFields } from "./shared/car-schema.js";

export const CarTicket = createCarModel(
  "CarTicket",
  {
    ...tenantFields,
    bookingId: { type: objectId, required: true, ref: "CarBooking" },
    pnr: { type: String, required: true },
    ticketNumber: { type: String, required: true, unique: true },
    legType: { type: String, enum: ["outbound", "return"], required: true },
    tripId: { type: objectId, required: true, ref: "CarTrip" },
    carId: { type: objectId, required: true, ref: "Car" },
    seatIds: [{ type: String, required: true }],
    passengers: [passengerSchema],
    issuedAt: { type: Date, required: true, default: Date.now },
    status: {
      type: String,
      enum: ["valid", "cancelled"],
      default: "valid",
      required: true,
    },
    cancellationReason: String,
    cancelledAt: Date,
  },
  [
    { keys: { bookingId: 1, legType: 1 }, options: { unique: true } },
    { keys: { pnr: 1 } },
  ]
);
