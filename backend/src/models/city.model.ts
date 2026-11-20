import { model, objectId, tenantFields } from "./shared/schema.js";
export const City = model(
  "City",
  {
    ...tenantFields,
    catalogId: { type: objectId, immutable: true },
    name: { type: String, required: true },
    state: { type: String, required: true },
    country: { type: String, default: "India" },
    key: { type: String, required: true },
    status: { type: String, default: "Active" },
  },
  [{ keys: { operatorId: 1, key: 1 }, options: { unique: true } }],
);
