import { createHmac, timingSafeEqual } from "node:crypto";
import type { Config } from "../config/env.js";
import { AppError, fail } from "../utils/errors.js";

export const RAZORPAY_PROVIDER = "razorpay_test";
export function razorpayEnabled(config: Config) {
  return !!(
    config.RAZORPAY_KEY_ID?.startsWith("rzp_test_") &&
    config.RAZORPAY_KEY_SECRET
  );
}
export function requireRazorpay(config: Config) {
  if (!razorpayEnabled(config))
    fail(
      503,
      "PAYMENT_UNAVAILABLE",
      "Configure Razorpay Test Mode credentials on the backend. Live keys are not enabled by this integration.",
    );
}
export function validSignature(
  message: string | Buffer,
  signature: string,
  secret: string,
) {
  if (!/^[a-f\d]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(message).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
export async function razorpayRequest(
  config: Config,
  endpoint: string,
  body?: unknown,
  extraHeaders: { "X-Refund-Idempotency"?: string } = {},
): Promise<any> {
  requireRazorpay(config);
  let response: Response;
  try {
    response = await fetch(`https://api.razorpay.com/v1${endpoint}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.RAZORPAY_KEY_ID}:${config.RAZORPAY_KEY_SECRET}`).toString("base64")}`,
        "Content-Type": "application/json",
        ...extraHeaders,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new AppError(
      503,
      "RAZORPAY_UNREACHABLE",
      "Razorpay could not be reached. Check payment status before retrying.",
    );
  }
  if (!response.ok) {
    if ([401, 403].includes(response.status))
      throw new AppError(
        502,
        "RAZORPAY_AUTH_FAILED",
        "Razorpay rejected the backend credentials. Check the Test Mode key pair.",
      );
    if (
      response.status >= 400 &&
      response.status < 500 &&
      response.status !== 429
    )
      throw new AppError(
        502,
        "RAZORPAY_REQUEST_REJECTED",
        "Razorpay rejected the payment request. Check payment status or contact your administrator.",
      );
    throw new AppError(
      503,
      "RAZORPAY_UNAVAILABLE",
      "Razorpay is temporarily unavailable. Check payment status before retrying.",
    );
  }
  try {
    return await response.json();
  } catch {
    throw new AppError(
      503,
      "RAZORPAY_INVALID_RESPONSE",
      "Razorpay returned an unreadable response. Check payment status before retrying.",
    );
  }
}
