# Phase 4A — financial ledger foundation

## Existing architecture and accounting boundary

CRS remains a modular Express/TypeScript application using MongoDB transactions and Redis. Booking stores integer-paise pricing and commission snapshots. Payment stores captured/failed evidence with a unique provider/external payment ID. PaymentOrder serializes gateway order/capture attempts and uncertain outcomes. WebhookEvent deduplicates provider events. Confirmation conditionally claims the original hold/seats and creates a ticket in a transaction. Razorpay network calls run before that transaction. Cancellation/Refund describe requests and provider states; Settlement describes separately recorded settlements. A captured payment does not prove a bank settlement.

Before this phase there was no balanced journal, account ownership, accounting-operation identity or balance projection. Commission reports are eligibility summaries from bookings, not a financial ledger. Existing commission calculation now uses BigInt basis-point multiplication and half-up integer division, preserving ordinary-price rounding while avoiding unsafe floating-point multiplication.

New flow: verified gateway capture → existing payment/booking/seat transaction → payment-clearing debit plus payable or suspense credits → journal, operation, projections and permanent audit → majority commit. Any accounting failure aborts the entire transaction. Provider confirmation cannot be acknowledged as successful until it commits. No gateway call moved into a transaction, and no pending/failed payment is treated as collected funds.

## Models, ownership and indexes

| Model | Purpose | Important indexes |
|---|---|---|
| LedgerAccount | Operator partition, owner scope/ID, chart code, type, INR currency | Unique operator + ownerType + ownerId + code + currency |
| JournalEntry | Posted event with embedded JournalLine records, booking/payment/event references, version and reversal link | Unique operationId; unique sparse reversalOf; unique paymentId for capture/exception kinds; operator/date, operator/account/date, operator/payment lookup |
| FinancialOperation | Immutable operation key, canonical payload SHA-256, journal and actor | Unique operator/idempotencyKey; unique journalId |
| AccountBalanceProjection | Transactional cumulative debit/credit paise and CAS version | Unique accountId; operator lookup |

JournalLine is embedded rather than stored as a separate collection. A maximum of 100 consolidated account lines is validated, persisted and reversed together. Every line has exactly one positive side; total debit equals total credit. All new money calculations use BigInt and convert to Number only after checking the safe integer range. Currency is INR only. Projections cannot overflow on accumulation. Their version counts postings touching that account.

Accounts use a controlled server-side chart:

- Platform / payment-clearing / Asset, partitioned by operator. This is a gateway receivable, not bank cash.
- Platform / payment-exceptions / Liability, partitioned by operator, for late captured funds requiring reconciliation.
- Operator / operator-payable / Liability, owned by that operator.
- Agent / agent-commission-payable / Liability, owned by a canonical SalesPartner of kind Agent under the same operator.
- Platform / platform-commission / Revenue is reserved in the chart. No booking posts it because no authoritative platform fee configuration/snapshot exists. Booking platform commission is explicitly zero; changing that requires an approved accounting policy and a snapshotted fee source.

ApiPartner is a reserved ownership scope in the account schema, but posting accounts for it is rejected. No wallet, credit, bank payout or API partner access is enabled. Branch commission is not treated as an agency liability; it remains inside the operator payable until a branch accounting design is approved.

Account ownership, journals and financial operations reject Mongoose save modifications, updates, replacements, deletes, bulk writes and insertMany bypasses. Corrections use one full, exact inverse journal referencing the original; a unique reversal link prevents a second full reversal. There is no HTTP posting or reversal endpoint. These are trusted backend primitives, not a client-authorized way to move money. Raw MongoDB/collection access can bypass application middleware: production needs reviewed least-privilege collection roles and protected backups. This phase does not provision those roles or claim storage-level tamper-proofing.

## Posting and idempotency

`postJournalInTransaction` requires an active transaction. `postJournal` owns a majority/snapshot transaction for trusted internal callers. Input is snapshotted before yielding. Canonical payload identity includes ownership, currency, references, reason, accounting version and sorted account lines. Same key/content returns the existing journal; changed content conflicts. Different operation keys still cannot create two capture journals for the same Payment. Account creation and duplicate-index races retry the complete transaction with bounded retries, retaining operation identity. Balance changes use version predicates and all postings also serialize through projection writes.

The capture hook runs only when an authoritative new captured Payment is first recorded (including a failed-to-captured transition). Replaying an already captured historical Payment does not silently backfill it. Event replay, booking/payment retry and reconciliation reuse existing journal/payment/ticket references. A late capture with lost seat ownership credits suspense, never a replacement hold or earned agency commission.

All required unique indexes are checked read-only before journal writes. Missing/incompatible indexes fail closed with LEDGER_NOT_READY. Production has autoIndex disabled: new collections/indexes must be reviewed and provisioned before enabling the updated capture path. The code does not create indexes on a live database as a side effect of posting.

## Balanced examples

Amounts below are **integer paise**. Operator payable includes collected taxes/charges under this interim allocation; AIBUS does not recognize passenger gross sales as platform revenue. Tax remittance, gateway fees, platform fees, discount funding and bank settlement accounting need approved policies before later financial workflows.

| Event/account | Debit | Credit |
|---|---:|---:|
| Confirmed agency booking: payment-clearing | 145000 | 0 |
| Operator payable | 0 | 137750 |
| Agency commission payable (snapshot: 5% of 145000) | 0 | 7250 |
| **Total** | **145000** | **145000** |

Direct bookings credit operator payable for the full captured amount. A late capture debits payment-clearing 145000 and credits payment-exceptions 145000. A correction reverses each original line's debit and credit exactly, preserving booking/payment references and adding a reason/actor. Cancellation requests do not post adjustments. Refund success/reversal and suspense resolution have reserved design boundaries but no executing workflow in 4A. Never infer refund completion from a request or a payout from a successful capture.

## Read access and API contract

GET /api/v1/finance/accounts?page=1&limit=25

GET /api/v1/finance/journals?page=1&limit=25

GET /api/v1/finance/journals/:id

All require authenticated current membership. Other query fields, including operatorId/agentId overrides, are rejected. Operator staff need finance:read and are restricted to their authenticated operator partition, including their agencies' entries. Agents need the current commissions grant and can read only their own agency accounts/lines; full journal totals, other owners' lines, payment IDs and booking references are omitted from that partial view. Another agency/operator's journal ID yields 404.

Super Admin platform:manage alone is insufficient. An explicitly server-provisioned User.platformFinanceRead=true adds platform:finance:read for active Super Admin accounts; no existing operator/staff request schema can set it. Provisioning that grant requires a separately reviewed operational action; no users were changed here. Revocation is checked on the next request. An authorized platform finance reviewer can read across operator partitions.

Read DTOs expose cumulative debit/credit and netDebitPaise (debit minus credit), not a spendable wallet or withdrawable balance. Credit-normal payables therefore have a negative netDebitPaise. Coverage starts with new captures after activation; existing refunds, historical payments and settlements are not implicitly included. Existing agent reports remain booking-snapshot reports and are not replaced with these projections.

## Read-only integrity and historical assessment

`verifyLedger(operatorId)` uses a consistent read-only snapshot to compare journals, totals, account references, operation links/payload hashes, inverse reversals and projections/versions. It reports discrepancies and never repairs data. It is not a proof against a database administrator replacing all records and hashes. The verifier currently scans an operator's ledger in memory; large ledgers need a bounded streaming verification job before scale deployment.

Read-only command (not executed against live data in this phase):

```powershell
cd backend
npm.cmd run ledger:assess -- --operator=<operatorObjectId>
```

The script disables automatic collection/index creation, has no apply mode and reads at most 1000 payment records in one operator snapshot. It reports truncation, existing journal coverage, missing/ambiguous booking/payment states, duplicate captured records, and cancellation/refund review flags. IDs are operational financial references; output must be treated as private. A candidate is only a candidate: agency attribution, commission entitlement, charge/tax policies, reversals and settlement evidence still require manual review. Payment success never marks a settlement complete.

Before staging: take a fresh backup, test an isolated restore, review real mappings and collection/index definitions, check duplicates, provision additive indexes and explicit access roles, and exercise capture retry/rollback in test mode. No existing financial data is rewritten. Historical posting requires a separate reviewed plan and explicit approval; no historical write command was added. A fresh historical assessment/restore was not executed here.

## Files in this phase

Added:

- src/models/ledger-account.model.ts
- src/models/journal-entry.model.ts
- src/models/financial-operation.model.ts
- src/models/account-balance-projection.model.ts
- src/models/shared/financial-schema.ts
- src/services/ledger.service.ts
- src/services/ledger-read.service.ts
- src/services/ledger-integrity.service.ts
- src/routes/finance.routes.ts
- src/scripts/assess-ledger.ts
- LEDGER.md

Modified: src/models/index.ts; src/models/shared/schema.ts (embedded passenger transaction rollback); src/models/user.model.ts; src/types/permissions.ts; src/services/agent.service.ts; src/services/commission.service.ts; src/services/inventory.service.ts; src/app.ts; src/docs/openapi.ts; tests/integration/system.test.ts; package.json.

Existing Phase 1–3 changes are preserved. No React files were changed in 4A. No dependency installation, live migration, database reset, refund, real charge, production deployment or Phase 4B workflow was performed.

## Verification and remaining boundaries

Verified on 18 November 2026: `npm.cmd test` passed all 167 tests (50 operator frontend, 114 backend including 108 integration and 6 adapter tests, 3 admin). All workspace builds passed with `npm.cmd run build`. Prettier checks passed for all code files changed in this phase, and `git diff --check` passed. No live Razorpay Checkout or production database validation is claimed.

18 new integration tests cover balance validation, money/currency limits, idempotency/conflicts, concurrent postings, index readiness, projection overflow, transaction rollback, reversals/immutability, payment retries, one capture per payment, late captures, non-collected payments, HTTP agency/operator isolation, explicit Super Admin access, corruption detection and read-only historical assessment. Existing duplicate verified callback and Razorpay callback/webhook replay tests also assert exactly one journal. Fixtures use a disposable MongoMemoryReplSet and mocked Razorpay transport. Raw fixture collection cleanup/index changes are confined to that disposable database.

Phase 4B inputs are available, but it must wait for approved accounting policies, merchant/fee attribution, refund/cancellation adjustment rules, settlement evidence, reconciliation operations, historical opening balances and deployment controls. Operational failures after gateway capture still require retries/reconciliation; never retry a charge merely because ledger/index/storage processing failed. Existing rejection of a distinct second captured payment for the same booking is preserved and needs a separate overpayment reconciliation workflow. No 4B implementation is started automatically.
