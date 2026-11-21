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
        .enum(["development", "test", "staging", "production"])
        .default("development"),
      PORT: z.coerce.number().int().min(1).max(65535).default(4000),
      MONGODB_URI: z.string().startsWith("mongodb"),
      REDIS_URL: z.string().url().default("redis://127.0.0.1:6379"),
      REDIS_PREFIX: z
        .string()
        .regex(/^[a-z0-9]+(?::[a-z0-9-]+)*$/i)
        .default("aibus"),
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
      PUBLIC_API_SANDBOX: z
        .enum(["true", "false"])
        .default("false")
        .transform((v) => v === "true"),
      PUBLIC_API_JWT_SECRET: z.string().min(64).optional(),
      // Private control-plane bridge; never exposed as a VITE/browser setting.
      SANDBOX_PORTAL_BRIDGE_SECRET: z.string().min(64).optional(),
      SANDBOX_PORTAL_URL: z.string().url().optional(),
      SANDBOX_CONTROL_URL: z.string().url().optional(),
      PUBLIC_WEBHOOK_SIGNING_KEY: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
      PUBLIC_WEBHOOK_ALLOWED_HOSTS: z.string().default(""),
      OPS_SLOW_MS: z.coerce.number().int().min(50).max(60000).default(1000),
      OPS_STUCK_MS: z.coerce
        .number()
        .int()
        .min(60000)
        .max(86400000)
        .default(900000),
      OPS_JOB_LAG_MS: z.coerce
        .number()
        .int()
        .min(30000)
        .max(3600000)
        .default(180000),
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
  if (parsed.PUBLIC_API_SANDBOX && parsed.NODE_ENV === "production")
    throw new Error("Public sandbox cannot run in production");
  if (
    parsed.PUBLIC_API_JWT_SECRET &&
    parsed.PUBLIC_API_JWT_SECRET === parsed.JWT_SECRET
  )
    throw new Error("Public API and dashboard signing keys must differ");
  for (const [name, value] of [
    ["SANDBOX_PORTAL_URL", parsed.SANDBOX_PORTAL_URL],
    ["SANDBOX_CONTROL_URL", parsed.SANDBOX_CONTROL_URL],
  ]) {
    if (!value) continue;
    const url = new URL(value);
    if (
      !parsed.SANDBOX_PORTAL_BRIDGE_SECRET ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      !(
        url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["public-test-api", "bookmybus-api"].includes(url.hostname))
      )
    )
      throw new Error(
        `${name} requires a private bridge key and an HTTPS origin or fixed internal service`,
      );
  }
  if (
    parsed.SANDBOX_PORTAL_BRIDGE_SECRET &&
    [parsed.JWT_SECRET, parsed.PUBLIC_API_JWT_SECRET].includes(
      parsed.SANDBOX_PORTAL_BRIDGE_SECRET,
    )
  )
    throw new Error(
      "Sandbox bridge key must differ from dashboard and Public API signing keys",
    );
  if (
    parsed.SANDBOX_PORTAL_URL &&
    parsed.NODE_ENV !== "production" &&
    parsed.NODE_ENV !== "test"
  )
    throw new Error(
      "Only the production control plane can forward sandbox portal operations",
    );
  if (
    parsed.SANDBOX_CONTROL_URL &&
    parsed.NODE_ENV !== "staging" &&
    parsed.NODE_ENV !== "test"
  )
    throw new Error(
      "Only an isolated sandbox can query the production control plane",
    );
  if (
    isProductionLike(parsed.NODE_ENV) &&
    !parsed.WEB_ORIGIN.startsWith("https://")
  )
    throw new Error("Production-like WEB_ORIGIN must use HTTPS");
  if (parsed.JWT_SECRET.startsWith("replace-"))
    throw new Error("Replace the example JWT_SECRET with a random secret");
  if (isProductionLike(parsed.NODE_ENV)) {
    if (parsed.NODE_ENV === "production" && parsed.FINANCE_TEST_MODE)
      throw new Error("Financial test operations cannot run in production");
    if (
      [
        parsed.ADMIN_WEB_ORIGIN,
        parsed.AGENT_WEB_ORIGIN,
        parsed.PARTNER_WEB_ORIGIN,
      ].some((origin) => origin && !origin.startsWith("https://"))
    )
      throw new Error("Production-like dashboard origins must use HTTPS");
    if (!/^mongodb(?:\+srv)?:\/\/[^/]+@/.test(parsed.MONGODB_URI))
      throw new Error("Production-like MongoDB credentials are required");
    const redis = new URL(parsed.REDIS_URL);
    if (!redis.password || redis.protocol !== "rediss:")
      throw new Error("Production-like Redis requires authentication and TLS");
  }
  if (parsed.NODE_ENV === "staging") {
    if (
      env.NODE_TLS_REJECT_UNAUTHORIZED === "0" ||
      /(?:^|\s)--tls-reject-unauthorized(?:=|\s+)0(?:\s|$)/.test(
        env.NODE_OPTIONS || "",
      )
    )
      throw new Error("Staging cannot disable TLS certificate verification");
    const databaseName = parsed.MONGODB_URI.match(
      /^mongodb(?:\+srv)?:\/\/[^/]+\/([^/?]+)/,
    )?.[1];
    if (
      !databaseName?.startsWith("aibus_public_sandbox_") ||
      !/^mongodb(?:\+srv)?:\/\/[^/:@]+:[^@]+@/.test(parsed.MONGODB_URI) ||
      (!parsed.MONGODB_URI.startsWith("mongodb+srv://") &&
        !/[?&]tls=true(?:&|$)/i.test(parsed.MONGODB_URI)) ||
      /[?&](?:tls|ssl)=false(?:&|$)/i.test(parsed.MONGODB_URI) ||
      /[?&](?:tlsInsecure|sslInsecure|tlsAllowInvalidCertificates|sslAllowInvalidCertificates|tlsAllowInvalidHostnames|sslAllowInvalidHostnames)=true(?:&|$)/i.test(
        parsed.MONGODB_URI,
      ) ||
      /[?&]sslValidate=false(?:&|$)/i.test(parsed.MONGODB_URI)
    )
      throw new Error(
        "Staging requires a TLS-protected isolated public sandbox database",
      );
    const redis = new URL(parsed.REDIS_URL);
    if (
      redis.username !== "aibus-public-test" ||
      parsed.REDIS_PREFIX !== "aibus:public-test"
    )
      throw new Error(
        "Staging requires a restricted Redis ACL user and isolated key namespace",
      );
    if (
      !parsed.PUBLIC_API_SANDBOX ||
      !parsed.FINANCE_TEST_MODE ||
      !parsed.PUBLIC_API_JWT_SECRET
    )
      throw new Error(
        "Staging requires public sandbox and test finance mode with a separate public API key",
      );
    if (
      !parsed.RAZORPAY_KEY_ID?.startsWith("rzp_test_") ||
      !parsed.RAZORPAY_KEY_SECRET
    )
      throw new Error("Staging requires Razorpay Test Mode credentials");
  }
  return parsed;
}
export type Config = ReturnType<typeof readConfig>;
export const isProductionLike = (nodeEnv: Config["NODE_ENV"]) =>
  nodeEnv === "production" || nodeEnv === "staging";
export const allowedWebOrigins = (config: Config) =>
  [
    config.WEB_ORIGIN,
    config.ADMIN_WEB_ORIGIN ??
      (!isProductionLike(config.NODE_ENV) ? "http://127.0.0.1:5174" : ""),
    config.AGENT_WEB_ORIGIN,
    config.PARTNER_WEB_ORIGIN ??
      (!isProductionLike(config.NODE_ENV) ? "http://127.0.0.1:5176" : ""),
  ].filter((origin): origin is string => !!origin);
