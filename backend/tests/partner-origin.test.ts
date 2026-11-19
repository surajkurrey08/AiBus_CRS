import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { allowedWebOrigins, readConfig } from "../src/config/env.js";
import { originGuard } from "../src/middleware/auth.middleware.js";
import { errorHandler } from "../src/middleware/error-handler.js";
const config = readConfig({
  NODE_ENV: "test",
  MONGODB_URI: "mongodb://127.0.0.1/unused_origin_test",
  JWT_SECRET: "o".repeat(64),
});
const app = express().use(express.json(), cookieParser(), originGuard(config));
app.post("/check", (_req, res) => res.json({ accepted: true }));
app.use(errorHandler);
describe("Partner portal origin policy", () => {
  it("allows the exact default partner development origin", async () => {
    expect(allowedWebOrigins(config)).toContain("http://127.0.0.1:5176");
    expect(
      (
        await request(app)
          .post("/check")
          .set("Origin", "http://127.0.0.1:5176")
          .set("X-Aibus-Client", "partner")
          .send({})
      ).status,
    ).toBe(200);
  });
  it("preserves existing Operator and Admin origins", async () => {
    for (const port of [5173, 5174])
      expect(
        (
          await request(app)
            .post("/check")
            .set("Origin", `http://127.0.0.1:${port}`)
            .send({})
        ).status,
      ).toBe(200);
  });
  it("rejects unapproved origins and names the correct partner workspace", async () => {
    const r = await request(app)
      .post("/check")
      .set("Origin", "http://127.0.0.1:5999")
      .set("X-Aibus-Client", "partner")
      .send({});
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("ORIGIN_REJECTED");
    expect(r.body.error.message).toContain(
      "partner workspace at http://127.0.0.1:5176",
    );
  });
  it("does not turn the configured partner origin into a wildcard", () => {
    const custom = readConfig({
      NODE_ENV: "test",
      MONGODB_URI: "mongodb://127.0.0.1/unused",
      JWT_SECRET: "q".repeat(64),
      PARTNER_WEB_ORIGIN: "https://partners.example.test",
    });
    expect(allowedWebOrigins(custom)).toContain(
      "https://partners.example.test",
    );
    expect(allowedWebOrigins(custom)).not.toContain("http://127.0.0.1:5176");
  });
  it("still blocks cross-site unsafe requests", async () => {
    expect(
      (
        await request(app)
          .post("/check")
          .set("Origin", "http://127.0.0.1:5176")
          .set("sec-fetch-site", "cross-site")
          .send({})
      ).status,
    ).toBe(403);
  });
  it("still requires an origin with partner refresh cookies", async () => {
    const r = await request(app)
      .post("/check")
      .set("Cookie", "aibus_partner_refresh=test-placeholder")
      .send({});
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("ORIGIN_REQUIRED");
  });
});
