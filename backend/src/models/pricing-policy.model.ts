import { model, objectId } from "./shared/schema.js";

export const PricingPolicy = model("PricingPolicy", {
  operatorId: { type: objectId, required: true, immutable: true, unique: true },
  taxBasisPoints: { type: Number, required: true, min: 0, max: 10000 },
  chargePaise: { type: Number, required: true, min: 0 },
  chargesTaxable: { type: Boolean, required: true },
  operatorDiscountMaxPaise: { type: Number, required: true, min: 0 },
  requireAge: { type: Boolean, required: true },
  requireGender: { type: Boolean, required: true },
  requireMobile: { type: Boolean, required: true },
  gstEnabled: { type: Boolean, required: true },
  version: { type: Number, required: true, default: 1 },
});
