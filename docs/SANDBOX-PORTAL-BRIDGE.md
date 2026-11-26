# Partner Portal to isolated Test API

Prepared 21 November 2026. Implementation status: local implementation and regression verification; not yet deployed.

## Architecture

Partner browsers continue signing in to the existing production Partner Portal. Team membership, current sessions, approval, passwords and business settings remain in the production control plane. The production API forwards allowlisted sandbox operations using a separate, short-lived, body-bound service proof. Passwords, password hashes, dashboard access tokens and refresh cookies are never forwarded.

The isolated staging backend creates one empty sandbox identity for each approved source partner public ID. It never copies production inventory, bookings, passengers, money or credentials. A separately reviewed sandbox inventory grant is still required. Existing standalone demo credentials remain compatible.

Every linked credential exchange and authenticated public request checks current source organization status, member status, scopes and request limit through the control plane. Effective requests per minute use the stricter current source/sandbox limit, including for existing access tokens. Revocation is effective for existing access tokens. Source suspension, member deactivation and bridge timeouts fail closed. A secret is returned once; metadata reads cannot recover it. Retrying an uncertain credential command with the same key cannot issue another secret.

## Operations covered

- Credentials: list, issue, rotate and revoke; issue/rotation/revocation require the current password verified by the production backend.
- Inventory Access, sandbox overview, integration status, booking list/detail and usage/CSV reads.
- Existing allowlisted Playground operations, including the existing central booking and test payment engine. Ticket access requires passenger permission.
- Team, application approval and company settings remain on the production control plane.

Webhook subscription management is not bridged in this change. The isolated Test API's signed webhook API behavior remains unchanged; production portal webhook settings must not be treated as sandbox settings.

## Private configuration and release

Generate a new random bridge secret of at least 64 characters. Store it only in both backend private environment files, never in Git, a browser setting, a PDF or a Postman export. Do not reuse MongoDB, Razorpay, dashboard JWT or public JWT credentials.

Production `/opt/bookmybus-crs/shared/api.env`:

```dotenv
SANDBOX_PORTAL_BRIDGE_SECRET=<separate-private-random-secret>
SANDBOX_PORTAL_URL=https://partner.bookmybus.pro
```

Staging `/opt/bookmybus-crs/shared/public-api-test.env`:

```dotenv
SANDBOX_PORTAL_BRIDGE_SECRET=<same-private-bridge-secret>
SANDBOX_CONTROL_URL=https://api.bookmybus.pro
```

Keep production `PUBLIC_API_SANDBOX=false`. Keep staging restricted to its existing test database and Redis namespace. The gateway forwards the exact `/internal/sandbox-portal/execute` and `/internal/sandbox-portal/inventory-execute` paths on `partner.bookmybus.pro` to staging; the production API receives signed entitlement checks. These endpoints are not customer APIs. HTTPS transport, a strict operation allowlist, 30-second purpose-bound body proofs, current backend authorization and rate limits protect them.

Deploy both backends and the gateway from the same tested release through the existing protected workflow. Back up private configuration before changes and retain the prior digest/release. No database reset or production data migration is required; the additional provenance field uses the existing unique partner public ID index. Do not set the bridge variables on an old image: old code ignores them and still cannot issue sandbox keys from production.

## Acceptance checks

1. Log in with an approved partner. An inactive company, unrelated role, expired session or incorrect step-up password must be denied.
2. Open API Credentials, generate a short-lived test credential, save the complete value privately, then refresh: only metadata is visible.
3. Open Inventory Access. A new company has no grants. In Admin → API Partners, assign a reviewed synthetic test trip with Manage inventory grant, then refresh the partner's inventory. The existing sandbox CLI remains an out-of-band recovery tool. Never grant production operators.
4. Exchange the credential at the Test API `/auth/token`; use the returned 45-minute token for cities, trips, seats and stops.
5. Run Playground capabilities and a granted trip request. The response must be from staging; the browser must receive no bridge secret or ephemeral credential.
6. Rotate/revoke the credential. Both the old credential and its existing access token must fail. Repeat the same credential command key: no extra credential is created.
7. Suspend the source company or deactivate the issuing member in isolated QA: existing tokens must fail. Restore only that QA identity afterward. Do not change a real company's status to test this.
8. Complete actual Razorpay Test Mode checkout, verify through the booking API, retrieve ticket/PNR, and attempt a second reservation for the occupied seat. No fake signature or paid flag is acceptable.

Actual hosted checkout and app integration require separate evidence; automated mocked gateway responses alone do not prove them.

## Admin inventory grants — 26 November 2026

Named inventory selection is available in Admin → API Partners → company → Manage inventory grant. Select a sandbox operator, resource type and resource, choose an expiry and access state, then provide the review reason/current password and confirm. Administrators no longer need to copy database IDs or run a VPS command for each grant. Existing synthetic inventory must still be provisioned; this flow never creates trips or grants access to ordinary production operators.

`GET /api/v1/platform/api-partners/:id/inventory-options` requires explicit `platform:partners:write`. Its strict query accepts `kind`, optional `operatorId`, `search`, `page` and `limit` (maximum 100). The production backend forwards this request to the existing sandbox host using a separate `inventory-execute` proof. Resource discovery stays inside the sandbox database and excludes ordinary operators, past/closed trips and inactive routes/vehicles. Route, Service and Operator grant scopes remain explicit alternatives to the default Trip scope.

The existing reviewed `POST /:id/grants` verifies the current admin password on the control plane. It strips the password and signs the exact selected partner, administrator, session and sanitized operation. No user-supplied host or HTTP operation is accepted. The sandbox calls the control plane's signed `inventory-entitlement` endpoint to recheck the active admin session, explicit partner read/write permissions, company approval and identity. Partner-member proofs are rejected by these separate purposes/audiences. Expired proofs, revoked sessions, disabled administrators, unavailable control transport and mismatched resource ownership fail closed.

Sandbox grants and their audit/command records are written in one transaction. Same-key retries return already-applied metadata; changed content under that key is rejected. Reads never create a grant. The company details drawer loads its actual sandbox grants, including existing CLI grants, rather than querying the production database for sandbox IDs.

Release the API for both backends and the gateway together. The gateway adds only the exact `/internal/sandbox-portal/inventory-execute` path on the partner hostname. Existing bridge secrets/URLs are reused, so no additional environment variable or database schema change is required. Retain the explicit database isolation and deployment/revision approval gates.

## Rollback

For a production/control-plane rollback, disable its bridge forwarding and redeploy the previous reviewed production release while retaining the new staging image. Linked sandbox credentials then fail closed when source entitlement is unavailable. Do not downgrade staging to an older image that does not understand partner provenance while linked credentials remain active: first revoke those linked sandbox credentials through reviewed, audited operations. Do not drop test collections, remove audit history, disable production guards or restore a database snapshot over newer business data.
