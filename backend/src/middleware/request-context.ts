import type { RequestHandler } from "express";
import { randomUUID } from "node:crypto";

export const requestContext: RequestHandler = (req, res, next) => {
  req.requestId = randomUUID();
  res.setHeader("X-Request-ID", req.requestId);
  next();
};
