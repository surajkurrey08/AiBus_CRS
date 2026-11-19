# Aibus operator management system

Two separate applications:

```text
frontend/   React + TypeScript + Vite + Tailwind operator dashboard
backend/    Node.js + TypeScript + Express + MongoDB + Redis + Socket.IO API
```

The existing dashboard layout is preserved. The default frontend uses authenticated backend APIs and never silently falls back to browser mock data. Explicit demo fixtures are used only by UI tests.

Booking Counter is available in the existing operator sidebar. It adds trip search, shared seat inventory, server-priced quotes, hold/passenger workflows, quotas, stop/resume booking and source-wise records. Before creating new bookings, an authorized operator must configure pricing rules in the counter. See [counter architecture and API mapping](backend/BOOKING-COUNTER.md).

## Run

```sh
npm ci
npm run setup
# Start Docker Desktop first, then the isolated local development databases:
npm run infra:up
npm run dev:backend
# In another terminal:
npm run dev:frontend
```

React: `http://127.0.0.1:5173`. Node API: `http://127.0.0.1:4000`.

Vite uses port 5173 strictly, matching the backend WEB_ORIGIN. A second frontend must not silently move to 5174. Native-development databases use loopback-only ports 27018 (MongoDB replica set) and 6380 (Redis), leaving other local projects alone. The MongoDB URI uses directConnection=true for the single Docker-hosted replica-set member. Check `/health/ready` on port 4000 before troubleshooting login credentials.

For the local Docker stack, prepare the backend environment file, then `docker compose up --build`; React is at `http://localhost:8080`.

First create a platform administrator with the documented bootstrap command, register an operator, approve it, then create buses, layouts, routes and trips. There are no default credentials.

```sh
npm run build
npm test
```

See [backend setup and deployment](backend/README.md), [system architecture and integration mapping](ARCHITECTURE.md), and [frontend guide](frontend/README.md).

Razorpay Test Mode is integrated for internal inventory: server-created orders, hosted Checkout, signed verification and captured-payment reconciliation. See [Razorpay setup](backend/RAZORPAY.md). External reservation APIs, live payments and automated refunds remain unavailable. Test payments are not real collections; complete production integrations before accepting real transactions.

See [folder structure](FOLDER-STRUCTURE.md) for source responsibilities and entrypoints.

For the isolated Hostinger/GHCR deployment pipeline, see the
[deployment runbook](docs/DEPLOYMENT.md), [source audit](docs/DEPLOYMENT-AUDIT.md)
and [local validation results](docs/CI-CD-VERIFICATION.md). Production deployment
is manual only; configuring these files does not deploy or change the shared proxy.
