# Admin interaction contract

## Central City Master

Read permission is `platform:settings:read`; adding/importing requires `platform:settings:write` and the existing reviewed current-password flow. Upload previews all source rows without creating cities. Conflicts and invalid rows remain excluded; importing never overwrites existing cities. The browser shows actual committed progress, preserves the import ID for retry/resume, and guards unload during processing. Uncertain chunk responses replay the same cursor. Read-only users see the catalog without import/add controls. Existing operator city IDs and public search IDs remain compatible. Partner city responses contain only authorized inventory, not the complete master catalog.

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
| --- | --- | --- | --- | --- |
| Form | FinanceReviewForm; CityCatalog resume form | Existing current-password review contract; server Zod schemas | Platform intent, explicit client validation for resume ID | Component and browser review tests; Mongo integration tests |
| Table | PlatformTable; native table for source evidence | Paginated catalog/import endpoints | Read-only import evidence inside table-wrap | Desktop/mobile browser overflow checks |
| CRUD | CityCatalog using PlatformTable and FinanceReviewForm | City Catalog create/preview/commit endpoints | Create/read/import; no delete or overwrite controls | Mongo integration tests and browser review tests |
| Scrollbar | Native browser scroll in table-wrap and Overlay | platform.css and overlay.css | Panel-contained horizontal evidence tables | 390px browser check |
| Select/Listbox | Native select | Existing OperationsConsole, PlatformUsers and PlatformWorkspace controls | Single selection; no authored popup | Existing workspace tests |
| Date | Native date input | Existing PlatformOverview filters | Native date-only filters | Existing workspace tests |
| Dialog | Overlay and FinanceReviewForm | Existing platform review/draft-discard behavior | Platform intent with masked password | Existing review and City Catalog browser tests |
| Upload | Native file input; CityCatalog preview | City Catalog endpoint validation | JSON/text file, 5 MB maximum, full-file preview | Preview component and browser tests |

## Ownership and navigation

PlatformScreen owns module navigation, the user identity and page title. Access is derived from the authenticated server identity, never a selected operator identifier. Hidden modules must not request their data. Finance access remains an independent grant. Existing Panel/Overlay and FinanceReviewForm own panels, focusable dialogs, draft/review steps and confirmation; PlatformTable owns platform list behavior.

## Lists, evidence and filters

Use server pagination with bounded page sizes, explicit loading, no-results, error/retry and export states. Search is debounced, respects IME composition, submits on Enter and ignores aborted/stale responses. Clearing search restores focus. Keep applied controls during drawer use and retries. Dates are travel dates for bookings/trips, audit event dates for logs; registry data such as buses is current. CSV requires bounded dates and follows server permissions, redaction and formula neutralization.

Intentional privacy override: filters and selected references are transient in component state and reset on module navigation/reload. Do not persist privileged search references in browser storage or URLs in this phase. This preserves the existing application's non-router architecture and reduces accidental disclosure on shared admin devices. A future shareable-filter feature needs a separate privacy and routing review.

Evidence drawers display server-approved projections. Lists and exports never contain passenger contact details. Passenger detail access requires the separate grant and is audited. Financial evidence requires finance-read; operational audit readers cannot see financial event metadata. Do not render provider payloads, password hashes, API credentials or session tokens.

## Privileged commands

Reasons and current-password re-verification are mandatory for lifecycle, verification, access and settings changes. Validate within the form, focus the invalid control and associate its error. Keep passwords masked and re-mask them before review. Review shows the proposed business change and excludes secrets. Busy states prevent repeated submission; uncertain responses retain the draft and operation key. Discarding an edited draft requires confirmation; page unload warns while a draft exists.

Versioned commands reject stale state and require refresh/review. Staff creation retries use the same idempotency key. Never silently retry a different payload under that key. Existing finance actions preserve their own independent grants, operation keys and maker/checker policies. Display captured payment, booking confirmation, cancellation acceptance and refund completion as different states.

## Honest availability

There are no live payouts/refunds/funding, automated document verification, document uploads, staff invitation delivery, MFA enrollment or automatic notification dispatch in Phase 5. Capabilities and settings must state these limits. Integration health/configuration summaries do not guarantee end-to-end provider availability. A disabled action explains its missing grant or state where relevant.

## Verification

Automated component tests are not browser E2E. Required manual follow-up: keyboard and screen-reader traversal, drawer focus return, mobile table scrolling, date/select behavior, zoom, a stale privileged update, a session revoked in another tab and a permitted test-mode finance workflow. These remain pending until a browser runtime is available; do not represent them as passed.

Phase 8: PlatformTable accepts an explicit request client so the Partner workspace can reuse its behavior with separate authentication. Export remains disabled unless a screen provides an authorized export flow. API Partners lifecycle/grant/key actions use the existing reviewed form, current password, reason and stable key; application review also sends the current revision. Raw credential/signing secrets are never shown in the Admin directory. The isolated browser suite now includes partner details and preserves existing workspace smokes; broader accessibility/manual staging checks above still apply.
# Partner approval review verification — 19 November 2026

- Require an explicit application decision and show only server-supported status transitions. Approved enables partner sign-in; inventory is granted separately.
- Current-password verification is enforced by the existing backend. Never bypass a 403 STEP_UP_REQUIRED response. Show the signed-in account, preserve non-secret changes and focus a cleared password field for retry.
- Keep dialog content within its viewport, retain visible actions and prevent Escape from silently discarding a dirty draft. Dialog styles must work when portalled outside the dashboard container.
- Verified: 17 Admin component tests, 8 Partner component tests, both production builds and 11 isolated Chrome tests. Chrome coverage includes actual rejected-password recovery followed by successful sandbox approval, plus mobile dialog overflow/footer checks. Isolated test records only; no production deployment or database reset.
