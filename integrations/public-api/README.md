# AIBUS Public Booking API v1 — external integration testing

20 November 2026. This is AIBUS's outward-facing inventory API, not a third-party inventory purchase integration. Namespace: `/api/v1/public`. OpenAPI: `openapi.v1.json` and the running API's `/api/v1/public/openapi.json`. The selected test URL is `https://partner.bookmybus.pro/api/v1/public`; it remains unavailable until the separate staging API/database and proxy route are provisioned and deployed.

## Availability of the 18 functionalities

| # | Functionality | Contract | Availability |
| --- | --- | --- | --- |
| 1 | Authentication | POST /auth/token | Implemented, server-to-server sandbox credential exchange |
| 2 | Cities | GET /cities | Implemented, authorized actively sellable inventory only |
| 3 | Dated trip search | GET /trips?from=city_id&to=city_id&journeyDate=YYYY-MM-DD | Implemented, exact city IDs/date, paging |
| 4 | Bus/trip details | GET /trips/{id} | Implemented; no internal IDs, crew contacts or secrets |
| 5 | Seat layout | GET /trips/{id}/seats | Implemented, decks/positions/base fare/current state |
| 6 | Boarding/dropping | GET /trips/{id}/stops | Implemented, configured names/times/addresses only |
| 7 | Fare recheck | POST /trips/{id}/quotes | Implemented, authoritative tax/fees and bounded quote expiry |
| 8 | Cancellation policy | GET /trips/{id}/cancellation-policy | Implemented lookup; eligibility remains booking/policy-dependent |
| 9 | Temporary hold | POST /trips/{id}/holds | Implemented, central inventory and durable idempotency |
| 10 | Booking/payment | POST /bookings then POST /bookings/{id}/payment and /payment/verify | Uses the existing CRS booking and ledger flow with Razorpay Test Mode; no real charge |
| 11 | Booking status | GET /bookings/{id} | Implemented, own partner references only |
| 12 | Ticket/PNR | GET /bookings/{id}/ticket | Existing CRS ticket flow after verified test payment; test database only |
| 13 | Cancellation request | POST /bookings/{id}/cancellations | Conditional full-booking request through existing state machine; never an automatic cancellation/refund |
| 14 | Cancellation charges | POST /bookings/{id}/cancellation-quotes | Conditional on explicit operator accounting policy, current ownership and captured evidence |
| 15 | Refund status | GET /bookings/{id}/refund | Read-only partner status; approved test refunds use the existing refund worker |
| 16 | Reschedule | POST /reschedule | Unavailable (501): no approved reservation/business policy |
| 17 | Partner wallet/balance | GET /wallet | Unavailable (501): no approved production partner funding model; agency wallets are never exposed |
| 18 | Webhooks | Signed delivery + GET /webhook-deliveries | Implemented sandbox delivery, conditional on trusted CLI subscription, signing configuration and exact outbound host allowlist |

Production partner credentials, production inventory distribution, real payments/refunds and production ticket issuance remain unavailable. `/capabilities` reports whether Razorpay Test Mode is configured. The API remains isolated to a non-production test database; this is not a production launch.

## Isolation and setup

For the owner's app and an external partner app, follow [the app rollout runbook](../../docs/PUBLIC-API-APP-ROLLOUT.md). In a configured isolated backend, run `npm run public:preflight -w backend -- --partner partner_OWN_APP --partner partner_EXTERNAL_APP` from the repository root. This read-only command checks configuration, indexes and authorized inventory; it does not deploy, provision users, issue credentials or establish actual payment readiness.

Public routes fail closed unless PUBLIC_API_SANDBOX=true, NODE_ENV is the hardened `staging` mode (or development/test for controlled local integration tests), a separate PUBLIC_API_JWT_SECRET is configured and the connected database name starts with `aibus_public_sandbox_`. Staging requires TLS MongoDB with a user restricted to that database, TLS Redis with a dedicated ACL user limited to the `aibus:public-test` key/channel namespace, test-finance mode and Razorpay Test Mode credentials. Never point this external API at production data or remove the isolation gate. For payment/refund tests, configure only Razorpay Test Mode credentials (`rzp_test_...`) and set FINANCE_TEST_MODE=true in staging. Do not use live Razorpay keys. Keep all gateway and signing secrets on the backend, outside source control and away from partner/browser code. The dashboard and public JWT signing keys must differ. Public inventory also requires an approved operator with `publicSandboxInventory=true`, an active bus/route, an internal open scheduled future trip and an unexpired partner inventory grant. Ordinary existing operator records default to excluded. A server-configured partner bookingCutoffMinutes may impose an earlier sales cutoff; zero preserves the existing departure cutoff. Canonical Area Master city references retain stable opaque IDs; legacy text-only cities use normalized legacy identity until explicitly migrated.

Never change the production database or share its MongoDB credentials. Use the existing transaction-capable MongoDB cluster only if its owner creates a separate sandbox database and restricted user. The existing Redis service may be reused only with a persisted restricted ACL user and the unique test key/channel namespace; never give staging the production Redis password. Schema/index assessment is read-only by default:

```powershell
# Run in the repository root using an explicitly prepared sandbox backend environment.
npm.cmd run operations:preflight -w backend
# Only after reviewing the dry run, and only against the dedicated sandbox:
npm.cmd run operations:preflight -w backend -- --apply-sandbox --ack-reviewed
npm.cmd run public:sandbox -w backend -- --create-fixture
```

The fixture command is additive and refuses ordinary/production databases. It initializes indexes only in that dedicated database and creates an approved sample operator, explicit sample pricing/cancellation policies, two trips (available and unavailable/blocked), a separate ApiPartner and explicit trip grants. Repeat fixture runs preserve existing records and do not reprint credentials. Credentials are output once to the trusted terminal; keep them on the integrating company's backend, outside source control. Razorpay TEST calls are made only when the test-payment flow is exercised; they cannot collect real money. No payout or live refund is made. No fixture command was executed against the user's database during implementation.

Additional trusted sandbox CLI commands:

```powershell
npm.cmd run public:sandbox -w backend -- --issue-credential partner_public_id
npm.cmd run public:sandbox -w backend -- --revoke-credential cred_public_id
npm.cmd run public:sandbox -w backend -- --grant-trip partner_public_id operator_object_id trip_object_id "Reviewed sandbox grant"
npm.cmd run public:sandbox -w backend -- --subscribe partner_public_id https://approved.partner.example/aibus "Reviewed sandbox webhook"
```

Internal IDs in the grant CLI are trusted provisioning inputs, not external authorization. The CLI verifies the trip belongs to the explicitly flagged sandbox operator. External requests accept opaque public IDs and reject arbitrary operatorId/agentId fields. Rotating credentials means issue a new one, transfer it securely and explicitly revoke the old one; outstanding access tokens are invalidated by revocation/version/expiry checks on every request. No self-service Developer Portal or live onboarding was added.

## Integration sequence

1. Exchange your credential using `Authorization: Bearer ap_sandbox_cred_...secret` and body `{}` at POST /auth/token. Keep the credential server-side. Use the resulting Bearer access token (five-minute lifetime) for API calls.
2. GET /cities, select the returned city IDs, then search /trips with both cities and the actual journey date. There is no implicit all-operator inventory access.
3. GET trip details, /seats, /stops and /cancellation-policy. Seat fares are base fares per passenger; they are not final checkout totals.
4. POST /quotes with `{"seats":["L1"]}` for a pre-hold recheck. POST /holds with those seats and a durable Idempotency-Key. Holds last at most five minutes.
5. POST /quotes again with seats plus the returned holdId. This second quote binds the fare to the owned hold. Quotes last at most two minutes, never beyond the hold. Do not submit an unbound quote as booking authorization.
6. POST /bookings with tripId, holdId, quoteId, a unique partnerReference and one validated passenger per held seat. Use a separate stable Idempotency-Key. This creates Pending payment, not a ticket.
7. POST `/bookings/{id}/payment` with `{}` and a new stable key. The API creates/reuses an order through Razorpay Test Mode and returns the test `keyId`, `orderId`, amount and expiry. Use that order in your server-side checkout integration. Do not send gateway secrets to the browser.
8. After Razorpay's test checkout returns, send `razorpay_order_id`, `razorpay_payment_id` and `razorpay_signature` to POST `/bookings/{id}/payment/verify` with its own stable key. The backend verifies the signature and fetches the provider's payment state before invoking the existing CRS capture, ledger and ticket flow. Never accept a client `paid` flag or amount. If the response is uncertain, repeat the same request/key or call `/payment/reconcile` with a stable key; do not create a second booking.
9. GET `/bookings/{id}` and `/ticket`. Persist the public booking ID and your partnerReference. Tickets are test-environment records and are not production tickets.
10. If policy permits, POST `/cancellation-quotes` with `{}`, then POST `/cancellations` with the current quoteId and reason. This requests operator review; it does not approve the cancellation or execute a refund. An authorized operator reviews it using the existing CRS workflow. If approved, the existing worker processes the refund through Razorpay Test Mode (only when test finance mode is enabled). Poll `/refund`; `Pending` or `Uncertain` is not a completed refund.

`client.ts` is a backend-only TypeScript example with in-memory short-lived tokens and one refresh retry. It does not store passenger records, credentials or tokens in browser storage. The Postman collection has empty secret variables and placeholder public IDs; it does not provision access.

## Status, retries and errors

Booking status enums are the existing authoritative values: Pending payment, Confirmed, Failed, Cancelled, Reconciliation required. Payment statuses are Pending, Paid, Failed, Refund pending, Refunded. Tickets have valid/cancelled status. Cancellation Requested is distinct from Approved; refund Processed is distinct from Pending/Uncertain/Manual review.

Every response follows `{data,meta?}` or `{error:{code,message,requestId}}`, with X-Request-ID. List paging uses page (1–10000), limit (1–100) and total. Queries and bodies reject unknown fields. Default partner rate limit is 120 requests/minute; credential exchange is 20/minute per IP, alongside the existing API limiter. Production instances require the existing Redis-backed limiter; test fixtures explicitly isolate/mock it.

Idempotency keys are partner-global across hold/booking/payment/verification/reconciliation/cancellation operations and bind action + payload. Use 16–100 permitted characters. Reuse the identical key and body after an uncertain response. A different action/body under a used key returns IDEMPOTENCY_CONFLICT. A stable partnerReference cannot be rebound to a different request. Expired/consumed holds are never recreated under their original key. Keep the original booking request for recovery if the response was lost; the wrapper recovers the central engine's existing booking before creating anything else. Status reads never require current selling grants, so an owned booking remains manageable after a distribution grant is revoked.

Common errors: PARTNER_UNAUTHORIZED (401), PARTNER_SCOPE (403), RESOURCE_NOT_FOUND/BOOKING_NOT_FOUND (404), IDEMPOTENCY_CONFLICT/PARTNER_REFERENCE_CONFLICT/FARE_CHANGED/QUOTE_EXPIRED (409), HOLD_EXPIRED (409 or 410 according to operation), PAYMENT_ORDER_MISMATCH/PAYMENT_MISMATCH (409), PARTNER_RATE_LIMIT/RATE_LIMITED (429), CAPABILITY_UNAVAILABLE (501), PUBLIC_API_DISABLED/PUBLIC_INDEX_REQUIRED/PAYMENT_UNAVAILABLE/FINANCE_DISABLED (503). Do not infer financial success after network timeouts. Booking integrity and captured-payment recovery remain centralized.

## Signed notifications

Subscriptions are provisioned only through the trusted CLI, with PUBLIC_WEBHOOK_SIGNING_KEY and PUBLIC_WEBHOOK_ALLOWED_HOSTS configured on the sandbox backend. Host allowlisting is exact, HTTPS-only and port 443; credentials, literal IP hosts and fragments are rejected. DNS results must be public and are pinned to the actual TLS connection, preventing DNS rebinding and redirect access. Private/link-local/mapped addresses and IPv6 transition destinations are denied. External delivery is not enabled by default.

Payloads contain a stable evt_ ID, booking.status type, sandbox environment, public booking ID, booking/payment/cancellation statuses and occurredAt. No passenger names, contacts, secrets or internal IDs are sent. Events are durable observed-state notifications, not a guarantee of every intermediate state between worker polls. Consumers should retrieve authoritative current booking state.

Headers: X-Aibus-Event-ID, X-Aibus-Timestamp (epoch milliseconds), X-Aibus-Signature (hex HMAC-SHA256). Signing input is `timestamp + "." + eventId + "." + rawBody`. Use the securely provisioned subscription signing secret, verify the raw bytes in constant time, reject timestamps outside five minutes and durably deduplicate event IDs. Signature verification alone does not prevent replay inside the accepted window. `verifyWebhookSignature` is the server-side reference helper.

Delivery is at least once. A timeout may mean the receiver accepted the event. Retries use the same event ID with fresh timestamp/signature, bounded exponential backoff and five attempts, then Manual review. Acknowledgement/attempt history is transactionally recorded after the external request. Notification retry cannot execute a booking, refund or payout. The collector is an existing leased job; delivery also has database-owned per-record leases. Keep both signing key and subscription IDs stable when recovering; key rotation requires explicit reprovisioning, not blind retries.

## Funding contract and deliberate limits

The integration flow does not invent a partner wallet or funding account. Test payments use the configured Razorpay Test Mode account; no real money is collected. Prices, tax and fees come from the operator's configured CRS pricing service. Cancellation accounting uses the existing operator policy, and a refund is created only after an authorized operator accepts the cancellation. The existing worker verifies the provider's test refund before posting the ledger result. Production funding, settlement, live payment and live refund contracts remain disabled.

Before production, business approval must specify selling/net fare, commission/markup, funding evidence, credit exposure, liability ownership, refund obligations, authorized ledger accounts and settlement/reconciliation controls. Until that approved model and validation exist, all production public booking and live partner financial operations remain disabled. Existing operator-agent wallet endpoints are never used as external partner wallets.

Read projections currently cap authorized search at 500 trips and validate public index readiness on requests. This is a sandbox safety boundary, not a production-scale query design. Inventory/grant/credential changes apply to subsequent authorization checks; already-running requests may complete under their validated context. Production launch requires a separate review of in-flight revocation/fencing, distributed load, usage retention, key rotation, credential delivery, alerts and staging recovery drills.

## Phase 8 extension

The separate Partner web workspace and Super Admin API Partners controls now provide reviewed sandbox onboarding and one-time credential issuance. Earlier CLI-only provisioning descriptions above refer to Phase 7. Public machine authentication and booking contracts remain unchanged. See ../../backend/PARTNER-PLATFORM-PHASE8.md and integrations/partner-portal/README.md for the separate web-session contracts. Production access remains disabled.
