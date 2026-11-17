# Trip Master

Operator sidebar → **Trip Master**. Existing buses, seat layouts and routes are reused.

1. Create a service with its route, default bus/crew, departure time (IST), weekdays and separate double/single side fares per passenger.
2. Open Multi-trip scheduling, select services and dates, preview, then schedule. A batch has at most 100 journeys; all new journeys commit together. Existing service/date journeys are skipped, including cancelled journeys (shown in preview). Use single-trip scheduling for a deliberate replacement or exception. Single-trip scheduling also accepts an optional service. Routes and Scheduled trips/calendar now live inside Trip Master; the separate Routes sidebar page has been consolidated. Bus creation/editing and layout configuration are under Master ? Bus Master ? Vehicles.
3. Check availability for an explicit journey date. Use Booking Counter for bookings and existing quota management.
4. Record actual stages in Trip tracker: Scheduled → Boarding → Departed → Arrived → Completed. Departure closes new bookings. Record odometers at departure/arrival and measured consumption at arrival for mileage reports.
5. Add fuel purchases and stop visits. Expenses can be voided with a reason. Reports calculate delay from actual vs planned times, distance from odometers, mileage from measured consumption, and pickup/drop counts from confirmed passengers.
6. Register tablets, assign to one active trip, and unassign before reusing them. Optional crew assignments are supported by the API.
7. Create related/connection links. Connections validate city continuity, transfer time and cycles. Links do not combine bookings or payments.
8. Create Agent/Branch partners and service/trip commission rules. Select an optional referral in the counter. Default commission basis is fare after discounts, excluding taxes/charges. A trip rule takes precedence over a service rule. Percent uses basis points; fixed amounts apply per booking. Existing bookings keep the recorded commission snapshot. Settlement payouts are separate.

## Implementation

- React: `frontend/src/features/trip-master/` with shared DataTable and Overlay.
- API: `backend/src/routes/trip-master.routes.ts` mounted under `/api/v1/operator/trip-master`.
- Logic: `services/trip-scheduling.service.ts`, `trip-master.service.ts`, `commission.service.ts`.
- Mongo models: bus-service, trip-operation, trip-fuel, trip-stop-record, trip-tablet, tablet-assignment, trip-link, sales-partner and commission-rule under `backend/src/models/`.
- All records are tenant scoped and permission checked. Scheduling uses Mongo transactions, bus/crew conflict checks and unique service/day indexing. Operational events, fuel and stop recording require `Idempotency-Key`; stage changes also require `expectedVersion`.
- Run `npm run indexes -w backend` after updating an existing database. Existing indexes are preserved.
- Authenticated OpenAPI: `/api/v1/openapi.json` and `/api/v1/docs`.

Live GPS, telemetry ingestion and Revmax are not connected. Configure coordinates in Area Master and GPS mappings in Bus Master; actual tracking needs provider documentation, credentials and ingestion integration. No simulated coordinates are used.
