import { describe, it, expect } from "vitest";
import request from "supertest";
import { createCarSandboxApp } from "../src/sandbox-app.js";

describe("Deployed sandbox documentation routing", () => {
  const app = createCarSandboxApp("o".repeat(64), "p".repeat(64));
  it("exposes the deployment health probe contract without a bearer token", async () => {
    const response = await request(app).get("/api/v1/car/openapi.json").expect(200);
    expect(response.body.openapi).toBe("3.0.3");
  });
  it("serves Swagger and its assets without a bearer token", async () => {
    await request(app).get("/api/v1/car/docs/").expect(200);
    await request(app).get("/api/v1/car/docs/swagger-ui.css").expect(200);
  });
  it("still requires provider credentials for inventory", async () => {
    const response = await request(app).get("/api/v1/car/cities").expect(401);
    expect(response.body.error.code).toBe("PROVIDER_TOKEN_REQUIRED");
  });
});
