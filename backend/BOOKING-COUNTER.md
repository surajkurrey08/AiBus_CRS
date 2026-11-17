# Booking Counter integration

The counter extends the existing operator API and the same `Trip.seats`, `SeatHold`, `Booking`, `Payment`, `Ticket`, `Offer`, cancellation and outbox collections. It is not another reservation database. React uses existing branding, sidebar, panels, controls and authentication. `SeatMap` is shared with the existing seat inventory screen.

## Added endpoints (all under /api/v1/operator)

| Endpoint                          | Purpose                                                                               | Permission                       |
| --------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------- |
| GET /counter/trips                | Operator-owned route/date trip search, availability and immutable bus layout metadata | read                             |
| GET /counter/trips/:id/bookings   | Paginated source-filtered booking records and source counts                           | read; PII requires manifest:read |
| GET /pricing-policy               | Read explicitly configured taxes, charges and passenger requirements                  | read                             |
| PUT /pricing-policy               | Versioned pricing configuration                                                       | pricing:write                    |
| POST /trips/:id/quote             | Expiring server quote, optionally bound to a hold                                     | bookings:write                   |
| PATCH /trips/:id/booking-status   | Versioned stop/resume of new booking acceptance                                       | routes:write                     |
| POST /trips/:id/quota             | Named quota assignment/release using atomic trip writes                               | inventory:write                  |
| PATCH /bookings/:id/passengers    | Versioned contact/passenger edits; seats and money cannot change                      | bookings:write                   |
| POST /bookings/:id/cancel-pending | Cancel an unpaid pending booking and release only its matching held seats             | bookings:write                   |
| GET /bookings/:id/payments        | Read recorded payment metadata, with no secrets/card data                             | finance:read                     |
| GET /bookings/:id/ticket.html     | Printable/downloadable HTML e-ticket from a valid authoritative ticket                | manifest:read                    |

Existing holds, block/unblock, booking creation, manifest and cancellation-request endpoints are reused. Booking creation accepts `quoteId`, passenger age/gender/email/dropping, contact and optional GST information. It rejects unknown fields including client totals, tax rates, operator IDs and booking sources.

## Explicit business decisions

- An authorized operator must configure a pricing policy before new bookings can be priced. No tax rate is assumed. Existing records/tickets are preserved; configure a policy as part of the upgrade. Tests explicitly configure zero-tax fixture policies.
- Fares are stored in integer paise in the existing trip snapshot. A policy specifies tax in basis points, additional booking charges, whether those charges are taxable, and a maximum operator discount. Tax is added to the discounted fare and, only when configured, taxable charges. All calculations and rounding occur on the server. Coupon and operator discount cannot stack.
- An operator discount requires both pricing permission and a positive configured limit. Policy changes invalidate previous quotes. Quotes expire within two minutes and never outlive their held seats. Booking creation recomputes and compares pricing, and atomically consumes a matching quote/hold.
- Quota seats are named allocations, not confirmed tickets. They cannot be held or booked until an inventory-authorized staff member releases that quota. Expired holds are evaluated in atomic predicates, not by browser colors.
- Stopping a trip blocks new holds and new pending booking creation. It does not invalidate already created pending-payment bookings or existing confirmed tickets. Captured money arriving after a pending cancellation must enter reconciliation, never claim a released seat.
- Counter-created bookings always have source `operator`, assigned server-side. Trusted backend integrations can call the shared `createBooking(auth, input, idempotencyKey, channel)` service with a verified channel context. That parameter is not accepted from the operator HTTP request. Customer, agent and external labels display bookings actually received from those trusted channels; those labels do not imply that the external integrations are configured.
- Passenger modifications preserve seats, monetary values, check-in data and recorded pricing. Concurrent changes use a version conflict response. Client tax/total/payment status changes cannot be submitted through this route.
- Passenger and contact drafts remain component-local and are cleared after saving/logout. Holds are released through an explicit action; leaving the counter warns about unsaved details. Hold expiration remains authoritative on the server.

## External integration gates

Razorpay Test Mode now supports payments for internal inventory; see [setup](RAZORPAY.md). No customer/agent application source or external reservation-provider contract was supplied. Those channels must call the same shared engine from their authenticated backend integrations; do not write trip inventory directly or accept a client-supplied `source` as proof of origin. Imported inventory continues to report unavailable rather than using a conflicting local availability copy.

The counter creates **pending** bookings. It never fabricates captured payment, valid PNR, provider confirmation, completed cancellation or refund. The existing verified-payment service is the only internal confirmation path. Confirm/print/download buttons remain unavailable until authoritative status permits them. Confirmed cancellations use the existing policy/request workflow; actual provider cancellation/refund execution still requires the adapters documented in README.md. Ticket download is an HTML e-ticket that can be printed or saved as PDF by the browser.

The counter follows the user-supplied CRS layout references and the shared Aibus theme.
