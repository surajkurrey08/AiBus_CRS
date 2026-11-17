import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "../config/logger.js";
import { AppError } from "../utils/errors.js";

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  let status = 500,
    code = "INTERNAL_ERROR",
    message = "The request could not be completed";
  if (error instanceof AppError) {
    status = error.status;
    code = error.code;
    message = error.message;
  } else if (error instanceof ZodError) {
    status = 400;
    code = "VALIDATION_ERROR";
    message = error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
  } else if ((error as { code?: number })?.code === 11000) {
    status = 409;
    code = "DUPLICATE_RECORD";
    message = "A record with this identifier already exists";
  } else if ((error as { name?: string })?.name === "CastError") {
    status = 400;
    code = "INVALID_ID";
    message = "Invalid record identifier";
  } else if ((error as { type?: string })?.type === "entity.parse.failed") {
    status = 400;
    code = "INVALID_JSON";
    message = "Request body must be valid JSON";
  } else if ((error as { code?: string })?.code === "LIMIT_FILE_SIZE") {
    status = 413;
    code = "FILE_TOO_LARGE";
    message = "Image exceeds 5 MB limit";
  }
  if (status >= 500)
    logger.error({ requestId: req.requestId, code }, "Request failed");
  res
    .status(status)
    .json({ error: { code, message, requestId: req.requestId } });
}
