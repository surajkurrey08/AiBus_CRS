import { Router } from "express";
import { z } from "zod";
import { asyncRoute, id, ok } from "../utils/core.js";
import {
  financialAccounts,
  financialJournals,
} from "../services/ledger-read.service.js";
const query = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export function financeRouter() {
  const router = Router();
  router.get(
    "/accounts",
    asyncRoute(async (req, res) => {
      const { page, limit } = query.parse(req.query);
      ok(res, await financialAccounts(req.auth, page, limit));
    }),
  );
  router.get(
    "/journals",
    asyncRoute(async (req, res) => {
      const { page, limit } = query.parse(req.query);
      ok(res, await financialJournals(req.auth, page, limit));
    }),
  );
  router.get(
    "/journals/:id",
    asyncRoute(async (req, res) => {
      z.object({}).strict().parse(req.query);
      ok(
        res,
        (await financialJournals(req.auth, 1, 1, id.parse(req.params.id)))
          .journals[0],
      );
    }),
  );
  return router;
}
