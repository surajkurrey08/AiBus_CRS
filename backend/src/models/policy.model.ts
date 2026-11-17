import { model, objectId } from "./shared/schema.js";

export const Policy = model("CancellationPolicy", {
  operatorId: { type: objectId, required: true, immutable: true, unique: true },
  rules: [{ hoursBefore: Number, refundPercent: Number }],
  version: { type: Number, default: 1 },
});
