import { Armchair, RotateCw } from "lucide-react";
import { useState } from "react";
import { money } from "../../data/demo-data.ts";
import "../../styles/booking-counter.css";
import { Panel } from "../index.ts";

export interface InventorySeat {
  number: string;
  deck: "lower" | "upper";
  row: number;
  column: number;
  category: "sleeper" | "seater" | "driver" | "front_passenger" | "window" | "middle" | "rear_window" | "aisle";
  farePaise: number;
  state: "available" | "booked" | "held" | "blocked" | "quota";
  quotaLabel?: string;
  isDriver?: boolean;
  isBookable?: boolean;
  label?: string;
  bookedByChannel?: "operator" | "agent" | "customer" | "external";
  bookedByName?: string;
  bookedPnr?: string;
  bookedPassengerName?: string;
}

export function SeatMap({
  seats,
  selected,
  onToggle,
  disabled = false,
  loading = false,
  error = "",
  onRefresh,
  selectable = ["available", "blocked", "quota"],
  title = "Seat inventory",
  heldSeats = [],
  variant = "inventory",
}: {
  seats: InventorySeat[];
  selected: string[];
  onToggle: (number: string) => void;
  disabled?: boolean;
  loading?: boolean;
  error?: string;
  onRefresh?: () => void;
  selectable?: string[];
  title?: string;
  heldSeats?: string[];
  variant?: "inventory" | "counter-chart";
}) {
  const [deck, setDeck] = useState<"lower" | "upper">("lower");

  // Pure Car CRS detection:
  // Must NOT have upper deck, and must have car seat indicators (D, FP, driver, 2L/2M/2R, etc.)
  const isCar =
    !seats.some((s) => s.deck === "upper") &&
    seats.some(
      (s) =>
        s.number === "D" ||
        s.number === "FP" ||
        s.isDriver ||
        s.category === "driver" ||
        s.category === "front_passenger" ||
        ["2L", "2M", "2R", "3L", "3M", "3R"].includes(s.number),
    );

  // Detect 6/7-seater MUV/SUV vs 4-seater Sedan
  const isMuv =
    seats.some((s) => s.row === 3 || s.number.startsWith("3")) ||
    seats.filter((s) => !s.isDriver && s.number !== "D").length >= 6;

  const decks = (["lower", "upper"] as const).filter((d) =>
    seats.some((s) => s.deck === d),
  );
  const active = decks.includes(deck) ? deck : decks[0] || "lower";
  const chart = variant === "counter-chart";
  const visible = chart || isCar ? seats : seats.filter((s) => s.deck === active);

  const deckColumns = (d: string) =>
    Math.max(1, ...seats.filter((s) => s.deck === d).map((s) => s.column + 1));
  const columns = chart
    ? decks.reduce((n, d) => n + deckColumns(d), 0)
    : Math.max(4, ...visible.map((s) => s.column + 1));

  // Rows mapping for Car Cabin layout
  const rowsMap: Record<number, InventorySeat[]> = {};
  if (isCar) {
    seats.forEach((seat) => {
      const r =
        seat.row ||
        (seat.number.startsWith("3")
          ? 3
          : seat.number.startsWith("2")
            ? 2
            : 1);
      if (!rowsMap[r]) rowsMap[r] = [];
      rowsMap[r].push(seat);
    });
    Object.values(rowsMap).forEach((r) => r.sort((a, b) => a.column - b.column));
  }

  // Count stats calculation:
  // In Car CRS, Driver seat 'D' is dedicated cockpit and NOT counted as a blocked passenger seat!
  const bookableSeats = seats.filter((s) => s.number !== "D" && !s.isDriver);
  const inventoryCounts = isCar
    ? [
        ["Bookable", bookableSeats.length],
        ["Available", bookableSeats.filter((s) => s.state === "available").length],
        ["Booked", bookableSeats.filter((s) => s.state === "booked").length],
        ["Held", bookableSeats.filter((s) => s.state === "held").length],
        ["Blocked", bookableSeats.filter((s) => s.state === "blocked").length],
        ["Driver", seats.some((s) => s.number === "D" || s.isDriver) ? 1 : 0],
      ]
    : [
        ["Total", seats.length],
        ["Booked", seats.filter((s) => s.state === "booked").length],
        ["Available", seats.filter((s) => s.state === "available").length],
        ["Blocked", seats.filter((s) => s.state === "blocked").length],
        ["Held", seats.filter((s) => s.state === "held").length],
        ["Quota", seats.filter((s) => s.state === "quota").length],
      ];

  const renderCarSeat = (seat: InventorySeat) => {
    const isDriverSeat = seat.number === "D" || seat.category === "driver" || seat.isDriver;
    const mine = heldSeats.includes(seat.number);
    const isSelected = selected.includes(seat.number);
    const state = isSelected ? "selected" : seat.state;
    const ariaLabel = `${seat.number}, ${mine ? "held by you" : seat.state}, ${seat.farePaise / 100} rupees${seat.quotaLabel ? `, quota ${seat.quotaLabel}` : ""}`;

    if (isDriverSeat) {
      return (
        <button
          type="button"
          key={seat.number}
          className="berth car-seat car-driver-seat disabled"
          aria-label={ariaLabel}
          aria-pressed={false}
          disabled={true}
          title="Driver Cockpit — Strictly Non-Bookable"
        >
          <div className="car-seat-headrest" />
          <div className="driver-title">
            <span className="car-steering-icon" aria-hidden="true">🛞</span>
            <span>D</span>
          </div>
          <span className="driver-sub">LOCKED</span>
        </button>
      );
    }

    const isFront = seat.number === "FP" || seat.category === "front_passenger";
    const isMiddle = seat.number.endsWith("M") || seat.category === "middle";
    const isWindow = seat.number.endsWith("L") || seat.number.endsWith("R") || seat.category === "window";
    const bookedChannelClass =
      seat.state === "booked"
        ? seat.bookedByChannel === "operator"
          ? "booked-operator"
          : seat.bookedByChannel === "agent"
            ? "booked-agent"
            : seat.bookedByChannel === "customer" || seat.bookedByChannel === "external"
              ? "booked-api"
              : ""
        : "";

    const badgeText =
      seat.state === "booked"
        ? seat.bookedByChannel === "operator"
          ? "Counter"
          : seat.bookedByChannel === "agent"
            ? "Agent"
            : seat.bookedByChannel === "customer" || seat.bookedByChannel === "external"
              ? "API"
              : "Booked"
        : isFront
          ? "+10%"
          : isMiddle
            ? "-10%"
            : isWindow
              ? "Win"
              : seat.quotaLabel || "";

    const hoverTitle =
      seat.state === "booked"
        ? `Seat ${seat.number} · BOOKED\n` +
          `Booked By: ${seat.bookedByName || (seat.bookedByChannel === "operator" ? "Operator Counter" : seat.bookedByChannel === "agent" ? "Travel Agent" : "API / Customer App")}\n` +
          `Passenger: ${seat.bookedPassengerName || "—"}\n` +
          `PNR: ${seat.bookedPnr || "—"}\n` +
          `Fare: ${money(seat.farePaise / 100)}`
        : seat.quotaLabel
          ? `Quota: ${seat.quotaLabel}`
          : `${seat.number} (${badgeText}) · ${money(seat.farePaise / 100)}`;

    return (
      <button
        type="button"
        key={seat.number}
        className={`berth car-seat passenger-seat ${state} inventory-${seat.state} ${bookedChannelClass} ${isFront ? "front-seat" : ""} ${isMiddle ? "middle-seat" : ""}`}
        aria-label={ariaLabel}
        aria-pressed={isSelected}
        disabled={disabled || loading || !selectable.includes(seat.state)}
        title={hoverTitle}
        onClick={() => onToggle(seat.number)}
      >
        <div className="car-seat-headrest" />
        <div className="car-seat-top">
          <strong className="car-seat-code">{seat.number}</strong>
          {badgeText && <span className="car-seat-pill">{badgeText}</span>}
        </div>
        {seat.state !== "available" && (
          <span aria-hidden="true" className="counter-seat-state-mark">
            {seat.state === "quota"
              ? "Q"
              : seat.state === "blocked"
                ? "×"
                : seat.state === "booked"
                  ? "B"
                  : "H"}
          </span>
        )}
        <small className="car-seat-price">{money(seat.farePaise / 100)}</small>
      </button>
    );
  };

  const renderSeat = (seat: InventorySeat) => {
    if (isCar) return renderCarSeat(seat);

    const mine = heldSeats.includes(seat.number);
    const isSelected = selected.includes(seat.number);
    const state = isSelected ? "selected" : seat.state;
    const bookedChannelClass =
      seat.state === "booked"
        ? seat.bookedByChannel === "operator"
          ? "booked-operator"
          : seat.bookedByChannel === "agent"
            ? "booked-agent"
            : seat.bookedByChannel === "customer" || seat.bookedByChannel === "external"
              ? "booked-api"
              : ""
        : "";
    const hoverTitle =
      seat.state === "booked"
        ? `Seat ${seat.number} · BOOKED\n` +
          `Booked By: ${seat.bookedByName || (seat.bookedByChannel === "operator" ? "Operator Counter" : seat.bookedByChannel === "agent" ? "Travel Agent" : "API / Customer App")}\n` +
          `Passenger: ${seat.bookedPassengerName || "—"}\n` +
          `PNR: ${seat.bookedPnr || "—"}\n` +
          `Fare: ${money(seat.farePaise / 100)}`
        : seat.quotaLabel
          ? `Quota: ${seat.quotaLabel}`
          : seat.number;

    return (
      <button
        type="button"
        key={seat.number}
        className={`berth ${state} inventory-${seat.state} ${bookedChannelClass} deck-${seat.deck} ${seat.category === "seater" ? "seater" : ""}`}
        style={{
          gridRow: seat.row + (chart ? 2 : 1),
          gridColumn:
            seat.column +
            1 +
            (chart && seat.deck === decks[1] ? deckColumns(decks[0]) + 1 : 0),
        }}
        aria-label={`${seat.number}, ${mine ? "held by you" : seat.state}, ${seat.farePaise / 100} rupees${seat.quotaLabel ? `, quota ${seat.quotaLabel}` : ""}`}
        aria-pressed={isSelected}
        disabled={disabled || loading || !selectable.includes(seat.state)}
        title={hoverTitle}
        onClick={() => onToggle(seat.number)}
      >
        <span>{seat.number}</span>
        {seat.state !== "available" && (
          <span aria-hidden="true" className="counter-seat-state-mark">
            {seat.state === "quota"
              ? "Q"
              : seat.state === "blocked"
                ? "×"
                : seat.state === "booked"
                  ? "B"
                  : "H"}
          </span>
        )}
        <small>{money(seat.farePaise / 100)}</small>
        <i />
      </button>
    );
  };

  return (
    <Panel
      className={chart ? "counter-chart-panel" : ""}
      title={title}
      aside={
        onRefresh ? (
          <button className="text-btn" disabled={loading} onClick={onRefresh}>
            <RotateCw size={13} />
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        ) : null
      }
    >
      <div className="counter-inventory-counts">
        {inventoryCounts.map(([label, count]) => (
          <div key={label}>
            <strong>{count}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>

      {!chart && !isCar && (
        <div className="counter-deckbar">
          <div
            className="tabs counter-decks"
            role="tablist"
            aria-label="Vehicle deck"
          >
            {decks.map((d, i) => (
              <button
                type="button"
                role="tab"
                aria-selected={d === active}
                aria-controls="seat-deck-panel"
                id={`deck-${d}`}
                tabIndex={d === active ? 0 : -1}
                key={d}
                onClick={() => setDeck(d)}
                onKeyDown={(e) => {
                  if (
                    ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
                  ) {
                    e.preventDefault();
                    const next =
                      e.key === "Home"
                        ? decks[0]
                        : e.key === "End"
                          ? decks[decks.length - 1]
                          : decks[(i + 1) % decks.length];
                    setDeck(next);
                    document.getElementById(`deck-${next}`)?.focus();
                  }
                }}
              >
                {d === "lower" ? "Lower deck" : "Upper deck"}
                <span className="count">
                  {seats.filter((s) => s.deck === d).length}
                </span>
              </button>
            ))}
          </div>
          <span className="muted">
            {visible.some((s) => s.category === "sleeper")
              ? "Sleeper"
              : "Seater"}{" "}
            layout
          </span>
        </div>
      )}

      <div className={`counter-legend ${isCar ? "car-legend" : ""}`}>
        {isCar ? (
          <>
            <span><i className="available" /> Available</span>
            <span><i className="selected" /> Selected</span>
            <span><i className="booked booked-operator" /> Booked (Operator)</span>
            <span><i className="booked booked-agent" /> Booked (Agent)</span>
            <span><i className="booked booked-api" /> Booked (API / App)</span>
            <span><i className="held" /> Held</span>
            <span><i className="blocked" /> Blocked</span>
            <span><i className="driver" /> Driver (Cockpit)</span>
          </>
        ) : (
          ["available", "selected", "booked", "held", "blocked", "quota"].map(
            (state) => (
              <span key={state}>
                <i className={state} />
                {state.replace(/^./, (s) => s.toUpperCase())}
              </span>
            ),
          )
        )}
      </div>

      {error && (
        <div className="counter-alert error" role="alert">
          {error}
        </div>
      )}

      <div
        className="counter-map-stage"
        role={chart ? "region" : "tabpanel"}
        id="seat-deck-panel"
        aria-labelledby={chart || isCar ? undefined : `deck-${active}`}
        aria-label={chart ? "Complete vehicle seat chart" : undefined}
        aria-busy={loading}
      >
        {loading && !seats.length ? (
          <div className="empty" role="status">
            <span className="loading-ring" />
            Loading authoritative inventory…
          </div>
        ) : visible.length ? (
          isCar ? (
            /* TOP-DOWN CAR BLUEPRINT FRAME (Engineering CAD Wireframe) */
            <div
              className={`car-blueprint-container ${isMuv ? "muv-chassis" : "sedan-chassis"}`}
              style={{ height: isMuv ? "410px" : "338px" }}
            >
              <svg
                className="car-blueprint-svg"
                viewBox={isMuv ? "0 0 340 515" : "0 0 340 425"}
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <defs>
                  {/* Subtle Technical CAD Grid */}
                  <pattern id="cadGrid" width="20" height="20" patternUnits="userSpaceOnUse">
                    <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#f1f5f9" strokeWidth="0.8" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#cadGrid)" />

                {/* 1. TECHNICAL CHASSIS SILHOUETTE */}
                {isMuv ? (
                  <path
                    d="M 120 18
                       C 145 15, 195 15, 220 18
                       C 246 22, 268 34, 276 56
                       C 282 72, 285 92, 285 118
                       C 285 140, 282 210, 280 310
                       C 278 350, 285 384, 288 422
                       C 290 448, 284 474, 268 492
                       C 250 508, 215 512, 170 512
                       C 125 512, 90 508, 72 492
                       C 56 474, 50 448, 52 422
                       C 55 384, 62 350, 60 310
                       C 58 210, 55 140, 55 118
                       C 55 92, 58 72, 64 56
                       C 72 34, 94 22, 120 18 Z"
                    fill="#ffffff"
                    stroke="#334155"
                    strokeWidth="1.8"
                    strokeLinejoin="round"
                  />
                ) : (
                  <path
                    d="M 120 18
                       C 145 15, 195 15, 220 18
                       C 246 22, 268 34, 276 56
                       C 282 72, 285 92, 285 118
                       C 285 140, 282 178, 280 220
                       C 278 262, 285 296, 288 332
                       C 290 358, 284 384, 268 402
                       C 250 418, 215 422, 170 422
                       C 125 422, 90 418, 72 402
                       C 56 384, 50 358, 52 332
                       C 55 296, 62 262, 60 220
                       C 58 178, 55 140, 55 118
                       C 55 92, 58 72, 64 56
                       C 72 34, 94 22, 120 18 Z"
                    fill="#ffffff"
                    stroke="#334155"
                    strokeWidth="1.8"
                    strokeLinejoin="round"
                  />
                )}

                {/* Front Lower Bumper Inset */}
                <path d="M 130 22 C 148 20, 192 20, 210 22 C 205 26, 135 26, 130 22 Z" stroke="#64748b" strokeWidth="1" fill="#f8fafc" />

                {/* 2. RECESSED CAD HEADLIGHT CONTOURS */}
                {/* Left Headlight */}
                <path
                  d="M 72 48
                     C 78 36, 95 30, 108 26
                     C 107 38, 98 56, 88 64
                     C 78 60, 73 54, 72 48 Z"
                  stroke="#475569"
                  strokeWidth="1.2"
                  fill="#f8fafc"
                />
                <circle cx="86" cy="46" r="3" stroke="#64748b" strokeWidth="1" fill="none" />
                <path d="M 76 45 C 88 38, 102 33, 106 31" stroke="#38bdf8" strokeWidth="1.2" strokeLinecap="round" />

                {/* Right Headlight */}
                <path
                  d="M 268 48
                     C 262 36, 245 30, 232 26
                     C 233 38, 242 56, 252 64
                     C 262 60, 267 54, 268 48 Z"
                  stroke="#475569"
                  strokeWidth="1.2"
                  fill="#f8fafc"
                />
                <circle cx="254" cy="46" r="3" stroke="#64748b" strokeWidth="1" fill="none" />
                <path d="M 264 45 C 252 38, 238 33, 234 31" stroke="#38bdf8" strokeWidth="1.2" strokeLinecap="round" />

                {/* 3. HOOD CHARACTER LINES */}
                <line x1="170" y1="28" x2="170" y2="108" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="3 3" />
                <path d="M 124 28 C 130 56, 126 86, 112 114" stroke="#94a3b8" strokeWidth="1" strokeLinecap="round" />
                <path d="M 216 28 C 210 56, 214 86, 228 114" stroke="#94a3b8" strokeWidth="1" strokeLinecap="round" />

                {/* 4. AERODYNAMIC SIDE WING MIRRORS */}
                {/* Left Mirror */}
                <path
                  d="M 55 125 L 38 122 C 32 121, 29 126, 31 131 C 33 135, 40 136, 48 134 L 55 132 Z"
                  stroke="#334155"
                  strokeWidth="1.4"
                  fill="#ffffff"
                  strokeLinejoin="round"
                />
                <line x1="33" y1="125" x2="45" y2="133" stroke="#94a3b8" strokeWidth="1" />
                {/* Right Mirror */}
                <path
                  d="M 285 125 L 302 122 C 308 121, 311 126, 309 131 C 307 135, 300 136, 292 134 L 285 132 Z"
                  stroke="#334155"
                  strokeWidth="1.4"
                  fill="#ffffff"
                  strokeLinejoin="round"
                />
                <line x1="307" y1="125" x2="295" y2="133" stroke="#94a3b8" strokeWidth="1" />

                {/* 5. FRONT WINDSHIELD, DASHBOARD & STEERING WHEEL */}
                <path d="M 68 118 C 112 104, 228 104, 272 118 L 264 154 C 220 146, 120 146, 76 154 Z" stroke="#64748b" strokeWidth="1.4" fill="#f8fafc" />
                {/* Driver Cockpit Steering Wheel (RHD - Right Hand Drive Indian Standard) */}
                <circle cx="223" cy="142" r="9" stroke="#64748b" strokeWidth="1.4" fill="#ffffff" />
                <circle cx="223" cy="142" r="3" stroke="#94a3b8" strokeWidth="1" fill="#e2e8f0" />
                <line x1="223" y1="133" x2="223" y2="139" stroke="#64748b" strokeWidth="1.2" />
                <line x1="214" y1="142" x2="220" y2="142" stroke="#64748b" strokeWidth="1.2" />
                <line x1="226" y1="142" x2="232" y2="142" stroke="#64748b" strokeWidth="1.2" />
                {/* Windshield Wipers */}
                <line x1="108" y1="146" x2="142" y2="128" stroke="#475569" strokeWidth="1.4" strokeLinecap="round" />
                <line x1="178" y1="146" x2="212" y2="128" stroke="#475569" strokeWidth="1.4" strokeLinecap="round" />

                {/* 7. CABIN GREENHOUSE (SIDE WINDOWS & B-PILLARS) */}
                {/* Left Front Window */}
                <path d="M 59 160 L 56 226 L 68 223 L 71 160 Z" fill="url(#glassTint)" stroke="#64748b" strokeWidth="1" />
                {/* Right Front Window */}
                <path d="M 281 160 L 284 226 L 272 223 L 269 160 Z" fill="url(#glassTint)" stroke="#64748b" strokeWidth="1" />
                {/* B-Pillars */}
                <rect x="54" y="226" width="14" height="6" fill="#1e293b" rx="1" />
                <rect x="272" y="226" width="14" height="6" fill="#1e293b" rx="1" />

                {isMuv ? (
                  <>
                    {/* MUV Middle Windows */}
                    <path d="M 56 232 L 54 316 L 66 313 L 68 232 Z" fill="url(#glassTint)" stroke="#64748b" strokeWidth="1" />
                    <path d="M 284 232 L 286 316 L 274 313 L 272 232 Z" fill="url(#glassTint)" stroke="#64748b" strokeWidth="1" />
                    {/* C-Pillars */}
                    <rect x="53" y="316" width="14" height="6" fill="#1e293b" rx="1" />
                    <rect x="273" y="316" width="14" height="6" fill="#1e293b" rx="1" />
                    {/* MUV Rear Quarter Windows */}
                    <path d="M 54 322 L 59 416 L 70 412 L 67 322 Z" fill="url(#glassTint)" stroke="#64748b" strokeWidth="1" />
                    <path d="M 286 322 L 281 416 L 270 412 L 273 322 Z" fill="url(#glassTint)" stroke="#64748b" strokeWidth="1" />
                    {/* MUV Rear Windshield */}
                    <path
                      d="M 74 420 C 118 428, 222 428, 266 420 L 254 456 C 218 462, 122 462, 86 456 Z"
                      fill="url(#glassTint)"
                      stroke="#334155"
                      strokeWidth="1.6"
                    />
                    <line x1="88" y1="432" x2="252" y2="432" stroke="#e2e8f0" strokeWidth="0.6" strokeOpacity="0.5" />
                    <line x1="94" y1="442" x2="246" y2="442" stroke="#e2e8f0" strokeWidth="0.6" strokeOpacity="0.5" />
                    <line x1="152" y1="424" x2="188" y2="424" stroke="#ef4444" strokeWidth="1.8" strokeLinecap="round" />
                    {/* MUV Trunk & Continuous LED Taillight Bar */}
                    <path d="M 104 472 C 136 476, 204 476, 236 472" stroke="#94a3b8" strokeWidth="1.2" strokeLinecap="round" />
                    <path
                      d="M 64 472
                         C 68 486, 92 496, 120 498
                         L 220 498
                         C 248 496, 272 486, 276 472
                         C 264 476, 240 482, 220 482
                         L 120 482
                         C 100 482, 76 476, 64 472 Z"
                      fill="url(#taillightGlow)"
                      stroke="#b91c1c"
                      strokeWidth="1.2"
                    />
                    {/* MUV Dual Exhaust Accents */}
                    <rect x="96" y="506" width="16" height="5" rx="2" fill="#334155" stroke="#64748b" strokeWidth="0.8" />
                    <rect x="228" y="506" width="16" height="5" rx="2" fill="#334155" stroke="#64748b" strokeWidth="0.8" />
                  </>
                ) : (
                  <>
                    {/* Sedan Rear Window */}
                    <path d="M 56 232 L 60 326 L 71 322 L 68 232 Z" fill="url(#glassTint)" stroke="#64748b" strokeWidth="1" />
                    <path d="M 284 232 L 280 326 L 269 322 L 272 232 Z" fill="url(#glassTint)" stroke="#64748b" strokeWidth="1" />
                    {/* Sedan Rear Windshield */}
                    <path
                      d="M 74 330 C 118 338, 222 338, 266 330 L 254 366 C 218 372, 122 372, 86 366 Z"
                      fill="url(#glassTint)"
                      stroke="#334155"
                      strokeWidth="1.6"
                    />
                    <line x1="88" y1="342" x2="252" y2="342" stroke="#e2e8f0" strokeWidth="0.6" strokeOpacity="0.5" />
                    <line x1="94" y1="352" x2="246" y2="352" stroke="#e2e8f0" strokeWidth="0.6" strokeOpacity="0.5" />
                    <line x1="152" y1="334" x2="188" y2="334" stroke="#ef4444" strokeWidth="1.8" strokeLinecap="round" />
                    {/* Sedan Trunk & Continuous LED Taillight Bar */}
                    <path d="M 104 382 C 136 386, 204 386, 236 382" stroke="#94a3b8" strokeWidth="1.2" strokeLinecap="round" />
                    <path
                      d="M 64 382
                         C 68 396, 92 406, 120 408
                         L 220 408
                         C 248 406, 272 396, 276 382
                         C 264 386, 240 392, 220 392
                         L 120 392
                         C 100 392, 76 386, 64 382 Z"
                      fill="url(#taillightGlow)"
                      stroke="#b91c1c"
                      strokeWidth="1.2"
                    />
                    {/* Sedan Dual Exhaust Accents */}
                    <rect x="96" y="416" width="16" height="5" rx="2" fill="#334155" stroke="#64748b" strokeWidth="0.8" />
                    <rect x="228" y="416" width="16" height="5" rx="2" fill="#334155" stroke="#64748b" strokeWidth="0.8" />
                  </>
                )}
              </svg>

              {/* Interactive Cabin Overlay with Physical Seats */}
              <div className={`car-cabin-overlay ${isMuv ? "muv" : "sedan"}`}>
                {Object.keys(rowsMap)
                  .map(Number)
                  .sort((a, b) => a - b)
                  .map((rowNum) => {
                    const rowSeats = rowsMap[rowNum];
                    const isRow1 = rowNum === 1;
                    const isRow2 = rowNum === 2;
                    const rowTitle = isRow1
                      ? "ROW 1 — FRONT CABIN"
                      : isRow2
                        ? isMuv
                          ? "ROW 2 — MIDDLE ROW"
                          : "ROW 2 — REAR BENCH"
                        : "ROW 3 — REAR BENCH";

                    return (
                      <div key={rowNum} className="car-cabin-row-group">
                        <div className="car-row-label">{rowTitle}</div>
                        <div
                          className={`car-row-seats ${isRow1 ? "row-front" : "row-bench"}`}
                        >
                          {isRow1 ? (
                            (() => {
                              const isDriver = (s?: InventorySeat) =>
                                s && (s.number === "D" || s.isDriver || s.category === "driver");
                              const driverSeat = rowSeats.find(isDriver) || rowSeats[1];
                              const fpSeat = rowSeats.find((s) => !isDriver(s)) || rowSeats[0];
                              return (
                                <>
                                  {fpSeat && renderCarSeat(fpSeat)}
                                  <div className="center-console" aria-hidden="true">
                                    <div className="gear-knob" />
                                    <span>PRND</span>
                                  </div>
                                  {driverSeat && renderCarSeat(driverSeat)}
                                </>
                              );
                            })()
                          ) : (
                            rowSeats.map(renderCarSeat)
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          ) : (
            <div className="counter-bus">
              {chart && (
                <div className="counter-chart-orientation" aria-hidden="true">
                  <span>FRONT OF CABIN</span>
                  <span>Driver →</span>
                </div>
              )}
              <div className="counter-bus-front">
                <span>FRONT · DRIVER</span>
                <span className="counter-wheel" aria-hidden="true">
                  ◉
                </span>
              </div>
              <div
                className="counter-berth-grid"
                style={{
                  gridTemplateColumns: chart
                    ? decks
                        .map((d) => `repeat(${deckColumns(d)},minmax(32px,1fr))`)
                        .join(" 14px ")
                    : `repeat(${columns},minmax(44px,1fr))`,
                }}
              >
                {chart &&
                  decks.map((d, index) => (
                    <span
                      className="counter-column-heading"
                      key={d}
                      style={{
                        gridRow: 1,
                        gridColumn: `${1 + (index ? deckColumns(decks[0]) + 1 : 0)} / span ${deckColumns(d)}`,
                      }}
                    >
                      {d === "upper" ? "Upper deck" : "Lower deck"} ·{" "}
                      {seats.filter((s) => s.deck === d).length}
                    </span>
                  ))}
                {visible.map(renderSeat)}
              </div>
              <div className="counter-bus-rear">REAR CABIN</div>
            </div>
          )
        ) : (
          <div className="empty">
            <Armchair size={30} />
            <h3>Select a car trip to view cabin seats</h3>
            <p>Individual passenger seats and fares load from scheduled car inventory.</p>
          </div>
        )}
      </div>

      <div className="counter-map-caption">
        <span>
          {isCar
            ? `Car Cabin · ${isMuv ? "6/7-Passenger MUV" : "4-Passenger Sedan"} individual passenger seats. Driver seat is locked and non-bookable.`
            : "Positions follow vehicle layout. Prices are per passenger."}
        </span>
        <span>{selected.length} selected</span>
      </div>
    </Panel>
  );
}
