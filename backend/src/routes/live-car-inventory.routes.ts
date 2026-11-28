import { createHash, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { Config } from "../config/env.js";
import { rateLimit, type Limiter } from "../middleware/auth.middleware.js";
import { searchCarInventory } from "../services/car-inventory-preview.service.js";
import { asyncRoute, dateOnly, fail, ok } from "../utils/core.js";

const city = z.string().trim().min(1).max(100);
const querySchema = z.object({
  source: city,
  destination: city,
  journeyDate: dateOnly,
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export function liveCarInventoryRouter(config: Config, limiter: Limiter) {
  const router = Router();
  const token = config.LIVE_CAR_INVENTORY_TOKEN;
  const operatorIds = config.LIVE_CAR_INVENTORY_OPERATOR_IDS?.split(",") ?? [];
  const digest = (value: string) => createHash("sha256").update(value).digest();
  const expected = token ? digest("Bearer " + token) : undefined;
  router.get("/trips/search", rateLimit(limiter, "live-car-inventory", 120, 60),
    asyncRoute(async (req, res) => {
      res.set("Cache-Control", "no-store");
      if (!expected || !operatorIds.length)
        return fail(404, "NOT_FOUND", "Live car inventory is unavailable");
      if (!timingSafeEqual(expected, digest(req.get("Authorization") ?? "")))
        return fail(401, "PARTNER_UNAUTHORIZED", "Invalid live inventory credential");

      const query = querySchema.parse(req.query);
      const result = await searchCarInventory(operatorIds, {}, query, async (id) => id);
      ok(res, result.data, { page: query.page, limit: query.limit, total: result.total });
    }),
  );
  return router;
}
