import { model, tenantFields } from "./shared/schema.js";
export const FleetOwner = model("FleetOwner", {
  ...tenantFields,
  name: { type: String, required: true },
  phone: String,
  email: String,
  address: String,
  status: { type: String, default: "Active" },
  loginRevision: { type: Number, default: 0 },
});
