import mongoose from "mongoose";
import { createClient } from "redis";
import { readConfig } from "../config/env.js";
import { inspectPublicReadiness } from "../services/public-readiness.service.js";

let redis: ReturnType<typeof createClient> | undefined;
try {
  const args = process.argv.slice(2);
  if (
    args.length !== 4 ||
    args[0] !== "--partner" ||
    args[2] !== "--partner" ||
    args[1] === args[3] ||
    ![args[1], args[3]].every((v) => /^partner_[A-Za-z0-9_-]{1,100}$/.test(v))
  )
    throw Error("USAGE");
  const config = readConfig();
  // Fail before opening either datastore if the deployment is not isolated.
  if (
    !config.PUBLIC_API_SANDBOX ||
    config.NODE_ENV === "production" ||
    !new URL(config.MONGODB_URI).pathname.startsWith("/aibus_public_sandbox_")
  )
    throw Error("ISOLATION");
  await mongoose.connect(config.MONGODB_URI, {
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 10000,
  });
  const report = await inspectPublicReadiness(config, [args[1], args[3]]);
  redis = createClient({
    url: config.REDIS_URL,
    socket: { connectTimeout: 10000, reconnectStrategy: false },
  });
  redis.on("error", () => {});
  let redisReady = false;
  try {
    await redis.connect();
    redisReady = (await redis.ping()) === "PONG";
  } catch {
    /* Report without exposing connection details. */
  }
  report.checks.push({ name: "redis-connectivity-only", ready: redisReady });
  report.ready &&= redisReady;
  console.log(
    JSON.stringify(
      {
        ...report,
        evidence:
          "Read-only configuration/index/inventory checks; not proof of checkout, Redis ACL isolation, backup recovery or production readiness.",
      },
      null,
      2,
    ),
  );
  if (!report.ready) process.exitCode = 1;
} catch {
  console.error(
    JSON.stringify({
      ready: false,
      readOnly: true,
      error: "PUBLIC_PREFLIGHT_FAILED",
      next: "Use --partner <own-app-public-id> --partner <external-app-public-id>; verify isolated configuration and connectivity. Secret values are intentionally omitted.",
    }),
  );
  process.exitCode = 1;
} finally {
  if (redis?.isOpen) redis.destroy();
  await mongoose.disconnect();
}
