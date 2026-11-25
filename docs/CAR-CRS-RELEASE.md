# Car CRS release

This release connects the existing pending Car Master, Route Master, Car Trip
Master, seat designer, counter, agency report, Admin and Partner changes to the
deployed applications. Prototype files under the separate local `car-crs` folder
are not a second deployed backend. Existing bus records and API routes remain
available; no existing records are converted, reset or deleted.

## Reservation and financial behavior

- Creating a booking keeps it pending until verified gateway payment, approved
  agency wallet/credit funding, or explicit operator acknowledgement of cash.
- Counter cash confirmation reuses the transaction-protected confirmation engine,
  validates the original unexpired hold and current seat/booking ownership,
  records a unique payment and balanced journal, and issues one ticket.
- A booking with an existing gateway order must be reconciled before cash can be
  accepted. Agents cannot use operator cash confirmation.
- Daily agency screens are sales reconciliation reports. Marking a report
  reviewed is audited and does not transfer funds, debit a wallet or repay credit.
  Existing financial ledger/settlement workflows remain authoritative.
- A vehicle write serializes concurrent trip scheduling. Missing tenant-owned
  routes are rejected instead of inventing pickup/dropoff records. Driver seats
  cannot be held, and booked/blocked seats remain unavailable for booking.
- API failures never replace live car or trip records with demonstration data.

## Deployment review

Install only the new Car and DailyAgentSettlement model indexes after checking
duplicate registration/report keys. Do not rebuild existing Trip/Bus indexes or
run a database reset. Production retains `autoIndex:false`.

Car fields are additive. A rollback to the previous bus-only UI will not display
the new modules. The new counter-cash ledger account is not understood by older
financial validation code: do not authorize an automatic downgrade after cash
activity without reviewing those journals. Preserve the provenance-aware sandbox
backend during a control-plane rollback. Image rollback does not reverse business
records or financial transactions.

Actual Razorpay checkout still requires valid matching gateway credentials;
automated test fixtures are not evidence of a completed live payment.
