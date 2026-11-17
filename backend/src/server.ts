import { createAdapter } from "@socket.io/redis-adapter";
import mongoose from "mongoose";
import http from "node:http";
import { createClient } from "redis";
import { createApp } from "./app.js";
import { readConfig } from "./config/env.js";
import { reconcileRazorpayOrders } from "./services/razorpay.service.js";
import {
  publishOutbox,
  reconcileExpiredHolds,
  reconcileExternalBookings,
} from "./jobs/booking.jobs.js";
import { attachRealtime } from "./realtime/socket.js";
import { logger } from "./utils/core.js";
const config = readConfig();
mongoose.set("sanitizeFilter", false);
await mongoose.connect(config.MONGODB_URI, {
  autoIndex: config.NODE_ENV !== "production",
  serverSelectionTimeoutMS: 10000,
});
const redis = createClient({ url: config.REDIS_URL });
redis.on("error", () => logger.error("Redis unavailable"));
await redis.connect();
const subscriber = redis.duplicate();
subscriber.on("error", () => logger.error("Redis subscriber unavailable"));
await subscriber.connect();
const limiter = {
  async check(key: string, limit: number, seconds: number) {
    const value = await redis.eval(
      "local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end;return n",
      { keys: [`aibus:limit:${key}`], arguments: [String(seconds)] },
    );
    return Number(value) <= limit;
  },
};
const app = createApp(config, limiter, async () => {
  try {
    return (
      mongoose.connection.readyState === 1 && (await redis.ping()) === "PONG"
    );
  } catch {
    return false;
  }
});
const server = http.createServer(app);
const io = attachRealtime(server, config, createAdapter(redis, subscriber));
server.listen(config.PORT, "0.0.0.0", () =>
  logger.info({ port: config.PORT }, "Aibus operator API listening"),
);
let busy = false;
const timer = setInterval(async () => {
  if (busy) return;
  busy = true;
  try {
    await reconcileRazorpayOrders(config);
    await reconcileExpiredHolds();
    await reconcileExternalBookings();
    await publishOutbox(io);
  } catch {
    logger.error("Background reconciliation failed");
  } finally {
    busy = false;
  }
}, 10000);
timer.unref();
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(timer);
  const deadline = setTimeout(() => process.exit(1), 15000);
  deadline.unref();
  io.close();
  server.close();
  await Promise.allSettled([
    redis.quit(),
    subscriber.quit(),
    mongoose.disconnect(),
  ]);
  clearTimeout(deadline);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
