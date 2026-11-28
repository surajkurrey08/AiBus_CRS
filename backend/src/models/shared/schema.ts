import mongoose, { Schema } from "mongoose";
export const objectId = Schema.Types.ObjectId;

export const tenantFields = {
  operatorId: { type: objectId, required: true, index: true, immutable: true },
};

export const opts = { timestamps: true, strict: "throw" as const };

export function model(
  name: string,
  definition: Record<string, unknown>,
  indexes: {
    keys: Record<string, 1 | -1>;
    options?: Record<string, unknown>;
  }[] = [],
) {
  const schema = new Schema(definition, opts);
  for (const i of indexes) schema.index(i.keys, i.options);
  return mongoose.model(name, schema);
}

export const mapping = { providerId: String, externalId: String };

export const berth = new Schema(
  {
    number: { type: String, required: true },
    deck: { type: String, enum: ["lower", "upper"], required: true },
    row: { type: Number, required: true },
    column: { type: Number, required: true },
    category: { type: String, enum: ["sleeper", "seater"], required: true },
    farePaise: { type: Number, required: true, min: 0 },
  },
  { _id: false, strict: "throw" },
);

export const stop = new Schema(
  {
    name: { type: String, required: true },
    time: String,
    address: String,
    locationId: objectId,
  },
  { _id: false, strict: "throw" },
);

export const viaStopSchema = new Schema(
  {
    city: { type: String, required: true },
    distanceKm: { type: Number, default: 0 },
    durationMinutes: { type: Number, default: 0 },
  },
  { _id: false, strict: "throw" },
);

export const segmentFareSchema = new Schema(
  {
    fromCity: { type: String, required: true },
    toCity: { type: String, required: true },
    distanceKm: { type: Number, default: 0 },
    farePaise: { type: Number, required: true },
    seatFares: Schema.Types.Mixed,
  },
  { _id: false, strict: "throw" },
);

export const inventorySeat = new Schema(
  {
    number: String,
    deck: String,
    row: Number,
    column: Number,
    category: String,
    farePaise: Number,
    state: {
      type: String,
      enum: ["available", "held", "booked", "blocked", "quota"],
      default: "available",
    },
    holdId: String,
    holdUserId: objectId,
    holdUntil: Date,
    bookingId: objectId,
    quotaLabel: String,
    isDriver: { type: Boolean, default: false },
    isBookable: { type: Boolean, default: true },
    seatId: String,
    label: String,
  },
  { _id: false, strict: "throw", versionKey: false },
);

export const passenger = new Schema(
  {
    name: { type: String, required: true },
    phone: String,
    seat: { type: String, required: true },
    boarding: String,
    dropping: String,
    email: String,
    age: Number,
    gender: String,
    checkedInAt: Date,
    checkedInBy: objectId,
  },
  // Embedded passengers have no version field. Disabling the implicit version
  // key also lets Mongoose restore transaction state after an accounting abort.
  { _id: false, strict: "throw", versionKey: false },
);
