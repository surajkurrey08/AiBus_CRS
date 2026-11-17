import { model, tenantFields } from "./shared/schema.js";
export const CoachType = model("CoachType", {
  ...tenantFields,
  name: { type: String, required: true },
  type: { type: String, required: true },
  arrangement: { type: String, enum: ["2+1", "2+2"], required: true },
  decks: { type: Number, enum: [1, 2], required: true },
  amenities: [String],
  status: { type: String, default: "Active" },
});
