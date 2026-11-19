import { partnerRoles } from "../types/partner-portal.js";
import { platformPermissions, platformProfiles } from "../types/platform.js";
import { model, objectId } from "./shared/schema.js";

export const User = model(
  "User",
  {
    operatorId: { type: objectId, index: true, immutable: true },
    partnerId: { type: objectId, immutable: true, index: true },
    partnerRole: { type: String, enum: partnerRoles },
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
        "agent",
        "partner",
      ],
      required: true,
    },
    active: { type: Boolean, default: true },
    platformProfile: { type: String, enum: platformProfiles },
    platformPermissions: { type: [String], enum: platformPermissions, default: undefined },
    // Server-provisioned only; omitted from staff/admin request schemas.
    platformFinanceRead: { type: Boolean, default: false },
    platformFinanceActions: { type: [String], enum: ["refunds:review", "settlements:prepare", "settlements:approve", "payouts:authorize"], default: [] },
    preferences: { type: Map, of: Boolean, default: {} },
    phone: { type: String },
    commissionType: {
      type: String,
      enum: ["Percent", "Fixed"],
      default: "Percent",
    },
    commissionRate: { type: Number, default: 500 },
    salesPartnerId: { type: objectId },
  },
  [{ keys: { operatorId: 1, salesPartnerId: 1 } }, { keys: {partnerId:1,role:1,active:1} }],
);
