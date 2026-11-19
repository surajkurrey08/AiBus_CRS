# AIBUS CRS — End-to-End (E2E) Verification & Manual QA Protocol

This protocol guides automated and manual end-to-end verification of Phase 1 through Phase 6 in the AIBUS Central Reservation System (CRS).

---

## 1. Automated Execution via Playwright

The project includes Playwright test suites configured in [playwright.config.ts](file:///E:/Worknai%20Projects/AiBus/CRS/playwright.config.ts).
The configuration automatically targets the locally installed system Google Chrome (`channel: "chrome"`) without requiring any external browser downloads or administrator privileges.

### Prerequisites

Start the development servers:
```bash
# Terminal 1: Backend API (port 4000)
npm run dev -w backend

# Terminal 2: Operator Dashboard (port 5173)
npm run dev -w frontend

# Terminal 3: Admin Dashboard (port 5174)
npm run dev -w admin
```

### Running Automated E2E Tests

```bash
# Run Security isolation suite (standalone)
npx playwright test tests/e2e/security/

# Run Admin dashboard suite (requires backend + admin running)
npx playwright test tests/e2e/admin/

# Run Operator dashboard suite (requires backend + frontend running)
npx playwright test tests/e2e/operator/

# Run all suites
npx playwright test
```

---

## 2. Reproducible Manual QA Protocol

### Suite A: Platform Admin Console & Operations Health

1. **Platform Login**
   - Navigate to `http://127.0.0.1:5174/`.
   - Submit bootstrap credentials (`BOOTSTRAP_EMAIL` / `BOOTSTRAP_PASSWORD`).
   - Verify: JWT access token issued; redirects to platform overview.
2. **Operations Console (`/platform/operations/health`)**
   - Click **Operations Monitor**.
   - Verify: Displays MongoDB connection state, background job lease states, request metrics bucketed by minute, and worker health latency.
   - Verify: No database secrets (`JWT_SECRET`, `RAZORPAY_KEY_SECRET`) are visible in network responses or DOM.
3. **Background Job Inspection & Rearm**
   - Verify: Job table displays `hold-expiry`, `razorpay-reconciliation`, `wallet-expiry`, `refund-reconciliation`, `external-bookings`, `integrity-scan`, and `inventory-outbox`.
   - In simulated failure (state = `Manual review`), verify that "Review restart" button appears for admins with `platform:settings:write`.
   - Verify: Requires password verification and reason; audits action under `operations.job-rearmed`.
4. **Platform-Wide Exception Monitoring**
   - View `/platform/operations/issues`.
   - Verify: Filters by status (`Open` / `Resolved`) and operator scope.
   - Verify: Read-only observation — viewing issues does not mutate bookings or journals.

---

### Suite B: Operator Trip Operations & Reliability

1. **Operator Login**
   - Navigate to `http://127.0.0.1:5173/`.
   - Login as approved Operator Admin.
2. **Trip Master & Reservation Integrity Scanner**
   - Open a scheduled service trip in **Trip Master**.
   - Click **Check reservation integrity**.
   - Verify: Displays snapshot discrepancies (e.g. booked seat without confirmed owner, expired holds pending cleanup).
   - Verify: Read-only behavior — inventory seat states, bookings, and ledger accounts remain untouched.
3. **Trip Incidents**
   - Under trip operations, record an operational incident (Delay, Breakdown, Safety, Other).
   - Enter reason and time; click save.
   - Verify: Idempotent submission via `Idempotency-Key`. Re-submitting with identical key does not create duplicates.
   - Verify: Future timestamps are rejected with HTTP 400.
4. **Operational Reports**
   - Navigate to **Reports** section.
   - Select report category (e.g., `seat-occupancy`, `departure-delays`, `bus-utilization`).
   - Enter Date range and click **Load detailed report**.
   - Verify: Displays policy disclaimer: *"Operational observations only; null means no actual measurement. Not accounting revenue."*
   - Verify: `fuel-expenses` is restricted to operators with explicit `finance:read` permission.
   - Click **Export operational CSV**; verify RFC 4180 output with formula escape protection (`'`).

---

### Suite C: Booking Counter & Seat Reservation Flow

1. **Bus Search & Selection**
   - Navigate to **Booking Counter**.
   - Search route (e.g. Hyderabad → Bangalore).
2. **Seat Selection & Hold Expiry**
   - Select seat (e.g. `L1`).
   - Verify: Seat state transitions to `held` with durable timestamp `holdUntil`.
   - Wait for hold duration (or observe background worker); verify expired hold transitions back to `available`.
3. **Test-Mode Booking Confirmation**
   - Enter passenger details and confirm hold.
   - In test mode, complete payment with mock Razorpay transaction.
   - Verify: Seat transitions from `held` to `booked` with matching `bookingId`.
   - Verify: Ticket generated with single `valid` status.
   - Verify: PNR can be retrieved from booking search.
4. **Double-Booking Prevention**
   - In a second incognito browser tab, attempt to select seat `L1` concurrently.
   - Verify: Returns HTTP 409 conflict; second passenger cannot claim the seat.

---

### Suite D: Multi-Tenant Security & Isolation

1. **Cross-Operator Scope Isolation**
   - Log in as Operator A in Window 1 and Operator B in Window 2.
   - In Window 2, attempt to query Operator A's trip integrity or issues via API:
     `GET /api/v1/operator/operations/trips/{tripId_A}/integrity`
   - Verify: Returns HTTP 404 (or 403 Foreign operator scope). Operator A's data is never returned.
2. **Session Revocation**
   - In Admin console, revoke sessions for a specific staff user.
   - In user's active session, attempt any operational or financial request.
   - Verify: Immediate HTTP 401 Unauthorized; user redirected to login.
