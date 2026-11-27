# AiCar provider sandbox

### Provider handoff

The [provider quickstart](PROVIDER-QUICKSTART.md), [blank environment](postman/provider.postman_environment.json), tested [collection](postman/local-booking.postman_collection.json) and [OpenAPI contract](src/docs/openapi.json) are the four shareable files. Package them from the repository root:

```powershell
Compress-Archive -LiteralPath car-crs/PROVIDER-QUICKSTART.md,car-crs/postman/provider.postman_environment.json,car-crs/postman/local-booking.postman_collection.json,car-crs/src/docs/openapi.json -DestinationPath ./aicar-provider-kit.zip -Force
```

Run `npm.cmd run car:sandbox-prepare` to obtain the fixture operator ID and both dates. Assign a distinct 24-hex provider ID to each partner and retain the mapping. For a new ID, run `node -e "console.log(require('node:crypto').randomBytes(12).toString('hex'))"`. Issue a token via `npm.cmd run car:sandbox-token -- OPERATOR_ID PROVIDER_ID`. Supply the token from the private `.cache/car-sandbox/provider-token` file through your agreed private channel. Give the provider the two scheduled dates. Renew with the same IDs. Keep the signing key and populated environment with the sandbox owner.

Open [Car Swagger UI](http://127.0.0.1:4010/api/v1/car/docs/) to browse the 17 provider operations. Import the [OpenAPI JSON](http://127.0.0.1:4010/api/v1/car/openapi.json) into Postman and set the server to `http://127.0.0.1:4010/api/v1/car`. Use Swagger for reference and Postman or a backend client for requests.

## Run locally

From the repository root with the project dependencies installed, run:

```powershell
npm.cmd run infra:up
npm.cmd run dev:car-sandbox
```

The launcher listens on IPv4 loopback and uses MongoDB on port 27018, replica set `rs0`, database `aibus_car_crs_sandbox_local`. A new database has no trips. The local Partner Portal's API Documentation page links to Car Swagger. The existing bus sandbox has its own contract and data at `/api/v1/public`.

## Make the first request

### Run the local Postman booking flow

With the car sandbox running, open a second terminal at the repository root:

```powershell
npm.cmd run car:sandbox-prepare
```

This prepares a four-passenger sedan and dated Pune–Mumbai and Mumbai–Pune trips in the local car database. The command prints the travel dates and writes a private environment with a 45-minute demo provider token. Run it again to refresh the token and select upcoming dates. On the same day it reuses the trips and preserves their seat state.

1. In Postman Desktop import [the local booking collection](postman/local-booking.postman_collection.json) and `.cache/car-sandbox/aicar.local.postman_environment.json`.
2. Select the **AiCar localhost** environment and run the whole collection in order with one iteration. Keep the populated environment private.
3. Inspect **Retrieve issued tickets** for the PNR and leg details. Each flow creates its own booking, retries confirmation with the same key, then cancels it and checks the sandbox refund and released seats. A round trip produces two tickets under one PNR.

From PowerShell, the same collection can be run with Newman:

```powershell
npm.cmd exec --yes --package=newman@6.2.1 -- newman run car-crs/postman/local-booking.postman_collection.json -e .cache/car-sandbox/aicar.local.postman_environment.json --bail --ignore-redirects
```

### Use your own local fixture identities

For local development the sandbox owner issues a token for a provider assigned to one operator. Use the operator ID that owns the sample inventory and a stable, distinct provider ID for each partner. Both are 24 hexadecimal characters. In a second PowerShell window, from the repository root:

```powershell
npm.cmd run car:sandbox-token -- YOUR_OPERATOR_ID YOUR_PROVIDER_ID
$token = (Get-Content -Raw .cache/car-sandbox/provider-token).Trim()
$headers = @{ Authorization = "Bearer $token" }
Invoke-RestMethod 'http://127.0.0.1:4010/api/v1/car/cities' -Headers $headers
```

A token lasts 45 minutes. Issue a new one with the same two IDs to resume work on the same bookings. In Postman use Bearer Token authorization. Keep token values and the local signing key on the developer machine. A valid token with no inventory returns `{"data":[]}` from the cities endpoint. The local token issuer is for testing only.

## Booking sequence

1. Read cities and routes. Search with the assigned cities and an actual scheduled journey date. For a round trip select both legs.
2. Read the seat maps, then request a fare quote. Use the returned seat IDs and amounts in integer INR paise.
3. Create the hold and save its ID and expiry. For a round trip save both hold IDs.
4. Confirm before expiry with passenger details, sandbox payment and a unique `idempotencyKey` in the JSON body. After a lost response retry the identical body and key. Save the returned booking ID and PNR.
5. Retrieve the tickets by booking ID or PNR. To cancel, obtain a cancellation quote first, then submit the reason. Read the refund status to see the sandbox accounting outcome.

The service limits inventory to the token's operator and booking access to the provider who created it. Paid and refunded statuses describe local sandbox records. Live payment collection, external provider onboarding and VPS deployment are outside this local setup.
