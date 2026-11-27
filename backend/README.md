# Aibus Node.js backend

Node 24, TypeScript, Express 5, MongoDB/Mongoose, Redis, Socket.IO. See [architecture](../ARCHITECTURE.md) for trust boundaries and frontend mapping. Razorpay Test Mode is integrated for internal inventory; see [Razorpay setup and verification](RAZORPAY.md). External reservation adapters, live payments and automatic refunds remain unavailable.

Security references: [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [Socket.IO authentication middleware](https://socket.io/docs/v4/middlewares/) and [Mongoose transactions](https://mongoosejs.com/docs/transactions.html).

## Local setup

From the repository root:

```sh
npm ci
cp backend/.env.example backend/.env
# Replace JWT_SECRET with cryptographically random material; 48+ characters.
# Start MongoDB as a replica set and Redis, then:
npm run indexes -w backend
npm run dev:backend
npm run dev:frontend
```

The frontend is at `http://127.0.0.1:5173`, API at `http://127.0.0.1:4000`. Use this exact hostname to match `WEB_ORIGIN`. No secrets are committed. PowerShell can use `Copy-Item` and `npm.cmd` if script execution is restricted.

For native Node/Vite with Docker-hosted databases, run `npm run setup` and then `npm run infra:up` from the root with Docker Desktop running. The development override binds only to loopback: MongoDB 27018 and Redis 6380. The Mongo URI uses `replicaSet=rs0&directConnection=true` so the host driver does not try resolving the container-only replica-set hostname. The full Docker stack continues to use its internal service addresses.

If the frontend reports an unreachable API, first check `http://127.0.0.1:4000/health/ready`. Both databases must be healthy before starting the Node process. If a different frontend origin is used, the server returns an explicit origin error; do not weaken the origin check. A fresh installation has no users, so follow the administrator bootstrap and operator registration/approval steps below.

Alternatively copy the environment file, replace its JWT secret, and use `docker compose up --build`. This creates an isolated **local-only** replica set and Redis, API and React app at `http://localhost:8080`. MongoDB and Redis have no host ports. This Compose file intentionally uses development-mode services; it is not an internet production deployment.

## First administrator and operator

Set `BOOTSTRAP_EMAIL`, `BOOTSTRAP_PASSWORD` (16+ characters), and optionally `BOOTSTRAP_NAME` in the private backend environment. Run `npm run bootstrap -w backend` (native), or `docker compose exec api node dist/scripts/bootstrap.js` (Docker). It refuses to overwrite an existing platform administrator. Remove bootstrap variables afterward.

Register an operator in the frontend. Registration creates an operator and admin in one transaction, initially pending. Sign in as the platform administrator to approve it. Then sign in as the operator admin, create staff, buses, layouts and routes, and schedule trips. There are no default passwords, synthetic settlements or pre-confirmed bookings.

## API use

`POST /api/v1/auth/login` with `{email,password}` returns an access token and sets an HttpOnly rotating refresh cookie. Use `Authorization: Bearer <accessToken>` for API calls. Browser requests use `credentials: include`. Cookie-based mutations must include `Origin` matching `WEB_ORIGIN`; HTTPS enables Secure cookies in production. The SPA stores access tokens only in module memory.

Authenticated OpenAPI JSON: `GET /api/v1/openapi.json`. Swagger UI is served at `/api/v1/docs` and requires a bearer header; use a local Swagger client to load the authenticated JSON and authorize, since navigating directly to a bearer-protected URL does not attach the SPA's in-memory token.

For the current car provider sandbox, see the [Car CRS guide](../car-crs/README.md).

Legacy bus partner API OpenAPI JSON: `GET /api/v1/public/openapi.json`. Its public Swagger UI is served at `/api/v1/public/docs`; request execution is disabled because partner credentials are server-to-server only. Use the Partner Portal playground or a backend/Postman client for sandbox requests.

All lists return `{data,meta:{page,limit,total,pages}}`; errors return `{error:{code,message,requestId}}`. Limits are 1–100. Search is escaped literal text. IDs are Mongo ObjectIds. Amounts are **integer paise**, not floating-point rupees. Dates use `YYYY-MM-DD` and departures require timestamps with offset; operational dates and financial grouping use Asia/Kolkata.

Booking flow for internal inventory:

1. `GET /operator/trips/:id/seats` (prefix every operator path with `/api/v1`).
2. `POST /operator/trips/:id/holds` with `{seats:["L1"]}`; holds last five minutes and are atomic across concurrent requests.
3. `POST /operator/bookings`, with `Idempotency-Key` (16–100 chars) and `{tripId,holdId,passengers:[{name,seat,phone?}]}`.
4. Booking stays **Pending payment**, with no PNR or ticket. Configured Razorpay Test Mode can initiate hosted Checkout; missing keys and external inventory remain unavailable.
5. The Razorpay adapter verifies the signature and fetches the authoritative captured payment, binding it to the configured merchant key, stored order, amount and INR currency before calling the server-only payment service. For external inventory it must additionally obtain authoritative provider confirmation. Never call the internal payment service from an HTTP body without verification.
6. `GET /operator/bookings/:id/ticket` returns a ticket only after confirmed inventory and payment. Late captured payments become reconciliation-required; they cannot steal an expired/reassigned seat.

Booking cancellation creates an audited policy snapshot and refund request; it does not release confirmed seats or claim money was returned. Refund processing remains 503 until verified reservation cancellation and payment-refund adapters exist.

## Provider integration work remaining

`src/integrations/providers.ts` defines normalized capability contracts. The supplied adapter has zero capabilities and makes no requests. Implement the real documented endpoint/auth mapping, a dedicated payment adapter and signature-verifying webhook controller; do not fill in assumed URLs. Provider request IDs and retry rules must match its actual contract. The GET-only helper retries transient failures with a timeout; mutation retry is prohibited without provider-supported idempotency. External reconciliation deliberately cannot generically confirm a ticket.

The user has indicated they will build/provide the external API later. Provider-specific booking, payment collection, cancellation execution, refunds, imported inventory and settlement ingestion are therefore **integration gates**, not completed live integrations.

## Tests and operational checks

```sh
npm run build
npm test
```

Backend tests download MongoDB 7.0.14 from the official MongoDB distribution on first run and start a temporary real replica set; no real bookings/payments/providers are used. Tests cover auth/RBAC, cross-operator access, token replay, seat concurrency, idempotency, duplicate verified sandbox callback processing, unavailable provider behavior, reconciliation and socket room isolation. The test limiter is injected; production always uses Redis atomic counters.

`/health/live` checks the process. `/health/ready` checks MongoDB plus Redis; 503 means do not route traffic. Structured request logs exclude cookies, headers, bodies, query strings, passwords and passenger contacts. Logs carry request IDs; collect stdout and alert on 5xx rates, readiness failure, reconciliation backlog, outbox age and failed payments. Redis rate-limit failures fail closed. Audit logs retain one year by default; confirm your operator retention policy before launch.

The server runs bounded hold reconciliation and durable outbox publication every ten seconds. `npm run worker -w backend` performs one expiry/provider reconciliation pass. Outbox delivery is at least once; clients re-fetch authoritative state and must tolerate duplicate identifiers. Configure an external supervised scheduler if processing is moved out of the API process. No generic worker fabricates external confirmations.

## Production deployment and recovery

Use an authenticated MongoDB replica set with TLS, authenticated Redis over TLS, HTTPS at the reverse proxy, a secret manager, a random rotating JWT key, SMTP and reviewed provider/payment credentials. Set `NODE_ENV=production`, `WEB_ORIGIN=https://your-domain`, and `TRUST_PROXY` to the actual trusted proxy hop count. Isolate private networks and never expose database ports. Do not enable permissive CORS or seed default users. The API Docker image runs as non-root. Keep uploaded images on durable restricted storage or replace the local store with private object storage plus ownership checks.

Run `npm run indexes -w backend` in a release job before production traffic. It adds missing indexes without dropping existing ones; review duplicates before adding unique registration and idempotency indexes. Mongo schemas use separate internal `_id` and external IDs. This is a new backend, so no existing-schema migration was required.

Schedule encrypted `mongodump --oplog` backups from the replica set and restricted upload-volume snapshots; store them off-host with access logs and retention approved by the operator. For restoration, first use an isolated replica set, restore with `mongorestore --oplogReplay`, restore images, run indexes, validate tenant counts and bookings/ticket/payment links, invalidate sessions, and reconcile against payment/provider sources before accepting bookings. Redis loss must not affect seat correctness; MongoDB owns holds and inventory. Test restoration regularly and record measured RPO/RTO rather than claiming untested recovery guarantees.

Before real launch: complete provider/payment contracts, configure SMTP, execute staging load/concurrency/security tests, verify real browser flows and HTTPS cookies, configure alerting/backups, and review business cancellation/commission/promotion policies. Passing local tests is not evidence that a missing external integration or Docker deployment has been verified.

See [folder structure](../FOLDER-STRUCTURE.md) for source responsibilities and entrypoints.
