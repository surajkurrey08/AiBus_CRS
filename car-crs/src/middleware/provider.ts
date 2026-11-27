import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { fail } from "../utils/response.js";

export const providerAudience = "car-provider-sandbox";
const ownerId = z.string().regex(/^[a-f0-9]{24}$/i);
const claims = z.object({ sub: ownerId, operatorId: ownerId, exp: z.number().int() });

declare global {
  namespace Express {
    interface Request {
      carProvider?: { userId: string; operatorId: string };
    }
  }
}

export function authenticateProvider(secret?: string): RequestHandler {
  return (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!secret || secret.length < 48 || process.env.NODE_ENV === "production")
      fail(503, "CAR_SANDBOX_DISABLED", "Car provider sandbox is unavailable");
    const match = /^Bearer ([^ ]+)$/i.exec(req.get("Authorization") || "");
    if (!match) fail(401, "PROVIDER_TOKEN_REQUIRED", "Supply a car provider bearer token");
    try {
      const token = claims.parse(jwt.verify(match[1], secret, {
        audience: providerAudience, algorithms: ["HS256"],
      }));
      req.carProvider = { userId: token.sub, operatorId: token.operatorId };
    } catch {
      fail(401, "INVALID_PROVIDER_TOKEN", "Invalid or expired car provider token");
    }
    next();
  };
}

export function issueProviderToken(
  secret: string,
  operatorId: string,
  providerId: string,
  expiresIn = "45m",
) {
  return jwt.sign({ operatorId }, secret, {
    subject: ownerId.parse(providerId),
    audience: providerAudience,
    expiresIn: expiresIn as jwt.SignOptions["expiresIn"],
    algorithm: "HS256",
  });
}
