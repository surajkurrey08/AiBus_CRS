# Phase 7 — AIBUS Public Booking API provider

Implementation report, 19 November 2026. Scope: an independent outward-facing API over AIBUS's existing internal CRS inventory. No purchased third-party inventory, production partner onboarding, deployment, live financial operations or Phase 8 portal was implemented.

## 1. Repository findings and components reused

The current repository contains the existing operator/admin workspaces, canonical operator-owned agencies, transactional MongoDB inventory, Redis-backed application limiter, Phase 1 ownership protections and Phase 4 ledger/refund/settlement services. Phase 6 operational code and additional tests were present/in progress when this request arrived. Previously reported counts were not treated as proof of completion; the work was inspected and rerun.

The Public API reuses createHold, createBooking, issueQuote/priceTrip, passenger/contact validators, resolveAreaRoutes, applyVerifiedPayment, requestCancellation, quoteCancellation, refundStatus, Ticket, Booking, Hold, Trip, Policy, PricingPolicy and the existing ledger. It reuses request IDs, error handling, JSON limits and the existing Limiter interface/Redis runtime. Notification collection/delivery is scheduled through the same operational job runner. There is no second reservation engine, database engine, wallet or accounting ledger.

## 2. New modules and modified files

New backend files:

- `src/models/public-api.model.ts`: partner, credential, distribution grant, public resource mapping, command/reference, usage and notification records.
- `src/services/public-auth.service.ts`: sandbox gate, credential generation/hash verification, token exchange, per-request revocation/expiry/version/scope checks and index readiness.
- `src/services/public-inventory.service.ts`: server-resolved explicit inventory grants, opaque IDs, active/sellable inventory and safe projections.
- `src/services/public-booking.service.ts`: durable request identity, central booking recovery/reference ownership and atomic sandbox confirmation.
- `src/services/public-webhook.service.ts`: durable status notifications, signatures, safe destination checks, bounded delivery leases/retries and history.
- `src/routes/public-api.routes.ts`: versioned validation, authorization, rate limiting, normalized responses and the supported/unsupported contracts.
- `src/docs/public-api.openapi.ts`: authoritative versioned OpenAPI source.
- `src/scripts/public-sandbox.ts`: trusted additive sandbox fixture/access provisioning, revocation and explicit trip grants.
- `tests/integration/public-api.test.ts`: 27 integration/security/concurrency tests.

Integration points:

- `src/app.ts`: mounts `/api/v1/public` without exposing Operator/Admin routes.
- `src/config/env.ts` and `.env.example`: opt-in sandbox, separate JWT/signing keys, outbound host allowlist; production sandbox and shared dashboard/public JWT keys rejected.
- `src/models/operator.model.ts`: publicSandboxInventory defaults false; `src/models/index.ts` exports additive records.
- `src/services/inventory.service.ts`: optional trusted server-generated hold ID, allowing public retries to recover the same central hold. Existing HTTP operator inputs cannot set it; ownership predicates and booking/payment state machines are retained.
- `src/jobs/operational.jobs.ts`: optional sandbox notification tasks using the existing runner.
- `src/scripts/operations-readiness.ts` and backend package scripts: read-only index/conflict assessment and sandbox-only acknowledged additive installation.
- `integrations/public-api/`: integration guide, backend-only TypeScript example, generated OpenAPI and Postman collection.

Operational prerequisite/UI/browser extensions are detailed separately in OPERATIONS-RELIABILITY.md. Existing dirty Phase 1–6 files and pre-existing browser stub specifications were preserved. A mixed working tree was not turned into a broad Phase 7 commit; repository metadata is read-only in this workspace. No push occurred.

## 3. API functionality and documentation

The guide's 18-row capability matrix is authoritative: [integration guide](../integrations/public-api/README.md). There are 20 documented request operations because capabilities and the separate pending/confirmation steps accompany the 18 business functionalities.

Implemented sandbox paths:

- POST `/auth/token`; GET `/capabilities`, `/cities`, `/trips`, `/trips/:id`, `/trips/:id/seats`, `/trips/:id/stops`, `/trips/:id/cancellation-policy`.
- POST `/trips/:id/quotes`, `/trips/:id/holds`, `/bookings`, `/bookings/:id/confirm`.
- GET `/bookings/:id`, `/bookings/:id/ticket`, `/bookings/:id/refund`, `/webhook-deliveries`.
- POST `/bookings/:id/cancellation-quotes`, `/bookings/:id/cancellations`.
- GET `/openapi.json` publishes the static contract without granting inventory access.

Unavailable contracts: POST `/reschedule` and GET `/wallet` return 501. Production credentials, live partner funding and live partner ticket issuance remain disabled. Cancellation quotation/request is conditional on the existing policy, cutoff, accounting and payment evidence; it does not approve a refund or release a seat by itself.

OpenAPI source/generated artifact describe request/response schemas, scopes, enums, errors, paging, limits, hold/quote lifetimes, idempotency and notification payloads. The guide provides examples and integration order. Postman variables contain no actual credential/token or deployed URL. `client.ts` is a backend integration example, not a browser SDK or complete production client.

## 4. Additive data architecture and indexes

| Record | Ownership / purpose | Important uniqueness |
| --- | --- | --- |
| ApiPartner | Independent external channel, sandbox status/scopes, finite simulated allowance, optional earlier booking cutoff | publicId |
| ApiCredential | Partner/environment, SHA-256 hash of random 256-bit secret, scopes, expiry/revocation/version | publicId; partner lookup |
| PartnerInventoryGrant | Explicit partner + operator + Operator/Route/Service/Trip target, expiry/active state | partnerId + operatorId + kind + targetId |
| PublicResource | Opaque IDs mapped server-side to internal resources/cities/quotes | publicId; kind + internalKey |
| PartnerCommand | Partner-global action/payload-bound retry identity; no passenger bodies stored | partnerId + key |
| PartnerBookingReference | Partner's own reference, central booking link, sandbox funding marker | publicId; partnerId + reference; partial unique bookingId |
| PartnerApiUsage | Sanitized operation template, status, request ID and latency | partnerId + createdAt |
| PartnerWebhookSubscription | Trusted CLI-configured partner destination and opaque signing identity | publicId; partnerId + url |
| PartnerWebhookEvent | Stable observed booking-state event, no passenger details | publicId; partnerId + state key |
| PartnerWebhookDelivery | Subscription/event delivery ownership, lease, attempts, next retry and result | subscriptionId + eventId; due-job index |
| PartnerWebhookAttempt | Durable delivery attempt outcome | deliveryId + attempt |

No historical booking/financial record is rewritten or backfilled. New sales require an explicitly flagged sandbox operator and distribution grant; ordinary operators remain excluded. Canonical city references use stable public mappings; legacy text-only city identity is documented separately. Public JSON and public JWT claims use opaque IDs rather than exposing MongoDB IDs.

Required uniqueness is checked before sandbox API use. API credentials and command/audit history are not silently TTL-deleted. A separate production retention/archival policy is still required for usage/notification history. Existing hold/quote TTL behavior and central ownership guards remain unchanged.

## 5. Partner authentication and distribution

Credentials are generated on the trusted backend CLI, never in the React app. Only hashes are persisted. Exchange uses a short-lived JWT with a dedicated key, audience/issuer and opaque credential/partner IDs. Every request checks current partner status, credential expiry/revocation/version and the intersection of partner/credential scopes. Revocation invalidates existing tokens. Rotation is explicit issue-new/securely-transfer/revoke-old; no implicit new privilege is granted.

Each inventory request resolves explicit unexpired grants server-side, checks approved non-blocked flagged operator, active route/bus, internal scheduled/open trip and departure cutoff (or the stricter server-owned partner cutoff). Operator grants with mismatched target/operator are rejected by projection logic. Public bodies/queries cannot use arbitrary operatorId or agentId to establish authority. No agency is created or converted into an external partner.

Grant/credential changes affect subsequent authorization checks. As in-flight requests may finish after their initial validated context, stricter production revocation fencing remains a launch review item; this sandbox is not claimed to solve every distributed revocation race.

## 6. Booking and funding safety

Public holding supplies a trusted stable hold identity to the existing transactional reservation function. A durable command binds partner/key/action/payload. Concurrent retries recover the same hold; different payload conflicts. Expired/consumed requests cannot be used to mint a new hold under the original key, including after central hold retention expires.

Booking creation requires the owned hold, a current hold-bound quote, validated passengers and a unique partner reference. It calls the existing central createBooking with external source and a namespaced key. Lost-response recovery reattaches the engine's existing booking before attempting a new sale, preserving references after interruption. Other partners cannot read or use that reference, even if they can sell the same trip.

Confirmation is sandbox-only and does not accept a customer payment claim or arbitrary amount. A finite server-provisioned simulated allowance is conditionally decremented inside a MongoDB transaction which invokes the existing applyVerifiedPayment session contract, seat predicates, Ticket uniqueness and balanced ledger posting. The existing simulated-bank-clearing account is used in the dedicated sandbox. Duplicate confirmation consumes no second allowance or ticket. Expired/replaced ownership aborts the transaction and simulated debit. No external gateway call occurs in this transaction.

The allowance is not cash, a production partner wallet, agent credit, commission or a second ledger. ApiPartner ledger accounts were not enabled. There is no automatic allowance refund/top-up. The production financial contract still needs approved net/selling fare, commission/markup, funding evidence, credit/exposure, settlement ownership, refund liability, ledger account definitions and reconciliation controls. The implementation deliberately makes no unapproved business assumptions.

## 7. Cancellations, refunds and notifications

Ownership is checked through PartnerBookingReference plus central external booking/user/operator identity before delegating to Phase 4 services. Cancellation quote uses the configured accounting policy and captured evidence. Requesting cancellation is idempotent and still needs the existing authorized operator review; no public endpoint can force acceptance, release booked seats, process refunds or authorize payouts. Refund status is a narrow owned-booking projection, not general operator finance access.

Notifications are durable observed-state snapshots with stable IDs and at-least-once delivery. A signed event contains public booking/status information only. CLI subscription provisioning requires an exact server-owned HTTPS host allowlist and dedicated signing key. DNS addresses are validated and pinned; private/link-local/mapped/transition targets, userinfo, literal IP hosts, non-443 ports and redirects are blocked. No unrestricted partner-supplied outbound URL endpoint exists.

Per-delivery MongoDB ownership, bounded backoff/five attempts, durable manual-review state and transactionally recorded attempt outcomes protect recovery. External delivery is outside transactions. Receivers must verify raw-body HMAC + timestamp and durably deduplicate event IDs. A signature alone does not prevent replay within the accepted time window. The polling collector may coalesce intermediate states; consumers must use authoritative status lookup. Notification retry never executes a financial operation.

## 8. Sandbox, tests and browser status

Sandbox routes require explicit enablement, non-production runtime, a separate signing key and an isolated `aibus_public_sandbox_*` replica-set database. Ordinary CRS databases are rejected even with valid test credentials. Live inventory defaults to excluded and no real partner was onboarded. The CLI fixture is additive and clearly labels finite allowance, sample prices/policies and available/unavailable inventory. It was prepared, not run against the user's database.

The 27 Public API tests cover ordinary-database denial, fare change, notification exhaustion, hash/token authentication, invalid/revoked/expired/rotated credentials, current scopes, explicit grants, cross-tenant/public-ID privacy, exact search dates, real seat layout/stops, fee calculation, concurrent/idempotent holds, expired/replacement ownership, central/public concurrency, pending/idempotent booking, payment-claim/allowance denial, duplicate confirmation, ticket/ledger integrity, late authorization rollback, ticket/PII isolation, policy/charges, cancellation request/refund status, internal API denial, rate limiting, signed retry/deduplication, replay/SSRF, browser credential denial and missing-index fail-closed behavior. All use disposable MongoDB fixtures and mocked notification transport; there are no real charges or deliveries.

Additional operational regressions and the earlier Phase 1–6 suites are retained. Final counts/build results are recorded below after the final full run.

Browser access host remains unavailable through the native connector, but project-level Playwright now executes system Chrome. The isolated harness creates a temporary MongoDB replica set, a loopback-only disposable Redis container and separate local API/operator/admin ports 14100/15173/15174. It never reuses running app servers or personal credentials. Four actual browser checks passed: admin login/operational health/finance denial, least-privilege navigation, operator Master/fleet records, anonymous admin denial. The cleanup wrapper verifies the run label before stopping its own Redis fixture.

This is limited browser coverage. Complete UI search-to-payment-to-PNR-to-cancellation, all Master creation flows, session-expiry UI and cross-operator UI E2E remain incomplete. The pre-existing `tests/e2e` files contain placeholders/skips and default normal application ports; they were preserved, not counted as completed validation and not executed against the user's running apps. The missing external Agent Dashboard remains excluded.

## 9. Deployment, migration and remaining security risks

No live migrations/index rollout, database resets, production deployment, real payments/refunds/payouts or Phase 8 implementation occurred. Use the read-only preflight first; sandbox-only index apply requires explicit acknowledgement and the isolated database prefix. Production rollout needs a separately reviewed additive index/migration plan, backup verification, replica-set readiness, staging load/recovery drills and approved partner funding. Never drop existing indexes or clear data to pass readiness.

The current npm advisory audit reports four unresolved packages: critical Vitest and tinypool, high Zod, moderate @vitest/mocker (counts include dependency propagation). Zod is a backend runtime dependency; others are test tooling. Existing body/rate limits do not establish that every advisory is mitigated. No blind `audit fix --force`, major-version Zod migration or unrelated dependency upgrade was performed. Track and remediate these before production certification. The captured advisory summary includes GHSA-mrhx-c7xc-m3w5, GHSA-9crc-q9x8-hgqq, GHSA-5xrq-8626-4rwp, GHSA-82fw-gwwq-j7x9, GHSA-qxg6-89mg-rqv8, GHSA-5gmw-xhrv-c9v3 and GHSA-85c8-ppgw-ccpr.

Further launch gates: production funding/accounting approval, secret storage/distribution/rotation, large-inventory database-side projections, reporting/usage retention, real external alert infrastructure, strict in-flight revocation semantics, complete browser E2E, network/HTTPS deployment review and live provider reconciliation certification. Search currently caps authorized candidates at 500 trips; index verification and projection work are intentionally conservative sandbox paths, not throughput certification.

Phase 8 can be planned against these explicit contracts. It has not begun. A working sandbox does not imply a production-ready public API provider.

## Final validation record

| Check | Observed result |
| --- | --- |
| Full `npm.cmd test` | Passed, exit 0: **317 tests** |
| Backend | **247 passed**: 196 main integration, 18 additional operational, 27 public API, 6 agent-client contract tests |
| Operator UI | **57 passed** |
| Admin UI | **13 passed** |
| Failed / skipped in final full run | **0 / 0** |
| Focused operational/public rerun | **45 passed**; these are part of the totals above, not additional distinct tests |
| Isolated system-Chrome smoke suite | **4 passed**, separate from the 317 unit/integration/component tests |
| Workspace builds | All three passed; backend build repeated successfully after readiness/spec corrections |
| Agent adapter and public client TypeScript checks | Both passed |
| OpenAPI artifact check | Generated artifact matches source; 245 local schema references resolve; 20 paths and 20 Postman requests; unavailable error envelope checked |
| Formatting / diff whitespace | Relevant source formatting checked; `git diff --check` passed |
| npm advisory audit | Not clean: four unresolved packages, including critical/high advisories, as detailed above |
| Disposable Redis cleanup | Verified: no `aibus-e2e-*` container left running after the final cleanup wrapper |

Earlier attempts exposed fixture omissions, a wrong navigation locator, the CSV route ordering and a consumed-hold false-positive in integrity reporting. They were corrected and the final runs above passed. Full browser booking/payment/cancellation acceptance remains incomplete; the four smoke checks do not replace it. No claim of production readiness or complete end-to-end browser validation is made.

## Phase 8 extension

The separate Partner web workspace and Super Admin API Partners controls now provide reviewed sandbox onboarding and one-time credential issuance. Earlier CLI-only provisioning descriptions above refer to Phase 7. Public machine authentication and booking contracts remain unchanged. See PARTNER-PLATFORM-PHASE8.md and integrations/partner-portal/README.md for the separate web-session contracts. Production access remains disabled.

## 20 November integration-test payment extension

The initial simulated-allowance confirmation was removed from the public booking contract. Public partners now create and reconcile Razorpay Test Mode orders through the existing CRS payment service:

- POST `/bookings/{id}/payment`
- POST `/bookings/{id}/payment/verify`
- POST `/bookings/{id}/payment/reconcile`

The backend validates the provider signature and authoritative payment before using the central booking, ledger and ticket flow. Cancellation quotes/requests continue to use existing CRS policies; operator approval is still required. When isolated `FINANCE_TEST_MODE` and Razorpay Test Mode are configured, the existing worker executes test refunds and partners can poll the read-only refund status. No real funds are charged/refunded.

This remains a non-production integration-test environment requiring an isolated database and explicit trip grants. No public test hostname was supplied or deployed, and production public booking remains disabled. The updated OpenAPI and Postman artifacts are in `integrations/public-api/`; the focused public API suite now covers Razorpay test payment, late-capture reconciliation, and an operator-approved test refund lifecycle.
