# AIBUS Public Booking API v1 — sandbox integration

19 November 2026. This is AIBUS's own outward-facing inventory API, not a third-party inventory purchase integration. Namespace: `/api/v1/public`. OpenAPI: `openapi.v1.json` and the running API's `/api/v1/public/openapi.json`. No publicly deployed sandbox URL exists yet.

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
| 10 | Booking | POST /bookings then POST /bookings/{id}/confirm | Pending booking implemented; confirmation requires isolated server-provisioned sandbox allowance |
| 11 | Booking status | GET /bookings/{id} | Implemented, own partner references only |
| 12 | Ticket/PNR | GET /bookings/{id}/ticket | Implemented, own simulated ticket; names/seats, no contact dump |
| 13 | Cancellation request | POST /bookings/{id}/cancellations | Conditional full-booking request through existing state machine; never an automatic cancellation/refund |
| 14 | Cancellation charges | POST /bookings/{id}/cancellation-quotes | Conditional on explicit operator accounting policy, current ownership and captured evidence |
| 15 | Refund status | GET /bookings/{id}/refund | Implemented read-only; actual completion is never inferred |
| 16 | Reschedule | POST /reschedule | Unavailable (501): no approved reservation/business policy |
| 17 | Partner wallet/balance | GET /wallet | Unavailable (501): no approved production partner funding model; agency wallets are never exposed |
| 18 | Webhooks | Signed delivery + GET /webhook-deliveries | Implemented sandbox delivery, conditional on trusted CLI subscription, signing configuration and exact outbound host allowlist |

All production partner credentials, production inventory distribution and live partner ticket issuance are unavailable. `/capabilities` states these limits. The route's sandbox gate is not a production API launch.

## Isolation and setup

Public routes fail closed unless PUBLIC_API_SANDBOX=true, NODE_ENV is not production, a separate PUBLIC_API_JWT_SECRET is configured and the connected database name starts with `aibus_public_sandbox_`. The dashboard and public JWT signing keys must differ. Public inventory also requires an approved operator with `publicSandboxInventory=true`, an active bus/route, an internal open scheduled future trip and an unexpired partner inventory grant. Ordinary existing operator records default to excluded. A server-configured partner bookingCutoffMinutes may impose an earlier sales cutoff; zero preserves the existing departure cutoff. Canonical Area Master city references retain stable opaque IDs; legacy text-only cities use normalized legacy identity until explicitly migrated.

Never change the production or ordinary CRS connection to satisfy this gate. Provision a separate disposable MongoDB replica set/database and Redis namespace/environment. Schema/index assessment is read-only by default:

```powershell
# Run in the repository root using an explicitly prepared sandbox backend environment.
npm.cmd run operations:preflight -w backend
# Only after reviewing the dry run, and only against the dedicated sandbox:
npm.cmd run operations:preflight -w backend -- --apply-sandbox --ack-reviewed
npm.cmd run public:sandbox -w backend -- --create-fixture
```

The fixture command is additive and refuses ordinary/production databases. It initializes indexes only in that dedicated sandbox and creates an approved sample operator, explicit sample policies, two trips (available and unavailable/blocked), a separate ApiPartner, explicit trip grants and a finite simulated allowance. Repeat fixture runs preserve existing records and do not reprint credentials. Credentials are output once to the trusted terminal; keep them on the integrating company's backend, outside source control. No notification, charge, payout or live refund is made. No fixture command was executed against the user's database during implementation.

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
7. In the isolated sandbox only, POST /bookings/{id}/confirm with `{"authorization":"sandbox-allowance"}` and another stable key. The server checks and atomically consumes its finite test allowance, calls the existing confirmation/ledger transaction and issues one simulated ticket. `paid:true`, arbitrary amounts or a client payment reference cannot authorize it. Insufficient allowance returns 402 without a payment/ticket/journal. Expired/replaced ownership rolls back the simulated debit.
8. GET /bookings/{id} and /ticket. Persist public booking ID and your partnerReference. A confirmation replay consumes no further allowance and issues no extra PNR.
9. If policy permits, POST /cancellation-quotes with `{}`, then POST /cancellations with the current quoteId and reason. This requests review; existing operator financial review is still needed. Seats remain booked until the existing cancellation state machine accepts the request. Poll /refund or process signed notifications. A requested/pending refund is not successful repayment.

`client.ts` is a backend-only TypeScript example with in-memory short-lived tokens and one refresh retry. It does not store passenger records, credentials or tokens in browser storage. The Postman collection has empty secret variables and placeholder public IDs; it does not provision access.

## Status, retries and errors

Booking status enums are the existing authoritative values: Pending payment, Confirmed, Failed, Cancelled, Reconciliation required. Payment statuses are Pending, Paid, Failed, Refund pending, Refunded. Tickets have valid/cancelled status. Cancellation Requested is distinct from Approved; refund Processed is distinct from Pending/Uncertain/Manual review.

Every response follows `{data,meta?}` or `{error:{code,message,requestId}}`, with X-Request-ID. List paging uses page (1–10000), limit (1–100) and total. Queries and bodies reject unknown fields. Default partner rate limit is 120 requests/minute; credential exchange is 20/minute per IP, alongside the existing API limiter. Production instances require the existing Redis-backed limiter; test fixtures explicitly isolate/mock it.

Idempotency keys are partner-global across hold/booking/confirmation/cancellation operations and bind action + payload. Use 16–100 permitted characters. Reuse the identical key and body after an uncertain response. A different action/body under a used key returns IDEMPOTENCY_CONFLICT. A stable partnerReference cannot be rebound to a different request. Expired/consumed holds are never recreated under their original key. Keep the original booking request for recovery if the response was lost; the wrapper recovers the central engine's existing booking before creating anything else. Status reads never require current selling grants, so an owned booking remains manageable after a distribution grant is revoked.

Common errors: PARTNER_UNAUTHORIZED (401), PARTNER_SCOPE (403), RESOURCE_NOT_FOUND/BOOKING_NOT_FOUND (404), IDEMPOTENCY_CONFLICT/PARTNER_REFERENCE_CONFLICT/FARE_CHANGED/QUOTE_EXPIRED (409), HOLD_EXPIRED (409 or 410 according to operation), SANDBOX_ALLOWANCE_REQUIRED (402), PARTNER_RATE_LIMIT/RATE_LIMITED (429), CAPABILITY_UNAVAILABLE (501), PUBLIC_API_DISABLED/PUBLIC_INDEX_REQUIRED (503). Do not infer financial success after network timeouts. Booking integrity and captured-payment recovery remain centralized.

## Signed notifications

Subscriptions are provisioned only through the trusted CLI, with PUBLIC_WEBHOOK_SIGNING_KEY and PUBLIC_WEBHOOK_ALLOWED_HOSTS configured on the sandbox backend. Host allowlisting is exact, HTTPS-only and port 443; credentials, literal IP hosts and fragments are rejected. DNS results must be public and are pinned to the actual TLS connection, preventing DNS rebinding and redirect access. Private/link-local/mapped addresses and IPv6 transition destinations are denied. External delivery is not enabled by default.

Payloads contain a stable evt_ ID, booking.status type, sandbox environment, public booking ID, booking/payment/cancellation statuses and occurredAt. No passenger names, contacts, secrets or internal IDs are sent. Events are durable observed-state notifications, not a guarantee of every intermediate state between worker polls. Consumers should retrieve authoritative current booking state.

Headers: X-Aibus-Event-ID, X-Aibus-Timestamp (epoch milliseconds), X-Aibus-Signature (hex HMAC-SHA256). Signing input is `timestamp + "." + eventId + "." + rawBody`. Use the securely provisioned subscription signing secret, verify the raw bytes in constant time, reject timestamps outside five minutes and durably deduplicate event IDs. Signature verification alone does not prevent replay inside the accepted window. `verifyWebhookSignature` is the server-side reference helper.

Delivery is at least once. A timeout may mean the receiver accepted the event. Retries use the same event ID with fresh timestamp/signature, bounded exponential backoff and five attempts, then Manual review. Acknowledgement/attempt history is transactionally recorded after the external request. Notification retry cannot execute a booking, refund or payout. The collector is an existing leased job; delivery also has database-owned per-record leases. Keep both signing key and subscription IDs stable when recovering; key rotation requires explicit reprovisioning, not blind retries.

## Funding contract and deliberate limits

The simulated allowance is a finite test authorization counter, not cash, a partner wallet, agent credit, a commission balance or a production settlement model. Successful sandbox captures debit the existing simulated-bank-clearing account and use the existing balanced central ledger/ticket flow, in the dedicated sandbox database. There is no ApiPartner money account added to the ledger chart. No new commission, markup, tax or credit policy was assumed. Prices/tax/fees come from the operator's configured pricing service. Cancellation/refund obligations remain existing policy-controlled records; allowance is not automatically topped up after cancellation.

Before production, business approval must specify selling/net fare, commission/markup, funding evidence, credit exposure, liability ownership, refund obligations, authorized ledger accounts and settlement/reconciliation controls. Until that approved model and validation exist, all production public booking and live partner financial operations remain disabled. Existing operator-agent wallet endpoints are never used as external partner wallets.

Read projections currently cap authorized search at 500 trips and validate public index readiness on requests. This is a sandbox safety boundary, not a production-scale query design. Inventory/grant/credential changes apply to subsequent authorization checks; already-running requests may complete under their validated context. Production launch requires a separate review of in-flight revocation/fencing, distributed load, usage retention, key rotation, credential delivery, alerts and staging recovery drills.

## Phase 8 extension

The separate Partner web workspace and Super Admin API Partners controls now provide reviewed sandbox onboarding and one-time credential issuance. Earlier CLI-only provisioning descriptions above refer to Phase 7. Public machine authentication and booking contracts remain unchanged. See ../../backend/PARTNER-PLATFORM-PHASE8.md and integrations/partner-portal/README.md for the separate web-session contracts. Production access remains disabled.
