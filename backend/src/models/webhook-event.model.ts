import { model } from "./shared/schema.js";

export const WebhookEvent = model(
  "WebhookEvent",
  {
    providerId: String,
    eventId: String,
    payloadHash: String,
    status: {
      type: String,
      enum: ["processing", "processed", "failed"],
      default: "processing",
    },
    processedAt: Date,
  },
  [{ keys: { providerId: 1, eventId: 1 }, options: { unique: true } }],
);
