import mongoose from "mongoose";
import { readConfig } from "../config/env.js";
import "../models/index.js";
await mongoose.connect(readConfig().MONGODB_URI, { autoIndex: false });
try {
  for (const model of Object.values(mongoose.models))
    await model.createIndexes();
  console.log("Indexes created; existing indexes were not dropped.");
} finally {
  await mongoose.disconnect();
}
