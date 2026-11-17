import { model, tenantFields } from "./shared/schema.js";
export const CrewMember = model("CrewMember", {
  ...tenantFields,
  name: { type: String, required: true },
  role: {
    type: String,
    enum: ["Driver", "Conductor", "Pickup staff"],
    required: true,
  },
  phone: String,
  licenceNumber: String,
  licenceExpiry: String,
  pickupPoint: String,
  status: { type: String, default: "Active" },
});
