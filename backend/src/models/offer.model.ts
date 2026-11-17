import { model, objectId, tenantFields } from "./shared/schema.js";

export const Offer = model(
  "Offer",
  {
    ...tenantFields,
    code: { type: String, required: true },
    name: { type: String, required: true },
    percent: { type: Number, required: true },
    maxDiscountPaise: Number,
    routeIds: [objectId],
    startDate: String,
    endDate: String,
    status: {
      type: String,
      enum: ["Active", "Inactive", "Scheduled"],
      default: "Active",
    },
    usage: { type: Number, default: 0 },
  },
  [{ keys: { operatorId: 1, code: 1 }, options: { unique: true } }],
);
