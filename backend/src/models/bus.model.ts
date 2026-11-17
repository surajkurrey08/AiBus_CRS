import { mapping, model, objectId, tenantFields } from "./shared/schema.js";

export const Bus = model(
  "Bus",
  {
    ...tenantFields,
    registration: {
      type: String,
      required: true,
      unique: true,
      set: (v: string) => v.toUpperCase().replace(/[\s-]/g, ""),
    },
    name: { type: String, required: true },
    type: {
      type: String,
      required: true,
      enum: [
        "AC Sleeper",
        "Non-AC Sleeper",
        "AC Seater",
        "Non-AC Seater",
        "Semi Sleeper",
        "Mixed Seater/Sleeper",
      ],
    },
    capacity: { type: Number, required: true, min: 1, max: 100 },
    amenities: [String],
    coachTypeId: objectId,
    ownerId: objectId,
    status: { type: String, enum: ["Active", "Inactive"], default: "Active" },
    insuranceExpiry: Date,
    permitExpiry: Date,
    insuranceNumber: String,
    permitNumber: String,
    images: [String],
    ...mapping,
  },
  [{ keys: { operatorId: 1, status: 1 } }],
);
