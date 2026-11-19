import mongoose from "mongoose";
import {
  createHmac,
  timingSafeEqual,
  randomUUID,
  createHash,
} from "node:crypto";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import * as P from "../models/public-api.model.js";
import {
  publicId,
  sandboxReady,
  type PartnerIdentity,
} from "./public-auth.service.js";
import { bookingView } from "./public-booking.service.js";
import type { Config } from "../config/env.js";
import { fail } from "../utils/core.js";
export function webhookSecret(
  config: Config,
  partnerId: string,
  subscriptionId: string,
  version = 1,
) {
  if (!config.PUBLIC_WEBHOOK_SIGNING_KEY)
    fail(
      503,
      "WEBHOOK_KEY_REQUIRED",
      "Sandbox webhook signing is unconfigured",
    );
  return createHmac("sha256", config.PUBLIC_WEBHOOK_SIGNING_KEY!)
    .update(`sandbox:${partnerId}:${subscriptionId}${version > 1 ? `:v${version}` : ""}`)
    .digest("hex");
}
export function webhookSignature(
  secret: string,
  timestamp: string,
  eventId: string,
  body: string,
) {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${eventId}.${body}`)
    .digest("hex");
}
export function verifyWebhookSignature(
  secret: string,
  timestamp: string,
  eventId: string,
  body: string,
  signature: string,
  now = Date.now(),
) {
  if (
    !/^\d{13}$/.test(timestamp) ||
    Math.abs(now - Number(timestamp)) > 300000 ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    return false;
  return timingSafeEqual(
    Buffer.from(signature, "hex"),
    Buffer.from(webhookSignature(secret, timestamp, eventId, body), "hex"),
  );
}
export function publicAddress(address: string) {
  if (isIP(address) === 6)
    return (
      /^[23][a-f0-9]{0,3}:/i.test(address) &&
      !/^2002:/i.test(address) &&
      !/^2001:(?:0{1,4}:|db8:)/i.test(address)
    ); // Only global-unicast IPv6, never mapped/private/link-local.
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && [0, 168].includes(b)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && [18, 19, 51].includes(b)) ||
    (a === 203 && b === 0)
  );
}
export function webhookTarget(config: Config, raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail(400, "WEBHOOK_TARGET", "Valid HTTPS destination required");
  }
  const allowed = config.PUBLIC_WEBHOOK_ALLOWED_HOSTS.split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (
    url!.protocol !== "https:" ||
    url!.username ||
    url!.password ||
    url!.hash ||
    (url!.port && url!.port !== "443") ||
    isIP(url!.hostname) ||
    !allowed.includes(url!.hostname.toLowerCase())
  )
    fail(
      400,
      "WEBHOOK_TARGET",
      "Webhook destination must be an exact server-allowlisted public HTTPS host",
    );
  return url!;
}
export async function sendWebhook(
  config: Config,
  target: string,
  body: string,
  headers: Record<string, string>,
) {
  const url = webhookTarget(config, target),
    addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    fail(400, "WEBHOOK_ADDRESS", "Non-public webhook address denied");
  const address = addresses[0];
  return new Promise<boolean>((resolve, reject) => {
    // Pin the validated DNS result for this connection; redirects are never followed.
    const req = request(
      url,
      {
        method: "POST",
        agent: false,
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        lookup: ((_hostname: any, options: any, callback: any) =>
          options?.all
            ? callback(null, [address])
            : callback(null, address.address, address.family)) as any,
      },
      (response) => {
        response.destroy();
        resolve(
          !!response.statusCode &&
            response.statusCode >= 200 &&
            response.statusCode < 300,
        );
      },
    );
    req.setTimeout(10000, () => req.destroy(Error("WEBHOOK_TIMEOUT")));
    req.on("error", reject);
    req.end(body);
  });
}
export async function collectPartnerEvents(
  config: Config,
  signal: AbortSignal,
) {
  sandboxReady(config);
  for await (const ref of P.PartnerBookingReference.find({
    bookingId: { $exists: true },
  }).cursor()) {
    signal.throwIfAborted();
    const partner = await P.ApiPartner.exists({
      _id: ref.partnerId,
      status: "Active",
    });
    if (!partner) continue;
    const identity = { partnerId: String(ref.partnerId) } as PartnerIdentity,
      view = await bookingView(identity, ref.publicId);
    const key = createHash("sha256")
      .update(
        JSON.stringify([
          view.id,
          view.status,
          view.paymentStatus,
          view.cancellationStatus,
        ]),
      )
      .digest("hex");
    const event = await P.PartnerWebhookEvent.findOneAndUpdate(
      { partnerId: ref.partnerId, key },
      {
        $setOnInsert: {
          publicId: publicId("evt"),
          booking: ref.publicId,
          status: view.status,
          paymentStatus: view.paymentStatus,
          cancellationStatus: view.cancellationStatus,
        },
      },
      { upsert: true, new: true },
    );
    const subscriptions = await P.PartnerWebhookSubscription.find({
      partnerId: ref.partnerId,
      active: true,
    }).lean();
    for (const sub of subscriptions)
      await P.PartnerWebhookDelivery.updateOne(
        { subscriptionId: sub._id, eventId: event!._id },
        { $setOnInsert: { partnerId: ref.partnerId } },
        { upsert: true },
      );
  }
}
export async function deliverPartnerWebhooks(
  config: Config,
  transport: typeof sendWebhook = sendWebhook,
) {
  sandboxReady(config);
  if (!config.PUBLIC_WEBHOOK_SIGNING_KEY) return { disabled: true };
  const overdue = await P.PartnerWebhookDelivery.find({
    $expr: { $gte: ["$attempts", { $ifNull: ["$retryLimit", 5] }] },
    status: { $in: ["Pending", "Delivering"] },
    leaseUntil: { $lte: new Date() },
  })
    .select("_id")
    .limit(100)
    .lean();
  for (const row of overdue)
    await P.PartnerWebhookDelivery.updateOne(
      { _id: row._id, status: { $in: ["Pending", "Delivering"] }, leaseUntil: { $lte: new Date() }, $expr: { $gte: ["$attempts", { $ifNull: ["$retryLimit", 5] }] } },
      { $set: { status: "Manual review", lastCode: "RETRY_LIMIT" } },
    );
  let checked = 0;
  for (let n = 0; n < 50; n++) {
    const now = new Date(),
      leaseToken = randomUUID(),
      delivery = await P.PartnerWebhookDelivery.findOneAndUpdate(
        {
          status: { $in: ["Pending", "Delivering"] },
          $expr: { $lt: ["$attempts", { $ifNull: ["$retryLimit", 5] }] },
          nextAttemptAt: { $lte: now },
          $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }],
        },
        {
          $set: {
            status: "Delivering",
            leaseToken,
            leaseUntil: new Date(+now + 60000),
          },
          $inc: { attempts: 1 },
        },
        { new: true, sort: { nextAttemptAt: 1, _id: 1 } },
      );
    if (!delivery) break;
    checked++;
    let succeeded = false;
    try {
      const partner = await P.ApiPartner.exists({
          _id: delivery.partnerId,
          status: "Active",
        }),
        sub = await P.PartnerWebhookSubscription.findOne({
          _id: delivery.subscriptionId,
          partnerId: delivery.partnerId,
          active: true,
        }).lean(),
        event = await P.PartnerWebhookEvent.findOne({
          _id: delivery.eventId,
          partnerId: delivery.partnerId,
        }).lean();
      if (!partner || !sub || !event) throw Error("SUBSCRIPTION_DISABLED");
      webhookTarget(config, sub.url);
      const body = JSON.stringify({
          id: event.publicId,
          type: event.type || "booking.status",
          environment: "sandbox",
          bookingId: event.booking,
          status: event.status,
          paymentStatus: event.paymentStatus,
          cancellationStatus: event.cancellationStatus,
          occurredAt: event.createdAt,
        }),
        timestamp = String(Date.now());
      succeeded = await transport(config, sub.url, body, {
        "X-Aibus-Event-ID": event.publicId,
        "X-Aibus-Timestamp": timestamp,
        "X-Aibus-Signature": webhookSignature(
          webhookSecret(config, String(delivery.partnerId), sub.publicId, sub.signingVersion || 1),
          timestamp,
          event.publicId,
          body,
        ),
      });
    } catch {
      /* Unknown outcomes are retried with the same event identity, never financial replay. */
    }
    await mongoose.connection.transaction(async (session) => {
      const changed = await P.PartnerWebhookDelivery.updateOne(
        { _id: delivery._id, leaseToken, status: "Delivering" },
        {
          $set: {
            status: succeeded
              ? "Delivered"
              : delivery.attempts >= (delivery.retryLimit || 5)
                ? "Manual review"
                : "Pending",
            lastCode: succeeded ? "ACKNOWLEDGED" : "DELIVERY_UNCERTAIN",
            nextAttemptAt: new Date(
              Date.now() + Math.min(900000, 10000 * 2 ** delivery.attempts),
            ),
          },
          $unset: { leaseToken: 1, leaseUntil: 1 },
        },
        { session },
      );
      if (changed.modifiedCount)
        await P.PartnerWebhookAttempt.create(
          [
            {
              deliveryId: delivery._id,
              attempt: delivery.attempts,
              code: succeeded ? "ACKNOWLEDGED" : "DELIVERY_UNCERTAIN",
              succeeded,
            },
          ],
          { session },
        );
    });
  }
  return { checked };
}
