import mongoose from "mongoose";
import { readConfig } from "../config/env.js";
import { id } from "../validators/common.schemas.js";
import { migrateAgentUser } from "../services/agent-migration.service.js";
const args = process.argv.slice(2);
const value = (flag: string) => args[args.indexOf(flag) + 1];
if (!args.includes("--operator-id") || !args.includes("--user-id"))
  throw new Error(
    "Provide --operator-id <id> --user-id <id>. Default is dry-run; add --apply only after reviewing the plan.",
  );
const operatorId = id.parse(value("--operator-id")),
  userId = id.parse(value("--user-id"));
await mongoose.connect(readConfig().MONGODB_URI, { autoIndex: false });
try {
  console.log(
    JSON.stringify(
      await migrateAgentUser(operatorId, userId, args.includes("--apply")),
      null,
      2,
    ),
  );
} finally {
  await mongoose.disconnect();
}
