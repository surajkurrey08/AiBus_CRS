import "dotenv/config";
import { z } from "zod";

/**
 * Validates Car CRS configuration and enforces absolute database isolation.
 * Car CRS MUST never point to the primary Bus CRS database ('aibus').
 */
export function validateCarCrsConfig(env: NodeJS.ProcessEnv = process.env) {
  const schema = z.object({
    NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
    CAR_CRS_PORT: z.coerce.number().int().min(1024).max(65535).default(4010),
    CAR_CRS_MONGODB_URI: z.string().min(1, "CAR_CRS_MONGODB_URI is required"),
    BUS_CRS_MONGODB_URI: z.string().optional(),
    CAR_CRS_JWT_SECRET: z.string().min(48).optional(),
    CAR_PROVIDER_JWT_SECRET: z.string().min(48).optional(),
  });

  const parsed = schema.parse(env);

  // Absolute Database Isolation Guard
  const uri = parsed.CAR_CRS_MONGODB_URI.toLowerCase();

  // Reject if URI ends with /aibus or /aibus? or targets bus database
  if (/(?:\/aibus|\/aibus[?#])/.test(uri) && !uri.includes("aibus_car_crs")) {
    throw new Error(
      "FATAL_DATABASE_ISOLATION_VIOLATION: CAR_CRS_MONGODB_URI points to the Bus CRS database ('aibus'). " +
      "Car CRS must strictly use a dedicated database (e.g., 'aibus_car_crs') to prevent schema and data corruption."
    );
  }

  // Reject if explicitly identical to Bus CRS URI
  if (parsed.BUS_CRS_MONGODB_URI && parsed.CAR_CRS_MONGODB_URI === parsed.BUS_CRS_MONGODB_URI) {
    throw new Error(
      "FATAL_DATABASE_ISOLATION_VIOLATION: CAR_CRS_MONGODB_URI cannot be identical to BUS_CRS_MONGODB_URI."
    );
  }

  return parsed;
}

export function readCarSandboxConfig(env: NodeJS.ProcessEnv = process.env) {
  const config = validateCarCrsConfig(env);
  if (!config.CAR_CRS_JWT_SECRET || !config.CAR_PROVIDER_JWT_SECRET)
    throw new Error("CAR_CRS_JWT_SECRET and CAR_PROVIDER_JWT_SECRET are required");
  return {
    ...config,
    CAR_CRS_JWT_SECRET: config.CAR_CRS_JWT_SECRET,
    CAR_PROVIDER_JWT_SECRET: config.CAR_PROVIDER_JWT_SECRET,
  };
}
