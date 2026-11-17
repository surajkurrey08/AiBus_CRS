import { Schema } from "mongoose";
import { model, objectId } from "./shared/schema.js";

export const Audit = model(
  "AuditLog",
  {
    operatorId: { type: objectId, index: true },
    actorId: objectId,
    action: { type: String, required: true },
    resource: String,
    resourceId: String,
    requestId: String,
    metadata: Schema.Types.Mixed,
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 365 * 86400000),
    },
  },
  [{ keys: { expiresAt: 1 }, options: { expireAfterSeconds: 0 } }],
);
