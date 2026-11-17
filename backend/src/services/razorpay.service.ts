import type { Config } from "../config/env.js";
import {
  razorpayRequest,
  requireRazorpay,
  RAZORPAY_PROVIDER,
  validSignature,
} from "../integrations/razorpay.js";
import { Audit, Booking, PaymentOrder, Trip } from "../models/index.js";
import { AppError, fail, type Principal } from "../utils/core.js";
import { applyVerifiedPayment } from "./inventory.service.js";

async function ownedBooking(auth: Principal, bookingId: string): Promise<any> {
  const booking = await Booking.findOne({
    _id: bookingId,
    operatorId: auth.operatorId,
  }).lean();
  if (!booking) fail(404, "NOT_FOUND", "Booking not found");
  return booking!;
}
async function activeSeats(booking: any) {
  const trip = await Trip.findOne({
    _id: booking.tripId,
    operatorId: booking.operatorId,
  }).lean();
  if (!trip || trip.inventoryOwner !== "internal")
    fail(
      503,
      "PAYMENT_UNAVAILABLE",
      "External reservations require their authoritative booking adapter before payment.",
    );
  if (
    booking.status !== "Pending payment" ||
    trip!.status !== "Scheduled" ||
    new Date(trip!.departureAt as Date) <= new Date()
  )
    fail(
      409,
      "BOOKING_CLOSED",
      "This booking is no longer open for payment. Create a new booking if its hold expired.",
    );
  const held = (booking.passengers as any[]).map((p) =>
    (trip!.seats as any[]).find(
      (s) =>
        s.number === p.seat &&
        s.state === "held" &&
        String(s.bookingId) === String(booking._id) &&
        new Date(s.holdUntil) > new Date(),
    ),
  );
  if (!held.length || held.some((s) => !s))
    fail(
      409,
      "HOLD_EXPIRED",
      "The seat hold expired. Payment cannot be started; reserve seats again.",
    );
  return new Date(
    Math.min(...held.map((s) => new Date(s.holdUntil).getTime())),
  );
}
function binding(order: any, config: Config) {
  requireRazorpay(config);
  if (order.keyId !== config.RAZORPAY_KEY_ID)
    fail(
      409,
      "PAYMENT_ACCOUNT_CHANGED",
      "This payment order belongs to a different Razorpay key/account. An administrator must reconcile it.",
    );
}
function validateOrder(remote: any, order: any) {
  if (
    !/^order_[a-z\d]+$/i.test(remote.id) ||
    remote.amount !== order.amountPaise ||
    remote.currency !== "INR" ||
    remote.receipt !== order.receipt ||
    remote.partial_payment === true
  )
    fail(
      502,
      "PAYMENT_MISMATCH",
      "Razorpay order does not match the stored booking amount.",
    );
}
async function recoverOrder(config: Config, order: any) {
  const response = await razorpayRequest(
    config,
    `/orders?receipt=${encodeURIComponent(order.receipt)}&count=100`,
  );
  const matches = (response.items || []).filter(
    (r: any) => r.receipt === order.receipt,
  );
  if (matches.length !== 1)
    fail(
      409,
      "PAYMENT_ORDER_UNCERTAIN",
      "Payment setup is still being checked. No second order was created. Try checking payment status again or contact your administrator.",
    );
  validateOrder(matches[0], order);
  return (await PaymentOrder.findByIdAndUpdate(
    order._id,
    { $set: { externalOrderId: matches[0].id, state: "ready" } },
    { new: true },
  ))!;
}
export async function startRazorpayPayment(
  config: Config,
  auth: Principal,
  bookingId: string,
) {
  requireRazorpay(config);
  const booking = await ownedBooking(auth, bookingId);
  if (booking.status === "Confirmed")
    return { status: booking.status, reference: booking.reference };
  const expiresAt = await activeSeats(booking);
  if (!Number.isSafeInteger(booking.totalPaise) || booking.totalPaise < 100)
    fail(
      400,
      "PAYMENT_AMOUNT_INVALID",
      "Razorpay checkout requires an amount of at least one rupee.",
    );
  let order: any;
  try {
    order = await PaymentOrder.findOneAndUpdate(
      { providerId: RAZORPAY_PROVIDER, bookingId },
      {
        $setOnInsert: {
          operatorId: auth.operatorId,
          keyId: config.RAZORPAY_KEY_ID,
          receipt: `aibus_${bookingId}`,
          amountPaise: booking.totalPaise,
          currency: "INR",
          state: "new",
          expiresAt,
        },
      },
      { upsert: true, new: true },
    );
  } catch (e) {
    if ((e as any).code !== 11000) throw e;
    order = await PaymentOrder.findOne({
      providerId: RAZORPAY_PROVIDER,
      bookingId,
    });
  }
  binding(order, config);
  if (order.state === "new") {
    const claimed = await PaymentOrder.findOneAndUpdate(
      { _id: order._id, state: "new" },
      { $set: { state: "creating", creationStartedAt: new Date() } },
      { new: true },
    );
    if (!claimed)
      fail(
        409,
        "PAYMENT_ORDER_BUSY",
        "Payment setup is already in progress. Try again in a moment.",
      );
    try {
      const remote = await razorpayRequest(config, "/orders", {
        amount: booking.totalPaise,
        currency: "INR",
        receipt: order.receipt,
        partial_payment: false,
      });
      validateOrder(remote, order);
      order = await PaymentOrder.findByIdAndUpdate(
        order._id,
        { $set: { externalOrderId: remote.id, state: "ready" } },
        { new: true },
      );
      await Audit.create({
        operatorId: auth.operatorId,
        actorId: auth.userId,
        action: "payment.razorpay_test.order_created",
        resourceId: bookingId,
      });
    } catch (e) {
      const rejected =
        e instanceof AppError &&
        ["RAZORPAY_AUTH_FAILED", "RAZORPAY_REQUEST_REJECTED"].includes(e.code);
      await PaymentOrder.updateOne(
        { _id: order._id, state: "creating" },
        { $set: { state: rejected ? "new" : "uncertain" } },
      );
      throw e;
    }
  } else if (order.state !== "ready") {
    if (
      order.state === "creating" &&
      Date.now() - new Date(order.creationStartedAt).getTime() < 30000
    )
      fail(
        409,
        "PAYMENT_ORDER_BUSY",
        "Payment setup is already in progress. Try again in a moment.",
      );
    order = await recoverOrder(config, order);
  }
  await activeSeats(booking);
  return {
    provider: "razorpay",
    mode: "test",
    keyId: config.RAZORPAY_KEY_ID,
    orderId: order.externalOrderId,
    amountPaise: order.amountPaise,
    currency: "INR",
    reference: booking.reference,
    expiresAt: order.expiresAt,
  };
}
async function applyCapture(
  config: Config,
  order: any,
  paymentId: string,
  allowCapture: boolean,
) {
  binding(order, config);
  let payment = await razorpayRequest(config, `/payments/${paymentId}`);
  const matches = () =>
    payment.id === paymentId &&
    payment.order_id === order.externalOrderId &&
    payment.amount === order.amountPaise &&
    payment.currency === "INR" &&
    !(Number(payment.amount_refunded) > 0);
  if (!matches())
    fail(
      409,
      "PAYMENT_MISMATCH",
      "The verified Razorpay payment does not match this booking/order/amount.",
    );
  if (payment.status === "authorized" && allowCapture) {
    const booking = await Booking.findById(order.bookingId).lean();
    await activeSeats(booking);
    const claim = await PaymentOrder.findOneAndUpdate(
      { _id: order._id, captureStartedAt: { $exists: false } },
      { $set: { captureStartedAt: new Date(), capturePaymentId: paymentId } },
      { new: true },
    );
    if (claim) {
      try {
        await razorpayRequest(config, `/payments/${paymentId}/capture`, {
          amount: order.amountPaise,
          currency: "INR",
        });
      } catch {
        /* Never repeat an uncertain capture; authoritative GET/webhooks reconcile it. */
      }
      payment = await razorpayRequest(config, `/payments/${paymentId}`);
      if (!matches())
        fail(
          409,
          "PAYMENT_MISMATCH",
          "Razorpay payment changed unexpectedly during verification.",
        );
    }
  }
  if (payment.status !== "captured" || payment.captured !== true)
    return {
      status: "Pending payment",
      paymentStatus: "Pending",
      gatewayStatus: payment.status,
      message:
        "Payment is not captured yet. Check payment status shortly; do not pay twice.",
    };
  await applyVerifiedPayment({
    verified: true,
    providerId: RAZORPAY_PROVIDER,
    eventId: `capture:${paymentId}`,
    externalId: paymentId,
    operatorId: String(order.operatorId),
    bookingId: String(order.bookingId),
    amountPaise: payment.amount,
    currency: "INR",
    status: "captured",
  });
  await PaymentOrder.updateOne(
    { _id: order._id },
    { $set: { settledAt: new Date(), lastCheckedAt: new Date() } },
  );
  const booking = await Booking.findById(order.bookingId).lean();
  return {
    status: booking!.status,
    paymentStatus: booking!.paymentStatus,
    reference: booking!.reference,
    pnr: booking!.pnr || null,
  };
}
export async function verifyRazorpayPayment(
  config: Config,
  auth: Principal,
  bookingId: string,
  input: {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
  },
) {
  await ownedBooking(auth, bookingId);
  const order = await PaymentOrder.findOne({
    operatorId: auth.operatorId,
    bookingId,
    providerId: RAZORPAY_PROVIDER,
  }).lean();
  if (
    !order?.externalOrderId ||
    order.externalOrderId !== input.razorpay_order_id
  )
    fail(
      409,
      "PAYMENT_ORDER_MISMATCH",
      "Payment order does not belong to this booking.",
    );
  binding(order, config);
  if (
    !validSignature(
      `${order!.externalOrderId}|${input.razorpay_payment_id}`,
      input.razorpay_signature,
      config.RAZORPAY_KEY_SECRET!,
    )
  )
    fail(
      400,
      "INVALID_PAYMENT_SIGNATURE",
      "Razorpay payment signature could not be verified.",
    );
  return applyCapture(config, order, input.razorpay_payment_id, true);
}
export async function reconcileRazorpayPayment(
  config: Config,
  auth: Principal,
  bookingId: string,
) {
  const booking = await ownedBooking(auth, bookingId);
  if (booking.status === "Confirmed") {
    await PaymentOrder.updateOne(
      { bookingId, providerId: RAZORPAY_PROVIDER, operatorId: auth.operatorId },
      { $set: { settledAt: new Date(), lastCheckedAt: new Date() } },
    );
    return {
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      reference: booking.reference,
      pnr: booking.pnr,
    };
  }
  let order: any = await PaymentOrder.findOne({
    operatorId: auth.operatorId,
    bookingId,
    providerId: RAZORPAY_PROVIDER,
  }).lean();
  if (!order)
    return {
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      message: "No Razorpay checkout has been started for this booking.",
    };
  binding(order, config);
  if (!order.externalOrderId) order = await recoverOrder(config, order);
  const response = await razorpayRequest(
    config,
    `/orders/${order!.externalOrderId}/payments`,
  );
  const captures = (response.items || []).filter(
    (p: any) => p.status === "captured",
  );
  let result: any;
  for (const payment of captures)
    result = await applyCapture(config, order, payment.id, false);
  if (result) return result;
  const authorized = (response.items || []).find(
    (payment: any) => payment.status === "authorized",
  );
  if (authorized) return applyCapture(config, order, authorized.id, true);
  await PaymentOrder.updateOne(
    { _id: order!._id },
    { $set: { lastCheckedAt: new Date() } },
  );
  return {
    status: booking.status,
    paymentStatus: booking.paymentStatus,
    message:
      "No captured payment received. You can retry checkout while the seat hold remains active.",
  };
}
export async function razorpayWebhook(
  config: Config,
  body: Buffer,
  signature: string,
) {
  requireRazorpay(config);
  if (!config.RAZORPAY_WEBHOOK_SECRET)
    fail(
      503,
      "WEBHOOK_UNAVAILABLE",
      "Configure the Razorpay Test Mode webhook secret first.",
    );
  if (!validSignature(body, signature, config.RAZORPAY_WEBHOOK_SECRET!))
    fail(
      400,
      "INVALID_WEBHOOK_SIGNATURE",
      "Invalid Razorpay webhook signature.",
    );
  let event: any;
  try {
    event = JSON.parse(body.toString("utf8"));
  } catch {
    fail(400, "INVALID_WEBHOOK", "Invalid webhook JSON.");
  }
  if (event.event !== "payment.captured") return { ignored: true };
  const payment = event.payload?.payment?.entity;
  if (
    !/^pay_[a-z\d]+$/i.test(payment?.id || "") ||
    !/^order_[a-z\d]+$/i.test(payment?.order_id || "")
  )
    fail(400, "INVALID_WEBHOOK", "Webhook payment identifiers are missing.");
  const order = await PaymentOrder.findOne({
    externalOrderId: payment.order_id,
    providerId: RAZORPAY_PROVIDER,
  }).lean();
  if (!order) return { ignored: true }; // Payment for another application on the same merchant account.
  return applyCapture(config, order, payment.id, false);
}
export async function reconcileRazorpayOrders(config: Config) {
  if (!config.RAZORPAY_KEY_ID || !config.RAZORPAY_KEY_SECRET) return;
  const orders = await PaymentOrder.find({
    providerId: RAZORPAY_PROVIDER,
    keyId: config.RAZORPAY_KEY_ID,
    state: "ready",
    settledAt: { $exists: false },
    createdAt: { $gte: new Date(Date.now() - 86400000) },
    $or: [
      { lastCheckedAt: { $exists: false } },
      { lastCheckedAt: { $lt: new Date(Date.now() - 30000) } },
    ],
  })
    .limit(3)
    .lean();
  for (const order of orders) {
    try {
      await reconcileRazorpayPayment(
        config,
        { operatorId: String(order.operatorId) } as Principal,
        String(order.bookingId),
      );
    } catch {
      await PaymentOrder.updateOne(
        { _id: order._id },
        { $set: { lastCheckedAt: new Date() } },
      );
    }
  }
}
