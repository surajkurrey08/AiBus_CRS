import mongoose, { Schema, Model } from "mongoose";

export const objectId = Schema.Types.ObjectId;

export const tenantFields = {
  operatorId: { type: objectId, required: true, index: true, immutable: true },
};

export const opts = { timestamps: true, strict: "throw" as const, versionKey: false as const };

export function createCarModel(
  name: string,
  definition: Record<string, unknown>,
  indexes: {
    keys: Record<string, 1 | -1>;
    options?: Record<string, unknown>;
  }[] = [],
): mongoose.Model<any> {
  if (mongoose.models[name]) {
    return mongoose.models[name];
  }
  const schema = new Schema(definition, opts);
  for (const idx of indexes) {
    schema.index(idx.keys, idx.options);
  }
  return mongoose.model(name, schema);
}

export const carInventorySeatSchema = new Schema(
  {
    seatId: { type: String, required: true },
    label: { type: String, required: true },
    row: { type: Number, required: true, min: 1, max: 4 },
    column: { type: Number, required: true, min: 1, max: 4 },
    isDriver: { type: Boolean, required: true, default: false },
    isBookable: { type: Boolean, required: true, default: true },
    category: {
      type: String,
      enum: ["driver", "front_passenger", "window", "middle", "rear_window"],
      required: true,
    },
    baseFarePaise: { type: Number, min: 0 },
    farePaise: { type: Number, required: true, min: 0 },
    state: {
      type: String,
      enum: ["available", "held", "booked", "blocked"],
      default: "available",
      required: true,
    },
    holdId: String,
    holdUserId: objectId,
    holdUntil: Date,
    bookingId: objectId,
    passengerName: String,
  },
  { _id: false, strict: "throw", versionKey: false }
);

export const passengerSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 100 },
    phone: { type: String, trim: true },
    seatId: { type: String, required: true },
    boarding: String,
    dropping: String,
    email: { type: String, trim: true, lowercase: true },
    age: { type: Number, min: 0, max: 120 },
    gender: { type: String, enum: ["female", "male", "other", "unspecified", "M", "F", "O"] },
  },
  { _id: false, strict: "throw", versionKey: false }
);

export const carStopSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    time: String,
    address: String,
    locationId: objectId,
  },
  { _id: false, strict: "throw" }
);
