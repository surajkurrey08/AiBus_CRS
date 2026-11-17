import { model, tenantFields, objectId } from "./shared/schema.js";
export const TripTablet = model(
  "TripTablet",
  {
    ...tenantFields,
    name: { type: String, required: true },
    serialNumber: { type: String, required: true },
    status: { type: String, default: "Active" },
  },
  [{ keys: { operatorId: 1, serialNumber: 1 }, options: { unique: true } }],
);
