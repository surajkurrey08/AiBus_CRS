import { Schema } from "mongoose";
import { model, objectId, tenantFields } from "./shared/schema.js";

export const FareHistory = model("FareHistory", {
  ...tenantFields,
  fareId: { type: objectId, required: true },
  actorId: objectId,
  before: Schema.Types.Mixed,
  after: Schema.Types.Mixed,
});
