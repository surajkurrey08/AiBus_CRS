# Operational reliability implementation notes

19 November 2026. These Phase 6 prerequisites were completed/verified while the user steered the ongoing work to Phase 7. They extend existing modules; they do not establish production certification or complete browser acceptance.

## Architecture and changes

Previously, the API server's interval used only a process-local busy flag and the one-shot recovery worker invoked the same services independently. MongoDB booking/financial ownership was already protected, but multiple processes could schedule the same logical recovery work. Existing operational stages were Scheduled → Boarding → Departed → Arrived → Completed, while GPS was configuration-only and earlier browser specs were incomplete.

New shared services/models:

- `models/operations.model.ts`: unique logical OperationalJob, durable OperationalJobRun, scoped OperationalIssue and idempotent TripIncident.
- `services/job-runner.service.ts`: conditional MongoDB lease acquisition, unique run token, heartbeat/expiry, restart recovery, bounded failure count/backoff and Manual review stop. Required lease uniqueness fails closed if absent.
- `jobs/operational.jobs.ts`: one schedule over existing hold expiry, Razorpay reconciliation, wallet expiry, refund reconciliation, external status observation, integrity scans and optional notification/outbox work. API interval and one-shot worker reuse it.
- `services/operations-integrity.service.ts`: transactional read-only trip/hold/booking/ticket checks, durable deduplicated observations and reuse of existing ledger verification. Confirmed bookings backed by consumed holds are valid; they must not become false discrepancy alerts.
- `services/observability.service.ts`: bounded per-process 60-minute request/failure/slow/booking-conflict counters and correlation-safe threshold logs; local Socket.IO connection/configuration observations.
- `services/operations-report.service.ts`, `routes/operations.routes.ts`: permission/tenant-scoped diagnostics, integrity, incidents, operational reports and reviewed job rearming.
- `scripts/operations-readiness.ts`: read-only index/conflict/query-plan assessment, with a separate explicitly acknowledged sandbox-only apply mode.

Existing recovery functions were reused, including durable expired Hold enumeration and replacement-seat protection, financial exception/retry records and wallet expiry. Final booking/financial correctness remains in conditional MongoDB updates/transactions. Redis coordination is not substituted for those protections. No source booking, ticket or financial history is rewritten by integrity scans.

## Lifecycle and devices

Trip.status keeps the existing four canonical reservation states. Trip.operationStage now supports Boarding (the existing boarding-open spelling), Boarding Completed, Departed, In Transit, Arrived and Completed. Legacy safe Boarding → Departed and Departed → Arrived calls remain compatible. New UI follows the finer sequence. State order, actual timestamp chronology, optimistic version, internal ownership and idempotency are validated server-side. Boarding completion closes new sales; departure/arrival timestamps and odometer/fuel rules are retained. Departure verifies the assigned bus and any configured crew are active; it does not invent or silently require missing crew.

The existing empty-trip cancellation and passenger check-in rules remain. Incidents record owned internal-trip actual time/reason/actor with request identity and audit. Tracker shows current assigned crew/tablets and incident history. Existing tablet ownership, active status, crew association and unique active assignment controls are reused. Bus GPS mappings are real configuration records; no live GPS/Revmax transport or coordinates were invented. A production telemetry adapter still needs authorized provider documentation/credentials and a validated ingest contract.

## Endpoints and UI

Operator prefix `/api/v1/operator/operations`: GET /issues, /trips/:id/integrity, /trips/:id/incidents, /reports/:name and /reports/:name.csv; POST /trips/:id/incidents requires routes:write. Operator A cannot select Operator B through query/body identifiers. Agency users cannot enter the operator routes.

Platform prefix `/api/v1/platform/operations`: monitor-permitted GET /health, /jobs, /issues, scoped /trips/:id/integrity and /trips/:id/incidents. Reports additionally require platform:reports:read. Financial observations require explicit finance-read. POST /jobs/:id/rearm is limited to platform:settings:write, current-password verification, a reason and a Manual review job; audit/run history is preserved. No arbitrary financial operation can be re-executed by that command.

Admin Buses & Trips gains compact health/job/exception panels using existing Panel/Evidence/PlatformTable/FinanceReviewForm. Operator Trip Master gains finer progress, crew/tablet/incident visibility, an explicit integrity check and detailed operational reporting through shared MasterForm/table patterns. Existing brand colors/navigation are preserved. Operational issues are read-only observations; the UI does not offer source-data repair or unavailable issue CSV export.

Fifteen report projections: daily trips, scheduled/completed evidence, departure delay, arrival delay, bus utilization evidence, occupancy, route performance, boarding counts, cancellation trends, fuel expenses, distance, mileage, stoppage duration, crew assignments and booking source. Date/operator/trip/search/paging/CSV filters apply. Fuel expenditure requires finance permission; accounting revenue remains in the Phase 4 ledger reports. Missing actual measurements return null, not zero. Utilization is per-trip evidence, not a fabricated fleet-hour percentage. Canonical report calculation reuses tripMasterReport and actual inventory/booking/check-in records.

## Monitoring and recovery limits

Config defaults: OPS_SLOW_MS=1000, OPS_STUCK_MS=900000, OPS_JOB_LAG_MS=180000. Logs/counters use request IDs and safe codes; request bodies, passenger records, passwords, tokens and provider secrets are not metrics labels. Readiness exceptions fail closed with 503, without connection details. Admin diagnostics describe MongoDB/Redis dependency readiness, job ownership/lag, recent runs and local WebSocket configuration. Adapter configuration and local connection counts are not proof of remote notification delivery.

Leases are at-least-once scheduling, not an exactly-once distributed execution claim. Heartbeat loss fences job completion metadata and aborts scan checkpoints; a process paused beyond its lease may have already started a domain operation. Existing reservation/financial idempotency and ownership checks remain the final safety mechanism. Integrity scans can be expensive at scale; they do not automatically correct records. Missing worker indexes stop acquisition. Failed/exhausted jobs remain visible and require reviewed rearming. External monitoring/alerting infrastructure, service SLOs and disaster-recovery drills have not been configured or verified.

Additive indexes cover tenant trip/status/departure, booking trip/status, hold status/expiry, pending payment reconciliation, job ownership/run history, issue identity and incidents. Existing indexes are not dropped. Preflight can show an empty-scope query plan, which is not a production workload benchmark. No live script was run.

## Validation and outstanding acceptance

The existing main integration file includes Phase 6 tests and is preserved. An additional `tests/integration/operations.test.ts` has 18 focused cases for leases/restart/backoff/index safety, lifecycle/version/idempotency, active bus verification, cancellation restriction, integrity/expiry/replacement ownership, issue deduplication/tenant/finance isolation, fifteen reports/CSV, readiness, devices, incidents and non-mutating scans.

The isolated browser runner now uses system Chrome, separate ports and disposable MongoDB/Redis. `npm.cmd run test:e2e:isolated` uses a wrapper which labels and verifies its own Redis fixture before cleanup. Four smoke tests passed. Complete booking/payment/cancellation UI E2E, all creation flows and session/tenant UI coverage remain outstanding. Original browser placeholder specs were not presented as working flows.

No production deployment, live migration, real payment/refund/payout, source-history reset or missing Agent Dashboard recreation was performed. Full validation counts and current dependency advisories are included in PUBLIC-API-PHASE7.md. No claim is made that Phase 6 production/browser acceptance is complete.
