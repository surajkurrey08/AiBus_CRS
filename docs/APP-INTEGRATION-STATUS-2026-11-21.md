# App integration implementation status — 21 November 2026

## Six requested work items

| Item | Evidence and status |
| --- | --- |
| Partner credential generation | Implemented and regression-tested locally. The production portal authenticates the actual member and current password, then sends a short-lived body-bound service proof to staging. Per-company isolated identities, one-time secret delivery, serialized idempotent issue/rotate/revoke and current-source authorization are covered. Hosted deployment is pending explicit approval. |
| API Playground | Implemented the private connection to the existing sandbox engine, preserving the existing UI and operation allowlist. The browser receives no bridge secret or ephemeral API credential. Inventory, overview, integration status, bookings and usage reads follow the same isolated connection. Hosted acceptance follows release. |
| Hosted Razorpay booking | Existing order/verification/reconciliation contracts and automated mocked-provider hold-to-ticket workflows pass. Actual hosted Test Mode checkout and ticket retrieval have not been executed; genuine checkout evidence is required. |
| Seat locking and duplicate prevention | Existing reservation regression suite passes, including occupied seat rejection, replacement holds, late-payment ownership, duplicate confirmation and partner isolation. The full actual hosted paid-booking scenario remains unverified until checkout is completed. |
| Integration handover | Updated 35-page PDF, HTML, current 22-operation OpenAPI, guided 25-request Postman collection, blank-secret environment, quickstart, result template and server-side client packaged together. Private populated app environments and credentials are excluded. |
| Actual customer/Travel Agent app | Blocked: no identifiable source in the available AiBus folder, CRS branches or accessible account repository names. The only matching accessible repository was AiBus_CRS; its maintained frontends are Operator, Admin and Partner. The older gaurav branch has Operator/Admin code, not the missing app. Unrelated GoAirClass projects were not modified. Required input is the actual application folder path or repository access. No replacement app was created. |

## Verification

- Full workspace suite: 414 passed (Operator 64, backend 316, Admin 20, Partner 14), exit 0. Includes 14 new private-bridge regression tests.
- Existing isolated browser suite: 12 passed, exit 0. It does not claim to exercise the newly deployed bridge or an actual hosted checkout.
- Postman/deployment tooling: 10 passed.
- All workspace TypeScript checks, changed-file ESLint/Prettier checks and backend build passed.
- The first GitHub CI run exposed a focus-transition race in an existing Operator registration test. The test now waits for the scheduled heading focus before typing; its six authentication cases pass locally. Product authentication behavior was not changed, and a fresh exact-revision CI gate is required before deployment.
- Final policy review added immediate enforcement of reduced control-plane request limits for existing tokens. The 15 bridge tests and 33 public API integration tests pass together; fresh exact-revision CI is required for this correction.
- A genuine hosted sandbox payment attempt reached pending booking creation, but the gateway rejected the configured key pair with RAZORPAY_AUTH_FAILED. No gateway order, payment evidence or PNR was created. The expired booking was marked Failed and its L1 seat returned to available. Existing production partner records were not changed. Actual checkout completion needs a valid matching test key pair.
- External Test API reverified at https://partner.bookmybus.pro/api/v1/public: both existing app partners returned 200 for token, capabilities, cities, trip search, seats and stops; tokens expire in 300 seconds.
- Production/public guard reverified: OpenAPI 200 with version 1.0.0-test; token exchange 503 PUBLIC_API_DISABLED. This is intentional.
- Existing deployed baseline remains d73ffc9. All four sites/readiness checks returned 200. No live configuration or database was changed during this implementation.
- PDF: 35 rendered pages, 22 operations, 34 syntactically valid JSON blocks, no detected page bounds/HTML overflow issues. Changed availability sections were visually inspected.

## Files and release boundary

New modules: sandbox-bridge.transport.ts, sandbox-portal.service.ts, sandbox-portal.routes.ts and sandbox-bridge.test.ts. Existing configuration, app wiring, partner routing, public authentication, Playground service, partner provenance schema and BookMyBus gateway routing were extended. See SANDBOX-PORTAL-BRIDGE.md for exact configuration, acceptance checks and rollback.

No dependencies were installed, no production migration/reset occurred, no payment success was fabricated, and no unrelated frontend or project was changed.

## Next release decision

Explicit approval is required before changing the production environment or deploying this release. The proposed scope is the tested source release, a distinct private bridge signing key in the two existing backend environment files, the production API, isolated Test API and BookMyBus gateway through the existing protected pipeline. Production public booking stays disabled. No shared proxy configuration rewrite, live payment enablement, production inventory copy or database reset is included.

After approval and hosted credential/Playground acceptance, complete genuine Razorpay Test Mode checkout and provide the actual app source before claiming all six items complete.
