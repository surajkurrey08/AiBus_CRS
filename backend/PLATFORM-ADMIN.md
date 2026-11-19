# Phase 5 — Super Admin and platform management

Implementation date: 18 November 2026. This extends the existing CRS. It does not replace the booking engine, ledger, operator masters, authentication or Agent Dashboard. No production deployment, live migration, real financial execution or data reset was performed.

## 1. Existing architecture findings

The repository has separate React operator and admin workspaces, one modular Express/TypeScript backend, MongoDB transactional business records, Redis coordination and the prepared external agent integration client. Before Phase 5, the admin screen combined platform counts, the company directory, company status review and the Phase 4 Finance Hub. Platform routes relied on broad platform-management access and company status commands lacked the new reason, password re-verification and optimistic version contract.

The existing Phase 1 reservation ownership predicates, Phase 2 canonical operator-owned SalesPartner agencies, existing session authentication, cancellation workflows, ledger journals, financial operations, settlements and reporting services remain authoritative. Phase 5 adds projections, oversight and constrained administrative commands around them. It introduces no alternative wallet, ledger, booking or settlement engine.

## 2. Module implementation

| Module | Delivered behavior | Boundary |
| --- | --- | --- |
| Overview | Actual tenant, fleet, trip, booking and seat metrics; travel-date/operator/source filters; trends, routes, activity and operational alerts | Gross ticket value is separate from ledger platform earnings; financial balances/open cases are current, not period revenue |
| Bus Operators | Search, paging, company profile, staff/fleet/routes/history counts, approval/rejection/reopening/suspension and independent new-sales stop | Versioned, reasoned and password re-verified; existing tickets are preserved |
| Company verification | Scoped opaque document references with Submitted/Reviewed/Rejected/Needs information review history | Manual reference review, not uploaded document storage, automated KYC or external URL fetching |
| Buses & Trips | Central read-oriented buses, routes, trips and inventory monitoring with detail drawers | Operator-owned master editing stays in the operator workspace |
| Agencies | Canonical agency/operator ownership, permissions, commission policy, recent activity, finance-gated wallet/credit/exceptions | No arbitrary reassignment or credit changes through platform operational routes |
| Bookings | Reference/PNR, source, operator, date and status search; ticket metadata, event timeline and optional privileged passenger evidence | No forced confirmation, seat release or cancellation bypass; list/export PII redacted |
| Finance | Reuses the nine-section Phase 4 AdminFinanceHub and existing reconciliation/refund/settlement services | Separate read/action grants; maker/checker and test-only controls remain |
| Admin Users & Roles | Functional profiles, explicitly selected permission subsets, account creation, access/status changes and session revocation | Bootstrap root/self protection; no root creation or invitation email delivery |
| Reports | Eight operational categories, bounded CSV export and existing fifteen financial categories | Server authorization, paging, formula neutralization and PII redaction |
| Audit Logs | Central actor, operator, reason, resource, timestamp and sanitized change metadata | Financial events require finance-read; immutable financial history is unchanged |
| Settings | Profile/support email, manual onboarding policy, template drafts and integration configuration summaries | No secret editing, automatic notification dispatch, live finance switches or MFA enrollment |

## 3. Files added and modified

Added backend:

- `src/types/platform.ts`: operational permissions, functional profile ceilings and identity construction.
- `src/models/platform.model.ts`: OperatorDocument, PlatformSettings and PlatformCommand.
- `src/services/platform-read.service.ts`: authorized projections, details, overview, operational reports and CSV.
- `src/services/platform-admin.service.ts`: reasoned/versioned/step-up administrative commands and index checks.
- `src/scripts/platform-preflight.ts`: read-only additive index/schema assessment.
- This report.

Modified backend integration points:

- `src/routes/platform.routes.ts`, `src/app.ts`, `src/docs/openapi.ts`: explicit contracts, authorization and mutation rate limiting.
- `src/models/user.model.ts`, `src/models/operator.model.ts`, `src/models/index.ts`, `src/types/permissions.ts`, `src/services/agent.service.ts`: additive profile/policy fields, exports and existing authenticated identity reuse.
- `src/services/inventory.service.ts`: serialize new sales with operator policy changes using MongoDB inside existing hold/booking transactions.
- `src/services/settlement.service.ts`: check action permission before test-mode availability; accounting and maker/checker rules unchanged.
- `tests/integration/system.test.ts`: nineteen Phase 5 regression cases and the existing approval test updated for the stricter command contract.
- `package.json`: read-only `platform:preflight` script.

Admin additions and extensions:

- `src/features/operators/PlatformScreen.tsx`: existing shell extended with permission-aware module navigation.
- `src/features/platform/{PlatformOverview,PlatformWorkspace,PlatformUsers,PlatformSettings}.tsx` and `platform.css`; PlatformWorkspace also exports PlatformReports.
- `src/components/platform/{PlatformTable,PlatformDetails}.tsx`: shared lists, filters and evidence.
- `src/features/finance/FinanceReviewForm.tsx`: reused review primitive with business intent, secret fields and accessible validation.
- `src/api/client.ts`: authenticated CSV download and functional identity profile.
- `src/tests/platform-workspace.test.tsx`, `src/tests/admin.test.tsx`, `DESIGN.md`, `UX-CONTRACT.md`.

The working tree also contains earlier Phase 1–4 changes. Those are not all Phase 5 changes; none were reverted or committed by this task.

## 4. Database changes and indexes

| Record | Additive changes | Required uniqueness |
| --- | --- | --- |
| User | Optional platformProfile and selected platformPermissions; existing explicit finance fields reused | Existing user email index retained |
| Operator | salesBlocked (false default), salesRevision (zero default) | Existing tenant/index rules retained |
| OperatorDocument | operatorId, kind, opaque reference, status, reviewer, reason, review timestamp | operatorId + kind + reference |
| PlatformSettings | key, display/support profile, Manual review onboarding, template draft map, version and updatedBy | key |
| PlatformCommand | actorId, idempotency key, HMAC payload identity, action and resulting resourceId | actorId + key |

All existing IDs and booking references are preserved. Privileged audit records set expiresAt to null and include actor, tenant where relevant, business reason and safe change evidence. Permission changes preserve previous profile/permissions/finance grants in audit. Credentials and password material are excluded. Existing financial journal history and retention are not rewritten.

Privileged commands fail closed if the required new unique indexes are absent or incompatible. MongoDB replica-set transaction support remains required. Policy updates use version predicates and transact with audit/outbox. New hold and new booking transactions atomically check approved status and salesBlocked while incrementing salesRevision; concurrent policy changes therefore conflict and retry under the existing transaction mechanism. Existing booking replay and already-owned pending payment confirmation remain available without creating new sales.

## 5. API contracts

Prefix: `/api/v1/platform`. Existing authentication/session refresh is reused with the admin client identity. Every endpoint requires a server-authenticated platform identity with no operator/agency tenant. GET responses use no-store. Privileged mutations share a rate limit of 20 per 900 seconds using the existing limiter.

| Method and path | Permission / behavior |
| --- | --- |
| GET `/capabilities` | Authenticated platform identity; selected permissions, role ceilings and unavailable-feature flags |
| GET `/overview` | platform:overview:read |
| GET `/operators`, `/operators/:id` | platform:operators:read; scoped directory/profile |
| PATCH `/operators/:id/status` | platform:operators:write; status and/or salesBlocked, version, reason and current password |
| POST `/operators/:id/documents` | platform:verification:write; add an opaque reference with reason/current password |
| POST `/operators/:operatorId/documents/:id/review` | platform:verification:write; scoped document, status, version, reason/current password |
| GET `/operators/:operatorId/agents/:agentId/bookings` | Existing route retained; canonical agency/operator relationship validated and passenger data redacted |
| GET `/{buses,trips,routes}`, corresponding `/:id` | platform:monitor:read; read-oriented monitoring |
| GET `/agencies`, `/agencies/:id` | platform:agencies:read; finance exposure additionally needs platform:finance:read |
| GET `/bookings`, `/bookings/:id` | platform:bookings:read; passenger detail separately needs platform:passengers:read and is audited |
| GET `/alerts`, `/alerts/:id` | platform:monitor:read; synthetic alert IDs have no UI drilldown |
| GET `/audit`, `/audit/:id` | platform:audit:read; sanitized, finance-gated history |
| GET `/{buses,trips,routes,agencies,bookings,alerts,audit}.csv` | Same resource permission, complete from/to required |
| GET `/reports/:name`, `/reports/:name.csv` | platform:reports:read; CSV requires complete from/to |
| GET/POST `/admin-users` | platform:staff:write; root-only capability, explicit least-privilege staff creation |
| PATCH `/admin-users/:id` | platform:staff:write; versioned change, reason/current password, revoke target sessions |
| POST `/admin-users/:id/revoke-sessions` | platform:staff:write; protected root/self checks, reason/current password |
| GET/PUT `/settings` | platform:settings:read/write; PUT requires version, reason/current password |

List query keys: page (1–100000), limit (1–100), search (maximum 100), status, operatorId, agentId, from/to ISO dates, source (`operator`, `agent`, `customer`, `external`). Unknown keys and invalid date order are rejected. Identifiers select a scope; they never grant authority. Some filters only apply to the relevant record type. Current registries do not become historical snapshots just because a date filter is supplied. Detail endpoints reject unexpected query keys.

Staff input: name, email, profile, explicit permissions array, financeRead, financeActions, active, reason and password (the acting administrator's current password). Creation additionally requires initialPassword of at least 12 characters and Idempotency-Key. Update requires version. Same-key creation replay returns the original resource; changed content conflicts. The password itself is never stored in PlatformCommand or returned. Protected bootstrap roots cannot be modified through these commands. The stricter lifecycle PATCH body is an intentional API tightening: clients must now supply version/reason/password; the Admin UI and OpenAPI were updated together.

## 6. RBAC matrix

The existing auth role remains `super_admin`; platformProfile differentiates functional staff and selected permissions are intersected with each profile's server-defined ceiling. A role label does not grant every permitted action. Accounts without platformProfile retain the legacy protected bootstrap-root operational capability. There is no client-selectable root profile.

| Profile | Maximum operational scope | Explicit finance eligibility |
| --- | --- | --- |
| Bootstrap Super Admin | All operational permissions, staff management and settings writes | Read and each action still require existing explicit grants |
| Platform Operations | Overview, operator read, monitoring, agencies, operational reports, settings read | No finance grants through staff provisioning |
| Finance Manager | Overview, operator/agency/booking read, operational reports, audit read | Read plus separately selected refund review, settlement prepare/approve and payout authorization |
| Booking Support | Overview, operator read, monitoring, bookings, operational reports; optional passenger detail | No finance grants through staff provisioning |
| Operator Verification | Overview, operator read/write, document-reference review, monitoring | No finance grants through staff provisioning |
| Audit / Read Only | Operational read capabilities except passenger PII | Read may be selected; no writes or finance execution grants |

Passenger detail is excluded from default profile selections, including Booking Support. Functional profiles cannot manage staff or write settings. Finance-read never implies an action grant. Maker/checker prevents a settlement preparer from approving their own batch even if both grants are held. Revoked/deactivated staff lose existing sessions; server authentication revalidates current user state. A profile change cannot be used to promote a functional account to bootstrap root.

## 7. Security and finance reuse

- All mutations use server permission checks and password re-verification; tenant/record ownership and transition/version checks are evaluated server-side.
- Staff grants are bounded by the selected profile, root/self changes are protected and staff creation has durable idempotency.
- Company suspension/new-sales stops do not silently cancel or release existing bookings. No manual ticket confirmation endpoint was added.
- Passenger lists/CSV are redacted; optional passenger detail has a distinct grant and audit event. Safe audit metadata is allowlisted; financial metadata is hidden from operational-only readers.
- Existing platform finance routes and the Finance Hub remain authoritative. Operator financial summaries call the existing reconciliation service. No second balance computation, settlement store or refund engine was introduced.
- Settlement action authorization now precedes test-mode availability checks, consistently returning forbidden to ungranted staff. Live execution remains unavailable and external payment calls remain outside MongoDB transactions.
- MFA was evaluated, not simulated: encrypted factors, enrollment challenges and recovery infrastructure are absent. Capabilities state unavailable; current-password step-up is implemented. Password re-verification is not MFA.

## 8. Reports

New operational report names: operator-performance, agency-performance, booking-source, route-bookings, bus-occupancy, confirmed-cancelled, payment-status, operational-alerts. Operator/agency groupings use IDs, so same-name organizations do not merge. Occupancy uses actual booked/total seats. Payment status is separate from booking status. Lists and CSV use the same authorization and projection paths.

The fifteen existing financial report categories remain in the Phase 4 Finance Hub, as documented in FINANCE-API.md and FINANCE-PHASES.md. They retain ledger-backed integer-paise accounting, separate gross value/platform earnings and their original permission/filter rules.

## 9. Validation and limitations

Nineteen new backend cases cover functional login, permission ceilings, real overview metrics, source/date filters, tenant monitoring, passenger redaction, step-up/state transitions, suspension preservation, independent sales policy, concurrent policy updates, document ownership, agency exposure, staff idempotency/escalation protection, session revocation, financial/credit denial, safe audit, reports/CSV, explicit finance grants, missing-index fail-closed behavior and settings safety.

Six new admin component tests cover restricted navigation/data loading, stale search responses and focus, reviewed least-privilege staff creation, email validation/draft preservation, re-masked secrets and genuine metrics/retry. Three existing admin tests now exercise the stricter operator-review contract. Existing reservation, agency, ledger, refund, wallet and settlement regression suites are preserved.

Final full-suite and build results are recorded in the completion update below. Automated databases are disposable MongoDB fixtures and payment integrations are mocked/test-only. No production data was used for these checks.

Browser QA was attempted but the native computer-use runtime failed before opening a surface (kernel asset path error, OS error 3). The optional Python design auditor could not run because Python is not installed. Browser E2E, real viewport/keyboard QA, actual Razorpay checkout and deployed service reachability are therefore unverified. jsdom component tests do not substitute for them.

Additional limits:

- Central read projections currently cap a source scan at 10000 records and fail with 413 rather than truncate silently. Large production inventories need indexed database-side projections/aggregates or an audited reporting store before rollout. Detail views reuse these bounded projections.
- Current registries are not historical snapshots; financial balances and unresolved cases are current. The API/UI describes this distinction.
- Gross booking value sums the selected booking records and their selected statuses; it is not captured cash, net sales or platform revenue. Use the existing ledger-backed financial reports for those accounting questions.
- Documents are opaque references reviewed manually, not an encrypted file vault or automatic verification service.
- Initial staff credentials use existing password hashing and must be distributed through a secure out-of-band process. This phase does not send invitations or introduce mandatory first-login rotation.
- Template drafts are stored but not dispatched. Redis/payment/SMTP configuration summaries do not prove provider availability. Live GPS/API partner configuration remains deferred.
- No MFA enrollment/recovery infrastructure or new audit archival/retention automation was added. Non-expiring privileged audits must be covered by deployment access/backup/retention policy.
- Filters are deliberately transient and not stored in URLs/browser storage; see admin/UX-CONTRACT.md.

## 10. Safe rollout and Phase 6 readiness

The additive read-only command is `npm.cmd run platform:preflight -w backend`. It accepts no apply mode, disables Mongoose automatic creation/indexing and reports missing/incompatible unique indexes and duplicate groups. It was prepared, not run against the user's live database.

Before any separately approved deployment: take and verify backups; run preflight against the target read-only; review existing User role/profile assignments; install the three new unique indexes through the established controlled index rollout after resolving conflicts without deleting data; confirm existing transaction/ledger/seat indexes and replica-set readiness; smoke-test access/session revocation and policy races in staging. The existing index script writes indexes and was not executed by this task. Do not enable migrations automatically on app launch.

Rollback means revoke/deactivate newly provisioned functional accounts and revert application rollout under an approved operational plan. Preserve audits, commands, documents, settings and financial history. Do not delete collections or clear role fields to turn a staff account into a legacy root.

Phase 6 has not begun. The scoped admin foundation is available for its planning, subject to final automated results, pending browser QA, explicit target-environment preflight/index rollout and the stated production-scale/security limits. This is not production certification.

## Final validation — 18 November 2026

| Check | Result |
| --- | --- |
| Full `npm.cmd test` | Passed, exit 0: 254 tests total |
| Backend | 184 passed: 178 integration + 6 agent-client contract tests |
| Operator React | 57 passed |
| Admin React | 13 passed |
| New Phase 5 tests | 25: 19 backend + 6 admin |
| Failed / skipped tests in final full run | 0 / 0 |
| Workspace builds | All three passed; TypeScript checks included |
| Agent adapter standalone TypeScript check | Passed |
| Focused formatting check | Passed for new/extended platform files and shared review form |
| `git diff --check` | Exit 0; only existing Windows line-ending conversion notices |
| Browser E2E / native visual QA | Blocked before initialization; not passed |
| Python design auditor | Not run: Python unavailable |

The first full run exposed a settlement-review ordering defect (ungranted approval returned test-mode unavailable before permission denial). Permission checking was moved before test-mode availability. The nineteen targeted Phase 5 tests then passed, followed by the final full suite above. The targeted run intentionally skipped unrelated cases; the final full run skipped none. A final header separator correction was included in the Admin suite and rebuilt successfully.

Implementation and automated validation are finished for the documented Phase 5 scope. Browser acceptance and target-environment rollout checks remain outstanding. No Phase 6/7 implementation, deployment or live financial operations were performed.
