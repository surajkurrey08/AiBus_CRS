import "dotenv/config";
import { z } from "zod";
const browserOrigin = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.hostname.includes("*") &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      value === url.origin
    );
  }, "Use an exact HTTP(S) origin without path, wildcard or credentials");
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = z
    .object({
      NODE_ENV: z
        .enum(["development", "test", "production"])
        .default("development"),
      PORT: z.coerce.number().int().min(1).max(65535).default(4000),
      MONGODB_URI: z.string().startsWith("mongodb"),
      REDIS_URL: z.string().url().default("redis://127.0.0.1:6379"),
      JWT_SECRET: z.string().min(48),
      WEB_ORIGIN: browserOrigin.default("http://127.0.0.1:5173"),
      ADMIN_WEB_ORIGIN: browserOrigin.optional(),
      PARTNER_WEB_ORIGIN: browserOrigin.optional(),
      AGENT_WEB_ORIGIN: browserOrigin.optional(),
      SMTP_HOST: z.string().optional(),
      SMTP_PORT: z.coerce.number().default(587),
      SMTP_USER: z.string().optional(),
      SMTP_PASSWORD: z.string().optional(),
      MAIL_FROM: z.string().email().default("no-reply@aibus.example"),
      UPLOAD_DIR: z.string().default("./var/uploads"),
      PUBLIC_API_SANDBOX: z.enum(["true", "false"]).default("false").transform(v => v === "true"),
      PUBLIC_API_JWT_SECRET: z.string().min(64).optional(),
      PUBLIC_WEBHOOK_SIGNING_KEY: z.string().regex(/^[a-f0-9]{64}$/).optional(),
      PUBLIC_WEBHOOK_ALLOWED_HOSTS: z.string().default(""),
      OPS_SLOW_MS: z.coerce.number().int().min(50).max(60000).default(1000),
      OPS_STUCK_MS: z.coerce.number().int().min(60000).max(86400000).default(900000),
      OPS_JOB_LAG_MS: z.coerce.number().int().min(30000).max(3600000).default(180000),
      TRUST_PROXY: z.coerce.number().int().min(0).default(0),
      RAZORPAY_KEY_ID: z.string().optional(),
      RAZORPAY_KEY_SECRET: z.string().optional(),
      RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
      FINANCE_TEST_MODE: z
        .enum(["true", "false"])
        .default("false")
        .transform((v) => v === "true"),
    })
    .parse(env);
  if (parsed.PUBLIC_API_SANDBOX && parsed.NODE_ENV === "production") throw new Error("Public sandbox cannot run in production");
  if (parsed.PUBLIC_API_JWT_SECRET && parsed.PUBLIC_API_JWT_SECRET === parsed.JWT_SECRET) throw new Error("Public API and dashboard signing keys must differ");
  if (
    parsed.NODE_ENV === "production" &&
    !parsed.WEB_ORIGIN.startsWith("https://")
  )
    throw new Error("Production WEB_ORIGIN must use HTTPS");
  if (parsed.JWT_SECRET.startsWith("replace-"))
    throw new Error("Replace the example JWT_SECRET with a random secret");
  if (parsed.NODE_ENV === "production") {
    if (parsed.FINANCE_TEST_MODE)
      throw new Error("Financial test operations cannot run in production");
    if (
      [parsed.ADMIN_WEB_ORIGIN, parsed.AGENT_WEB_ORIGIN, parsed.PARTNER_WEB_ORIGIN].some(
        (origin) => origin && !origin.startsWith("https://"),
      )
    )
      throw new Error("Production dashboard origins must use HTTPS");
    if (!/^mongodb(?:\+srv)?:\/\/[^/]+@/.test(parsed.MONGODB_URI))
      throw new Error("Production MongoDB credentials are required");
    const redis = new URL(parsed.REDIS_URL);
    if (!redis.password || redis.protocol !== "rediss:")
      throw new Error("Production Redis requires authentication and TLS");
  }
  return parsed;
}
export type Config = ReturnType<typeof readConfig>;
export const allowedWebOrigins = (config: Config) =>
  [
    config.WEB_ORIGIN,
    config.ADMIN_WEB_ORIGIN ??
      (config.NODE_ENV !== "production" ? "http://127.0.0.1:5174" : ""),
    config.AGENT_WEB_ORIGIN,
    config.PARTNER_WEB_ORIGIN ?? (config.NODE_ENV !== "production" ? "http://127.0.0.1:5176" : ""),
  ].filter((origin): origin is string => !!origin);
