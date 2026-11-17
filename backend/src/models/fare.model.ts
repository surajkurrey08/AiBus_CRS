import { model, objectId, tenantFields } from "./shared/schema.js";

export const Fare = model(
  "Fare",
  {
    ...tenantFields,
    routeId: { type: objectId, required: true },
    basePaise: { type: Number, required: true },
    weekendPaise: Number,
    singlePaise: Number,
    singleWeekendPaise: Number,
    specialDates: [{ date: String, amountPaise: Number }],
    seatFares: [{ number: String, amountPaise: Number }],
    version: { type: Number, default: 1 },
  },
  [{ keys: { operatorId: 1, routeId: 1 }, options: { unique: true } }],
);
