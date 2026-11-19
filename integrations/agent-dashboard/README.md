# Phase 3: AIBUS agent integration contract

**Actual frontend integration is pending.** Only CRS operator/admin/backend packages were found in the AIBUS workspace and nearby AIBUS project manifests. The user confirmed GoAirClass is unrelated; no files in that project were changed. The existing AIBUS Agent Dashboard source/path remains unknown. No replacement dashboard, connected agent screens or passing browser E2E is claimed.

## Authentication and deployment

Reuse CRS accounts, User.salesPartnerId and canonical operator-owned SalesPartner Agent records. No second authentication database or self-registration flow is introduced. Agents are provisioned by their operator.

Set the approved exact `AGENT_WEB_ORIGIN` on the backend. It is unset by default; the example port is not deployment approval. No live .env was edited. Credentialed CORS uses an explicit allowlist, never a wildcard. Origins must have no path, trailing slash, wildcard or embedded credentials. All configured production dashboard origins require HTTPS.

Call existing `/api/v1/auth/login`, `/refresh`, `/logout`, `/me` using `X-Aibus-Client: agent` and `credentials: include`. The separate `aibus_agent_refresh` cookie is HttpOnly, SameSite=Strict, Secure in production, host-only and scoped to `/api/v1/auth`. Session.client binds refresh/logout to its portal. Rotation/replay, approved operator, active user, active agency and current grants are checked server-side. Legacy operator/admin sessions remain supported; old agent clients must sign in once with the new header before using the agent cookie namespace.

Use either a same-origin API proxy or HTTPS agent/API subdomains on the same site. Use consistent local host spelling. An unrelated cross-site domain will not work with Strict cookies and the existing cross-site mutation guard merely because CORS is approved. Do not weaken cookies/CSRF checks as a workaround. Unknown Origin, missing Origin on cookie mutations and cross-site mutations are rejected.

Keep tokens/passwords/passengers out of localStorage/sessionStorage. Access tokens stay in memory. Obtain navigation grants from `/agent/me`, not client IDs or auth identity's limited internal permission list. Server authorization remains authoritative. Handle 401 with controlled refresh/login; handle grant-denied 403 with updated permissions, not operator-API or fixture fallback.

## Adapter

`client.ts` is a framework-neutral integration adapter, **not a dashboard**. Copy/import it into the confirmed existing app only when that source is recovered:

```ts
import { createAgencyClient } from './aibus/client';
export const aibus = createAgencyClient(import.meta.env.VITE_AIBUS_API_ORIGIN);
```

Use one instance per app/tab. The API origin is public configuration; Razorpay/backend secrets never enter React. `login`, `refresh`, `logout` and `me` use existing auth. `getIdentity()` exposes no token. Refresh is single-flight within that instance. One authentication-only retry retains the exact captured payload and idempotency key. Late 401s cannot erase a newly refreshed token.

Network/5xx mutation outcomes and PAYMENT_ORDER_UNCERTAIN are marked `AgencyApiError.uncertain`. Never blindly retry a charge or create a new booking/key. Reconcile the existing booking/order. Failed logout clears memory but must surface server/network failure; frontend code cannot itself delete an HttpOnly cookie. Cross-tab session behaviour still needs testing in the actual app.

## Screen/API contract

Agent paths below use `/api/v1/agent`. Success: `{data,meta?}`. Error: `{error:{code,message,requestId}}`. Money is integer paise. Dates are YYYY-MM-DD; timezone is Asia/Kolkata.

| Existing screen | API | Required grant / behaviour |
|---|---|---|
| Identity/navigation | GET /me | Current agency grants; no staff enumeration |
| Dashboard | GET /dashboard?date= | bookings; finance omitted without commissions; today defaults to IST |
| City autocomplete | GET /cities?search=&page=&limit= | search; names only from permitted future bookable inventory |
| Search | GET /trips?from=&to=&journeyDate=&page=&limit= | search; submit a complete explicit search |
| Seats | GET /trips/:id/seats | inventory; coordinates, decks, fares and safe states |
| Cancellation policy | GET /trips/:id/cancellation-policy | inventory; version/rules, execution-unavailable flag |
| Hold/release | POST /trips/:id/holds; DELETE /trips/:id/holds/:holdId | book; server expiry, own unconsumed holds |
| Quote | POST /trips/:id/quote | book + inventory; server pricing |
| Pending booking | POST /bookings + Idempotency-Key | book; server-derived tenant/source/agency/creator |
| Test payment | POST /bookings/:id/payment | book; public test key/order/amount only |
| Verify/reconcile | POST /bookings/:id/payment/verify or /payment/reconcile | book; proof or existing booking, no client success flag |
| History/PNR | GET /bookings?page=&limit=&search=&status=&paymentStatus=&from=&to= | bookings; strict filters, literal reference/PNR search |
| Details | GET /bookings/:id | bookings; own passengers, contact, server pricing/status/time |
| Ticket/print | GET /bookings/:id/ticket | tickets; confirmed PNR and own journey/bus/passenger details |
| Cancellation | POST /bookings/:id/cancellation; GET same path | cancel; request and actual request/refund status |
| Commissions | GET /commissions?from=&to= | commissions; earned/pending/excluded snapshots, date-wise rows |
| Wallet/settlements | GET /settlements | explicitly unavailable; disable wallet/top-up/payout UI |

Dashboard booking counts/recent activity and commission date filters use **booking creation day in IST**, while authorized trips use journey date. Commission without dates preserves all-time totals; date-wise output caps at 366 populated days and exposes `dateWiseTruncated`. Filter smaller periods for complete day rows. Pending commission is prospective, not earned. Cancelled/refunded exclusion buckets may overlap and are not additive ledger reversals or wallet balances.

## Booking state machine

Login -> explicit search -> seats -> hold -> passengers -> server quote -> pending booking -> test checkout -> server verification -> confirmed ticket/PNR -> history. Selection is not a hold; pending is not confirmed. Booked/blocked seats stay disabled. Use the server hold expiry, exact boarding/drop names and quote totals. Never create a client PNR/payment status or expose another customer's hold/user/booking IDs.

POST /bookings body: `{tripId,holdId,quoteId?,passengers:[{name,seat,boarding,dropping,phone?,age?,gender?}],contact?,gst?,promoCode?}`. Omit operatorId, agentId, salesPartnerId, source and client totals. Generate one `crypto.randomUUID()` idempotency key per attempt and keep the immutable body/key for recovery. A changed request with the same key conflicts; another agency's key never reveals its booking.

The adapter deliberately does not persist PII. On tab reload, recover known booking IDs/references through history; recovery of an uncertain not-yet-known booking outcome needs a deliberate UI design, not copying passenger payloads into localStorage.

Razorpay Checkout uses only the stored server order. Return its razorpay_order_id, razorpay_payment_id and razorpay_signature proof. Client success, closing Checkout or a timeout cannot confirm. Reconcile the same booking after an uncertain outcome. A late captured payment can be Paid + Reconciliation required with no ticket; do not charge again or affect a replacement hold.

Print only after ticket retrieval succeeds and render passenger text escaped. Cancellation request success is not completed cancellation, inventory release or refund. Show actual refund status/completed flag; execution remains unavailable. No API Partner or ledger implementation is included.

## Validation and blocker

No actual AIBUS agent React source, runnable agent URL or screen selector contract is available. Therefore agent-screen tests/browser E2E are **not executed**. Backend tests exercise the full API sequence on an isolated MongoMemoryReplSet with mock Razorpay; adapter tests use mock fetch. Neither is browser E2E. See MANUAL-QA.md and STAGING-READINESS.md.

```powershell
npm.cmd run test:agent-adapter
npm.cmd run check:agent-adapter
npm.cmd run test -w backend -- --testNamePattern="agent dashboard integration contract"
npm.cmd test
npm.cmd run build
```

Phase 3 remains incomplete until the existing agent screens are connected and verified. Do not deploy or automatically start Phase 4.

Verification on 2026-11-18: the workspace run passed 149 tests (50 operator, 96 backend including 6 adapter tests, 3 admin), and all workspace builds passed. After the final report-total adjustment, the backend build, adapter TypeScript check and all 96 backend tests passed again. One intermediate backend run hit a 180-second fixture setup-hook timeout; its isolated rerun and the subsequent complete backend run passed without changing test timeouts. Payment tests use mocked Razorpay transport, not a real Checkout session. Browser acceptance remains unexecuted for the source/URL blocker above.

## Files in this integration change

Modified: package.json; backend/.env.example; backend/src/config/env.ts; backend/src/models/session.model.ts; backend/src/services/auth.service.ts; backend/src/routes/auth.routes.ts; backend/src/middleware/auth.middleware.ts; backend/src/routes/agent.routes.ts; backend/tests/integration/system.test.ts. Added: backend/src/services/agent-dashboard.service.ts; backend/src/validators/agent-dashboard.schemas.ts; backend/tests/agent-client.test.ts; integrations/agent-dashboard/client.ts, README.md, MANUAL-QA.md, STAGING-READINESS.md. Earlier Phase 1/2 changes are retained; no existing React screen or unrelated external repository was changed in this phase.
