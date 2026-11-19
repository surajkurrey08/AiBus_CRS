# Repository deployment audit — 19 November 2026

This is a source/local-validation audit. No VPS login, production deployment,
shared reverse-proxy change, firewall change or database migration was performed.

## What the repository actually contains

| Area | Observed implementation | Deployment consequence |
| --- | --- | --- |
| Applications | npm workspaces: `frontend`, `admin`, `partner`, `backend` | Build all four with the single root lockfile. |
| Operator/Admin/Partner | React 19, TypeScript 5.7, Vite 6; API calls use same-origin `/api` | One production gateway chooses each built panel using its exact Host header. No API secret is a frontend build argument. |
| Backend | Express 5, TypeScript ESM, Node 24; `backend/dist/server.js` | Non-root API image; production port 4000 is internal only. |
| Persistence | Mongoose/MongoDB transactions, Redis rate limiting and Socket.IO adapter | Use authenticated replica-set/Atlas MongoDB and a dedicated authenticated TLS Redis endpoint. No production database containers are introduced. |
| Jobs | Existing server executes operational jobs every 10 seconds | One API replica initially; preserve existing leased-job mechanisms. No new duplicate worker process. |
| Configuration | `backend/src/config/env.ts` rejects unsafe production origins, unauthenticated MongoDB, non-TLS Redis, sandbox mode and finance test mode | Synthetic CI configuration tests reuse this validator. Runtime validation happens before container rollout. |
| Health | `/health/live`; `/health/ready` checks Mongo connection and Redis PING in `server.ts` | Compose waits for API readiness; deploy verifies readiness through the gateway and each panel's commit revision. |
| Tests | Vitest unit/integration suites with MongoMemoryReplSet; separate isolated Playwright harness with temporary Redis | Tests do not use the production `.env` or Atlas database. Browser CI installs Chrome and runs the existing isolated suite. |
| Existing Docker | Original image omitted Partner workspace and served only Operator | Dockerfile now includes all workspaces and separate production gateway. Existing `web` development target and development Compose remain supported. |
| Existing development infrastructure | `compose.yaml` / `compose.dev.yaml` | Not reused for production; no implicit Mongo/Redis bootstrapping in production. |
| Source remote | `surajkurrey08/AiBus_CRS` on GitHub | GHCR repositories: `ghcr.io/surajkurrey08/aibus_crs-api` and `...-web`. No VPS Git checkout. |
| Agent frontend | Actual AIBUS Travel Agent frontend source remains unavailable | No Agent site is fabricated or deployed. |

## Production requirements not established by this audit

- VPS identity, OS version, x86_64 architecture, Docker/Compose versions and actual available resources.
- Port 5020, directory `/opt/bookmybus-crs`, project name, network and upload-volume uniqueness.
- Existing edge proxy's mounted include/certificate paths, network ownership and domain conflicts.
- DNS, SAN certificate issuance/renewal and external HTTPS routing for all four domains.
- Dedicated Redis TLS endpoint; do not reuse another application's Redis or weaken the runtime validator.
- MongoDB replica-set health, least-privilege credentials, unique indexes, Atlas allowlist and backup/restore drill.
- GitHub branch protections, production environment reviewers/plan support, SSH credentials and GHCR read access.
- Payment/webhook/email production configuration and business approval to accept real payments. Test keys remain test keys; this pipeline does not activate live payment functionality.
- Public API sandbox requires a separately isolated deployment/database; this production stack deliberately keeps `PUBLIC_API_SANDBOX=false`.

## Dependency and lint baseline

The existing installation reports four advisory-bearing packages: Vitest (critical),
Tinypool (critical), Vitest mocker (moderate), and Zod (high). The first three are
test tooling; Zod is a runtime dependency. npm proposes major upgrades (Vitest 5,
Zod 4), which are not silently applied in an infrastructure change. Resolve or
formally assess these before approving production. CI runs trusted repository
test code on fresh hosted runners, never `pull_request_target` with secrets.

Lint uses ESLint's recommended JavaScript correctness rules with the TypeScript
parser. Type-aware validation is the separate strict TypeScript gate. Existing
initialization style is exempted; deliberate control-character rejection regexes
and one existing test-file BOM have narrowly documented exemptions. This is not
a full stylistic reformat or a claim that every historic lint convention is fixed.

## Isolation boundary

Only `bookmybus-crs` resources may be managed by the new release scripts. Scripts
check existing named network/volume Compose ownership. They never run global
prune, Compose down, volume removal, daemon restart or other-app lifecycle commands.
The shared edge proxy change is a review-only proposal, absent from the deploy
archive. The OnlineGo checkout and its environment backup are never accessed.
