# Phase 2: operator-owned agencies

## Canonical identity

Reuse `SalesPartner` with `kind: Agent`; no additional agent collection. Its immutable `operatorId` owns the agency. `User.salesPartnerId` links a login to one agency. Multiple login users can belong to an agency; linked user IDs are derived from User, not duplicated on SalesPartner.

New logins use role `agent`. Existing linked `booking_staff` users resolve to effective role `agent` at login, refresh and every authenticated request. Unlinked booking staff remain internal staff. Agency status, grants and bus restrictions are read from the database. Agents cannot enter operator, master, platform or operator realtime channels.

Bookings store server-derived operatorId, agentId, source, userId and createdByUserId. The existing source/userId fields remain compatible. Passenger/contact data remain booking-owned; customer accounts are never permanently assigned to an agency. Existing Phase 1 seat ownership, payment verification, ticket and idempotency logic are reused.

## API contracts

Operator prefix: `/api/v1/operator/agents`.

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/` | Paginated list / create agency |
| GET/PATCH | `/:id` | Details / edit contact, status, grants, buses, commission |
| POST | `/:id/users` | Link eligible same-operator staff or create a login |
| GET | `/performance` | Status-separated agency totals |
| GET | `/:id/bookings` | Paginated private booking report |

Existing performance/history endpoints are extended, not duplicated. Legacy staff IDs resolve on details/history only after a valid canonical agency link exists. Trip Master partners use the same SalesPartner collection. A linked agency cannot become a branch. Legacy agent mutations require agents:write.

Link-user bodies: either `{ userId }` or `{ name, email, password }`. Existing users must belong to this operator, be booking staff/agent users and not belong to another agency. No password hashes are returned. Changes to agency access revoke linked sessions.

Commission inputs: `commissionType: Percent | Fixed`, integer `commissionRate`: basis points for Percent (0–10000), paise for Fixed (0–100000000). Zero is valid. Default agency commission uses discounted base fare before tax/charges. Existing explicit trip/service CommissionRule overrides retain their original basis. Configuration changes never recalculate historical snapshots. Only Confirmed + Paid bookings count as earned commission. Pending, cancelled, refunded, failed and reconciliation-required bookings are excluded.

Allowed grants: `search`, `inventory`, `book`, `bookings`, `tickets`, `cancel`, `commissions`, `settlements`. Empty `allowedBusIds` explicitly means all owned buses; nonempty lists restrict new searches, holds and bookings. Every ID is tenant-validated.

Agent prefix: `/api/v1/agent`. Reuse existing `/api/v1/auth/login`, `/refresh`, `/me`, `/logout`.

| Grant | Endpoints |
|---|---|
| Identity | `GET /me` |
| search | `GET /trips?from=&to=&journeyDate=&page=&limit=` |
| inventory | `GET /trips/:id/seats` |
| book | `POST /trips/:id/holds`, `DELETE /trips/:id/holds/:holdId`, `POST /trips/:id/quote`, `POST /bookings` |
| book | Shared `POST /bookings/:id/payment`, `/payment/verify`, `/payment/reconcile` |
| bookings | `GET /bookings`, `GET /bookings/:id` |
| tickets | `GET /bookings/:id/ticket` |
| cancel | `POST /bookings/:id/cancellation` |
| commissions | `GET /commissions` |
| settlements | `GET /settlements` returns explicit unavailable capability, not operator settlement rows |

Agent booking bodies reject client-supplied operatorId, agentId, source and salesPartnerId. POST /bookings retains Idempotency-Key requirements. Reads/payments/tickets/cancellation requests are scoped to the authenticated agency. Inventory DTOs omit other customers' hold IDs, booking IDs and user IDs. Cancellation only requests the existing policy workflow: no automatic refunds or seat release are introduced.

Super Admin read endpoint: `GET /api/v1/platform/operators/:operatorId/agents/:agentId/bookings`; both resources are validated. No operator impersonation is added.

## Permission matrix

| Actor | Agency reports | Agency management | Agency booking flow | Master/platform |
|---|---|---|---|---|
| Super Admin | Explicit platform endpoint | Existing platform scope only | No impersonation | Platform only |
| Operator admin | Own operator | Own operator | Existing operator flow | Existing permissions |
| Manager | Own operator | No | Existing operator flow | Existing permissions |
| Unlinked booking staff | No private agency reports | No | Existing internal operator flow | No mutation privileges |
| Read-only | No finance/passenger agency reports | No | No booking writes | Existing redacted reads |
| Linked agent | Own agency, as granted | No | Own agency, as granted | None |

## Additive migration

No live migration is run during implementation. Review/back up existing records before applying. Select genuine legacy agents explicitly: internal staff must not be automatically converted.

Dry-run from repository root:

```powershell
npm.cmd run migrate:agents -w backend -- --operator-id <operatorObjectId> --user-id <userObjectId>
```

After reviewing the plan, append `--apply`. Each selected user is processed transactionally. The migration reuses an explicit or uniquely matching same-operator agency (case-insensitive email), refuses ambiguous matches, and creates a new agency only when necessary. Invalid legacy commission values require manual review. It links the user, revokes sessions and adds missing agent/creator attribution to eligible historical bookings. It preserves source, reference, PNR, money, payment state and commission snapshots. Direct customer bookings are excluded. Reruns do not create duplicate agencies or financial records. Nothing is deleted.

Unlinked users no longer earn automatic agency commission from User fields. Those legacy fields remain available as migration inputs; migrate/link actual legacy agents before switching their dashboard to agency endpoints.

New indexes: SalesPartner `{operatorId, legacyUserId}` unique only for ObjectId legacyUserId; User `{operatorId, salesPartnerId}` nonunique; Booking `{operatorId, agentId, createdAt:-1}` nonunique. Use the existing `npm.cmd run indexes -w backend` during an approved maintenance window; it never drops indexes. Production startup has autoIndex disabled. No new indexes have been applied to the live database during this work.

## Verification and next phase

Tests: backend `tests/integration/system.test.ts`, frontend `src/tests/agent-management.test.tsx`; Phase 1 reservation regressions remain in the integration suite. Run targeted agent tests, all workspace tests and builds.

The external Travel Agent Dashboard is not in this repository. Phase 3 must connect its auth and booking UI to the agency API, configure its approved browser origin, and verify search/hold/quote/payment/ticket/cancellation, session recovery and status messaging end to end. External API Partners remain a separate later channel. Wallet, ledger and settlement accounting remain Phase 4. No production deployment is part of Phase 2.

## Phase 2 file manifest

Backend modified: package.json; src/app.ts; src/types/permissions.ts; src/middleware/authorization.ts; src/models/user.model.ts, sales-partner.model.ts, booking.model.ts; src/realtime/socket.ts; src/routes/auth.routes.ts, operator.routes.ts, platform.routes.ts, trip-master.routes.ts; src/services/auth.service.ts, commission.service.ts, inventory.service.ts, razorpay.service.ts; tests/integration/system.test.ts.

Backend added: src/types/agent.ts; src/validators/agent.schemas.ts; src/services/agent.service.ts, agent-migration.service.ts, cancellation.service.ts; src/routes/agent.routes.ts, agent-management.routes.ts; src/scripts/migrate-agents.ts; AGENT-MANAGEMENT.md.

Frontend modified: src/api/client.ts; src/components/forms/RecordForm.tsx (internal staff label); src/features/settings/StaffManagement.tsx, OperatorSettings.tsx; DESIGN.md; UX-CONTRACT.md. Added: src/features/settings/components/AgentForm.tsx, agent-form.css; src/tests/agent-management.test.tsx.

Phase 1 changes already present in jobs/booking.jobs.ts and routes/counter.routes.ts were preserved. Pre-existing .gitignore/.dockerignore changes were not edited in this phase.

## Verification recorded on 2026-11-18

Final workspace run: 84 backend integration tests + 50 operator frontend tests + 3 admin tests = 137 passed. Targeted agent run: 12 backend tests passed; targeted agency UI run: 6 tests passed. All Phase 1 reservation regressions passed in the complete suite. npm run build passed for all three workspaces, including TypeScript checks. Changed-file formatting and git diff --check passed. The repository-wide formatting check reports the unchanged frontend/src/utils/normalize.ts; it was deliberately left outside this phase.

Browser automation could not initialize (kernel assets path error), so real-browser visual/keyboard/narrow-viewport verification was not executed. The optional Python UI audit could not run because Python is not installed. Component interaction tests ran in jsdom; payment provider transport was mocked. No live migration, index command, database reset, production deployment, dependency installation, API Partner work or Phase 3 implementation was performed.
