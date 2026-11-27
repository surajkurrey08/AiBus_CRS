import { createServer } from "node:http";
import { createCarSandboxApp } from "./sandbox-app.js";
import { readCarSandboxConfig } from "./config/env.js";
import { connectCarCrsDatabase } from "./database/connection.js";

const config = readCarSandboxConfig();
await connectCarCrsDatabase(config.CAR_CRS_MONGODB_URI);

const app = createCarSandboxApp(
  config.CAR_CRS_JWT_SECRET,
  config.CAR_PROVIDER_JWT_SECRET,
);
app.get("/health/live", (_req, res) => res.json({ data: { status: "live" } }));
app.get("/health/ready", (_req, res) =>
  res.status(200).json({ data: { status: "ready" } }),
);

const server = createServer(app);
server.listen(config.CAR_CRS_PORT, "0.0.0.0", () =>
  console.log(`AiCar sandbox API listening on ${config.CAR_CRS_PORT}`),
);

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
