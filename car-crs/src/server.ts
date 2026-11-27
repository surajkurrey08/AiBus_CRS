import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import swaggerUi from "swagger-ui-express";
import { createCarCrsApp } from "./app.js";
import { readCarSandboxConfig } from "./config/env.js";
import { connectCarCrsDatabase } from "./database/connection.js";

const config = readCarSandboxConfig();
const openapi = JSON.parse(
  readFileSync(new URL("./docs/openapi.json", import.meta.url), "utf8"),
);
await connectCarCrsDatabase(config.CAR_CRS_MONGODB_URI);

const app = createCarCrsApp(
  config.CAR_CRS_JWT_SECRET,
  config.CAR_PROVIDER_JWT_SECRET,
);
app.get("/health/live", (_req, res) => res.json({ data: { status: "live" } }));
app.get("/health/ready", (_req, res) =>
  res.status(200).json({ data: { status: "ready" } }),
);
app.get("/api/v1/car/openapi.json", (_req, res) => res.json(openapi));
app.use(
  "/api/v1/car/docs",
  ...swaggerUi.serveFiles(openapi, {
    swaggerOptions: { supportedSubmitMethods: [], validatorUrl: null },
  }),
  swaggerUi.setup(openapi, {
    customSiteTitle: "AiCar Provider API",
    swaggerOptions: { supportedSubmitMethods: [], validatorUrl: null },
  }),
);

const server = createServer(app);
server.listen(config.CAR_CRS_PORT, "0.0.0.0", () =>
  console.log(`AiCar sandbox API listening on ${config.CAR_CRS_PORT}`),
);

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
