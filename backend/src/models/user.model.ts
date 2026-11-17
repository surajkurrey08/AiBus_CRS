import { model, objectId } from "./shared/schema.js";

export const User = model("User", {
  operatorId: { type: objectId, index: true, immutable: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true, select: false },
  role: {
    type: String,
    enum: [
      "super_admin",
      "operator_admin",
      "manager",
      "booking_staff",
      "read_only",
    ],
    required: true,
  },
  active: { type: Boolean, default: true },
  preferences: { type: Map, of: Boolean, default: {} },
  phone: { type: String },
  commissionType: {
    type: String,
    enum: ["Percent", "Fixed"],
    default: "Percent",
  },
  commissionRate: { type: Number, default: 500 },
  salesPartnerId: { type: objectId },
});
