# Finance integration and rollout reference — 18 November 2026

All JSON endpoints retain the existing `{data, meta?}` envelope and authenticated session. Amounts are non-negative safe integer INR paise; reports may show signed balances. A selected identifier is a filter, never proof of authorization. Unknown request fields are rejected. Operators derive their tenant from authentication; agencies derive tenant and canonical SalesPartner membership server-side. Super Admin finance is opt-in through `platformFinanceRead`, with separately provisioned `platformFinanceActions`. Existing staff management cannot grant these platform actions.

## Wallet and credit — 4B

Operator prefix `/api/v1/operator/finance`:

| Method / suffix | Contract |
|---|---|
| GET / PUT `policy` | Runtime availability; versioned operator test custody/wallet/credit configuration. Changes require reason and finance:manage. |
| GET `wallet-summary` | Owned prepaid liabilities, reservations and credit exposure; no client balances. |
| GET `wallets` | Page, limit, search, status. |
| POST / GET `wallets/:agentId` | Create/read an owned agency wallet; creation is idempotent by ownership. |
| PATCH `wallets/:agentId/status` | Active/Suspended with reason. |
| PUT `wallets/:agentId/credit` | Limit in paise, status, reason and Idempotency-Key. A credit limit is not a deposit. |
| POST / GET `wallets/:agentId/funding` | Purpose Wallet/Credit repayment, amountPaise and stable Idempotency-Key; list/status retrieval. |
| POST `wallets/:agentId/funding/:intentId/review` | `{action:"Verify test evidence"|"Confirm"|"Reject",reason}`; only server test evidence can confirm funding. |
| GET `wallets/:agentId/credit/history` | Immutable authorization history. |
| GET `wallets/:agentId/transactions` | Owned wallet/credit ledger lines. |
| GET `wallets/:agentId/statement.csv?from=YYYY-MM-DD&to=YYYY-MM-DD` | Authorized bounded CSV, paise columns, formula neutralization. |

Agent prefix `/api/v1/agent/wallet`: GET the prefix root (wallet balance), POST/GET `funding`, GET `funding/:id`, GET `credit/history`, GET `transactions`, GET `statement.csv`; POST `reservations` with `{bookingId,mode:"wallet"|"credit"}` and Idempotency-Key; GET/DELETE `reservations/:id`; POST `reservations/:id/confirm`. Wallet and credit grants are explicit opt-in. Original booking/hold expiry and payable snapshots are authoritative. Mixed gateway/wallet/credit funding is rejected.

## Cancellation and recovery — 4C

Operator prefix `/api/v1/operator/finance`; platform prefix `/api/v1/platform/finance`:

| Method / suffix | Purpose |
|---|---|
| GET/PUT `cancellation-accounting-policy` | Operator only; enabled, refundBasis, taxTreatment, chargeTreatment, commissionTreatment, allowExceptionRefunds, current version and reason. Explicit component treatment required to enable. |
| POST `bookings/:id/cancellation-quote` | Full booking by default or complete seat list; partial scope rejected. Snapshot components/expiry returned. |
| GET `bookings/:id/refund-status` | Booking, payment and actual refund state remain distinct. |
| GET `cancellations`, `refund-intents`, `exceptions` | Page/limit/search/status/from/to. |
| GET `refund-intents/:id` | Durable intent, fixed original funding source, verified reference and attempt history. |
| POST `cancellations/:id/review` | `{action:"Accept"|"Reject",quoteId?,reason}`; Accept requires a fresh explicit quote and test execution. |
| POST `refund-intents/:id/process` | Empty body; process/reconcile an already-approved fixed intent, never a supplied amount. |
| POST `refund-intents/:id/recheck` | `{reason}`; authorized bounded retry cycle, same request/key. |
| GET `exceptions/:id` | Read-only matched payment evidence. |
| POST `exceptions/:id/review` | `{action:"Acknowledge"|"Approve test refund"|"Resolve verified refund",reason}`. Resolution requires a posted verified refund. |

Agent `/api/v1/agent/bookings/:id/cancellation-quote` and `refund-status` expose only own agency bookings. Existing cancellation request routes are retained. Existing operator refund process route delegates approved workflow intents; unapproved legacy records fail closed. Verified raw-HMAC Razorpay refund callbacks re-fetch provider evidence. Real refunds remain disabled. Approved cancellation does not mean refunded.

## Settlements and reports — 4D

Read prefixes `/api/v1/operator/finance`, `/api/v1/platform/finance`, and scoped `/api/v1/agent/finance`:

| Method / suffix | Purpose |
|---|---|
| GET `settlements` | Page/limit, from/to, operatorId/agentId authorized filters, search by reference, exact workflow status. New workflow batches only. |
| GET `settlements/:id` | Claimed lines, approvals, payout and attempt evidence. |
| GET `reports` | Available report names and test/live availability. |
| GET `reports/:name` | Required from/to; page/limit, operatorId/agentId, status and search. Agency access restricted to own agency revenue/commissions. |
| GET `reports/:name.csv` | Same filters, full authorized bounded CSV. All monetary columns identify paise. |
| GET `reconciliation?operatorId=...` | Non-agency read-only consistency assessment; platform must select one operator. No balancing writes. |
| GET `audit` | Operator/platform permanent financial events; date/scope/search/paging. |
| GET `agencies?operatorId=...` | Operator/platform scope lookup; names/status only, up to 500. Operator context inferred. |

Existing `/api/v1/agent/settlements` now returns own agency batches within its existing envelope (`available`, `settlements`) and never operator batches. The external app has not been connected because its source is absent.

Platform-only mutations require explicit prepare/approve/payout action grants:

| Method / suffix | Body |
|---|---|
| GET / PUT `settlement-policy/:operatorId` | PUT `{enabled,treatment:"Unconfigured"|"Existing capture liabilities",funding:"Unconfigured"|"Simulated gateway receipts",version,reason}`. Disabled initially. |
| POST `settlements` | `{operatorId,kind:"Operator"|"Agency",agentId?,from,to,reason}` and stable Idempotency-Key (10–150 chars). Agency requires its owned agentId; Operator rejects agentId. |
| POST `settlements/:id/review` | `{action:"Submit"|"Approve",reason}`. A preparer cannot approve. |
| POST `settlements/:id/test-receipts` | `{reason}`. Explicit isolated receipt simulation, not bank funding. |
| POST `settlements/:id/authorize-payout` | `{reason}`. Requires independently approved batch and original payment receipt evidence. Preparer excluded. |
| POST `settlements/:id/process-payout` | `{reason}`. Lookup original simulator operation, submit at most one identity, independently verify then post. Preparer excluded. |
| POST `settlements/:id/reconcile` | `{reason}`. Append immutable assessment; never auto-adjust. |

Full payable lines are claimed, not arbitrary partial amounts. Partial/mismatched provider evidence becomes Manual review without a second payout/top-up. Commission-to-wallet settlement is unavailable, preventing double discharge of one obligation.

## Additive index rollout and recovery

No live migration or preflight was executed. `npm.cmd run finance:preflight -w backend` is read-only: autoCreate/autoIndex disabled, unique/partial/sparse compatibility and duplicate groups assessed, no apply mode. Review the `2026-11-18-finance-v2` output in a separately authorized maintenance window. Install additive indexes only after backup and replica-set validation; never drop/reset existing data. Legacy Settlement records are excluded from the new partial idempotency index unless they have an idempotencyKey.

Required uniqueness includes wallet/facility/policy ownership; booking funding reservation; funding operation/evidence identity; capture/payment posting; refund original payment and gateway identity; Settlement operator+operation key (partial); SettlementLine journal+account; approval batch+action; PayoutIntent settlement and operation key; simulator receipt per payment; simulator payout per intent/reference. Mutation services verify critical installed indexes and fail closed if absent.

Rollback is operational: disable FINANCE_TEST_MODE and the finance policy flags, retain all journals/claims/evidence, stop dispatch, and reconcile already-accepted operations. Do not delete claims or reset balances to retry an operation. The existing raw financial history middleware and production DB privileges must remain enforced. Manual historical/partial settlement adjustments, bank custody, actual receipt reconciliation, fees/tax changes, live refunds/funding/payouts need separate approved policies and implementation.

## Verification boundaries

Disposable MongoMemoryReplSet fixtures exercise transactions and database uniqueness. UI tests exercise permissions, review, retry identities and display, not browser E2E. Browser verification remains blocked by the CUA kernel initialization failure; Python static auditing was unavailable. No external Agent Dashboard, real bank, real charge or real refund was exercised. Production readiness also requires backup restore rehearsal, replica set/index rollout, least-privilege DB grants, finance role provisioning, monitoring and provider staging tests.
