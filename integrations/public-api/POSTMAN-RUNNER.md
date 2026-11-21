# Test the public partner API in Postman

Verified 20 November 2026: `https://api.bookmybus.pro/health/ready` is HTTP 200. Production `POST /api/v1/public/auth/token` currently returns HTTP 503 `PUBLIC_API_DISABLED`. Hosting the dashboards/backend does not enable public production inventory sales. Do not change production database settings or remove the sandbox guard to test requests.

## Import once

The remote isolated test deployment is now verified at `https://partner.bookmybus.pro/api/v1/public` (20 November 2026, contract `1.0.0-test`). Use `postman.external-sandbox.environment.json` with a dedicated credential and the current assigned test trip date. Token exchange and inventory reads passed for both app identities. Actual payment checkout remains a separate test step; do not treat inventory verification as ticket confirmation.

In Postman Desktop, choose **Import** and select:

- `postman.runner.v1.json` — ordered requests, response assertions and automatic ID capture.
- `postman.live.environment.json` — read-only live checks.
- `postman.sandbox.environment.json` — isolated sandbox workflow, blank secrets.

If the Lightweight client does not offer Collections/Runner, sign in to Postman first. Imported environments contain no credentials. Keep credentials and returned tokens in your local Postman environment; never publish/export a populated secret environment or paste these values into a frontend app.

## Check the live deployment

Select **AIBUS live — diagnostics only**. Run the folder **00 Live diagnostics — read only**. Both readiness and the public OpenAPI document should return 200. The OpenAPI document lists contracts; it does not authorize production booking calls. Do not run the sandbox booking folder against this production host.

## Prepare the test booking flow

1. Use a separately provisioned sandbox server/database and approved sandbox partner. The existing local setup is `http://127.0.0.1:4001`; it was not reachable during this check. On the development laptop, start Docker Desktop, then run from the repo root:

   ```powershell
   docker start aibus-public-sandbox-redis
   node scripts/start-public-sandbox.mjs
   ```

   These commands assume the existing isolated environment, fixture, Redis container and backend build are present. Do not create an ordinary production connection as a replacement. See `LOCAL-TOKEN-TEST.md` and `README.md` for provisioning requirements.

2. Select **AIBUS isolated sandbox** and set these local environment values:

   | Variable | Value |
   | --- | --- |
   | `baseUrl` | `http://127.0.0.1:4001/api/v1/public`, or an actually provisioned dedicated sandbox URL |
   | `apiCredential` | Full, valid sandbox partner credential; not an Admin/Operator dashboard access token |
   | `fromCityName` | Exact authorized source city, initially Pune |
   | `toCityName` | Exact authorized destination city, initially Mumbai |
   | `journeyDate` | Exact scheduled sandbox trip date, `YYYY-MM-DD` |
   | `allowSandboxWrites` | `true`, only when ready to create test bookings and cancellation requests |
   | `testRunId` | Leave empty for the first test; an operation identity is generated automatically |

3. Run **01 Token exchange** once. Its body is raw JSON `{}`. The complete API credential is sent as Bearer authorization. The returned access token is stored automatically with its five-minute expiry. Subsequent requests use that token.

   For this existing local setup, the private credential file is `.cache/aibus-sandbox-credential.json`; use its complete `credential` value, not just `credentialId`. Do not share that file. Saved fixture metadata is in `.cache/aibus-sandbox-test-data.json`; its recorded journey date was `2026-11-26` during this check. Verify the scheduled fixture still exists after starting the sandbox instead of substituting a production trip date.
4. Run **02 Capabilities** and **03 Cities** once. The collection selects city IDs only when each configured city name has exactly one authorized match on the first 100-row page. If a name is ambiguous or absent, copy the exact `id` values from the relevant Cities response into `fromCityId` and `toCityId`. These are public search IDs, not provider IDs or raw MongoDB IDs. Configure a trip date that actually exists; importing the central city catalog does not create trip inventory.
5. The test backend must use Razorpay Test Mode credentials (`rzp_test_...`) and `FINANCE_TEST_MODE=true`; do not configure live gateway keys. No real money is collected.

## Run everything in order

Choose folder **01 Test booking flow — integrate Razorpay Checkout**. Run the initial requests through **13 Create Razorpay Test Mode order**, then complete the checkout from your integration using the returned test `keyId`, `orderId` and amount. Enter the resulting `razorpayPaymentId` and `razorpaySignature` into the local Postman environment before running **14 Verify test checkout response** and the remaining requests. Disable stored cookies and do not add an `Origin` header; the API is server-to-server.

| Order | Request | Result |
| --- | --- | --- |
| 1 | POST `/auth/token` | Saves Bearer access token |
| 2 | GET `/capabilities` | Verifies sandbox mode |
| 3 | GET `/cities` | Saves authorized source/destination IDs |
| 4 | GET `/trips?from=...&to=...&journeyDate=...` | Saves first matching available trip |
| 5–8 | Trip details, seats, stops, cancellation policy | Chooses one available seat, excludes held/booked/blocked/quota seats |
| 9 | POST `/trips/{id}/quotes` | Initial quote without holdId |
| 10 | POST `/trips/{id}/holds` | Creates one temporary hold |
| 11 | POST `/trips/{id}/quotes` with holdId | Saves hold-bound quote required for booking |
| 12 | POST `/bookings` | Creates pending booking with synthetic passenger |
| 13 | POST `/bookings/{id}/payment` | Creates/reuses Razorpay Test Mode order |
| 14 | POST `/bookings/{id}/payment/verify` | Verifies provider signature and payment; requires checkout response |
| 15–16 | Booking status and ticket | Checks confirmed test booking and saves PNR |
| 17–19 | Cancellation quote, cancellation request, refund status | Requests operator review; approved refunds go through the test refund worker |
| 20 | GET `/webhook-deliveries` | Delivery history, possibly empty |

If a test checkout response is lost, use **02 Payment recovery — uncertain response only** to reconcile authoritative provider status. Do not retry checkout blindly. The partner API cannot approve cancellations; an authorized CRS operator must review them before test refunds are created/processed.

The scripts capture `tripId`, `seatNumber`, `holdId`, `quoteId`, `bookingId`, `cancellationQuoteId` and `pnr`. Each write has its own stable `Idempotency-Key` **header**, never a query parameter. Requests stop after a failed prerequisite/status rather than showing a misleading chain of successes. The Runner summary provides status and assertion results; click a request to inspect its response.

Run folder **02 Unsupported capabilities — expect 501** separately after authentication. Reschedule and Partner Wallet intentionally return 501 `CAPABILITY_UNAVAILABLE`; those assertions should pass. An empty webhook list does not prove outbound delivery works.

## Retry and new tests

- Token expired: rerun **01 Token exchange**, then retry the failed request. Token refresh keeps existing request keys and booking references.
- Timeout on a write: reuse the exact same request body, key and partnerReference; check booking status. Do not restart the entire booking flow with new identifiers while the original result is uncertain.
- Start another independent test only after reviewing the previous outcome: change `testRunId` to a new unique 16–60 character value or clear it before Token exchange. The generated run gets new per-operation keys; previous booking ID is retained as `previousBookingId`. A new booking consumes another test seat and makes a Razorpay Test Mode transaction.
- Hold/quote expired: resolve any existing booking first, then start a fresh run with a current available seat. Never use an expired quote for payment.
- 503 `PUBLIC_API_DISABLED`: this environment is not a provisioned sandbox. A different token will not fix that server configuration.
- 401: expired/revoked/wrong credential or token. 403: missing scopes or cookie/Origin sent. Empty trips: wrong exact IDs/date or inventory not granted. 409: inspect stale quote, ownership or idempotency conflicts. 429: wait for the rate window; do not launch parallel iterations.

The collection intentionally tests one dependent journey sequentially, not parallel calls or a load test. Multi-partner isolation, concurrent reservations, late-payment recovery and signed webhook receiver verification remain separate acceptance checks in `MANUAL-QA.md`.

Regenerate with `node scripts/generate-public-postman-runner.mjs`. Validate the artifact scripts with `node --test integrations/public-api/postman-runner.test.mjs`; these artifact tests do not execute a real booking workflow.
