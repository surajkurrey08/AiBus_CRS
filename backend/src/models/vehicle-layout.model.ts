import { model, tenantFields } from "./shared/schema.js";

export const VehicleLayout = model("VehicleLayout", {
  ...tenantFields,
  name: { type: String, required: true },
  vehicleType: { type: String, enum: ["Car", "Mini Bus", "Bus"], required: true },
  seats: [{ _id: false, number: String, row: Number, column: Number }],
}, []);
