# Aibus operator workspace

Compact dispatch workspace for an Indian bus operator. Signature: departure board with occupancy tracks and precise sleeper inventory.

Shared runtime theme: src/styles/theme.css, loaded after base styles.css and workflow styles. The latest customer-booking screenshot supersedes the earlier blue/gray CRS palette. Header #FFFDF9, burnt-orange action #C4522B (hover #A94322), warm canvas #FAF7F2, white cards, ink #17201C, border #E4E7EC and blue focus #2563EB. Soft orange #FFF0E8 identifies selected navigation and services. Named brand tokens own these values; legacy --crs-blue and --crs-action alias --brand-accent. All twelve pages, authentication forms, dialogs and the counter inherit the theme. Compact typography and the labeled 80px sidebar (64px on phones) remain; hide/show removes the full rail and keeps its toggle in the header. Controls use 8px corners, panels 10px. Operational seat states retain distinct semantic colors.

English India, INR, Asia/Kolkata. Normal runtime uses authenticated backend data. Native selects and dates use platform geometry. Shared tables, forms, dialogs and notifications preserve the visual system. Access tokens stay in memory; passenger records and business edits are not stored in localStorage. Explicit test fixtures are isolated from the default live workspace. Semantic controls, focus indicators, reduced motion and print support remain canonical.

## Booking Counter extension

The user supplied a BusCRS booking screenshot as the explicit visual reference and subsequently approved that style for every page. Shared shell, table, panel, form and dialog styles now live in workspace-crs.css. The counter retains a 34% seat-chart column and 66% booking column, green available berths and yellow selected berths. Both decks appear side by side with Up/Dn column labels. Actual row/column positions and fare values remain server-owned. Tablet layouts put search before the seat map.

Counter variant runtime owner: src/styles/counter-crs.css, imported after src/styles/booking-counter.css. Named tokens: --crs-blue and --crs-action alias the shared orange accent, --crs-selected #FFEADC, --crs-available #F0F8F1, --crs-line inherits the shared border token. Arial/system sans provides the reference's utilitarian counter typography; tabular numbers are inherited. Fare outputs use the current server quote and display a dash before a quote is available. The passenger-form preview is disabled until seats are held. No decorative or unsupported action buttons are added from the reference.

Selected seats are not confirmations. Booked, held, blocked and quota seats have labels/symbols as well as color. Tax and charge rates come from an explicitly configured server pricing policy. No client-calculated amount, payment result or PNR is authoritative.

Counter readability refinement: deck-wide Lower/Upper headings include seat counts; a dedicated 14px grid separator distinguishes the decks without changing backend coordinates. Rounded 74px sleeper berths use a pillow detail, pale green availability, orange selected borders and a selection check; seater tiles retain a distinct shorter shape. A front/driver orientation strip clarifies direction. The redundant workspace-status strip is hidden on the counter only.

Sidebar clarity: each action uses a distinct icon plus a persistent short caption. Counter uses Calculator, bookings TicketCheck, passenger manifest ClipboardList, cancellations TicketX and offers BadgePercent. Full names remain available through accessible labels and native tooltips.

Header refinement: the operator header now uses warm white, dark text, orange current-page emphasis, a soft orange sidebar toggle/avatar and a warm neutral divider. This replaces the customer reference’s dark header to match the operator canvas more closely.

Trip Master continues the canonical warm theme and shared table/dialog controls. The section distinguishes recurring services from dated trips, and recorded actual operations from unconnected GPS telemetry. Dense operational tables use horizontal scrolling on small screens. The Trip Master sidebar caption and CalendarClock icon remain visible alongside Bus Master and Area Master.


Navigation consolidation: the compact sidebar now exposes Master instead of separate Fleet and Routes entries. The dedicated Master page offers three responsive cards for Bus Master, Area Master and Trip Master; module breadcrumbs link back to this page. Vehicle CRUD and layout configuration live in Bus Master / Vehicles. Routes and calendar/single-trip scheduling are tabs within Trip Master. Seats and Counter remain independent operational tools.


All three Master modules use the shared grouped section navigation: a 210px secondary rail with 44px rows on desktop and a native compact selector on smaller screens. The active row uses the established soft orange fill and inset accent. This replaces crowded wrapping tab strips while preserving the global sidebar and content width constraints.
