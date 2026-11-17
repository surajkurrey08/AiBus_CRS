import { model, objectId } from "./shared/schema.js";

export const Reset = model(
  "PasswordReset",
  {
    userId: { type: objectId, required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: Date,
    usedAt: Date,
  },
  [{ keys: { expiresAt: 1 }, options: { expireAfterSeconds: 0 } }],
);
