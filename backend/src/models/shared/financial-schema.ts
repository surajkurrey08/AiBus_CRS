import mongoose, { Schema } from "mongoose";
import { AppError } from "../../utils/errors.js";

export const safePaise = {
  type: Number,
  required: true,
  min: 0,
  validate: Number.isSafeInteger,
};
// Posted journals, operation identities and account ownership are append-only.
// Raw MongoDB access must additionally be restricted by deployment credentials.
export function financialModel(name: string, schema: Schema) {
  schema.pre("save", function () {
    if (!this.isNew)
      throw new AppError(
        409,
        "LEDGER_IMMUTABLE",
        "Financial history is append-only",
      );
  });
  for (const hook of [
    "updateOne",
    "updateMany",
    "findOneAndUpdate",
    "replaceOne",
    "findOneAndReplace",
    "deleteOne",
    "deleteMany",
    "findOneAndDelete",
  ] as const) {
    schema.pre(hook as any, function () {
      throw new AppError(
        409,
        "LEDGER_IMMUTABLE",
        "Financial history is append-only",
      );
    });
  }
  schema.pre("deleteOne", { document: true, query: false }, function () {
    throw new AppError(
      409,
      "LEDGER_IMMUTABLE",
      "Financial history is append-only",
    );
  });
  schema.pre("bulkWrite", function () {
    throw new AppError(
      409,
      "LEDGER_IMMUTABLE",
      "Financial history is append-only",
    );
  });
  schema.pre("insertMany", function () {
    throw new AppError(
      409,
      "LEDGER_USE_SERVICE",
      "Use validated transactional journal posting",
    );
  });
  return mongoose.model(name, schema);
}
