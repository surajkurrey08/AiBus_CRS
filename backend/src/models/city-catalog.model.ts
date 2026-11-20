import { Schema } from "mongoose";
import { model, objectId } from "./shared/schema.js";

// Global catalog. Operator City records remain tenant-owned and keep their IDs.
export const CatalogCity = model(
  "CatalogCity",
  {
    cityId: { type: String, required: true, immutable: true },
    key: { type: String, required: true, immutable: true },
    name: { type: String, required: true },
    state: { type: String, required: true },
    country: { type: String, required: true, default: "India" },
    status: { type: String, enum: ["Active", "Inactive"], default: "Active" },
    createdBy: { type: objectId, required: true },
    importId: objectId,
  },
  [
    { keys: { cityId: 1 }, options: { unique: true } },
    { keys: { key: 1 }, options: { unique: true } },
    { keys: { status: 1, name: 1 } },
  ],
);

export const CityCatalogImport = model(
  "CityCatalogImport",
  {
    actorId: { type: objectId, required: true, immutable: true },
    digest: { type: String, required: true, immutable: true },
    source: { type: String, required: true },
    rows: { type: [Schema.Types.Mixed], required: true },
    counts: { type: Schema.Types.Mixed, required: true },
    cursor: { type: Number, default: 0 },
    inserted: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["Preview", "Importing", "Complete"],
      default: "Preview",
    },
  },
  [{ keys: { actorId: 1, digest: 1 }, options: { unique: true } }],
);
