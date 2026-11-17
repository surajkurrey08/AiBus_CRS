import { model, tenantFields, objectId } from "./shared/schema.js";
export const BusGps = model(
  "BusGps",
  {
    ...tenantFields,
    busId: { type: objectId, required: true },
    provider: { type: String, required: true },
    deviceId: { type: String, required: true },
    status: { type: String, default: "Active" },
  },
  [
    { keys: { operatorId: 1, busId: 1 }, options: { unique: true } },
    {
      keys: { operatorId: 1, provider: 1, deviceId: 1 },
      options: { unique: true },
    },
  ],
);
