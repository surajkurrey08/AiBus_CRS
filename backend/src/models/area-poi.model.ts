import { model, tenantFields, objectId } from "./shared/schema.js";
export const AreaPoi = model(
  "AreaPoi",
  {
    ...tenantFields,
    cityId: { type: objectId, required: true },
    name: { type: String, required: true },
    category: { type: String, required: true },
    address: String,
    latitude: Number,
    longitude: Number,
    status: { type: String, default: "Active" },
  },
  [{ keys: { operatorId: 1, cityId: 1 } }],
);
