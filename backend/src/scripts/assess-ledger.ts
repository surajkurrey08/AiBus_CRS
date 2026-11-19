import mongoose from "mongoose";
import { readConfig } from "../config/env.js";
import { assessHistoricalFinance } from "../services/ledger-integrity.service.js";
const args = process.argv.slice(2);
if (args.length !== 1 || !/^--operator=[a-f\d]{24}$/i.test(args[0]))
  throw new Error(
    "Read-only usage: npm run ledger:assess -- --operator=<operatorObjectId>. No apply mode exists.",
  );
await mongoose.connect(readConfig().MONGODB_URI, {
  autoIndex: false,
  autoCreate: false,
});
try {
  console.log(
    JSON.stringify(await assessHistoricalFinance(args[0].slice(11)), null, 2),
  );
} finally {
  await mongoose.disconnect();
}
