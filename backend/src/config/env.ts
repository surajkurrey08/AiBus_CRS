import "dotenv/config";
import { z } from "zod";
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
      WEB_ORIGIN: z.string().url().default("http://127.0.0.1:5173"),
      ADMIN_WEB_ORIGIN: z.string().url().optional(),
      SMTP_HOST: z.string().optional(),
      SMTP_PORT: z.coerce.number().default(587),
      SMTP_USER: z.string().optional(),
      SMTP_PASSWORD: z.string().optional(),
      MAIL_FROM: z.string().email().default("no-reply@aibus.example"),
      UPLOAD_DIR: z.string().default("./var/uploads"),
      TRUST_PROXY: z.coerce.number().int().min(0).default(0),
      RAZORPAY_KEY_ID: z.string().optional(),
      RAZORPAY_KEY_SECRET: z.string().optional(),
      RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
    })
    .parse(env);
  if (
    parsed.NODE_ENV === "production" &&
    !parsed.WEB_ORIGIN.startsWith("https://")
  )
    throw new Error("Production WEB_ORIGIN must use HTTPS");
  if (parsed.JWT_SECRET.startsWith("replace-"))
    throw new Error("Replace the example JWT_SECRET with a random secret");
  if (parsed.NODE_ENV === "production") {
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
  ].filter(Boolean);
