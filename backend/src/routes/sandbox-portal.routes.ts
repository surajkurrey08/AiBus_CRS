import { Router } from "express";
import type { Config } from "../config/env.js";
import type { Limiter } from "../middleware/auth.middleware.js";
import { asyncRoute, fail, ok } from "../utils/core.js";
import { verifyBridgeProof } from "../services/sandbox-bridge.transport.js";
import {
  controlEntitlement,
  executeSandboxPortal,
} from "../services/sandbox-portal.service.js";
export function sandboxPortalBridgeRouter(config: Config, limiter: Limiter) {
  const router = Router();
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.post(
    "/entitlement",
    asyncRoute(async (req, res) => {
      if (!config.SANDBOX_PORTAL_URL)
        fail(404, "NOT_FOUND", "Endpoint not found");
      const proof = verifyBridgeProof(
        config,
        "entitlement",
        req.get("Authorization")?.replace(/^Bearer /, "") || "",
        req.body,
      );
      if (!(await limiter.check(`sandbox-entitlement:${proof!.sub}`, 600, 60)))
        fail(
          429,
          "RATE_LIMITED",
          "Sandbox organization request limit exceeded",
        );
      ok(res, await controlEntitlement(proof!.sub, proof!.actorId));
    }),
  );
  router.post(
    "/execute",
    asyncRoute(async (req, res) => {
      if (!config.SANDBOX_CONTROL_URL)
        fail(404, "NOT_FOUND", "Endpoint not found");
      const proof = verifyBridgeProof(
        config,
        "execute",
        req.get("Authorization")?.replace(/^Bearer /, "") || "",
        req.body,
      );
      if (!(await limiter.check(`sandbox-execute:${proof!.sub}`, 300, 60)))
        fail(
          429,
          "RATE_LIMITED",
          "Sandbox organization request limit exceeded",
        );
      res.json(
        await executeSandboxPortal(
          config,
          limiter,
          req,
          proof!.sub,
          proof!.actorId,
          req.body,
        ),
      );
    }),
  );
  return router;
}
