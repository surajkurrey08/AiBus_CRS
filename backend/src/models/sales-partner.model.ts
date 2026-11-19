import { model, tenantFields, objectId } from "./shared/schema.js";
import { agentCapabilities } from "../types/agent.js";
export const SalesPartner = model(
  "SalesPartner",
  {
    ...tenantFields,
    name: { type: String, required: true },
    kind: { type: String, enum: ["Agent", "Branch"], required: true },
    phone: String,
    email: String,
    status: { type: String, default: "Active" },
    permissions: {
      type: [String],
      enum: agentCapabilities,
      default: () =>
        agentCapabilities.filter((p) => !["wallet", "credit"].includes(p)),
    },
    allowedBusIds: { type: [objectId], default: [] },
    commissionType: {
      type: String,
      enum: ["Percent", "Fixed"],
      default: "Percent",
    },
    commissionRate: {
      type: Number,
      default: 500,
      min: 0,
      validate: Number.isSafeInteger,
    },
    legacyUserId: objectId,
  },
  [
    {
      keys: { operatorId: 1, legacyUserId: 1 },
      options: {
        unique: true,
        partialFilterExpression: { legacyUserId: { $type: "objectId" } },
      },
    },
  ],
);
