import { model, tenantFields, objectId } from "./shared/schema.js";
export const AreaLocation = model(
  "AreaLocation",
  {
    ...tenantFields,
    cityId: { type: objectId, required: true },
    name: { type: String, required: true },
    usage: { type: String, enum: ["Pickup", "Drop", "Both"], required: true },
    address: String,
    landmarkId: objectId,
    phone: String,
    latitude: Number,
    longitude: Number,
    status: { type: String, default: "Active" },
  },
  [{ keys: { operatorId: 1, cityId: 1 } }],
);
