import type { Request, RequestHandler } from "express";
import { Permission } from "../types/permissions.js";
import { AppError, fail } from "../utils/errors.js";
export const operatorStaffOnly: RequestHandler = (req, _res, next) => {
  if (req.auth.agentId || req.auth.role === "agent" || req.auth.partnerId || req.auth.role === "partner")
    return next(
      new AppError(
        403,
        "OPERATOR_STAFF_REQUIRED",
        "Use the agency API for agent operations",
      ),
    );
  next();
};

export function permit(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth?.permissions.includes(permission))
      return next(
        new AppError(
          403,
          "FORBIDDEN",
          "You do not have permission for this action",
        ),
      );
    next();
  };
}

export function tenant(req: Request) {
  if (!req.auth.operatorId)
    fail(403, "OPERATOR_CONTEXT_REQUIRED", "An operator account is required");
  return { operatorId: req.auth.operatorId! };
}
