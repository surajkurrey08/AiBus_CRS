# Staging/migration readiness

## Evidence

- New Session.client is optional/additive, needs no destructive rewrite/new unique index, and preserves legacy operator/admin sessions. New agent cookie use requires fresh agent login.
- Phase 2 migration is dry-run by default and selects an explicit operator/user pair. Application is tested only on isolated fixtures; no staging/production migration is claimed.
- Existing indexes, reservations, booking references, payment logic and commission snapshots are preserved. Model indexes are initialized in disposable test databases only during tests.
- The 2026-11-17 backup archive SHA-256 was recalculated and matches the manifest: c40bbb48ca2f48cb7a128993095e92ca0eb8cb552f271850724f841e621d1cfe.
- The manifest records an earlier successful restore: 508 documents, 46 collections, zero failures. This is historical evidence, not a fresh restore or coverage of later changes. No live restore/reset was run.

## Gates before staging integration

1. Recover/confirm the existing AIBUS agent app and approved origin. Review its auth, navigation, bus pages, storage, wallet placeholders and tests. Do not modify unrelated GoAirClass sources.
2. Take a fresh backup and verify restoration into a new isolated database. Protect transfer archives/private environment files; never publish them as code or test artifacts.
3. Review real legacy User/SalesPartner mappings: genuine agency users versus internal booking staff, foreign/ambiguous links, duplicate emails, invalid rates and missing attribution. No real mapping review is claimed here.
4. Run the Phase 2 dry-run per reviewed user/operator, retain a redacted plan and resolve ambiguity by explicit linkage, never automatic deletion/merge.
5. Inspect actual staging indexes/duplicates before the existing additive index command. Source declarations and fixture indexes do not verify production index state. Do not use syncIndexes/drop/reset.
6. Apply only the reviewed staging plan in bounded batches; rerun to check idempotency. Compare agency/user counts and booking reference/PNR/price/payment/snapshot invariants. Large historical backfills need workload testing because the migration uses a per-user transaction. Do not execute against production.
7. Verify fresh login and cookie namespaces, approved-origin preflight, CSRF, HTTPS, revoked/inactive memberships and permissions in the actual browser.
8. Run all manual scenarios or implement Playwright against the recovered app's actual routes/selectors. An API harness or substitute UI is not agent frontend E2E.

## Phase 4 handoff only

Canonical agency IDs and snapshot-eligibility reports are available as inputs. Wallets, double-entry accounting, settlements/payouts and refund execution remain absent; no fictional balances are returned. Production deployment and Phase 4 implementation are outside this work. Phase 3 frontend integration remains blocked until the correct source is available.
