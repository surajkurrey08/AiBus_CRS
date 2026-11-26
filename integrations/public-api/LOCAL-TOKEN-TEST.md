# Local public API token testing

The main API remains on `http://127.0.0.1:4000`, using Atlas database `aibus`.
The dedicated sandbox API runs on `http://127.0.0.1:4001`, using
`aibus_public_sandbox_dev` with disposable fixture inventory. The ordinary
database isolation guard remains enforced. This does not enable production API access.

Sandbox-only settings are in ignored `backend/.env.public-sandbox`. It uses
separate dashboard/public signing keys, no Razorpay/SMTP credentials, and a
dedicated Redis container `aibus-public-sandbox-redis` on loopback port 6381.

To start after a computer restart, start that existing container, then run from
the repository root:

```powershell
docker start aibus-public-sandbox-redis
node scripts/start-public-sandbox.mjs
```

The private, once-issued test credential is in ignored
`.cache/aibus-sandbox-credential.json`. Read the complete `credential` value;
do not use only `credentialId`. It expires seven days after issuance. Never
commit it or put it in a browser application. Renew through existing trusted
sandbox provisioning if it expires; old secrets cannot be recovered from MongoDB.

In Postman:

1. POST `http://127.0.0.1:4001/api/v1/public/auth/token`.
2. Authorization: Bearer Token, value = the full private sandbox credential.
3. Body: raw JSON `{}`; Content-Type: `application/json`.
4. Disable cookie jar for this request and do not send an Origin header.
5. Send. HTTP 200 returns `data.accessToken`, `tokenType: Bearer`, `expiresIn: 2700`.
6. GET `http://127.0.0.1:4001/api/v1/public/cities` using the returned access
   token as Bearer authorization. Repeat the credential exchange when it expires.

The Partner Playground on the main backend still enforces its ordinary-database
boundary. These steps use the separate server-to-server sandbox directly, not
a bypass or a production connection. Fixture city/trip IDs and date are saved
in `.cache/aibus-sandbox-test-data.json` for further test requests.

Verified on 19 November 2026: invalid credential 401; valid token exchange 200
(300 seconds); capabilities, cities, dated trips and seat reads all 200. The
main API remained ready. Existing public API/origin regressions: 33 passed.
No raw token or credential was printed in verification output.
