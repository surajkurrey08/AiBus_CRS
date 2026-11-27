# AiCar partner sandbox on the VPS

This is a **staging-only** provider sandbox. Its public base URL is:

`https://partner.bookmybus.pro/api/v1/car`

It uses a separate MongoDB database and does not change the Bus CRS public API at
`/api/v1/public`. Do not set `NODE_ENV=production` for this service: provider
routes intentionally return `CAR_SANDBOX_DISABLED` in production.

## One-time VPS preparation

Run these commands only after logging into the VPS as `root`. First confirm the
existing BookMyBus gateway is healthy and its internal integration network exists:

```bash
docker network inspect bookmybus-crs_integration
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

Create two different random signing secrets. Never paste either secret into Git,
Swagger, Postman collection exports, chat, or provider emails.

```bash
umask 077
openssl rand -hex 48
openssl rand -hex 48
```

Create `/opt/bookmybus-crs/shared/car-sandbox.env` from
`deploy/car-sandbox.env.example`, replacing both placeholders with the two values
printed above. Its permissions must be `600`. The BookMyBus release script refuses
to deploy if this file is missing or has looser permissions.

## Start or update the sandbox

The GitHub Actions production deployment now publishes a digest-pinned Car image,
updates the BookMyBus gateway image, and starts this sandbox as part of the same
verified release. The API has no host port. Only the existing BookMyBus gateway
can reach it through the `bookmybus-crs_integration` network.

## Prepare test inventory and issue a provider token

After the API is healthy, run the seed once. It is idempotent and prints the
operator ID, provider ID, and the two upcoming travel dates.

```bash
docker exec -i bookmybus-crs-car-sandbox-api-1 npm run prepare-sandbox
```

To issue a 45-minute provider token for that operator and provider, run:

```bash
docker exec -i bookmybus-crs-car-sandbox-api-1 npm run provider-token -- OPERATOR_ID PROVIDER_ID
```

Give the token to the intended provider through a private channel only. Provider
tokens are restricted to that operator's inventory and the bookings created by that
provider.

## Verify from outside the VPS

Use a bearer token in these requests:

```bash
curl -fsS -H 'Authorization: Bearer TOKEN' https://partner.bookmybus.pro/api/v1/car/cities
curl -fsS -H 'Authorization: Bearer TOKEN' https://partner.bookmybus.pro/api/v1/car/openapi.json >/dev/null
```

Swagger is available at:

`https://partner.bookmybus.pro/api/v1/car/docs/`

Use the browser UI as reference only. It intentionally does not submit requests or
persist bearer credentials. Test actual booking flows with the supplied Postman
collection.

## Rollback

Use the last known-good immutable image reference in `release.env`, then run the
same `docker compose up -d` command. Do not remove the Mongo volume unless the
sandbox data is deliberately being discarded.
