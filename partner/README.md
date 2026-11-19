# AIBUS API Partner Platform — Phase 8

Separate React/TypeScript workspace for approved external API companies. This is not an operator-owned travel-agent dashboard.

From the repository root:

```powershell
npm.cmd run dev:partner
```

Open `http://127.0.0.1:5176`. The development proxy uses the existing backend on port 4000. Override `VITE_API_TARGET` only when intentionally using a separate isolated sandbox backend.

The backend must have `PARTNER_WEB_ORIGIN=http://127.0.0.1:5176`. Public API execution additionally requires a dedicated `aibus_public_sandbox_*` MongoDB replica-set database, Redis, `PUBLIC_API_SANDBOX=true`, a separate public API JWT signing secret, reviewed additive indexes, explicitly sandbox-enabled operator inventory, and platform inventory grants. Never point the public sandbox at your ordinary/live CRS database. See [the Phase 8 report](../backend/PARTNER-PLATFORM-PHASE8.md).

If registration/login reports `ORIGIN_REJECTED`, confirm the Partner origin in `backend/.env` and restart the backend. `npm start` runs the built `backend/dist/server.js`; editing source or rebuilding does not reload an already running process. Rebuild with `npm.cmd run build -w backend`, then restart that local backend from its directory. Do not disable origin/CSRF checks or rewrite the browser origin in the Vite proxy. An anonymous refresh returning 401 is expected; a valid Partner origin must not be rejected with 403.

The registration screen now groups company and integration details, supports explicit password visibility, preserves form data after errors and accepts a blank optional company-registration field. Pending applications can be opened for Super Admin review without attempting authorized trip discovery first. Follow-up validation: 38 focused backend tests, 8 Partner component tests, 10 isolated Chrome tests, and Partner/backend builds passed. These follow-up checks supplement the Phase 8 baseline; they are not a new claim that every workspace test was rerun for this UI fix.

Registration creates a Draft or Submitted application and an inactive owner in the existing User collection. Super Admin approval is required before login. Approval grants no inventory, scopes, production credentials or real funding automatically. A Production request is a review preference only.

## Source organization

| Folder | Responsibility |
| --- | --- |
| `src/api` | Partner web authentication, in-memory access token and refresh-cookie client |
| `src/components` | Shared portal loading, safe facts and one-time secret display |
| `src/features/auth` | Company registration, login and existing password reset flow |
| `src/features/workspace` | Organization-scoped operational pages |
| `src/features/developer` | Compiled OpenAPI documentation, examples, scenario guide and playground |
| `src/features/usage` | Usage filters, analytics and permission-controlled CSV |
| `src/config.ts` | Presentation role/scope choices; backend remains authoritative |

Panel, Overlay, reviewed forms and tables reuse the Admin application's canonical components. Runtime brand tokens are imported from `admin/src/styles/theme.css`; this workspace has no competing color system.

```powershell
npm.cmd test -w partner
npm.cmd run build -w partner
npm.cmd run test:e2e:isolated
```

The isolated browser command creates its own temporary MongoDB replica set and labeled Redis container. It does not use user database credentials or payment keys. The wrapper cleans up only that run's Redis container.

Passwords, JWTs, new API credentials, signing secrets and privileged drafts are never written to localStorage or URLs. Newly issued secrets are visible once in a masked dialog; closing it clears page state. Keep machine credentials in a server secret manager. Team initial-password delivery and SMTP configuration remain administrator responsibilities; the UI does not pretend to send invitations.
