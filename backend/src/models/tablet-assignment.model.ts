import { model, tenantFields, objectId } from "./shared/schema.js";
export const TabletAssignment = model(
  "TabletAssignment",
  {
    ...tenantFields,
    tabletId: { type: objectId, required: true },
    tripId: { type: objectId, required: true },
    crewId: objectId,
    assignedAt: Date,
    releasedAt: { type: Date, default: null },
  },
  [
    {
      keys: { operatorId: 1, tabletId: 1 },
      options: { unique: true, partialFilterExpression: { releasedAt: null } },
    },
  ],
);
