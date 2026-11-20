import { type RequestHandler } from "express";
import {
  allowedWebOrigins,
  isProductionLike,
  type Config,
} from "../config/env.js";
import { hashToken, principal } from "../services/auth.service.js";
import { AppError, asyncRoute, fail } from "../utils/core.js";

export interface Limiter {
  check(key: string, limit: number, windowSeconds: number): Promise<boolean>;
}

export function rateLimit(
  limiter: Limiter,
  scope: string,
  limit: number,
  seconds: number,
): RequestHandler {
  return asyncRoute(async (req, _res, next) => {
    const identity =
      scope === "login"
        ? `${req.ip}:${hashToken(String(req.body?.email || "").toLowerCase())}`
        : req.ip;
    const allowed = await limiter.check(`${scope}:${identity}`, limit, seconds);
    if (!allowed)
      fail(429, "RATE_LIMITED", "Too many requests. Try again later.");
    next();
  });
}

export function originGuard(config: Config): RequestHandler {
  return (req, _res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const origin = req.get("origin");
    const client = req.get("X-Aibus-Client");
    const portal =
      client === "partner"
        ? "Partner"
        : client === "admin"
          ? "Admin"
          : client === "agent"
            ? "Agent"
            : "Operator";
    const portalOrigin =
      client === "partner"
        ? config.PARTNER_WEB_ORIGIN ||
          (!isProductionLike(config.NODE_ENV)
            ? "http://127.0.0.1:5176"
            : config.WEB_ORIGIN)
        : client === "admin"
          ? config.ADMIN_WEB_ORIGIN ||
            (!isProductionLike(config.NODE_ENV)
              ? "http://127.0.0.1:5174"
              : config.WEB_ORIGIN)
          : client === "agent"
            ? config.AGENT_WEB_ORIGIN || config.WEB_ORIGIN
            : config.WEB_ORIGIN;
    if (origin && !allowedWebOrigins(config).includes(origin))
      return next(
        new AppError(
          403,
          "ORIGIN_REJECTED",
          `Request origin is not allowed. Open the ${portal.toLowerCase()} workspace at ` +
            new URL(portalOrigin).origin +
            ".",
        ),
      );
    if (req.get("sec-fetch-site") === "cross-site")
      return next(
        new AppError(403, "ORIGIN_REJECTED", "Cross-site request blocked"),
      );
    if (
      (req.cookies?.aibus_refresh ||
        req.cookies?.aibus_admin_refresh ||
        req.cookies?.aibus_agent_refresh ||
        req.cookies?.aibus_partner_refresh) &&
      !origin
    )
      return next(
        new AppError(
          403,
          "ORIGIN_REQUIRED",
          "Origin header is required for cookie-authenticated requests",
        ),
      );
    next();
  };
}

export function authenticate(config: Config): RequestHandler {
  return asyncRoute(async (req, _res, next) => {
    const header = req.get("authorization");
    if (!header?.startsWith("Bearer "))
      fail(401, "UNAUTHENTICATED", "Sign in to continue");
    req.auth = await principal(header!.slice(7), config);
    next();
  });
}
