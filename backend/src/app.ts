import { platformRouter } from "./routes/platform.routes.js";
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
    express.json({ limit: "128kb" }),
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
      const healthy = await ready();
      res
        .status(healthy ? 200 : 503)
        .json({ data: { status: healthy ? "ready" : "unavailable" } });
    }),
  );
  app.use("/api", rateLimit(limiter, "api", 300, 60));
  app.use("/api/v1/auth", authRouter(config, limiter));
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
  app.use(
    "/api/v1/operator/bus-master",
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
  app.use("/api/v1/platform", platformRouter(config));
  app.use((_req, _res, next) =>
    next(new AppError(404, "NOT_FOUND", "Endpoint not found")),
  );
  app.use(errorHandler);
  return app;
}
