import type { Response } from "express";

export const ok = (
  res: Response,
  data: unknown,
  meta?: unknown,
  status = 200,
) => res.status(status).json({ data, ...(meta ? { meta } : {}) });
