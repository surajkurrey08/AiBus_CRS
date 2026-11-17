import { model, objectId, tenantFields } from "./shared/schema.js";

export const Ticket = model("Ticket", {
  ...tenantFields,
  bookingId: { type: objectId, required: true, unique: true },
  pnr: { type: String, required: true, unique: true },
  issuedAt: { type: Date, required: true },
  status: { type: String, enum: ["valid", "cancelled"], default: "valid" },
});
