import { model, tenantFields, objectId } from "./shared/schema.js";
export const BusService = model(
  "BusService",
  {
    ...tenantFields,
    name: { type: String, required: true },
    code: { type: String, required: true },
    routeId: { type: objectId, required: true },
    busId: { type: objectId, required: true },
    departure: { type: String, required: true },
    daysOfWeek: [Number],
    crewIds: [objectId],
    doublePaise: { type: Number, required: true },
    singlePaise: { type: Number, required: true },
    status: { type: String, default: "Active" },
  },
  [{ keys: { operatorId: 1, code: 1 }, options: { unique: true } }],
);
