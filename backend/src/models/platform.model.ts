import { Schema } from "mongoose";
import { model, objectId, tenantFields } from "./shared/schema.js";
export const OperatorDocument = model(
  "OperatorDocument",
  {
    ...tenantFields,
    kind: {
      type: String,
      enum: [
        "Business registration",
        "Tax registration",
        "Operating licence",
        "Other",
      ],
      required: true,
    },
    reference: { type: String, required: true },
    status: {
      type: String,
      enum: ["Submitted", "Reviewed", "Rejected", "Needs information"],
      default: "Submitted",
    },
    reviewedBy: objectId,
    reviewedAt: Date,
    reviewReason: String,
  },
  [
    {
      keys: { operatorId: 1, kind: 1, reference: 1 },
      options: { unique: true },
    },
  ],
);
export const PlatformSettings = model("PlatformSettings", {
  key: { type: String, required: true, unique: true },
  displayName: { type: String, default: "AIBUS" },
  supportEmail: String,
  onboardingMode: {
    type: String,
    enum: ["Manual review"],
    default: "Manual review",
  },
  templates: { type: Map, of: String, default: {} },
  version: { type: Number, default: 1 },
  updatedBy: objectId,
});
export const PlatformCommand = model(
  "PlatformCommand",
  {
    actorId: { type: objectId, required: true },
    key: { type: String, required: true },
    requestHash: { type: String, required: true, select: false },
    resourceId: { type: objectId, required: true },
    action: { type: String, required: true },
  },
  [{ keys: { actorId: 1, key: 1 }, options: { unique: true } }],
);
