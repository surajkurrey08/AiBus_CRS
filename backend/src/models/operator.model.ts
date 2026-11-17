import { model, objectId } from "./shared/schema.js";

export const Operator = model("Operator", {
  company: { type: String, required: true },
  email: { type: String, required: true },
  phone: String,
  address: String,
  status: {
    type: String,
    enum: ["pending", "approved", "suspended", "rejected"],
    default: "pending",
  },
  approvedBy: objectId,
  approvedAt: Date,
});
