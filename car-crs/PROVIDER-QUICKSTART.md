# AiCar provider quickstart

Use this kit to book and cancel a sample Pune–Mumbai car journey. Run Postman Desktop on the computer hosting the local sandbox. Each run creates two synthetic bookings and cancels both. Payment and refund amounts represent sandbox accounting entries.

| Connection | Local value |
| --- | --- |
| Base URL | `http://127.0.0.1:4010/api/v1/car` |
| API reference | [Browse Swagger](http://127.0.0.1:4010/api/v1/car/docs/) or open the included `openapi.json` |
| Authorization | `Authorization: Bearer <providerToken>` on requests from your backend or Postman |

## Start in Postman

1. Ask your AiCar onboarding contact for the **45-minute token issued to your provider**, the outbound date and the return date. Use the dates assigned to your test inventory. Keep your token in a private local environment.
2. In a fresh Postman workspace, import `local-booking.postman_collection.json` and `provider.postman_environment.json`. Select **AiCar provider sandbox**. Fill in the local values for `providerToken`, `journeyDate` and `returnDate`. Paste just the token value. Enter each date as `YYYY-MM-DD`.
3. Open **01 · Authentication and inventory → Discover cities** and click **Send**. With the demo inventory assigned, the response is HTTP 200 with `{"data":["Mumbai","Pune"]}`. The collection adds the Bearer header automatically.
4. Run the **whole collection**, all four folders in order, with one iteration. The first request deliberately omits authorization and passes on HTTP 401. The remaining requests use your token. The expected result is **34 requests and 34 passing checks**.
5. In each booking folder, inspect **Retrieve issued tickets** for the PNR and seats. Look at **Read refund outcome** and the final seat checks for the result after cancellation.

The equivalent first request in PowerShell, with your token already in `$env:AICAR_PROVIDER_TOKEN`, is:

```powershell
$api = 'http://127.0.0.1:4010/api/v1/car'
$headers = @{ Authorization = "Bearer $env:AICAR_PROVIDER_TOKEN" }
Invoke-RestMethod -Uri "$api/cities" -Headers $headers
```

## Implement a booking in your backend

All paths below are relative to the base URL. Use IDs, dates, seat IDs and amounts from the preceding responses. Successful responses wrap the result in `data`. Amounts are integer INR paise (50,000 paise = ₹500).

| Step | Request | What to do with the result |
| --- | --- | --- |
| Find a car | `GET /trips/search?source=Pune&destination=Mumbai&journeyDate=YYYY-MM-DD` | Save a trip's `_id`. For a return journey, use `POST /trips/round-trip-search` and select both legs. |
| Choose a seat | `GET /trips/{id}/seats` | Select an available, bookable passenger seat from each leg. |
| Quote the fare | `POST /fares/quote` | Send `outboundTripId` and `outboundSeatIds`. Include both return fields for a round trip. Save `grandTotalPaise`. |
| Hold the seats | `POST /holds` or `POST /holds/round-trip` | Save the hold ID for each leg and `expiresAt`. You can release an unused hold with `DELETE /holds/{id}`. |
| Confirm | `POST /bookings/confirm` | Send the held seats, passengers, contact, sandbox payment and a unique `idempotencyKey` in the JSON body. Save the exact request, `data.booking._id` and `data.pnr`. |
| Retrieve tickets | `GET /bookings/{id}/tickets` | Use your booking ID or PNR. A one-way booking has one ticket. A round trip has an outbound and a return ticket under the same PNR. |
| Cancel and check refund | `POST /bookings/{id}/cancellation-quote` → `POST /bookings/{id}/cancel` → `GET /bookings/{id}/refund-status` | Review `cancellationFeePaise` and `refundablePaise`. Submit a cancellation reason, then read the payment and leg statuses. |

## Recover from a failed request

| What you see | What to do |
| --- | --- |
| Connection refused | Check that the local car sandbox is listening on port 4010 on the same machine as Postman. |
| HTTP 401 | Check the selected environment and the local token value. For an expired token, request a new token for the **same provider and operator** to continue an existing booking. |
| HTTP 200 with no cities or trips | Confirm the operator assignment, route and scheduled dates with your contact. A fresh token alone does not create inventory. |
| HTTP 410 with `HOLD_EXPIRED` or `RETURN_HOLD_EXPIRED` | Refresh availability, quote again and obtain fresh holds. Use a new booking key for the new request. |
| Confirmation times out | Retry the **identical confirmation body with the same key**. On a successful replay, check the returned booking ID and PNR. If you already have the PNR, check `GET /bookings/{pnr}`. |
| HTTP 409 with `IDEMPOTENCY_CONFLICT` | The key is already associated with another request. Recover the original outcome before starting another booking. |

For support, send your onboarding contact the operation, HTTP status, `error.code`, test time with timezone, and sandbox PNR if available. Remove authorization headers and passenger details from any shared output.
