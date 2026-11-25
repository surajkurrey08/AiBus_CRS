import {
  partnerPortalRouter,
  platformPartnersRouter,
} from "./routes/partner-portal.routes.js";
import { publicApiRouter } from "./routes/public-api.routes.js";
import { sandboxPortalBridgeRouter } from "./routes/sandbox-portal.routes.js";
import { operationsRouter } from "./routes/operations.routes.js";
import { observeRequests } from "./services/observability.service.js";
import { settlementRouter } from "./routes/settlement.routes.js";
import { refundWorkflowRouter } from "./routes/refund-workflow.routes.js";
import { platformRouter } from "./routes/platform.routes.js";
import { financeRouter } from "./routes/finance.routes.js";
import { agencyFinanceRouter } from "./routes/agency-finance.routes.js";
import { agentRouter } from "./routes/agent.routes.js";
import { agentManagementRouter } from "./routes/agent-management.routes.js";
import { operatorStaffOnly } from "./middleware/authorization.js";
import { busMasterRouter } from "./routes/bus-master.routes.js";
import { tripMasterRouter } from "./routes/trip-master.routes.js";
import { areaMasterRouter } from "./routes/area-master.routes.js";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import mongoose from "mongoose";
import { pinoHttp } from "pino-http";
import swaggerUi from "swagger-ui-express";
import { allowedWebOrigins, type Config } from "./config/env.js";
import { openapi } from "./docs/openapi.js";
import {
  authRouter,
  authenticate,
  originGuard,
  rateLimit,
  type Limiter,
} from "./modules/auth/index.js";
import { operatorRouter } from "./routes/operator.routes.js";
import { paymentRouter } from "./routes/payment.routes.js";
import { razorpayWebhook } from "./services/razorpay.service.js";
import {
  AppError,
  asyncRoute,
  errorHandler,
  logger,
  ok,
  requestContext,
} from "./utils/core.js";
export function createApp(
  config: Config,
  limiter: Limiter,
  ready: () => Promise<boolean> = async () =>
    mongoose.connection.readyState === 1,
) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.TRUST_PROXY);
  app.use(
    requestContext,
    observeRequests(config.OPS_SLOW_MS),
    helmet(),
    cors({
      origin: allowedWebOrigins(config),
      credentials: true,
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "Idempotency-Key",
        "X-Aibus-Client",
      ],
    }),
  );
  // Provider authentication is its raw-body HMAC, not a browser session cookie.
  app.post(
    "/api/v1/webhooks/razorpay",
    rateLimit(limiter, "razorpay-webhook", 120, 60),
    express.raw({ type: "application/json", limit: "128kb" }),
    asyncRoute(async (req, res) => {
      if (!Buffer.isBuffer(req.body))
        throw new AppError(
          400,
          "INVALID_WEBHOOK",
          "Expected a JSON webhook body.",
        );
      ok(
        res,
        await razorpayWebhook(
          config,
          req.body,
          req.get("x-razorpay-signature") || "",
        ),
      );
    }),
  );
  app.use(
    // Only the authenticated catalog upload accepts larger JSON. Other API
    // requests keep the existing 128KB cap.
    (req, res, next) => {
      if (
        req.path !== "/api/v1/platform/city-catalog/imports/preview" ||
        req.method !== "POST"
      )
        return express.json({ limit: "128kb" })(req, res, next);
      rateLimit(
        limiter,
        "city-catalog-upload",
        10,
        900,
      )(req, res, (limitError) => {
        if (limitError) return next(limitError);
        authenticate(config)(req, res, (error) => {
          if (error) return next(error);
          if (
            req.auth.role !== "super_admin" ||
            req.auth.operatorId ||
            req.auth.agentId ||
            !req.auth.permissions.includes("platform:settings:write")
          )
            return next(
              new AppError(
                403,
                "FORBIDDEN",
                "City catalog import permission required",
              ),
            );
          originGuard(config)(req, res, (originError) =>
            originError
              ? next(originError)
              : express.json({ limit: "8mb" })(req, res, next),
          );
        });
      });
    },
    cookieParser(),
    originGuard(config),
  );
  app.use(
    pinoHttp({
      logger,
      autoLogging: config.NODE_ENV !== "test",
      serializers: {
        req: (req) => ({
          id: req.id,
          method: req.method,
          path: String(req.url).split("?")[0],
        }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.get("/health/live", (_req, res) => ok(res, { status: "live" }));
  app.get(
    "/health/ready",
    asyncRoute(async (_req, res) => {
      let healthy = false;
      try {
        healthy = await ready();
      } catch {
        /* Readiness fails closed. */
      }
      res
        .status(healthy ? 200 : 503)
        .json({ data: { status: healthy ? "ready" : "unavailable" } });
    }),
  );
  app.use("/api", rateLimit(limiter, "api", 300, 60));
  app.use("/api/v1/auth", authRouter(config, limiter));
  app.use(
    "/internal/sandbox-portal",
    sandboxPortalBridgeRouter(config, limiter),
  );
  app.use("/api/v1/partner", partnerPortalRouter(config, limiter));
  app.use("/api/v1/platform/api-partners", platformPartnersRouter(config));
  app.use("/api/v1/public", publicApiRouter(config, limiter));
  app.get("/api/v1/openapi.json", authenticate(config), (_req, res) =>
    res.json(openapi),
  );
  app.use(
    "/api/v1/docs",
    authenticate(config),
    swaggerUi.serve,
    swaggerUi.setup(openapi),
  );
  // No unauthenticated financial callback accepts a client's payment status.
  app.post("/api/v1/webhooks/:provider", (_req, _res, next) =>
    next(
      new AppError(
        503,
        "WEBHOOK_UNAVAILABLE",
        "No provider signature verifier has been configured",
      ),
    ),
  );
  app.use("/api/v1/agent", authenticate(config), agentRouter(config));
  app.use(
    "/api/v1/agent",
    authenticate(config),
    refundWorkflowRouter(config, "agent"),
  );
  app.use(
    "/api/v1/agent",
    authenticate(config),
    agencyFinanceRouter(config, true),
  );
  app.use("/api/v1/finance", authenticate(config), financeRouter());
  app.use("/api/v1/operator", authenticate(config), operatorStaffOnly);
  app.use("/api/v1/operator/operations", operationsRouter(config));
  app.use(
    "/api/v1/platform/operations",
    authenticate(config),
    operationsRouter(config, true, ready),
  );
  app.use("/api/v1/operator/finance", agencyFinanceRouter(config));
  app.use("/api/v1/operator/finance", refundWorkflowRouter(config));
  app.use("/api/v1/operator/finance", settlementRouter(config, "operator"));
  app.use("/api/v1/operator/agents", agentManagementRouter());
  app.use(
    "/api/v1/operator/bus-master",
    (req, res, next) => {
      if (process.env.ENABLE_LEGACY_BUS_MASTER !== "true") {
        return res.status(410).json({
          error: {
            code: "BUS_MASTER_RETIRED",
            message:
              "Bus fleet management is retired. Use /api/v1/operator/cars for car fleet management.",
          },
        });
      }
      next();
    },
    authenticate(config),
    busMasterRouter(),
  );
  app.use(
    "/api/v1/operator/area-master",
    authenticate(config),
    areaMasterRouter(),
  );
  app.use(
    "/api/v1/operator/trip-master",
    authenticate(config),
    tripMasterRouter(),
  );
  app.use(
    "/api/v1/operator",
    authenticate(config),
    paymentRouter(config),
    operatorRouter(config),
  );
  app.use(
    "/api/v1/platform/finance",
    authenticate(config),
    refundWorkflowRouter(config, "platform"),
  );
  app.use(
    "/api/v1/platform/finance",
    authenticate(config),
    settlementRouter(config, "platform"),
  );
  app.use(
    "/api/v1/agent/finance",
    authenticate(config),
    settlementRouter(config, "agent"),
  );
  app.use("/api/v1/platform", platformRouter(config, limiter));
  app.use((_req, _res, next) =>
    next(new AppError(404, "NOT_FOUND", "Endpoint not found")),
  );
  app.use(errorHandler);
  return app;
}
