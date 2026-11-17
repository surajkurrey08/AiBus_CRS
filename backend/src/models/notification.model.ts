import { model, tenantFields } from "./shared/schema.js";

export const Notification = model(
  "Notification",
  { ...tenantFields, title: String, message: String, readAt: Date },
  [{ keys: { operatorId: 1, createdAt: -1 } }],
);
