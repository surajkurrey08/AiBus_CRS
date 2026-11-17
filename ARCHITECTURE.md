# Aibus operator system

## Existing integration inventory

The supplied repository contained only a React/TypeScript/Vite frontend with browser-local mock data. No existing customer/agent application, backend, auth, MongoDB collections, payment contracts or external provider documentation was supplied. The user will provide/build the external API later. Existing React source is preserved under `frontend/`; the new independent Node.js API is under `backend/`. No invented third-party endpoints.

## Request path

React → same-origin `/api/v1` proxy → Express → authentication/session lookup → current user role/operator approval → permission → validated tenant-scoped repository query → MongoDB replica set transaction. Redis backs shared rate limits and Socket.IO fan-out; it is not a second seat-availability source. MongoDB atomic trip-document updates are authoritative for internal inventory. External inventory has no local availability or confirmation fallback.

Access tokens live in frontend memory; rotating opaque refresh tokens use HttpOnly, SameSite Strict cookies. Refresh hashes and session revocation are persisted. The server rejects cross-origin cookie mutations. Super admins use a distinct platform router; they cannot silently select another tenant via operator API parameters. Operator registration remains pending until platform approval.

## Screen mapping

| Frontend                | API /api/v1/operator                            |
| ----------------------- | ----------------------------------------------- |
| Overview                | dashboard                                       |
| Bus & fleet             | buses; buses/:id/layout; buses/:id/images       |
| Routes & trips          | routes; schedules; trips                        |
| Seat inventory          | trips/:id/seats; holds; block; unblock          |
| Bookings & tickets      | bookings; bookings/:id/ticket                   |
| Passenger manifest      | trips/:id/manifest; bookings/:id/check-in       |
| Fare & pricing          | fares; fares/:id/history                        |
| Cancellations & refunds | cancellations; cancellation-policy; refunds     |
| Offers & promotions     | offers                                          |
| Reports & earnings      | reports/revenue; reports/occupancy; settlements |
| Operator settings       | profile; staff; preferences; integrations       |

## Boundaries

`backend/src/models/`: individual schemas/indexes. `src/services/auth.service.ts` and `src/middleware/`: password/session/RBAC. `src/routes/`: HTTP workflows. `src/services/inventory.service.ts`: atomic holds and booking transitions. `src/integrations/providers.ts`: capability-based reservation adapter. `src/services/analytics.service.ts`: recorded financial data in integer paise. `src/jobs/`: expiry/reconciliation/outbox. `src/app.ts` and `src/server.ts`: middleware, health, startup and graceful shutdown. `src/docs/openapi.ts`: API documentation. `frontend/src/api/client.ts` and `src/context/WorkspaceContext.tsx`: API state, refresh and realtime invalidation. See [folder structure](FOLDER-STRUCTURE.md).

Razorpay Test Mode has a raw-body HMAC webhook and a signed Checkout-verification endpoint. Both independently fetch the authoritative captured payment and bind it to a persisted order and the booking total before calling the server-only payment application service. Callback, webhook and background reconciliation are idempotent. Other reservation/refund callbacks remain unavailable. No HTTP route accepts an unverified client claim of successful payment. See [Razorpay integration](backend/RAZORPAY.md). A pending booking has no PNR or ticket. Money is integer paise; financial reports distinguish gross, discounts, commissions, confirmed refunds and actual settlements.

MongoDB transactions require a replica set, including local development. Hold expiration is checked in atomic write predicates; TTL cleanup is never reservation authority. Versioned fares affect future trip snapshots; existing holds retain their quoted amount. Durable outbox events contain identifiers only, never passenger PII. Worker reconciliation is idempotent. Redis failure fails closed for request limiting. Production startup requires HTTPS origin and an explicit random JWT secret.
