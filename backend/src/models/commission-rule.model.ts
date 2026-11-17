import { model, tenantFields, objectId } from "./shared/schema.js";
export const CommissionRule = model(
  "CommissionRule",
  {
    ...tenantFields,
    partnerId: { type: objectId, required: true },
    serviceId: objectId,
    tripId: objectId,
    basis: String,
    kind: String,
    basisPoints: Number,
    fixedPaise: Number,
    status: { type: String, default: "Active" },
  },
  [
    {
      keys: { operatorId: 1, partnerId: 1, serviceId: 1, tripId: 1 },
      options: { unique: true },
    },
  ],
);
