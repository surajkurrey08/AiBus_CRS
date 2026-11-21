# Own app and external app: public booking API rollout

## Current status (21 November 2026)

- Existing public API: authentication, authorized inventory, holds, quotes, bookings, Razorpay Test Mode payment/verification/recovery, tickets and cancellation requests.
- The portal regression now exercises actual payment endpoints with mocked provider responses, replacing its removed allowance-confirmation operation.
- New read-only `public:preflight` checks two independent app partners.
- Deployed baseline `d73ffc9`: healthy production services and a separate staging Test API with restricted MongoDB/Redis access. External token, cities, trips, seats and stops requests were verified on 20 November.
- The production Partner Portal originally could not generate isolated sandbox credentials or run its Playground. The new [private bridge](SANDBOX-PORTAL-BRIDGE.md) is implemented locally; it requires a reviewed coordinated release and private configuration before hosted acceptance testing.
- Available project metadata and accessible GitHub repository names did not identify the actual AIBUS customer app. The Operator/Admin/Partner frontends are not a replacement customer app. Other projects were not changed.

Verification: 400 workspace tests (64 Operator, 302 backend, 20 Admin, 14 Partner), 12 isolated browser tests, and 10 Postman/deployment tooling tests passed. All workspace/client TypeScript checks and changed TypeScript formatting checks passed. The full run used the cached MongoDB 7.0.14 disposable test binary. New API coverage verifies separate own-app/external-app bookings, cross-partner ticket/payment-recovery denial, occupied-seat rejection and read-only readiness behavior. Actual external checkout and hosted app integration remain unverified.

## Atlas isolation prerequisite (already provisioned for the deployed test service)

An Atlas database credential does not provide Atlas account/API authentication. Atlas does not support the MongoDB `createUser` command; use its UI or authenticated administration API.

1. Sign in to the correct Atlas project, then open **Database Access / Database Users**.
2. Add a password-authenticated user, for example `aibus-public-test`.
3. Assign **Specific Privileges**: `readWrite` on database `aibus_public_sandbox_apps`, all collections within that database. Do not grant Atlas Admin or access to every database.
4. Restrict access to the intended cluster where supported. Retain the approved network policy; do not add `0.0.0.0/0` for this rollout.
5. Save its URI privately, specifying `/aibus_public_sandbox_apps`. URL-encode special password characters. Never paste passwords into chat or export populated secret environments.

Provision collections/indexes separately after configuration review. Do not copy/reset production data.

References: [Atlas database users](https://www.mongodb.com/docs/atlas/security-add-mongodb-users/), [createUser restriction](https://www.mongodb.com/docs/manual/reference/command/createuser/).

## Deployment prerequisites

Use existing `docker-compose.public-test.yml` and [deployment instructions](DEPLOYMENT.md#optional-partner-integration-test-api).

| Setting | Dedicated test value |
| --- | --- |
| MongoDB | TLS, restricted user, database `aibus_public_sandbox_apps` |
| Redis | TLS, persisted `aibus-public-test` ACL user |
| Signing | Separate random dashboard/public JWT keys, distinct from production |
| Razorpay | Test key ID and matching secret; no live keys |
| Environment | `NODE_ENV=staging`, `PUBLIC_API_SANDBOX=true`, `FINANCE_TEST_MODE=true` |
| Redis prefix | `aibus:public-test` |
| VPS private file | `/opt/bookmybus-crs/shared/public-api-test.env`, mode 0600, deploy user |

Publish the exact tested release through the existing protected workflow so the new route and Compose file exist on the VPS. Selected test base: `https://partner.bookmybus.pro/api/v1/public`. Do not change the production API database or enable sandbox flags in its environment.

## Two independent partners

Use the existing reviewed onboarding workflow for one owner-app partner and one external-app partner. Give each its own expiring credentials and scopes. Grant reviewed inventory with explicit operator test opt-in, active buses/routes, future open trips, fares and cancellation/accounting policies. Never share one credential across companies.

## Read-only preflight

From a configured isolated backend environment:

```sh
npm run public:preflight -w backend -- --partner partner_OWN_APP --partner partner_EXTERNAL_APP
```

In the compiled test container, run `node dist/scripts/public-readiness.js` with the same arguments. The command rejects production/non-sandbox settings before connecting, disables automatic collection/index creation, and checks transaction capability, public unique indexes, test payment settings, Redis connectivity, both partner approvals/scopes/current credentials and sellable authorized trips with correctly owned active buses/routes.

It exits nonzero for missing prerequisites and never repairs data, issues credentials or prints connection secrets. Output includes public partner IDs and counts only. A passing check is not proof of actual checkout, Redis ACL restrictions, backup recovery or production readiness.

## Acceptance sequence

1. Verify externally reachable test OpenAPI matches deployed source; obtain separate app tokens.
2. For each app: cities, search, seats, quote, hold, hold-bound quote, pending booking.
3. Create a test order, complete actual Razorpay Test Mode checkout, verify its returned payment ID/signature. Application code must not fabricate payment evidence.
4. Retrieve each ticket; deny cross-partner ticket/payment-recovery access.
5. Reject rebooking occupied seats; repeated verification must retain the same ticket. Expired ownership must not affect replacement holds.
6. Verify timeout recovery and cancellation review/test refund processing. Requested cancellation is not a completed refund.
7. Connect actual app backends using `integrations/public-api/client.ts`, keeping credentials server-side and preserving write keys/references across retries.

Real payments/tickets and live production funding/settlement require a separate production-readiness review. Sandbox test success does not activate production.
