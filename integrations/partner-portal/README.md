# Partner web API contracts

Base path: `/api/v1/partner`. This uses existing dashboard bearer sessions with `X-Aibus-Client: partner`, separate from `/api/v1/public` machine credentials. Refresh/logout use the existing `/api/v1/auth` endpoints and `aibus_partner_refresh` HttpOnly, SameSite Strict cookie. Access tokens stay in memory; permitted origins are checked on unsafe browser requests.

| Method / path | Purpose |
| --- | --- |
| POST `/applications` | Strict company/owner registration; `submit:false` returns a private draft submission token once |
| POST `/applications/:publicId/submit` | Consume a nonexpired draft token; no organization session required |
| GET `/overview` | Actual organization status, usage, grants, bookings, webhook counts and activity |
| GET/POST `/credentials` | Safe metadata / reviewed issuance or atomic rotation via `rotateId` |
| POST `/credentials/:publicId/revoke` | Reviewed owned credential revocation |
| GET `/inventory` | Existing platform grants and Phase 7-authorized eligible trips |
| GET `/documentation` | Existing compiled Public API OpenAPI document |
| GET/POST `/playground` | Fixed operation allowlist / local sandbox execution |
| GET `/usage`, `/usage/summary`, `/usage/export` | Scoped paginated request metadata, aggregates and bounded CSV |
| GET `/bookings`, `/bookings/:publicId` | Owned sandbox bookings; passenger names/seats require an additional permission |
| GET/POST `/webhooks` | Subscription metadata / reviewed registration and one-time signing key |
| POST `/webhooks/:publicId` | Reviewed `enable`, `disable`, `rotate` or `test` action |
| GET `/deliveries` | Safe delivery attempt metadata |
| POST `/deliveries/:id/retry` | One reviewed extension from five to at most ten cumulative attempts |
| GET/POST `/team` | Organization memberships / reviewed member creation |
| POST `/team/:id` | Reviewed membership change; revokes sessions and member-created keys |
| GET/POST `/settings` | Company details / reviewed allowed-field update |
| GET/POST `/support` | Scoped support threads / deduplicated request creation |
| GET `/integration-status` | Honest sandbox readiness and disabled production capabilities |

Reviewed mutations accept `password`, `reason` and a stable UUID `key` alongside their strict business fields. Never send `partnerId` to establish authorization. Keys are namespaced in the existing PartnerCommand collection. A completed reviewed-command retry returns 409 `COMMAND_ALREADY_APPLIED` with no raw secret; mismatched input conflicts. Support requests return their existing record for matching retries. Existing public booking/idempotency contracts are unchanged.

List queries: `page` (1–10000), `limit` (1–100), optional bounded `search`, `status`, `from`, `to`, `endpoint`. Usage filters apply IST event dates, exact endpoint templates and HTTP status; CSV has a 5000-row cap and formula-neutralized cells. Metric payloads contain no API request/response bodies.

Playground example:

```json
{
  "operationId": "seatHold",
  "params": { "id": "<authorized-public-trip-id>" },
  "query": {},
  "body": { "seats": ["L1"] },
  "idempotencyKey": "<stable-uuid-for-this-operation>"
}
```

The backend creates a short-lived backend-only credential, invokes the existing Public API router locally, captures its actual sanitized response, then revokes that credential. No caller-supplied URL, HTTP method, headers, cookie or access token is forwarded. Authentication-token issuance is not a playground operation. Ticket retrieval also requires `partner:passengers`.

## Super Admin

Base `/api/v1/platform/api-partners`: GET list; GET `/:id` application evidence, usage, safe credential metadata, inventory, own bookings, failures, support and audit; POST `/:id/review`; POST `/:id/grants`; POST `/:id/credentials/:publicCredentialId/revoke`; POST `/:id/support/:supportId` for reviewed responses. Read and write require explicit platform partner permissions. Review also requires the current application `version`, a reason and the administrator's password. Resource ownership is validated when granting operator/route/service/trip inventory.

## Membership policy

| Role | Effective access |
| --- | --- |
| Owner / Admin | Organization operations, reviewed key/team/webhook/settings changes, passenger access; only Owners may appoint/change another Owner |
| Developer | Documentation, playground, inventory, usage, support, reviewed credentials/webhooks; no team/settings writes or passenger-reading scope |
| Finance Viewer | Overview, safe bookings, usage/export, documentation, support read |
| Read Only | Overview, inventory, documentation, safe bookings, webhook/usage/team/support read; no keys, playground, export or writes |

All roles are bounded by approved organization scopes and current Phase 7 inventory grants. Organization members cannot approve their own company, broaden platform scopes, change limits or grant inventory. Strong password re-verification is implemented; MFA enrollment is unavailable.
