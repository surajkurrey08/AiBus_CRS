# Partner platform interaction contract

## Canonical ownership

| Capability | Owner | Variant and verification |
| --- | --- | --- |
| Panels / dialogs | Admin `Panel` / `Overlay` | Partner-specific content; native modal focus; component and Chrome checks |
| Lists, filters, paging, retry | Admin `PlatformTable` | Explicit partner request adapter, exports disabled unless separately authorized |
| Privileged create/edit/revoke | Admin `FinanceReviewForm` | Platform intent, current password, reason, explicit review and stable command key |
| Select and date | Existing native controls and reviewed form | Platform geometry accepted; accessible labels; expiry validation on server |
| Loading / async recovery | `components/PortalPrimitives.Load` | Abort stale reads, loading/error/retry states |
| Secret display | `OneTimeSecret` | Masked default, reveal/copy/clear, never a stored-secret getter |
| Scrollbars / focus / tokens | Admin theme and base CSS | Partner CSS owns layout only |
| Selection | Not applicable | No bulk privileged selection exists in Phase 8 |
| Feedback | Existing inline status/alert regions | No duplicate toast provider |

## Access and lifecycle

Only approved active partner memberships may log in. Client-side permissions hide unavailable navigation and actions, while every backend route re-reads membership. No selected company ID grants authorization. Partner sessions have their own refresh cookie and dashboard client identity.

Approval does not grant inventory, API scopes, production access or funding. Suspension revokes organization sessions and API credentials. A membership change revokes that member's sessions and issued credentials. Developers cannot obtain passenger-reading machine scopes through credential issuance.

## Changes and recovery

Privileged writes are pessimistic. Keep a draft and operation key through uncertain responses, mask passwords, re-mask before review and confirm dirty-form discard. Reviewed command replays return `COMMAND_ALREADY_APPLIED`; reload metadata instead of expecting the secret to be shown again. Generate a replacement only through a new explicit reviewed action.

One-time secrets live only in component memory and are removed on close/unmount. Copy feedback contains no secret. Do not put credentials in toast text, query parameters, screenshots of real accounts or browser storage. Machine-to-machine examples use placeholders and are labeled server-side.

Search, filters, response JSON and selected references are transient. Do not persist passenger requests or privileged search history. Playground request drafts warn on browser unload; cross-module navigation clears them. This intentional transient behavior avoids persisting test passenger information. Reviewed modal drafts retain the canonical discard confirmation.

## Honest sandbox behavior

The playground dispatches only compiled allowlisted API operations. It displays actual returned HTTP status, request ID and duration. The scenario guide provides fixture instructions; it does not fabricate successful outcomes or reset inventory. Pending authorization, confirmed booking, requested cancellation and completed refund remain distinct states.

Inventory and financial operations require the isolated sandbox database boundary. Wallet, rescheduling, live credentials, real funding, real refunds and payouts remain unavailable. SMTP-dependent reset delivery and MFA must not be represented as configured unless actually available.

## Verification limits

Component tests cover permission-based navigation, review-before-write, secret reveal/clear, registration validation, malformed playground input and stale-response protection. Isolated Chrome tests cover login/logout, inventory, playground execution, one-time credential issuance, read-only restrictions, Admin partner details and mobile page overflow. Existing Operator/Admin smoke tests remain included.

Screen-reader audits, extensive zoom/keyboard testing, real callback receiver delivery and SMTP email delivery remain manual staging work. Browser smokes do not replace the full backend reservation and financial regressions.

Authentication refresh: registration and login use the Partner origin and client identity. The registration form preserves inputs on server failure, focuses its visible error summary, and associates validation errors with the invalid field. Passwords are masked by default with an explicit show/hide control. Leaving an edited registration requires a discard confirmation; browser unload warns while unsaved registration details exist. Draft-submit errors remain visible outside the form. Successful submission returns to login with approval guidance rather than creating a session automatically.

## Developer workflow clarity

- Documentation reads the existing compiled OpenAPI contract. Method, path, required parameters, request body, errors and response samples come from that contract. Samples are labelled illustrative and require replacement values. Authentication examples distinguish a server credential from an exchanged access token; write examples include required idempotency headers.
- Playground keeps per-endpoint drafts in memory while switching operations. Cross-module navigation clears them, as above. Invalid JSON is rejected locally with editor focus; network failure preserves the request. A pending request disables editing and endpoint changes, clears the previous response and shows pending status. Actual HTTP failures remain failures in the response panel. Late responses after unmount are ignored.
- Credentials reuse PlatformTable and FinanceReviewForm. Only non-secret metadata is formatted for display; original credential IDs/scopes remain available to existing reviewed rotate/revoke commands. The server remains authoritative for approved scopes and expiry.
- Inventory uses Load for authoritative grants and PlatformTable for client paging/search of the returned authorized trip snapshot. Refresh inventory and the trip table's Refresh action both reload the authoritative server snapshot through PlatformTable's onRefresh adapter. The latest grant response is limited to 100; counts describe returned records. Internal grant IDs are explicitly distinguished from public trip IDs. Empty, expired, disabled and unavailable inventory have explanatory states.
- No production API, new funding behavior or permission changes are introduced by this UI work. Python static design auditing was attempted through both python and the py launcher, but no Python runtime is installed; project tests, TypeScript builds and isolated Chrome are the verification evidence.
