# Razorpay Test Mode

This implementation supports Razorpay **Test Mode** for Aibus's internal trip
inventory. Live keys and external bus-provider reservations remain unavailable.
No real money should be collected with this setup. Test payments and orders use
the `razorpay_test` provider identifier in local records.

## Local configuration

Keep these values only in `backend/.env`:

```dotenv
RAZORPAY_KEY_ID=rzp_test_your_key_id
RAZORPAY_KEY_SECRET=your_test_key_secret
RAZORPAY_WEBHOOK_SECRET=your_random_webhook_secret
```

The public Key ID is returned for Checkout. Key Secret and webhook secret are
never sent to React. Use a matching Test Mode key pair. Restart the backend after
editing `.env`. Rotate keys that were shared in chat or committed to source.

A random webhook secret was generated in the local `.env` if one did not exist.
To enable webhook delivery, copy its value locally into the Razorpay Dashboard's
Test Mode webhook settings; do not paste it into chat.

## Try a booking

1. Start MongoDB/Redis, backend and frontend using the root scripts.
2. Use a future scheduled internal trip and its configured pricing rules.
3. In Booking Counter, search the route/date and select available seats.
4. Hold the seats, enter passengers/contact/stops and create a pending booking.
5. Click **Pay with Razorpay (test)** and complete the provider's test checkout.
6. The backend verifies the Checkout signature, retrieves the payment using its
   own Razorpay credentials and validates order, amount, currency and capture.
7. A captured payment confirms seats only if the booking still owns an active
   hold. Confirmed passengers then appear in the manifest and a ticket is issued.

Existing pending bookings with expired holds cannot start another payment.
Reserve seats again and create a fresh booking instead of trying to pay an
expired record. Closing Checkout or a failed attempt does not mark a booking paid.

The same payment controls are available in **Bookings & tickets → View details**,
or **Booking Counter → trip bookings → Pay (test)/Payments**. Only authorized
booking staff can initiate/verify/reconcile payments. Financial record visibility
continues to use its existing permissions.

## Verification and recovery

| Endpoint                                               | Behavior                                                             |
| ------------------------------------------------------ | -------------------------------------------------------------------- |
| `POST /api/v1/operator/bookings/:id/payment`           | Create/reuse one persisted order using the server booking total      |
| `POST /api/v1/operator/bookings/:id/payment/verify`    | Validate Checkout HMAC and fetch the authoritative payment           |
| `POST /api/v1/operator/bookings/:id/payment/reconcile` | Check the stored order for captured payments after a missed callback |
| `POST /api/v1/webhooks/razorpay`                       | Validate raw-body HMAC and process `payment.captured`                |

The only accepted Checkout fields are `razorpay_order_id`, `razorpay_payment_id`
and `razorpay_signature`. The server uses the persisted order ID when computing
the signature. A valid signature alone never substitutes for payment-state and
amount verification. The fetched payment must belong to the stored order and
have the full booking amount, INR currency, no recorded refund and captured state.

Authorized payments can be captured server-side once while the seat hold remains
valid. An uncertain capture is never blindly repeated. Use **Check payment status**
or reconciliation to discover its outcome. Automatic capture on the Razorpay
Dashboard is also useful as a backstop; confirm your Test Mode capture settings.

Concurrent starts reuse the same persisted payment order. Uncertain order creation
is recovered with a receipt lookup instead of sending another creation request.
Callback and webhook delivery converge on the same idempotent capture event, so
they cannot issue duplicate tickets. An already captured payment is not downgraded
by a failed checkout attempt. Provider errors shown to the frontend are sanitized.

Late payment after hold expiry/cancellation is recorded for reconciliation. It
does not take seats held/booked by somebody else or produce a valid ticket. Refund
execution is not implemented; an administrator must investigate these cases.

## Webhooks on localhost

Razorpay cannot call a `127.0.0.1` webhook URL. Configure a public HTTPS forwarding
URL ending in `/api/v1/webhooks/razorpay` in the Razorpay **Test Mode** Dashboard,
enable `payment.captured`, and use the matching webhook secret from `.env`.
Opening such a tunnel is a separate deployment/configuration step; none was opened
automatically. Webhook signature verification occurs before JSON parsing.

Normal localhost testing can confirm via Checkout's server-verified callback.
The running API also checks unsettled, known orders periodically (a bounded batch,
recent 24-hour orders, at least 30 seconds between checks). The worker command
includes the same reconciliation. This recovers captured payments if the browser
closes, provided the backend remains running. Public webhook delivery still needs
the Dashboard URL configuration.

## Verification evidence

The local configured Test Mode credentials authenticated with Razorpay (HTTP 200).
A separate ₹1 test order was created through the official Orders API without
starting a payment or consuming any bus inventory. Automated tests use mocked
provider HTTP responses and a real temporary MongoDB replica set. They test
authorization/tenant isolation, signatures, server amount binding, duplicate
delivery, capture, uncertainty recovery and late-payment seat ownership.

A real interactive provider Checkout payment still needs to be completed in the
browser. No real payment, public webhook delivery, production release or automatic
refund was verified by the order/authentication checks alone.

Official contracts:

- [Standard Checkout](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/)
- [Create orders](https://razorpay.com/docs/api/orders/create/)
- [Fetch payments](https://razorpay.com/docs/api/payments/fetch-with-id/)
- [Capture payments](https://razorpay.com/docs/api/payments/capture/)
- [Webhook validation](https://razorpay.com/docs/webhooks/validate-test/)
