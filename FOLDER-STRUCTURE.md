# Aibus source structure

The standalone platform admin application lives in `admin/`, the bus operator application in `frontend/`, and their shared Node API in `backend/`. Run `npm run dev:admin` for the admin application on port 5174. Admin code is organized into `src/app`, `src/api`, `src/components/ui`, `src/features/auth`, `src/features/operators`, `src/styles` and `src/tests`. Platform administration endpoints live in `backend/src/routes/platform.routes.ts`. Admin manages company details and approval/status, while operators use the existing workspace.

This is a modular application with a separate React frontend and Node backend.
It runs as one API process with local MongoDB and Redis. Service folders are code
boundaries, not separate deployments or databases.

```text
CRS/
├── frontend/
│   ├── src/
│   │   ├── main.tsx                 # React browser entrypoint
│   │   ├── app/App.tsx             # Workspace shell, navigation and page composition
│   │   ├── api/                    # HTTP client, session handling and API errors
│   │   ├── context/                # Workspace state and data loading
│   │   ├── features/
│   │   │   ├── auth/               # Login, registration and password reset
│   │   │   ├── platform/           # Platform administrator approval screen
│   │   │   ├── payments/           # Razorpay Test Mode Checkout and payment actions
│   │   │   ├── booking-counter/
│   │   │   │   ├── BookingCounter.tsx
│   │   │   │   ├── api/            # Counter endpoint contracts and types
│   │   │   │   └── components/     # Hold, passenger, pricing and ticket dialogs
│   │   │   ├── fleet/              # Bus seat-layout editor and image upload
│   │   │   ├── inventory/          # Live inventory and isolated demo inventory
│   │   │   ├── passengers/         # Manifest and check-in
│   │   │   ├── pricing/            # Cancellation policy editor
│   │   │   ├── settings/           # Company settings and staff management
│   │   │   └── trips/              # Trip scheduling and calendar
│   │   ├── components/
│   │   │   ├── ui/                 # Shared Panel, Badge and Overlay
│   │   │   ├── forms/              # Shared validated RecordForm
│   │   │   ├── tables/             # Searchable, sortable DataTable
│   │   │   ├── charts/             # Statistics and revenue chart
│   │   │   └── seats/              # Shared data-driven SeatMap
│   │   ├── hooks/                  # Shared React hooks
│   │   ├── utils/                  # Normalization and CSV export
│   │   ├── data/                   # Explicit demo fixtures and formatting helpers
│   │   ├── styles/                 # Base, shared theme and counter styles
│   │   └── tests/                  # DOM workflows and API-response tests
│   ├── public/                     # Static assets, if present
│   ├── index.html
│   └── vite.config.ts
├── backend/
│   ├── src/
│   │   ├── server.ts               # Mongo/Redis connection, HTTP server and job timers
│   │   ├── app.ts                  # Express composition and platform endpoints
│   │   ├── config/                 # Validated environment and logger
│   │   ├── models/
│   │   │   ├── user.model.ts
│   │   │   ├── operator.model.ts
│   │   │   ├── bus.model.ts
│   │   │   ├── route.model.ts
│   │   │   ├── trip.model.ts
│   │   │   ├── booking.model.ts
│   │   │   ├── payment-order.model.ts # Persisted, account-bound payment orders
│   │   │   ├── ...                 # One file per MongoDB model
│   │   │   ├── shared/schema.ts    # Schema factory and reusable subdocuments
│   │   │   └── index.ts            # Model exports/registration
│   │   ├── routes/                 # Auth, operator and counter HTTP handlers
│   │   ├── services/               # Auth, inventory, pricing and analytics logic
│   │   ├── middleware/             # Auth, permissions, rate limits, errors, request IDs
│   │   ├── validators/             # Common and operator input schemas
│   │   ├── types/                  # Roles, permissions and request identity types
│   │   ├── integrations/           # Reservation/payment-provider boundary
│   │   ├── realtime/              # Authenticated Socket.IO rooms and events
│   │   ├── jobs/                   # Expiry, reconciliation and outbox logic
│   │   ├── workers/                # Reconciliation worker entrypoint
│   │   ├── scripts/                # Admin bootstrap and database-index creation
│   │   ├── docs/                   # OpenAPI contract
│   │   ├── modules/auth/index.ts   # Public auth exports
│   │   └── utils/                  # Errors, responses, query helpers and shared exports
│   ├── tests/integration/          # Real temporary MongoDB replica-set tests
│   ├── .env                        # Private local configuration; not committed
│   └── .env.example
├── scripts/                        # Environment setup and clean backend build
├── Dockerfile
├── compose.yaml
└── compose.dev.yaml
```

## Where to make changes

| Change                                | Owner                                       |
| ------------------------------------- | ------------------------------------------- |
| MongoDB fields or indexes             | `backend/src/models/*.model.ts`             |
| HTTP endpoint                         | `backend/src/routes/`                       |
| Reusable booking or pricing behavior  | `backend/src/services/`                     |
| Authentication/permission enforcement | `backend/src/middleware/`                   |
| Request validation                    | `backend/src/validators/`                   |
| New external provider                 | `backend/src/integrations/`                 |
| Booking Counter behavior              | `frontend/src/features/booking-counter/`    |
| Seat appearance and accessibility     | `frontend/src/components/seats/SeatMap.tsx` |
| Application colors                    | `frontend/src/styles/theme.css`             |
| Shared form/table/dialog              | `frontend/src/components/`                  |
| API requests/session recovery         | `frontend/src/api/`                         |

New workflows should live in a business-named feature folder. Shared components
should contain reusable UI, not endpoint-specific business rules. Routes handle
HTTP parsing/permissions/responses; reusable domain operations belong in services.
Keep Mongo schemas out of routes and keep database access out of the frontend.

## Commands

Run from the root, in separate terminals for the two development servers:

```sh
npm run infra:up
npm run dev:backend
npm run dev:frontend
```

```sh
npm run build
npm test
npm run format:check
npm run indexes -w backend
npm run bootstrap -w backend
npm run worker -w backend
```

Backend output is `backend/dist/server.js`; model/service subfolders retain their
structure under `dist`. Builds clean only generated backend output. MongoDB data,
local `.env` configuration and uploaded images are not moved or reset.
