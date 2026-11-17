import { Router } from "express";
import { z } from "zod";
import type { Config } from "../config/env.js";
import {
  reconcileRazorpayPayment,
  startRazorpayPayment,
  verifyRazorpayPayment,
} from "../services/razorpay.service.js";
import { asyncRoute, id, ok, permit } from "../utils/core.js";

export function paymentRouter(config: Config) {
  const router = Router();
  router.use("/bookings/:id/payment", permit("bookings:write"));
  router.post(
    "/bookings/:id/payment",
    asyncRoute(async (req, res) =>
      ok(
        res,
        await startRazorpayPayment(config, req.auth, id.parse(req.params.id)),
      ),
    ),
  );
  router.post(
    "/bookings/:id/payment/verify",
    asyncRoute(async (req, res) => {
      const input = z
        .object({
          razorpay_order_id: z.string().regex(/^order_[a-z\d]+$/i),
          razorpay_payment_id: z.string().regex(/^pay_[a-z\d]+$/i),
          razorpay_signature: z.string().regex(/^[a-f\d]{64}$/i),
        })
        .strict()
        .parse(req.body);
      ok(
        res,
        await verifyRazorpayPayment(
          config,
          req.auth,
          id.parse(req.params.id),
          input,
        ),
      );
    }),
  );
  router.post(
    "/bookings/:id/payment/reconcile",
    asyncRoute(async (req, res) =>
      ok(
        res,
        await reconcileRazorpayPayment(
          config,
          req.auth,
          id.parse(req.params.id),
        ),
      ),
    ),
  );
  return router;
}
