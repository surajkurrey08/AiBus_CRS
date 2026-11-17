# Aibus admin panel

Standalone React application for platform administrators.

- `src/app/` handles session restoration and administrator access.
- `src/api/` handles authenticated HTTP requests and API errors.
- `src/features/auth/` contains administrator login.
- `src/features/operators/` contains overview, operator directory, company details and status review.
- `src/components/ui/` contains Panel and Overlay components.
- `src/styles/` owns the admin application theme and base controls.
- `src/tests/` verifies login, operator details, status changes, filters and error recovery.

From the repository root, run `npm run infra:up`, `npm run dev:backend` and `npm run dev:admin` in separate terminals. Open `http://127.0.0.1:5174` and sign in with a platform administrator account. The operator application runs separately at `http://127.0.0.1:5173` using `npm run dev:frontend`.

The backend exposes admin APIs under `/api/v1/platform`. Admin and operator logins use separate refresh cookies. Configure `ADMIN_WEB_ORIGIN` for a deployed admin origin. Local development permits `http://127.0.0.1:5174` by default. Account passwords are stored as hashes in MongoDB.

Operator approval, suspension and rejection require explicit confirmation. The admin application shows company contact details and fleet/route/trip counts. Operator business workflows remain in the operator application.
