import { berth, model, objectId, tenantFields } from "./shared/schema.js";

export const Layout = model(
  "BusLayout",
  {
    ...tenantFields,
    busId: { type: objectId, required: true },
    name: { type: String, required: true },
    seats: { type: [berth], required: true },
  },
  [{ keys: { operatorId: 1, busId: 1 }, options: { unique: true } }],
);
