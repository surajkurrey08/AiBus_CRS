import { model, objectId } from "./shared/schema.js";
export const PartnerSupport = model(
  "PartnerSupport",
  {
    partnerId: { type: objectId, required: true, immutable: true },
    subject: { type: String, required: true },
    message: { type: String, required: true },
    status: {
      type: String,
      enum: ["Open", "In review", "Resolved"],
      default: "Open",
    },
    response: String,
    createdBy: objectId,
    reviewedBy: objectId,
    requestKey: { type: String, required: true },
  },
  [
    { keys: { partnerId: 1, requestKey: 1 }, options: { unique: true } },
    { keys: { partnerId: 1, createdAt: -1 } },
  ],
);
