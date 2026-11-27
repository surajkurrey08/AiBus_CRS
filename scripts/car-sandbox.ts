import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import express from "express";
import jwt from "jsonwebtoken";
import swaggerUi from "swagger-ui-express";
import { createCarCrsApp } from "../car-crs/src/app.js";
import { connectCarCrsDatabase, disconnectCarCrsDatabase } from "../car-crs/src/database/connection.js";
import { prepareSampleTrips } from "./car-sandbox-fixture.js";
import { providerAudience } from "../car-crs/src/middleware/provider.js";

// This entry point only operates on disposable loopback infrastructure.
if (process.env.NODE_ENV === "production" || process.env.NODE_ENV === "staging")
  throw new Error("Start the local car sandbox in development mode");

const cache = new URL("../.cache/car-sandbox/", import.meta.url);
mkdirSync(cache, { recursive: true, mode: 0o700 });
const keyPath = new URL("local-signing-key", cache);
try {
  writeFileSync(keyPath, randomBytes(48).toString("base64url"), { flag: "wx", mode: 0o600 });
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
}
const key = readFileSync(keyPath, "utf8");
const localDatabase = "mongodb://127.0.0.1:27018/aibus_car_crs_sandbox_local?replicaSet=rs0&directConnection=true";
function issueToken(operatorId: string, providerId: string) {
  return jwt.sign({ operatorId }, key, {
    subject: providerId, audience: providerAudience, expiresIn: "45m", algorithm: "HS256",
  });
}
if (process.argv[2] === "token") {
  const [, , , operatorId, providerId] = process.argv;
  if (![operatorId, providerId].every(id => /^[a-f0-9]{24}$/i.test(id ?? "")))
    throw new Error("Supply operatorId and providerId as 24 hexadecimal characters");
  const token = issueToken(operatorId, providerId);
  writeFileSync(new URL("provider-token", cache), token, { mode: 0o600 });
  console.log("Local 45-minute token saved to .cache/car-sandbox/provider-token");
} else if (process.argv[2] === "prepare") {
  await connectCarCrsDatabase(localDatabase);
  try {
    const { operatorId, providerId, journeyDate, returnDate } = await prepareSampleTrips();
    const env = {
      name: "AiCar localhost", _postman_variable_scope: "environment",
      values: [
        { key: "providerToken", value: issueToken(operatorId, providerId), type: "secret", enabled: true },
        { key: "journeyDate", value: journeyDate, enabled: true },
        { key: "returnDate", value: returnDate, enabled: true },
      ],
    };
    writeFileSync(new URL("aicar.local.postman_environment.json", cache), JSON.stringify(env, null, 2), { mode: 0o600 });
    console.log(`Demo inventory operator ID: ${operatorId}`);
    console.log(`Pune to Mumbai: ${journeyDate}; return: ${returnDate}. Private Postman environment saved in .cache/car-sandbox/.`);
  } finally {
    await disconnectCarCrsDatabase();
  }
} else {
  const spec = JSON.parse(readFileSync(new URL("../car-crs/src/docs/openapi.json", import.meta.url), "utf8"));
  const docsOptions = { customSiteTitle: "AiCar Provider API", swaggerOptions: {
    supportedSubmitMethods: [], validatorUrl: null, persistAuthorization: false,
  }};
  await connectCarCrsDatabase(localDatabase);
  const app = express();
  app.get("/api/v1/car/openapi.json", (_req, res) => res.json(spec));
  app.use("/api/v1/car/docs", swaggerUi.serveFiles(spec, docsOptions), swaggerUi.setup(spec, docsOptions));
  app.use(createCarCrsApp(randomBytes(48).toString("hex"), key));
  app.listen(4010, "127.0.0.1", () => console.log("Car Swagger: http://127.0.0.1:4010/api/v1/car/docs/"));
}
