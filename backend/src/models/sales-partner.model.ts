import { model, tenantFields, objectId } from "./shared/schema.js";
export const SalesPartner = model(
  "SalesPartner",
  {
    ...tenantFields,
    name: { type: String, required: true },
    kind: { type: String, enum: ["Agent", "Branch"], required: true },
    phone: String,
    email: String,
    status: { type: String, default: "Active" },
  },
  [],
);
