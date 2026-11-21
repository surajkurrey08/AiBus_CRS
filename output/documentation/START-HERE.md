# AIBUS external API integration kit

Updated 21 November 2026. Deployed public API baseline: d73ffc9, contract 1.0.0-test.

## Start here

1. Read AIBUS-Public-API-Complete-Guide.pdf or the HTML version.
2. Import postman.runner.v1.json and postman.external-sandbox.environment.json into Postman Desktop.
3. Follow EXTERNAL-TESTER-QUICKSTART.md. Obtain your own company's expiring sandbox credential privately. This shared package contains no working secrets.
4. Use Test API base https://partner.bookmybus.pro/api/v1/public. Exchange the complete credential at POST /auth/token with raw JSON {}. Later requests use the returned five-minute access token.
5. Run capabilities, cities, trips, seats and stops before enabling sandbox writes. Use public IDs from responses, not illustrative guide IDs.

## Verified and pending

External HTTPS token exchange and inventory requests were reverified for two separate app partners on 21 November. The isolated test database and synthetic inventory are separate from production. Production public booking remains disabled at api.bookmybus.pro.

The new Partner Portal to isolated sandbox bridge is implemented locally. It requires a reviewed deployment and private configuration. Until hosted acceptance passes, do not assume every live portal account can generate a working sandbox credential. Existing demo credentials are separate test identities.

Actual hosted Razorpay Test Mode checkout and confirmed ticket retrieval remain unverified. The collection pauses for genuine checkout evidence; never fabricate payment IDs, signatures or paid status. Cancellation is a review request, not an instant refund. Wallet and rescheduling intentionally return 501.

## Test inventory

Synthetic route: Pune to Mumbai, journey date 2026-11-27. Discover public city and trip IDs from authorized responses. Each new partner requires its own reviewed inventory grant. Availability changes when seats are held or booked.

## Protect access

Keep credentials on your backend or in local Postman secret values. Never put them in a browser/mobile bundle, shared documentation, Git or a populated environment export. Give each company its own partner identity and credential. Return sanitized findings using TEST-RESULT-TEMPLATE.md.

The actual customer/Travel Agent app source remains unavailable; application integration is not claimed complete.
