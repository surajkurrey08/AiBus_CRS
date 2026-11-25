import type { Request, Response, NextFunction, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { fail } from "../utils/response.js";

export type CarOperatorRole = "operator_admin" | "operator_staff" | "super_admin";

export type CarPermission =
  | "car:fleet:read"
  | "car:fleet:write"
  | "car:layout:read"
  | "car:layout:write"
  | "car:routes:read"
  | "car:routes:write"
  | "car:trips:read"
  | "car:trips:write"
  | "car:bookings:read"
  | "car:bookings:write";

export interface CarPrincipal {
  userId: string;
  operatorId: string;
  role: CarOperatorRole;
  permissions: CarPermission[];
  system: "car_crs";
}

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      carAuth?: CarPrincipal;
    }
  }
}

export function signCarToken(
  payload: Omit<CarPrincipal, "system">,
  secret: string,
  expiresIn = "8h"
): string {
  return jwt.sign(
    {
      ...payload,
      system: "car_crs",
    },
    secret,
    { expiresIn } as any
  );
}

export function verifyCarToken(token: string, secret: string): CarPrincipal {
  try {
    const decoded = jwt.verify(token, secret) as any;
    if (decoded.system !== "car_crs") {
      fail(
        403,
        "INVALID_SYSTEM_CONTEXT",
        "Token does not belong to the Car CRS system context. Bus CRS tokens are not accepted."
      );
    }
    if (!decoded.operatorId || !decoded.userId || !Array.isArray(decoded.permissions)) {
      fail(401, "MALFORMED_TOKEN", "Token payload is missing required authorization attributes.");
    }
    return {
      userId: decoded.userId,
      operatorId: decoded.operatorId,
      role: decoded.role || "operator_staff",
      permissions: decoded.permissions,
      system: "car_crs",
    };
  } catch (err: any) {
    if (err.name === "AppError") throw err;
    if (err.name === "TokenExpiredError") {
      return fail(401, "TOKEN_EXPIRED", "Car CRS authorization token has expired.");
    }
    return fail(401, "UNAUTHORIZED", "Invalid Car CRS authorization token.");
  }
}

export function authenticateCarOperator(secret: string): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return fail(401, "MISSING_AUTH_TOKEN", "Missing or invalid Authorization header");
    }

    try {
      const token = authHeader.replace(/^Bearer\s+/, "").trim();
      req.carAuth = verifyCarToken(token, secret);
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireCarPermission(permission: CarPermission): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.carAuth) {
      return fail(401, "UNAUTHENTICATED", "Unauthenticated Car CRS request");
    }
    if (
      !req.carAuth.permissions.includes(permission) &&
      !req.carAuth.permissions.includes("*" as any)
    ) {
      return fail(
        403,
        "FORBIDDEN",
        `Insufficient permissions: '${permission}' is required to perform this operation.`
      );
    }
    next();
  };
}
