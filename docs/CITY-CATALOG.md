# AIBUS central City Master

The Admin City Master owns a global catalog. Existing `City` records remain operator-owned. Linking creates a separate tenant record, preserves its MongoDB ID, and copies the canonical name/state/country server-side. Existing cities and routes are not automatically relinked or rewritten. Catalog city IDs and keys are immutable. Source provider IDs are evidence only.

## Admin workflow

1. Open **City Master** using an Admin with `platform:settings:read`. Saving or importing requires explicit `platform:settings:write` and verification of the signed-in Admin's current password. Operator/agent/partner identities cannot administer the catalog.
2. **Add city** accepts city name, state and a reviewed business reason. The server generates `city_<random UUID>` and a normalized key, including country. The same key returns the existing record without changing it.
3. **Import city JSON** accepts a JSON array or `{ "success": true, "data": [...] }`, up to 50,000 rows / 5 MB file. Rows use `CityId`, `City`, `State`. The entire file is examined before any city is imported. Preview stores an actor-owned, resumable import record, not catalog cities.
4. Conflicting source IDs, distinct source localities with the same key, incomplete rows and identical duplicates are classified separately. Ambiguous localities are never silently merged. Correct excluded rows in a separate source file before previewing again. Existing catalog entries are never overwritten.
5. Review the counts, then use **Review and import valid cities**, provide the business reason/current password, and confirm. The browser commits up to 250 source rows per transaction, displaying progress. Each committed chunk is audited. A stable cursor prevents duplicate work after an uncertain response. Reuploading the same source filename/content resumes the same preview for the same Admin; alternatively paste its import ID in **Resume import ID**. A new Admin cannot read or commit another Admin's preview.
6. Operator **Master → Area Master → Cities → Add/Create city** offers searchable catalog selection. The operator may still create a local city for existing workflow compatibility. A linked city cannot be relinked to another catalog entry.

Preview exclusions remain in the saved import record for review; there is no automatic conflict resolution or deletion action. Preview input is capped separately from normal API requests, which retain their 128 KB cap. Public IDs are random rather than provider IDs; they are not authorization credentials.

## API contracts

- `GET /api/v1/platform/city-catalog?page=1&limit=25&search=Pune`
- `POST /api/v1/platform/city-catalog` — name, state, country, reason, password.
- `POST /api/v1/platform/city-catalog/imports/preview` — source filename and full rows array; authenticated before the larger JSON parser.
- `GET /api/v1/platform/city-catalog/imports/:id?page=1&limit=25` — summary and paginated source rows, same Admin only.
- `POST /api/v1/platform/city-catalog/imports/:id/commit` — cursor, reason, password. Cursor replay returns current progress, future cursors return 409. Failed chunks roll back.
- `GET /api/v1/operator/area-master/catalog?search=Pune&limit=25` — active catalog lookup, authenticated operator staff.
- Existing operator city create accepts optional `catalogId`; the server resolves canonical data instead of trusting submitted names/tenant IDs.

Existing public `GET /api/v1/public/cities` keeps its authorized-trip filter, paging, `id` and `name`. It adds `success: true`, `CityId` (equal to existing `id`, usable in trip search), `City` (equal to `name`), `CityKey`, `State` and optional/null `CatalogCityId`. Legacy routes without an operator city link return null state/key rather than fabricated metadata. `CatalogCityId` is the central identity; do not substitute it for the existing search ID. Importing 27,000 cities does **not** expose 27,000 cities to every partner or create bus availability.

## Rollout

No live import or deployment is performed by tests. Before production release, retain a current backup and review the two additive collections and unique indexes:

```powershell
npm run cities:indexes -w backend
# Only after reviewing backup and approving additive provisioning:
npm run cities:indexes -w backend -- --apply
```

The check uses the configured database; it prints index metadata, never credentials. The apply step only creates these two collections' indexes and never drops indexes, rewrites tenant cities or resets data. Saving fails closed with `CATALOG_NOT_READY` until the unique indexes exist. Use the existing reviewed release/deployment workflow. Existing production public-provider sandbox restrictions stay unchanged.

The supplied 29,409-row attachment was analyzed locally: 27,653 eligible, 1,755 ambiguous/conflicting, one invalid, zero identical duplicates. These counts precede comparison with a deployed catalog; existing entries may further reduce inserted totals. The attachment is not bundled into frontend code or committed as hardcoded seed data.

## Verification evidence

- Full workspace suite: 390 tests passed (63 Operator, 293 backend, 20 Admin, 14 Partner). One additional Operator catalog-selection regression passed separately after the full run.
- Backend coverage includes full-file conflict classification, preview/commit replay, wrong password, actor/tenant isolation, bounded chunk resume, simultaneous commit retries and missing unique indexes. Existing public API search tests verify compatibility aliases and stable search IDs.
- Two Chrome UI-contract tests passed at 1440px and 390px with intercepted fixture APIs: upload preview, excluded-row evidence, deliberate password review, successful import progress and no document overflow. These are browser UI checks, not a claim of live-database browser E2E. On this Windows environment, the verified test Vite process required cleanup after assertions finished.
- All four workspace production builds, TypeScript checks, ESLint, synthetic production configuration checks and five deployment-contract tests passed. The scoped Admin premium static audit has zero findings.
- No live collections, index provisioning, source-data import, production release, Git commit or push was performed as part of this implementation.
