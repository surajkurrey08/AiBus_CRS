# AIBUS public API integration-test handoff

## Current availability

Verified 20 November 2026: the isolated Test API is active at `https://partner.bookmybus.pro/api/v1/public`, serving contract `1.0.0-test` from release `d73ffc9`. Both test app credentials returned HTTP 200 for token exchange, capabilities, cities, search, seats and stops over external HTTPS. Actual Razorpay checkout and ticket issuance were not executed in this deployment verification. Production public booking calls remain disabled on `api.bookmybus.pro`.

The supplied external environment has the intended `baseUrl` prefilled and the credential empty. Do not substitute the production API host. `127.0.0.1` refers to the tester's own computer and is not a remote testing URL.

## What the AIBUS owner supplies separately

- Confirmation that `https://partner.bookmybus.pro/api/v1/public` is live and routed to a dedicated non-production backend/database. Do not use `api.bookmybus.pro` for writes.
- A dedicated approved test partner with authorized test trips and required scopes.
- An individually issued, expiring test API credential through an agreed private channel. Do not use a shared Admin account or production credential.
- Exact scheduled journey date and authorized source/destination public city IDs (or unique city names).
- Razorpay Test Mode credentials configured privately on the test backend, `FINANCE_TEST_MODE=true` only in that non-production environment, and test cancellation/accounting policies.
- Test window, contact and the expected unsupported features.

The current synthetic inventory is Pune to Mumbai on `2026-11-27`, with seats L1, L2, L3 and U1. Give each tester their own authorized credential privately. Keep the test database, credentials and inventory isolated from production.

## Tester steps

1. Install/open Postman Desktop and sign in if Collections/Runner are unavailable.
2. Import `postman.runner.v1.json` and `postman.external-sandbox.environment.json`.
3. Select **AIBUS external tester sandbox** (or the individually provisioned private app environment). The `baseUrl` is `https://partner.bookmybus.pro/api/v1/public`. Enter the full `apiCredential`, exact `journeyDate`, and `fromCityId`/`toCityId` or unique city names. Keep the credential local to your Postman instance. Do not publish the populated environment.
4. Run **01 Token exchange**, **02 Capabilities** and **03 Cities** individually first. Confirm sandbox capability and inventory access. Token exchange uses Bearer API credential and raw JSON `{}`; later requests use the returned access token automatically.
5. When ready, set `allowSandboxWrites=true`. Run folder **01 Test booking flow — integrate Razorpay Checkout** with one iteration, 300 ms delay, Local/Functional execution, no stored cookies and no Origin header. Create the test order, then complete Razorpay Checkout through your integration before entering the returned payment ID and signature for verification.
6. Inspect each request's response body, HTTP status and assertions in the Runner. The collection captures token, trip/seat/hold/quote/booking IDs and PNR automatically, with separate stable idempotency headers for each write.
7. Run **02 Payment recovery — uncertain response only** only if a checkout response was lost. Run **03 Unsupported capabilities — expect 501** separately. Reschedule and Partner Wallet intentionally return 501; webhook history may be empty if no subscription/delivery is configured.
8. Record findings in `TEST-RESULT-TEMPLATE.md` and return a sanitized report. Do not return bearer tokens, API credentials, populated environments or real passenger details.

Use synthetic passenger data only. Razorpay Test Mode does not collect real money. Cancellation creates a review request; an authorized CRS operator must review it. If accepted, the existing worker processes a test refund. Pending or uncertain refund status is not completed repayment.

## Retries

Access tokens last five minutes. Repeat Token exchange to refresh without replacing the current booking request keys. After a timeout, inspect booking status and retry the identical operation/body/key; do not begin another booking while the result is uncertain.

For a new independent test, review the old outcome first and set a new unique `testRunId` (16–60 letters, digits, dot, underscore, colon or hyphen), or clear it before Token exchange. Each new successful booking uses another test seat and a Razorpay Test Mode transaction. Parallel iterations are not a concurrency test.

If there are no authorized cities/trips, contact the AIBUS owner with the response requestId and exact query date. A different bearer token does not fix `PUBLIC_API_DISABLED`, missing inventory grants, missing Razorpay Test Mode configuration or an unprovisioned test environment.

## Owner completion checks

Before sending the kit as working access, verify from an external network: valid credential exchange, capabilities, cities, exact dated trip search, Razorpay Test Mode order/verification, ticket issuance, operator-reviewed cancellation, test refund status and the production-isolation boundary. After testing, revoke the tester credential and review retained test bookings/holds through normal application workflows. Never reset production data to prepare a test.
