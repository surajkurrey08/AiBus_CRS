import mongoose from "mongoose";
import { readConfig } from "../config/env.js";
import { reconcileRazorpayOrders } from "../services/razorpay.service.js";
import {
  reconcileExpiredHolds,
  reconcileExternalBookings,
} from "../jobs/booking.jobs.js";
const config = readConfig();
await mongoose.connect(config.MONGODB_URI);
try {
  await reconcileRazorpayOrders(config);
  console.log(
    JSON.stringify({
      expiredTripCount: await reconcileExpiredHolds(),
      external: await reconcileExternalBookings(),
    }),
  );
} finally {
  await mongoose.disconnect();
}
