import { model, objectId, tenantFields } from "./shared/schema.js";

export const ExternalMapping = model(
  "ExternalMapping",
  {
    ...tenantFields,
    providerId: String,
    resource: String,
    internalId: objectId,
    externalId: String,
  },
  [
    {
      keys: { providerId: 1, resource: 1, externalId: 1 },
      options: { unique: true },
    },
  ],
);
