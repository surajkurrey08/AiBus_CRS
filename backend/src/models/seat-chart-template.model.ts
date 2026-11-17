import { model, tenantFields, berth } from "./shared/schema.js";
export const SeatChartTemplate = model("SeatChartTemplate", {
  ...tenantFields,
  name: { type: String, required: true },
  seats: { type: [berth], required: true },
  status: { type: String, default: "Active" },
});
