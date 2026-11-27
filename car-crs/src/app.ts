import { authenticateProvider } from "./middleware/provider.js";
import express from "express";
import { authenticateCarOperator } from "./middleware/auth.middleware.js";
import { carMasterRouter } from "./routes/car-master.routes.js";
import { carLayoutRouter } from "./routes/car-layout.routes.js";
import { carRouteRouter } from "./routes/car-route.routes.js";
import { carTripMasterRouter } from "./routes/car-trip-master.routes.js";
import { carSearchRouter } from "./routes/car-search.routes.js";
import { carBookingRouter } from "./routes/car-booking.routes.js";
import { AppError } from "./utils/response.js";
import { ZodError } from "zod";

export function createCarCrsApp(jwtSecret: string, providerSecret?: string) {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "128kb" }));

  // Mount Public Car Search, Availability, Holds and Bookings routes
  app.use("/api/v1/car", authenticateProvider(providerSecret), carSearchRouter, carBookingRouter);

  // Mount API Operator routes
  const operatorRouter = express.Router();
  operatorRouter.use(authenticateCarOperator(jwtSecret));
  operatorRouter.use(carMasterRouter);
  operatorRouter.use(carLayoutRouter);
  operatorRouter.use(carRouteRouter);
  operatorRouter.use(carTripMasterRouter);
  operatorRouter.use(carBookingRouter);

  app.use("/api/v1/operator", operatorRouter);

  // Centralized Error Handler
  app.use(
    (
      err: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      if (err instanceof AppError) {
        return res.status(err.status).json({
          error: {
            code: err.code,
            message: err.message,
          },
        });
      }

      if (err instanceof ZodError) {
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid request payload",
            details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
          },
        });
      }

      if (err.name === "CastError") {
        return res.status(400).json({
          error: {
            code: "INVALID_IDENTIFIER",
            message: `Invalid format for field '${err.path}'`,
          },
        });
      }

      const status = err.status || 500;
      return res.status(status).json({
        error: {
          code: err.code || "INTERNAL_SERVER_ERROR",
          message: err.message || "An unexpected error occurred",
        },
      });
    }
  );

  return app;
}
