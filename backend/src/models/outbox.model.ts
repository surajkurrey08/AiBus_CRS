import { model, tenantFields } from "./shared/schema.js";

export const Outbox = model(
  "Outbox",
  { ...tenantFields, event: String, resourceId: String, deliveredAt: Date },
  [{ keys: { deliveredAt: 1, createdAt: 1 } }],
);
