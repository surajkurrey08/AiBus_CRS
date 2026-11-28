import { model, objectId } from "./shared/schema.js";

export const Session = model(
  "Session",
  {
    userId: { type: objectId, required: true, index: true },
    family: { type: String, required: true, index: true },
    client: { type: String, enum: ["operator", "admin", "agent", "partner", "owner"] },
    refreshHash: { type: String, required: true, unique: true, select: false },
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
  },
  [{ keys: { expiresAt: 1 }, options: { expireAfterSeconds: 0 } }],
);
