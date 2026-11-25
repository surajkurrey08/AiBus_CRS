import { publicId, publicScopes } from "../src/services/public-auth.service.js";
import { mkdirSync, writeFileSync } from "node:fs";
// Isolated browser harness. Ignores user database/credential environment variables.
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createServer } from "node:http";
import { createClient } from "redis";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as M from "../src/models/index.js";
import { readConfig } from "../src/config/env.js";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/services/auth.service.js";
import { attachRealtime } from "../src/realtime/socket.js";
let container = "",
  mongo: MongoMemoryReplSet | undefined,
  redis: ReturnType<typeof createClient> | undefined;
try {
  const runId = process.env.AIBUS_E2E_RUN || randomUUID();
  if (!/^[a-f0-9-]{36}$/.test(runId))
    throw Error("Invalid fixture run identity");
  container = execFileSync(
    "docker",
    [
      "run",
      "--detach",
      "--rm",
      "--label",
      "aibus.test.run=" + runId,
      "--name",
      "aibus-e2e-" + randomUUID(),
      "--publish",
      "127.0.0.1::6379",
      "redis:7-alpine",
      "redis-server",
      "--save",
      "",
      "--appendonly",
      "no",
    ],
    { encoding: "utf8" },
  ).trim();
  if (!/^[a-f0-9]{64}$/.test(container))
    throw Error("Invalid disposable Redis container identity");
  mkdirSync(".cache", { recursive: true });
  writeFileSync(
    `.cache/e2e-redis-${runId}.json`,
    JSON.stringify({ id: container, runId }),
  );
  const mapping = execFileSync("docker", ["port", container, "6379/tcp"], {
    encoding: "utf8",
  }).trim();
  if (!/^127\.0\.0\.1:\d+$/.test(mapping))
    throw Error("Redis must be bound to loopback only");
  redis = createClient({
    url: "redis://" + mapping,
    socket: { reconnectStrategy: false },
  });
  redis.on("error", () => {});
  await redis.connect();
  mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    binary: { version: "7.0.14" },
  });
  await mongoose.connect(mongo.getUri("aibus_public_sandbox_browser_disposable"));
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const config = readConfig({
    NODE_ENV: "test",
    MONGODB_URI: mongo.getUri("aibus_public_sandbox_browser_disposable"),
    JWT_SECRET: "browser-fixture-".repeat(6),
    WEB_ORIGIN: "http://127.0.0.1:15173",
    PARTNER_WEB_ORIGIN: "http://127.0.0.1:15176",
    PUBLIC_API_SANDBOX: "true",
    PUBLIC_API_JWT_SECRET: "p".repeat(64),
    PUBLIC_WEBHOOK_SIGNING_KEY: "b".repeat(64),
    PUBLIC_WEBHOOK_ALLOWED_HOSTS: "partner.example.test",
    ADMIN_WEB_ORIGIN: "http://127.0.0.1:15174",
    REDIS_URL: "redis://" + mapping,
  });
  const hash = await hashPassword("Browser-Fixture-Password-123!");
  const owner = await M.Operator.create({
    company: "Isolated Browser Operator",
    publicSandboxInventory: true,
    email: "operator@browser.test",
    status: "approved",
  });
  await M.User.create({
    operatorId: owner._id,
    name: "Browser Operator",
    email: "operator@browser.test",
    role: "operator_admin",
    passwordHash: hash,
  });
  await M.User.create({
    name: "Browser Admin",
    email: "admin@browser.test",
    role: "super_admin",
    passwordHash: hash,
  });
  await M.User.create({
    name: "Browser Auditor",
    email: "audit@browser.test",
    role: "super_admin",
    platformProfile: "Audit / Read Only",
    platformPermissions: ["platform:audit:read"],
    passwordHash: hash,
  });
  const apiPartner = await M.ApiPartner.create({publicId:publicId("partner"),name:"Browser API Company",scopes:[...publicScopes],sandboxAllowancePaise:1000000,portalActivatedAt:new Date()});
  await M.User.create({name:"Browser Partner Owner",email:"partner@browser.test",role:"partner",partnerId:apiPartner._id,partnerRole:"Owner",passwordHash:hash});
  await M.User.create({name:"Browser Read Only",email:"readonly@browser.test",role:"partner",partnerId:apiPartner._id,partnerRole:"Read Only",passwordHash:hash});
  await M.PartnerInventoryGrant.create({partnerId:apiPartner._id,operatorId:owner._id,kind:"Operator",targetId:owner._id,expiresAt:new Date(Date.now()+86400000)});
  await M.Car.create({operatorId:owner._id,registration:"MH12CR4321",registrationNumber:"MH12CR4321",make:"Browser Car",model:"Sedan",vehicleCategory:"4-Passenger Sedan",category:"4-Passenger Sedan",totalPhysicalSeats:5,bookablePassengerCapacity:4,status:"Active"});
  const bus = await M.Bus.create({
    operatorId: owner._id,
    registration: "MH12BR1234",
    name: "Browser Sleeper",
    type: "AC Sleeper",
    capacity: 3,
  });
  await M.Layout.create({
    name: "Browser 2+1 fixture",
    operatorId: owner._id,
    busId: bus._id,
    seats: ["L1", "L2", "U1"].map((number, column) => ({
      number,
      row: 0,
      column,
      deck: number === "U1" ? "upper" : "lower",
      category: "sleeper",
      farePaise: 100000,
    })),
  });
  const route = await M.Route.create({
    operatorId: owner._id,
    source: "Pune",
    destination: "Mumbai",
    boarding: [{ name: "Wakad" }],
    dropping: [{ name: "Dadar" }],
    departure: "20:00",
    arrival: "23:00",
    durationMinutes: 180,
  });
  const journeyDate = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Kolkata",
  });
  await M.Trip.create({
    operatorId: owner._id,
    busId: bus._id,
    routeId: route._id,
    journeyDate,
    departureAt: new Date(Date.now() + 3600000),
    seats: ["L1", "L2", "U1"].map((number, column) => ({
      number,
      row: 0,
      column,
      deck: number === "U1" ? "upper" : "lower",
      category: "sleeper",
      farePaise: 100000,
      state: "available",
    })),
  });
  await M.PricingPolicy.create({
    operatorId: owner._id,
    taxBasisPoints: 0,
    chargePaise: 0,
    chargesTaxable: false,
    operatorDiscountMaxPaise: 0,
    requireAge: false,
    requireGender: false,
    requireMobile: false,
    gstEnabled: false,
  });
  const limiter = {
    check: async (key: string, limit: number, seconds: number) =>
      Number(
        await redis!.eval(
          "local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end;return n",
          { keys: ["browser:" + key], arguments: [String(seconds)] },
        ),
      ) <= limit,
  };
  const server = createServer(
      createApp(
        config,
        limiter,
        async () =>
          mongoose.connection.readyState === 1 &&
          (await redis!.ping()) === "PONG",
      ),
    ),
    io = attachRealtime(server, config);
  server.listen(14100, "127.0.0.1", () =>
    console.log(
      "Isolated E2E fixture ready on 14100; no real payment transport configured",
    ),
  );
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    io.close();
    server.close();
    await redis?.quit();
    await mongoose.disconnect();
    await mongo?.stop();
    if (container)
      execFileSync("docker", ["stop", container], { stdio: "ignore" });
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} catch (error) {
  await redis?.quit().catch(() => {});
  await mongoose.disconnect();
  await mongo?.stop();
  if (/^[a-f0-9]{64}$/.test(container))
    execFileSync("docker", ["stop", container], { stdio: "ignore" });
  throw error;
}
