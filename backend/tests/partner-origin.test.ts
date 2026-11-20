import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  allowedWebOrigins,
  isProductionLike,
  readConfig,
} from "../src/config/env.js";
import { originGuard } from "../src/middleware/auth.middleware.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { setRefresh } from "../src/services/auth.service.js";
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
  it("accepts only hardened staging configuration and excludes development origins", async () => {
    const stagingEnvironment = {
      NODE_ENV: "staging",
      MONGODB_URI:
        "mongodb+srv://sandbox-user:password@cluster.example.test/aibus_public_sandbox_partner?retryWrites=true",
      REDIS_URL:
        "rediss://aibus-public-test:redis-password@redis.example.test:6379",
      REDIS_PREFIX: "aibus:public-test",
      JWT_SECRET: "s".repeat(64),
      PUBLIC_API_JWT_SECRET: "p".repeat(64),
      PUBLIC_API_SANDBOX: "true",
      FINANCE_TEST_MODE: "true",
      RAZORPAY_KEY_ID: "rzp_test_fixture",
      RAZORPAY_KEY_SECRET: "fixture-test-secret",
      WEB_ORIGIN: "https://bookmybus.pro",
      PARTNER_WEB_ORIGIN: "https://partner.bookmybus.pro",
    };
    const staging = readConfig(stagingEnvironment);
    expect(isProductionLike(staging.NODE_ENV)).toBe(true);
    expect(allowedWebOrigins(staging)).toEqual([
      "https://bookmybus.pro",
      "https://partner.bookmybus.pro",
    ]);
    const secureCookieApp = express().get("/", (_req, res) => {
      setRefresh(res, "fixture-only-cookie", staging, "aibus_partner_refresh");
      res.sendStatus(204);
    });
    const { headers } = await request(secureCookieApp).get("/").expect(204);
    expect(headers["set-cookie"][0]).toContain("Secure");
    expect(() =>
      readConfig({
        ...stagingEnvironment,
        RAZORPAY_KEY_ID: "rzp_live_fixture",
      }),
    ).toThrow("Razorpay Test Mode");
    expect(() =>
      readConfig({
        ...stagingEnvironment,
        MONGODB_URI:
          "mongodb://sandbox-user:password@db.example.test/aibus_public_sandbox_partner?tls=true&tlsInsecure=true",
      }),
    ).toThrow("TLS-protected isolated public sandbox database");
    expect(() =>
      readConfig({
        ...stagingEnvironment,
        NODE_OPTIONS: "--tls-reject-unauthorized=0",
      }),
    ).toThrow("cannot disable TLS certificate verification");
  });
  it("rejects a non-sandbox staging database", () => {
    expect(() =>
      readConfig({
        NODE_ENV: "staging",
        MONGODB_URI:
          "mongodb+srv://prod-user:password@cluster.example.test/production",
        REDIS_URL: "rediss://:redis-password@redis.example.test:6379",
        REDIS_PREFIX: "aibus:public-test",
        JWT_SECRET: "s".repeat(64),
        PUBLIC_API_JWT_SECRET: "p".repeat(64),
        PUBLIC_API_SANDBOX: "true",
        FINANCE_TEST_MODE: "true",
        RAZORPAY_KEY_ID: "rzp_live_fixture",
        RAZORPAY_KEY_SECRET: "fixture-live-secret",
        WEB_ORIGIN: "https://partner.bookmybus.pro",
      }),
    ).toThrow("isolated public sandbox database");
  });
  it("rejects staging without a restricted Redis user and namespace", () => {
    const staging = {
      NODE_ENV: "staging",
      MONGODB_URI:
        "mongodb+srv://sandbox-user:password@cluster.example.test/aibus_public_sandbox_partner?retryWrites=true",
      REDIS_URL: "rediss://:production-password@redis.example.test:6379",
      REDIS_PREFIX: "aibus",
      JWT_SECRET: "s".repeat(64),
      PUBLIC_API_JWT_SECRET: "p".repeat(64),
      PUBLIC_API_SANDBOX: "true",
      FINANCE_TEST_MODE: "true",
      RAZORPAY_KEY_ID: "rzp_test_fixture",
      RAZORPAY_KEY_SECRET: "fixture-test-secret",
      WEB_ORIGIN: "https://bookmybus.pro",
    };
    expect(() => readConfig(staging)).toThrow(
      "restricted Redis ACL user and isolated key namespace",
    );
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
