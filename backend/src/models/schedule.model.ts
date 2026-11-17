import { mapping, model, objectId, tenantFields } from "./shared/schema.js";

export const Schedule = model("Schedule", {
  ...tenantFields,
  routeId: { type: objectId, required: true },
  busId: { type: objectId, required: true },
  daysOfWeek: [Number],
  specialDates: [String],
  startDate: String,
  endDate: String,
  status: { type: String, enum: ["Active", "Inactive"], default: "Active" },
  ...mapping,
});
