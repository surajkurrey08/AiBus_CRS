import type { Request, Response, NextFunction, RequestHandler } from "express";

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function fail(status: number, code: string, message: string): never {
  throw new AppError(status, code, message);
}

export const ok = (res: Response, data: unknown, meta?: unknown, status = 200) => {
  return res.status(status).json({ data, ...(meta ? { meta } : {}) });
};

export function asyncRoute(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
