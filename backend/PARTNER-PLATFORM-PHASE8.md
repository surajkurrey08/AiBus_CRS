# Phase 8 — API Partner Platform completion report

Scope: sandbox partner onboarding and developer operations on the existing CRS. No production deployment, ordinary/live database migration, real funding, live ticket issuance, bank payout or real refund was performed. The missing external Travel Agent Dashboard and unrelated projects were not modified.

## 1. Implementation summary

A separate `partner/` React workspace provides the external-company portal on development port 5176. The existing Admin workspace has an API Partners section. The Express backend extends existing identities, sessions and Public API models; it does not introduce another organization identity, reservation engine, wallet or ledger.

Applications support Draft, Submitted, Under Review, Approved, Rejected and Suspended. Company contacts, address, registration details, technical email, intended usage and requested environment are captured. Approval activates the initial owner but grants no inventory or scopes automatically. A production preference does not create production access.

## 2. Phase 7 services reused

- `public-auth.service.ts`: hashed machine credentials, short-lived scoped Public API tokens and sandbox/index gates.
- `public-inventory.service.ts`: explicit inventory grants, eligible trip discovery, public resource mapping and booking command identity.
- `public-booking.service.ts`: owned references, existing seat holds, pending bookings and sandbox authorization.
- `public-api.routes.ts` and compiled `public-api.openapi.ts`: the same eighteen functionalities and existing request validation.
- `public-webhook.service.ts`: signed events, validated/pinned destinations, stable delivery IDs, leases and bounded attempt history.
- Existing authentication, password hashing, refresh families, session revocation, platform permissions, Audit, central reservation, pricing, cancellation and financial ledger services.

## 3. Files created and modified in Phase 8

Created backend files:

- `src/types/partner-portal.ts`: organization roles and explicit permissions.
- `src/models/partner-portal.model.ts`: support records only.
- `src/validators/partner-portal.schemas.ts`: strict public/portal/admin request contracts.
- `src/services/partner-portal.service.ts`: reviewed organization commands, credentials, memberships, grants, support, usage and booking projections.
- `src/services/partner-playground.service.ts`: allowlisted local dispatch through the Public API router.
- `src/routes/partner-portal.routes.ts`: portal and Super Admin routes.
- `tests/integration/partner-portal.test.ts`: 31 regression/integration cases.

Modified existing backend files: `app.ts`, `config/env.ts`, `middleware/auth.middleware.ts`, `middleware/authorization.ts`, `models/index.ts`, `models/user.model.ts`, `models/session.model.ts`, `models/public-api.model.ts`, `routes/auth.routes.ts`, `routes/public-api.routes.ts`, `services/auth.service.ts`, `services/agent.service.ts` (shared identity resolver only), `services/public-auth.service.ts`, `services/public-webhook.service.ts`, `types/permissions.ts`, `types/platform.ts`, `scripts/operations-readiness.ts`, `.env.example`, and `package.json`.

Created frontend workspace files: `partner/package.json`, `index.html`, `tsconfig.json`, `vite.config.ts`, `src/main.tsx`, `src/App.tsx`, `src/config.ts`, `src/portal.css`, `src/api/{client,ApiError,response}.ts`, `src/components/PortalPrimitives.tsx`, `src/features/auth/PartnerAuth.tsx`, `src/features/workspace/PartnerPages.tsx`, `src/features/developer/{DeveloperWorkspace.tsx,contracts.ts}`, `src/features/usage/Usage.tsx`, `src/portal.test.tsx`, `README.md`, `DESIGN.md`, and `UX-CONTRACT.md`.

Admin: new `src/features/platform/ApiPartners.tsx`, new `src/tests/api-partners.test.tsx`, modified `src/features/operators/PlatformScreen.tsx`, and a request-client adapter on the existing `src/components/platform/PlatformTable.tsx`.

Tooling/docs: root `package.json`/`package-lock.json`; compatible Vitest version changes in all four workspace manifests; `playwright.isolated.config.ts`, `backend/tests/browser-harness.ts`, new `tests/isolated/partner.spec.ts`, this report and `integrations/partner-portal/README.md`. Existing dirty changes from earlier phases were retained and are not all attributable to Phase 8.

## 4. Database models and indexes

The existing ApiPartner now holds application state/business contacts, requested environment, hashed expiring draft-submission token, approval evidence, request limit and first portal-activation timestamp. Its environment remains sandbox-only. Existing User holds immutable partner membership and explicit role; existing Session recognizes the partner client.

The existing ApiCredential gains label, creator, last-used time and a flag distinguishing ephemeral playground credentials. Webhook subscriptions gain signing-key version; events distinguish integration tests; delivery retry limits preserve monotonic attempts.

The only new collection is PartnerSupport, uniquely keyed by `(partnerId, requestKey)` with a `(partnerId, createdAt desc)` list index. Additive indexes include application state/date, user partner/role/active, credential partner/portal-managed/date, subscription partner/date and delivery partner/status/date. Existing Public API unique indexes remain authoritative.

Reviewed portal commands use existing PartnerCommand uniqueness, namespaced keys, content hashes and MongoDB transactions. They serialize on partner revision; membership changes serialize with user/session checks. Required unique indexes are verified before reviewed mutations, registration and support creation. Missing uniqueness fails closed rather than falling back to an in-memory check.

## 5. Partner dashboard screens

Overview; API Credentials; Inventory Access; API Documentation; API Playground; Bookings; Webhooks; Usage & Analytics; Integration Status; Team & Permissions; Support; Settings. Navigation/actions are permission-filtered, and all endpoints enforce the same restrictions independently of the browser.

The workspace reuses Admin tokens, Panel, Overlay, reviewed forms and tables, with abortable loading/error/retry states, server paging and a persistent sandbox label. No simulated production income is displayed.

## 6. Super Admin screens

API Partners provides an application directory and scoped organization drawer: contact/application evidence, approval/scopes/request limits, credential metadata/revocation, inventory grants, usage, sandbox booking projections, webhook failures, support responses and audit history. Read and write require separate platform partner permissions. Writes require password, reason, stable command key and, for application review, current revision.

## 7. Credential lifecycle

Approved Owner/Admin/Developer memberships with credential-write permission may request allowed sandbox scopes and expiration between one minute and 90 days. Passenger-reading `tickets:read` additionally requires passenger permission; a Developer cannot bypass that restriction by minting a machine key. Relevant permissions are rechecked inside the command transaction.

Only a hash is stored. A new raw credential is returned once after reviewed issuance. Metadata never returns a stored secret/hash. Rotation revokes the old key and issues the replacement in one transaction. Revocation invalidates existing Public API bearer tokens on subsequent requests. Actual authenticated API calls update last-used time.

Suspension revokes organization sessions and keys. Membership changes revoke that member's sessions and keys. Owner changes require an Owner, self-removal is prohibited, and an active owner must remain. A completed issuance replay never reprints the secret or duplicates issuance; the caller receives an explicit already-applied response and must inspect metadata.

Existing trusted CLI-provisioned Phase 7 sandbox partners without the new onboarding field retain machine API compatibility. New web memberships require explicit Approved state. No existing data was silently backfilled.

## 8. Inventory integration

The portal displays the existing grants and eligible trip results from Phase 7. Partners cannot approve their organization, broaden scopes, change platform rate limits or add inventory grants. Super Admin grant creation validates that the selected resource belongs to the approved, explicitly sandbox-enabled operator. Expiry, inactive buses/routes, closed trips and operator sales restrictions remain enforced by the existing inventory service.

## 9. Documentation portal

The searchable endpoint explorer renders the existing compiled OpenAPI contract, methods, paths, required scopes, parameters, request/response schemas, errors, generated placeholder examples and idempotency instructions. Copyable examples are labeled server-side and use placeholders. Authentication is documented but credential exchange is deliberately unavailable in the browser playground. Wallet and rescheduling remain marked unavailable.

## 10. API Playground and sandbox scenarios

The server accepts an operation ID, validated resource parameters, query/body and optional idempotency key. The operation map is derived from the compiled local specification. Arbitrary URL, host, HTTP method, custom headers and the authentication operation are rejected. No network proxy or general URL fetcher exists.

The gateway creates a short-lived backend-only credential, invokes the existing Express Public API router locally and revokes the credential in `finally`. Existing scopes, grant filters, pricing/holds/booking confirmation and request validation remain authoritative. The browser receives actual status, sanitized response JSON, duration and correlation ID, not the underlying credential/token.

The guide covers thirteen scenarios: available/unavailable buses, sold-out seats, fare change, created/expired holds, successful/duplicate/failed booking, ticket, cancellation, pending refund and webhook failure. These are instructions against provisioned disposable fixtures, not fabricated outcome buttons or a data-reset API. Phase 7 and reservation tests exercise those state transitions; the new portal regression additionally completes hold → hold-bound quote → pending booking → duplicate replay → simulated authorization → locked seat → ticket through the gateway.

## 11. Webhooks

Owned subscriptions support registration, enable/disable, one-time signing-key rotation, safe test-event queueing, delivery metadata and one bounded manual retry extension. Existing version-one signing keys remain compatible. Rotation changes the derived signing version without exposing a stored-secret getter.

HTTPS host allowlisting, no IP/userinfo/fragment/alternate-port destinations, DNS public-address checks and pinning, no redirects, signing, five-minute verification window, stable event IDs, per-delivery leases, bounded retries and Manual review are preserved. A reviewed retry can extend five exhausted attempts to ten once; it never resets attempt history or replays a financial operation. Receivers must durably deduplicate event IDs.

Actual external receiver delivery was not exercised against a public service. Automated tests use a controlled transport and verify safe test events, signing behavior and retry history.

## 12. Usage analytics

Actual scoped request metadata drives totals, success/failure counts, average latency and endpoint totals. Raw API payloads are not logged in this collection. Date/endpoint/status filters, paging and permission-controlled CSV are provided. CSV caps at 5000 filtered rows and neutralizes spreadsheet formulas. Per-partner rate limits may be configured from 1 to 120 requests/minute; existing global limits also apply. Rate-limited authenticated attempts are included in safe usage recording.

## 13. Booking history

History includes the owned partner/public reference, central AIBUS reference, PNR when confirmed, operator, route, journey date, seats, booking/payment/cancellation/refund states and an explicit sandbox label. List projections omit passenger names/contact details. Detail names/seats and playground ticket retrieval require passenger permission. Foreign references return not found. The central booking and ledger remain the sole source of truth.

## 14. Security and RBAC validation

Existing User/Session identity is reused. Partner role and immutable membership are server-read; client tenant IDs never establish authorization. Partner sessions cannot access Operator, Agent or platform administration. Public machine tokens cannot authenticate dashboard routes. Partner login is rejected through the Operator client. Refresh cookies and client identity are separate, HttpOnly and SameSite Strict; unsafe browser origin checks include the partner cookie.

Privileged changes use current-password verification, strict schemas, transactions, required unique indexes, audit records, version checks and stable command keys. Member-created key revocation follows role changes. No production keys, real funding or API secrets are bundled in frontend assets. Public execution requires the dedicated sandbox database boundary.

Password recovery reuses the existing reset service and session-family revocation. Partner links use the configured Partner origin (local 5176 fallback in nonproduction). Real email delivery requires SMTP and was not externally verified. MFA enrollment is not supported and is reported as unavailable.

## 15. Automated tests added

31 backend portal tests cover registration/draft/rejection/approval/suspension; organization/client/session isolation; reviewed credential issuance, hash-only storage, one-time replay protection, rotation/revocation/scope/expiry; inventory grant ownership; playground allowlisting and database boundary; booking isolation and the full gateway-to-ticket flow; webhook safe targets, rotation and retry; CSV isolation/RBAC; team ownership/session/key revocation; support; and legacy signing compatibility.

Six Partner component tests cover real organization data and filtered navigation, one-time secret visibility/clear, reviewed issuance, malformed playground JSON/focus, stale reads and registration validation. Two Admin component tests cover reviewed application control and read-only denial. Five new Chrome tests augment the four existing isolated workspace smokes.

## 16–18. Validation results

Final per-workspace validation passed: **356 automated tests** — **278 backend**, **57 Operator**, **15 Admin**, and **6 Partner**. The isolated Chrome suite passed **9/9**. All four workspace builds and both integration-client TypeScript checks passed. Final selected suites have zero failed or skipped tests. The new portal integration suite independently passed 31/31 after the final permission hardening.

The complete backend result is captured in `.cache/phase8-backend-verified.json`, with the independent portal result in `.cache/phase8-portal-final.json`. Earlier interrupted aggregate runs are retained separately; they must not be confused with the clean per-workspace verification. The final backend process temporarily prevented idle system sleep and restored that request on exit; no persistent power-plan settings were changed.

Earlier runs exposed three approval-path errors caused by a hydrated document save tripping immutable-field defaults. The review now performs an explicit conditional MongoDB update within the transaction. A duplicate-text browser selector and a test's Unicode expectation were corrected. A later broad run recorded multi-hour elapsed intervals and timed out in two existing Operator checks; focused reruns passed without altering those features. These intermediate failures are not represented as a clean final test run.

No live database or real payment transport was used. Browser screenshots are disposable fixture artifacts, not proof of production deployment. The original unconfigured browser test stubs were not run against the user's existing application/database.

## 19. Dependency security

Vitest was compatibly updated from 3.0.0 to 3.2.7 across all workspaces. This addresses [GHSA-9crc-q9x8-hgqq](https://github.com/advisories/GHSA-9crc-q9x8-hgqq) and [GHSA-5xrq-8626-4rwp](https://github.com/advisories/GHSA-5xrq-8626-4rwp) without a major upgrade. Tests/builds validate compatibility.

The subsequent npm audit still reports four vulnerable packages: `vitest`/`@vitest/mocker` 3.2.7 (current mocker advisories), `tinypool` 1.1.1 (critical prototype-pollution/RCE gadgets), and runtime `zod` 3.25.76 (high constrained-collection memory exhaustion). References: [mocker traversal](https://github.com/advisories/GHSA-82fw-gwwq-j7x9), [mocker registration](https://github.com/advisories/GHSA-qxg6-89mg-rqv8), [tinypool options](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3), [tinypool run](https://github.com/advisories/GHSA-85c8-ppgw-ccpr), [Zod collection limits](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).

Aggregate audit severity remains two critical, one high and one moderate package finding. The audit recommends major upgrades (Vitest 5.1.1 and Zod 4.6.7); these were not forced. Never expose a Vitest API/UI server to untrusted networks. The backend's 128KB JSON limit and rate limits reduce oversized-input exposure but do not establish that Zod's advisory is fixed. Audit JSON is retained locally in `.cache/phase8-audit*.json`. These are explicit production blockers for a separately reviewed dependency upgrade.

## 20. Migration readiness

`npm.cmd run operations:preflight -w backend` remains a read-only inspection: collection indexes, duplicates and readiness evidence. It now includes User and PartnerSupport. Run it only with an intentionally selected environment. Optional `--apply-sandbox --ack-reviewed` provisions additive indexes only in a nonproduction `aibus_public_sandbox_*` database. Conflicting index options/duplicates are reported; data is not reset or removed. No live migration or index provisioning was run during Phase 8.

Legacy Phase 7 machine partners are supported without a silent backfill. No existing operator, agent, booking, financial journal or ticket was deleted or reset. A future production rollout requires its own reviewed migration/backup/recovery plan and explicit approval.

## 21. Intentionally disabled capabilities

Production partner credentials and production API execution; live ticket issuance; real partner wallet/funding; unsupported rescheduling; real refund/payout execution; automatic real-money reconciliation; MFA enrollment; emailed team invitations; automatic KYC/company verification; a replacement external Travel Agent Dashboard.

Sandbox authorization is a finite server-provisioned simulation. The portal cannot self-fund or turn a payment claim into confirmation. Existing ordinary CRS modules retain their own previous behavior.

## 22. Remaining production blockers

Resolve major dependency advisories through a separately tested upgrade; provision an isolated staging/sandbox deployment and reviewed indexes; review privileged root grants and application approval operations; configure HTTPS portal/API origins, SMTP, approved callback hosts and signing-key custody; verify real callback delivery/deduplication, reset emails and worker supervision; define privacy/retention, support handling, onboarding verification and operational access policy; execute broader accessibility, load/abuse, backup/restore and disaster-recovery checks. No public URL or production SLA is asserted.

## 23. Phase 9 readiness

The sandbox platform has the application, API and test foundations for a later production-readiness review. Passing Phase 8 sandbox tests does not authorize production funding or deployment. Phase 9 has not been started. No unresolved dependency or deployment prerequisite is represented as completed.
