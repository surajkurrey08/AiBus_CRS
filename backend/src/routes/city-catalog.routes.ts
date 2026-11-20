import { Router } from "express";
import { z } from "zod";
import {
  CatalogCity,
  CityCatalogImport,
} from "../models/city-catalog.model.js";
import { asyncRoute, fail, id, literalRegex, ok } from "../utils/core.js";
import { platformPermit } from "../services/platform-read.service.js";
import {
  addCatalogCity,
  catalogCityInput,
  commitCityImport,
  prepareCityImport,
} from "../services/city-catalog.service.js";

const review = {
  password: z.string().min(1).max(128),
  reason: z.string().trim().min(5).max(240),
};
const query = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    search: z.string().trim().max(100).default(""),
  })
  .strict();
export async function listCatalogCities(raw: unknown, activeOnly = false) {
  const q = query.parse(raw),
    filter = {
      ...(activeOnly ? { status: "Active" } : {}),
      ...(q.search
        ? {
            $or: ["name", "state", "key", "cityId"].map((k) => ({
              [k]: literalRegex(q.search),
            })),
          }
        : {}),
    };
  const [rows, total] = await Promise.all([
    CatalogCity.find(filter)
      .select("cityId key name state country status")
      .sort({ name: 1, _id: 1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    CatalogCity.countDocuments(filter),
  ]);
  return {
    rows,
    meta: { ...q, total, pages: Math.max(1, Math.ceil(total / q.limit)) },
  };
}
function summary(batch: any) {
  return {
    id: String(batch._id),
    source: batch.source,
    digest: batch.digest,
    counts: batch.counts,
    total: batch.rows.length,
    cursor: batch.cursor,
    inserted: batch.inserted,
    skipped: batch.skipped,
    status: batch.status,
  };
}
// Mounted inside the existing authenticated global platform router.
export function cityCatalogRouter() {
  const router = Router();
  router.get(
    "/",
    asyncRoute(async (req, res) => {
      platformPermit(req.auth, "platform:settings:read");
      const result = await listCatalogCities(req.query);
      ok(res, result.rows, result.meta);
    }),
  );
  router.post(
    "/",
    asyncRoute(async (req, res) => {
      const { password, reason, ...city } = z
        .object({ ...catalogCityInput.shape, ...review })
        .strict()
        .parse(req.body);
      ok(res, await addCatalogCity(req.auth, city, password, reason));
    }),
  );
  router.post(
    "/imports/preview",
    asyncRoute(async (req, res) => {
      const input = z
        .object({
          source: z.string().trim().min(1).max(120),
          rows: z.array(z.unknown()).min(1).max(50000),
        })
        .strict()
        .parse(req.body);
      ok(
        res,
        summary(await prepareCityImport(req.auth, input.rows, input.source)),
      );
    }),
  );
  router.get(
    "/imports/:id",
    asyncRoute(async (req, res) => {
      platformPermit(req.auth, "platform:settings:write");
      const q = query.parse(req.query);
      const batch: any = await CityCatalogImport.findOne({
        _id: id.parse(req.params.id),
        actorId: req.auth.userId,
      }).lean();
      if (!batch) fail(404, "NOT_FOUND", "Import preview not found");
      ok(
        res,
        {
          ...summary(batch),
          rows: batch.rows.slice((q.page - 1) * q.limit, q.page * q.limit),
        },
        {
          page: q.page,
          limit: q.limit,
          total: batch.rows.length,
          pages: Math.ceil(batch.rows.length / q.limit),
        },
      );
    }),
  );
  router.post(
    "/imports/:id/commit",
    asyncRoute(async (req, res) => {
      const input = z
        .object({ cursor: z.number().int().min(0), ...review })
        .strict()
        .parse(req.body);
      ok(
        res,
        summary(
          await commitCityImport(req.auth, id.parse(req.params.id), input),
        ),
      );
    }),
  );
  return router;
}
