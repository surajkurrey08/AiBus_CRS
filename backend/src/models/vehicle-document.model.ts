import { model, tenantFields, objectId } from "./shared/schema.js";
export const VehicleDocument = model("VehicleDocument", {
  ...tenantFields,
  busId: { type: objectId, required: true },
  kind: { type: String, required: true },
  reference: { type: String, required: true },
  issuedOn: String,
  expiresOn: String,
  notes: String,
});
