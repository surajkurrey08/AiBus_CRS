import express from "express";
import { readFileSync } from "node:fs";
import swaggerUi from "swagger-ui-express";
import { createCarCrsApp } from "./app.js";

export function createCarSandboxApp(operatorSecret: string, providerSecret: string) {
  const app = express();
  app.disable("x-powered-by");
  const openapi = JSON.parse(readFileSync(new URL("./docs/openapi.json", import.meta.url), "utf8"));
  const options = {
    customSiteTitle: "AiCar Provider API",
    swaggerOptions: {
      supportedSubmitMethods: ["get", "post", "delete"], validatorUrl: null,
      persistAuthorization: false, displayRequestDuration: true,
    },
  };
  // Public documentation must precede the provider-authenticated API router.
  app.get("/api/v1/car/openapi.json", (_req, res) => res.json(openapi));
  app.use("/api/v1/car/docs", swaggerUi.serveFiles(openapi, options), swaggerUi.setup(openapi, options));
  app.use(createCarCrsApp(operatorSecret, providerSecret));
  return app;
}
