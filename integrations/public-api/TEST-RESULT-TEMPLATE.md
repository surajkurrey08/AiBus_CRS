# AIBUS sandbox API test results

- Tester:
- Test date/time and timezone:
- Sandbox base URL:
- Collection version/file:
- Journey date and route:
- Test run ID:
- Public booking ID / PNR, if issued:

Do not include API credentials, access tokens, Authorization headers, populated secret environments or real passenger data.

| Request | HTTP status | Assertions passed/failed | Expected behavior | Actual behavior | requestId / X-Request-ID |
| --- | --- | --- | --- | --- | --- |
| Token exchange | | | Scoped access token issued | | |
| Capabilities / cities / dated search | | | Authorized sandbox inventory only | | |
| Seats / stops / policy | | | Current available seats and configured stops/policy | | |
| Quote / hold / hold-bound quote | | | Owned temporary hold and matching final quote | | |
| Pending booking / Razorpay Test order and verification | | | One confirmed test booking, central ledger and ticket | | |
| Booking status / ticket | | | Valid ticket and PNR | | |
| Cancellation quote / operator review / test refund status | | | Review required; verified test refund only | | |
| Webhook history | | | Configured delivery history or empty list | | |
| Reschedule / partner wallet | | | 501 CAPABILITY_UNAVAILABLE | | |

## Issue details

- Endpoint and method:
- Reproduction steps:
- Sanitized request body (remove names/contacts/secrets):
- Sanitized response/error code:
- Expected result:
- Actual result:
- Response requestId / X-Request-ID:
- Screenshot with secrets masked, if helpful:
- Did a timeout occur? If yes, record the existing public booking ID and inspect status before attempting a new booking.
