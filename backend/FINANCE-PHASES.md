# Finance implementation record — 4B / 4C / 4D

Baseline on 18 November 2026: all 167 tests passed (114 backend, 50 operator, 3 admin). Existing dirty Phase 1–4A changes were retained. No automatic commit is safe while those phases remain mixed in the working tree; no push/deployment is authorized.

## 4B policy and ownership

Prepaid is an operator-custodied liability to a canonical agency; credit is an operator exposure against that agency, not prepaid cash. Both use agency-specific subledger accounts within the operator's ledger partition. Platform custody is unconfigured and unsupported until approved. No commission-to-wallet transfer exists. FINANCE_TEST_MODE defaults false and is rejected in production. FinancePolicy also requires explicit operator test custody plus separate wallet/credit/test-operation flags. New agency wallet/credit grants are opt-in, excluded from default permissions.

Added AgentWallet, CreditFacility, FinancePolicy, WalletFundingIntent, WalletReservation, immutable CreditLimitHistory and immutable TestFundingEvidence. Existing JournalEntry/AccountBalanceProjection are the transaction history/balance projections; no second ledger or redundant financial transaction collection was introduced. Wallet amounts and available credit derive from posted account totals and transactionally reserved balances. New chart codes: test-funds-clearing (operator asset), agency-prepaid (agency liability), agency-credit-receivable (agency counterparty subledger for operator credit asset).

Funding states: Requested → Verified (server-generated isolated test-provider evidence) → Posted, or Rejected. Screenshots, reference strings, supplied balances and client success flags cannot post funds. All evidence is explicitly test-only; no bank deposit is represented. Credit changes append immutable history and do not create deposits. Repayments require verified test evidence and reduce the credit receivable only, never the prepaid balance.

Funding reservations: Reserved → Consumed / Released / Expired. The authenticated agent reserves the existing booking's authoritative total until its original consumed hold expires. Wallet/credit projection writes serialize concurrent authorization. Confirmation joins the **existing** applyVerifiedPayment transaction: original hold/seat validation, payment, ticket, journal, balance debit, reservation consumption and audit either all commit or all abort. A failed seat claim never consumes agency funds. Gateway checkout and agency funding claim one funding method on Booking; mixed funding is rejected. A released/expired reservation is terminal; cancel the unpaid booking and create a new booking attempt rather than recycling its operation identity.

Reservation expiry is retry-safe and uses MongoDB transaction predicates; multiple API processes may attempt it without releasing funds twice. Both the API maintenance loop and reconciliation CLI call the same expiry service. No Redis-only financial locks or external gateway calls inside MongoDB transactions are introduced.

Wallet and credit unique indexes are verified before financial transactions. Run the read-only versioned `npm.cmd run finance:preflight -w backend` assessment before a separately reviewed additive index rollout. The script has no apply mode, disables autoCreate/autoIndex, reports missing/incompatible indexes/duplicate groups, and never migrates historical records. Rollback means disabling test mode and policy flags while preserving records and reconciling reservations; never dropping collections/journals.

Operator APIs under `/api/v1/operator/finance`: GET/PUT policy; GET wallet-summary; GET wallets with server search/status/paging; POST/GET wallets/:agentId; PATCH status; PUT credit; POST/GET funding; POST funding/:id/review; GET credit/history; GET transactions; GET statement.csv with required date range. Every selected agency is looked up within the authenticated operator. Operator management requires finance:manage (operator_admin only); finance:read staff can view. Agents cannot call operator routes.

Agent APIs under `/api/v1/agent/wallet`: GET the prefix root for balances; POST/GET funding and GET funding/:id; GET credit/history; GET transactions; GET statement.csv; POST reservations; GET/DELETE reservations/:id; POST reservations/:id/confirm. Membership and grants are reread server-side; no client tenant/agency establishes ownership. The prepared TypeScript client exposes these contracts. The unavailable external dashboard was not recreated or modified.

Operator Finance uses existing warm AIBUS tokens, native selects, Panel/DataTable and the shared Overlay. FinanceActionForm is a business-specific shared form for money, review, stable operation keys, inline errors and draft-discard confirmation. Server-calculated balances/exposure, funding review, credit management/history and authorized statements replace fictional figures. Statement exports neutralize spreadsheet formulas, exclude other accounts' lines, require date bounds and cap export size. Latest-100 detail histories are labelled; full date-range statements provide bounded exports.

Browser verification attempt failed: CUA could not initialize its kernel assets (Windows error 3). The skill's Python static auditor could not run because Python is unavailable. Component/API tests are not browser E2E or bank/gateway verification. No real charges, refunds, funding, migrations or payouts were executed.

4B tests: wallet ownership, grants, funding proof and replay, invalid inputs, concurrency/insufficient funds, wallet booking/commission separation, credit concurrency/limit protection, repayment, suspension/revocation, expired/replacement holds, atomic ticket failure rollback, mixed funding, immutable history, scoped statements and actual exposure. Frontend tests cover exact INR input, review-before-mutation, retry identity, errors and draft preservation. Complete phase gate results are recorded after the full run succeeds.

4B full gate passed: 183 tests (127 backend, 53 operator, 3 admin); all workspace builds and adapter TypeScript check passed. Early duplicate declarations were removed before the successful gate. No live verification is claimed.

## 4C

Implemented after the successful 4B gate. Cancellation accounting is explicitly configured and disabled by default; full-booking scope only. Quotes snapshot the current cancellation percentage, component treatment, commission reversal and expiry. Acceptance atomically invalidates the ticket, releases only original owned seats and reallocates capture liabilities. Approval never marks a refund completed. Historical captures without original journals fail closed.

RefundIntent fixes amount, source, body hash and provider idempotency identity. Mongo leases, bounded retries and immutable RefundAttempt records coordinate workers. Gateway calls stay outside transactions. Razorpay test refunds use X-Refund-Idempotency and independent status retrieval; uncertain outcomes are looked up before a retry. Authenticated refund webhooks re-fetch provider evidence. Wallet refunds restore the original prepaid liability; credit refunds reduce only original receivables, never cash. Duplicate/late captures have suspense journals and durable financial exceptions. Review cannot resolve a discrepancy without verified evidence.

New operator and platform /finance APIs expose cancellation review, refund intents/attempts, exceptions and review/recheck actions. Agent APIs expose own booking cancellation quote and refund status; the prepared client is extended where compatible. Operator Finance > Refund management shows quote components and review forms. Existing Admin > Finance shows permission-controlled exception/refund oversight. Read-only reporting does not imply mutation rights. 4C validation passed: full suite 205 tests (147 backend, 53 operator, 5 admin), plus both newly added operator refund tests passed (207 total available tests). All workspace builds and SDK type-check passed. The admin test fixture metadata type was corrected before its successful build. Browser E2E remains unverified.

Provider contract references: https://razorpay.com/docs/api/refunds/create-normal/ and https://github.com/razorpay/markdown-docs/blob/master/api/refunds/normal-refunds-idempotent.md . Gateway tests use isolated mocked transport; no real Razorpay refund was performed.

## 4D

Implemented after the successful 4C gate. The existing Settlement collection is extended as the canonical batch rather than introducing a parallel settlement engine. Legacy pending/settled fields and external references remain intact; workflowVersion=1 distinguishes new immutable-line batches. Phase 4A capture split remains authoritative: operator payable includes original taxes/charges; agency commission is separate; platform/gateway fees are unconfigured (zero additional fees). No tax or custody policy is invented.

Lifecycle: Calculated -> Under review -> Approved -> Payment processing -> Paid (Test), or Reconciliation required. SettlementLine claims a complete payable journal/account pair uniquely. SettlementApproval is immutable and unique per batch/action. A preparer cannot approve or authorize/dispatch their own payout. Explicit platform finance read plus separate prepare/approve/payout grants are required; platform:manage alone is insufficient. Ordinary operators and agencies can read only their owned financial records.

Eligibility is deliberately conservative: original post-ledger Razorpay test capture, completed trip, unpaid/immature/historical and wallet/credit obligations excluded. Cancellation retained amounts require the accepted quote, cancellation adjustment journal, processed refund intent, actual original payment refund amount and refund journal (or explicit zero-refund Not due evidence). Cancelled commission is never claimed. Booking locks plus immutable unique claims prevent concurrent allocations. Cancellation cannot reverse a claimed obligation after trip rescheduling; a separately approved compensating-adjustment policy is required. No automatic balancing adjustment or historical backfill is available.

SettlementPolicy is disabled by default and supports only explicitly configured isolated simulated gateway receipts and existing capture liabilities. TestSettlementReceipt is unique per original payment, posting a labelled simulated clearing transfer once. PayoutIntent is unique per settlement with a stable operation identity. TestPayoutRecord supplies durable isolated simulator evidence; no user-supplied transfer string or status establishes success. Provider status lookup precedes dispatch and is repeated independently afterward. Mongo leases, bounded attempts, immutable PayoutAttempt history and atomic payout journals protect retries. Timeout recovery queries the original operation; partial/mismatched evidence becomes Manual review without a top-up. Failed provider operations remain unpaid. A verified simulator result with an aborted journal remains recoverable evidence and never silently disappears. There are no real bank calls.

Payout journal: debit original operator/agency payable; credit simulated-bank-clearing. Claims are never simultaneously paid to cash and credited to wallet. Test payouts are excluded from the legacy dashboard bank-settlement aggregate. SettlementReconciliation preserves checks and detected discrepancies without rewriting history. The read-only financial reconciliation endpoint checks ledger/projections, wallet/credit reservation totals/exposure, refund liabilities/postings, captured payment coverage and payout postings. It explicitly does not infer bank settlement.

Fifteen scoped financial reports: daily/monthly ticket value, operator/agency/route performance, booking sources, earned commissions, commission payable, settlements, pending payments, refunds, wallet liabilities, credit exposure, payment exceptions and settlement reconciliation. Activity is based on IST journal dates. Outstanding balance reports are cumulative through the selected end date, not changes within the period. Reports use snapshot reads and integer-paise/BigInt arithmetic, date/operator/agency/status/search filters, pagination and bounded CSV downloads. CSV is Excel-compatible text, not an XLSX workbook. Exports neutralize formula-leading cells. Interactive source scans are capped at 10,000 rows, settlement candidate journals at 500; larger scopes require a reviewed offline reporting workflow. Agency reports redact operator payable/platform revenue and never include passenger names/contact data.

Operator Finance now has Earnings overview, Agency commissions, Wallet & credit, Settlement history, Refund management and Financial reports. Admin Finance has oversight, settlements, commissions, wallet/credit, refunds, reconciliation, payout records, reports and permanent audit history. Shared native controls/panels/forms and the established palette are retained. Review-before-write, stable retry keys, role-controlled actions, explicit loading/empty/error/retry, table overflow and stale-request cancellation are implemented. External Agent Dashboard source is still unavailable and was not recreated. Its TypeScript adapter and own-agency settlement/report contracts are updated.

4D targeted verification: 16 settlement/report integration tests passed after tightening the processed-refund evidence guard; 4 new operator/admin component tests passed. One further regression checks cancellation after rescheduling a claimed booking. Final complete suite/build result is recorded below after completion.

Verified captured evidence mismatches for a known owned Razorpay order are now quarantined with provider payment ID, observed amount/currency and a durable Open finance case. Foreign-order evidence is never attached to this tenant. No automatic journal, ticket or refund is invented for inconsistent evidence. The original mismatch regression now asserts preservation of the captured observation.


## Financial change manifest

This lists the financial work; pre-existing Phase 1?4A changes in the dirty working tree were retained and were not attributed as new work.

| Area | Files/modules |
|---|---|
| Wallet/credit | src/models/agency-finance.model.ts; src/services/agency-finance.service.ts; src/routes/agency-finance.routes.ts; src/services/finance-export.service.ts |
| Refund/recovery | src/models/refund-workflow.model.ts; src/services/refund-workflow.service.ts; src/services/refund-review.service.ts; src/services/payment-exception.service.ts; src/routes/refund-workflow.routes.ts; src/services/cancellation.service.ts |
| Settlement/reporting | src/models/settlement.model.ts (extended existing collection); src/models/settlement-workflow.model.ts; src/services/settlement.service.ts; src/services/financial-report.service.ts; src/routes/settlement.routes.ts; src/integrations/test-payout.ts |
| Existing engine integration | src/services/inventory.service.ts; src/services/razorpay.service.ts; src/integrations/razorpay.ts; src/services/ledger.service.ts; src/models/journal-entry.model.ts; src/models/booking.model.ts; src/models/payment.model.ts; src/models/cancellation.model.ts; src/models/refund.model.ts |
| Runtime/ownership | src/app.ts; src/server.ts; src/workers/reconciliation.worker.ts; src/config/env.ts; src/types/permissions.ts; src/models/user.model.ts; src/models/sales-partner.model.ts; src/services/agent.service.ts; src/validators/agent.schemas.ts; src/routes/operator.routes.ts; src/routes/agent.routes.ts; src/services/agent-dashboard.service.ts; src/services/analytics.service.ts; src/models/index.ts |
| Operator UI | ../frontend/src/features/finance/*; ../frontend/src/app/App.tsx; ../frontend/src/components/tables/DataTable.tsx; ../frontend/src/api/client.ts; ../frontend/src/utils/normalize.ts; agency grant form and DESIGN/UX-CONTRACT |
| Admin UI | ../admin/src/features/finance/*; ../admin/src/features/operators/PlatformScreen.tsx; ../admin/src/api/client.ts; ../admin/DESIGN.md |
| Tests | tests/integration/system.test.ts; existing tests/agent-client.test.ts retained; frontend finance-wallet, finance-refunds, finance-reports tests; admin finance and settlements tests |
| Adapter/rollout | ../integrations/agent-dashboard/client.ts; src/scripts/finance-v2-preflight.ts; backend/package.json finance:preflight; .env.example FINANCE_TEST_MODE; FINANCE-API.md |

The existing LedgerAccount, JournalEntry, FinancialOperation and AccountBalanceProjection remain the only accounting authority. New adjustment operations are linked compensating journals, not replacement ledger collections. SettlementLine is a unique payable claim, not another balance ledger. No dependencies were installed. No forced commit/push was made: earlier phase changes and this work are mixed in the inherited working tree.

## Remaining restrictions and production readiness

- Real custody/funding, bank receipt reconciliation, real refunds and bank payouts are disabled. Test mode defaults off and is rejected in production. No live transfer or gateway refund was performed.
- Platform/gateway fee and revised tax policies are unconfigured. Original operator payable includes existing capture taxes/charges. No new commercial fee or tax treatment was invented.
- Wallet/credit payout custody, partial seat cancellations, partial payable-line settlement, manual historical adjustments and commission-to-wallet discharge require separately approved policies. They fail closed. Historical balances are not backfilled. Manual-review payout cases cannot be cleared by clicking Paid or adding a reference.
- Existing legacy Settlement records remain readable in reporting but are not automatically verified, recalculated or migrated into claim batches.
- A separately approved additive index rollout and explicit finance grants are required before new financial mutations. The versioned assessment is prepared/read-only and has not been run against a live database. Financial action grants are not automatically granted to every Super Admin.
- Browser E2E/visual QA was not executed: CUA initialization failed (Windows kernel asset path error). The Python UI auditor could not run because Python is unavailable. Component tests and mocked provider responses are not real gateway/bank verification.
- The separate Travel Agent Dashboard source is still missing. Its adapter contracts are prepared; no replacement application or unrelated GoAirClass code was created or modified.
- Production also needs finance policy approval, provider staging verification, durable recovery monitoring/alerts, backup restore rehearsal, replica-set and index rollout verification, least-privilege DB credentials and reporting load tests. Interactive report/candidate limits are explicit and do not replace a scalable offline reporting pipeline.
- No production deployment, database reset, live migration or historical financial backfill was executed. Phase 5 has not been started. Readiness is limited to validated test-mode financial workflows; this is not production financial certification.

Report interpretation: ticket activity groups the capture cohort selected by IST journal date, while cancellation/refund eligibility reflects the current booking state. These are operational financial views, not certified historical closing statements. Cumulative account balance reports use the selected end date; original dated journals remain the posting history.


## Final validation - 18 November 2026

| Check | Observed result |
|---|---|
| Existing baseline rerun | 167 passed: 114 backend, 50 operator, 3 admin |
| 4B gate | 183 passed; all builds and SDK check passed |
| 4C gate | 205 in full run + 2 newly added refund UI tests, 207 available tests passed; all builds and SDK check passed |
| Final complete workspace suite | 229 passed: 165 backend (159 integration + 6 SDK), 57 operator, 7 admin; no failed or skipped tests |
| Backend rerun after captured mismatch quarantine | All 165 passed; no failed or skipped tests |
| Production builds | frontend, backend and admin passed; backend rebuilt successfully after the final recovery change |
| Adapter TypeScript | npm.cmd run check:agent-adapter passed |
| Focused formatting / whitespace | Finance service/model/route/UI Prettier checks passed; checked tracked financial diffs have no whitespace errors |
| Browser / live provider / bank | Not run; runtime/source/policy blockers described above. Mock evidence is not live verification |

There are 62 more passing automated tests than the 167-test baseline: 13 wallet/credit integration + 3 wallet UI; 20 cancellation/refund integration + 2 operator refund UI + 2 admin finance UI; 18 settlement/report integration + 2 operator report UI + 2 admin settlement UI. Existing reservation, concurrency, expired/replacement ownership, RBAC, ledger, Razorpay and Master regressions remain passing. The existing mismatch regression was strengthened without increasing the test count.

During development, a failed retained-cancellation test exposed insufficient refund evidence checks; settlement eligibility now requires the processed intent and journal. A missing ordered:true transaction option and duplicate declaration edits were corrected before successful gates. Final failures: zero. Targeted test runs intentionally filtered unrelated tests; the final full suites did not skip tests.

Status: 4B/4C/4D test-mode workflows are implemented and validated within the documented policy boundaries. Restricted commercial, historical/partial, external-dashboard and real-bank workflows remain blocked or disabled explicitly. This does not claim production readiness or completion of those disabled integrations. No Phase 5 work, push or deployment was performed.
