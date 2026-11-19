# Manual browser acceptance checklist

**Not executed: the existing AIBUS Agent Dashboard source/URL is unavailable.** GoAirClass is explicitly excluded. Recover the real app before claiming frontend integration or browser E2E.

## Reproducible prerequisites

1. Record the confirmed existing agent app commit, start command, browser origin and API proxy configuration. Do not build a substitute UI.
2. Create a separate disposable MongoDB replica set and Redis instance/database, with a unique database such as aibus_agent_qa_20261118. Start a separate CRS process using explicit MONGODB_URI, REDIS_URL, PORT and throwaway JWT_SECRET values. Never reuse/reset the live aibus database or production secrets.
3. Set only the approved AGENT_WEB_ORIGIN. Use consistent loopback hosts locally, and reviewed HTTPS same-site/proxy hosts for cookie validation. Configure Razorpay test keys on the isolated backend only.
4. Using existing admin/operator provisioning, approve QA Operators A and B. Under A create Agencies A1/A2 with separate active linked users. Under B create B1. Use unique QA credentials; automated fixtures are destroyed and are not live dashboard accounts.
5. Create A's active bus, both-deck layout, route with boarding/drop points, explicit pricing/cancellation policies and a future trip. Set different double/single fares and 5% agency commission. Create B's separate bus/trip. Restrict A1 to A's bus and initially grant all agency privileges.
6. Connect the recovered app to README's contract. Keep wallets/settlements disabled. Use separate browser profiles for A1, A2 and operator A. Record sanitized pass/fail evidence without exporting credentials, tokens or passenger PII.

## Browser scenarios

| # | Steps | Required outcome |
|---|---|---|
| 1 | Login A1, inspect /agent/me, logout, reload. | Agency navigation only; isolated HttpOnly cookie; server logout revokes; no token/PII storage. |
| 2 | Revoke session or deactivate A1 in operator UI, then navigate/book. | Controlled refresh/login, no infinite retry or new booking. Operator session unaffected. |
| 3 | Open search before submitting; search A's trip/date, then another date and B's route. | No invented/preloaded trip; authorized date-specific results only; empty/error clears stale chart. |
| 4 | Inspect both decks; select double/single available seats and hold. Try blocked/booked/held seats. | Server coordinates/fares/states; unavailable seats disabled; server expiry used. |
| 5 | Enter exact stops/passengers, quote and create pending booking. | Server totals and derived attribution; no ticket/PNR yet. |
| 6 | Complete test Checkout; separately close it and try an invalid signature. | Only verified captured payment confirms; no secret exposed; abort/failure is not Paid. |
| 7 | Retrieve/print confirmed ticket; try pending ticket. | Correct own PNR, passengers, bus/route/journey; pending print denied; escaped text. |
| 8 | History: search PNR/reference, filter state/payment/IST dates. | Own agency pagination; invalid range recoverable; no other agency data. |
| 9 | View policy, request cancellation twice, refresh status. | One request; Requested state; no false refund completion or seat release. |
| 10 | Compare confirmed-paid, pending, failed, cancelled and refunded commissions. | Only eligible snapshots earned; pending/excluded labelled correctly; no fictional wallet/payout. |
| 11 | A2 requests A1's known booking/details/ticket/payment/cancellation IDs; inject agentId/query/body. | 404/403/400; no A1 PII/finance; hidden navigation is not the security boundary. |
| 12 | A1 requests B's known trip/seats/hold/bookings and tries tenant override. | Server denies foreign inventory/data regardless of client parameters. |
| 13 | Expire A1's hold; replace it before cleanup; reconcile A1's late capture and old cancellation. | Replacement unaffected; captured money recorded for reconciliation; no invalid ticket. |
| 14 | Operator A and A1 submit the same seat concurrently. | Exactly one valid hold; loser refreshes; no double booking/ticket. |
| 15 | Interrupt booking/payment response; retry immutable body/key; refresh history; issue concurrent requests. | Same booking reference, one order/ticket; no blind charge retry; unknown state reconciles. |

Also check loading/error/Retry, empty state, keyboard, narrow viewport, open selects/dialogs and multiple tabs. Refresh sharing in the adapter is per instance; actual cross-tab session behaviour needs browser verification. Record results rather than marking this checklist passed from API tests.
