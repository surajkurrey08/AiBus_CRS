import { CarBlueprint } from "./CarBlueprint";
import { MiniBusCabin } from "./MiniBusCabin";
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
  vehicleType,
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
  vehicleType?: string;
}) {
  const [deck, setDeck] = useState<"lower" | "upper">("lower");

  // Pure Car CRS detection:
  // Must NOT have upper deck, and must have car seat indicators (D, FP, driver, 2L/2M/2R, etc.)
  const isCar =
    !seats.some((s) => s.number.startsWith("CS-")) &&
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
  const isMiniBus = vehicleType === "Mini Bus" && seats.length > 0 && decks.length === 1;
  const hasCabin = isCar || isMiniBus;
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
  const inventoryCounts = hasCabin
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
        disabled={disabled || loading || seat.isDriver || seat.isBookable === false || !selectable.includes(seat.state)}
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
        disabled={disabled || loading || seat.number === "D" || seat.isDriver || seat.isBookable === false || !selectable.includes(seat.state)}
        title={hoverTitle}
        onClick={() => onToggle(seat.number)}
      >
        <span>{seat.isDriver ? "Driver" : seat.number}</span>
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

      {!chart && !hasCabin && (
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

      <div className={`counter-legend ${hasCabin ? "car-legend" : ""}`}>
        {hasCabin ? (
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
        aria-labelledby={chart || hasCabin ? undefined : `deck-${active}`}
        aria-label={chart ? "Complete vehicle seat chart" : undefined}
        aria-busy={loading}
      >
        {loading && !seats.length ? (
          <div className="empty" role="status">
            <span className="loading-ring" />
            Loading authoritative inventory…
          </div>
        ) : visible.length ? (
          isMiniBus ? (
            <MiniBusCabin columns={deckColumns(decks[0])}>
                {seats.map((seat) => (
                  <div key={seat.number} style={{ gridRow: seat.row + 1, gridColumn: seat.column + 1 }}>
                    {renderCarSeat(seat)}
                  </div>
                ))}
            </MiniBusCabin>
          ) : isCar ? (
            /* TOP-DOWN CAR BLUEPRINT FRAME (Engineering CAD Wireframe) */
            <div
              className={`car-blueprint-container ${isMuv ? "muv-chassis" : "sedan-chassis"}`}
              style={{ height: isMuv ? "410px" : "338px" }}
            >
              <CarBlueprint isMuv={isMuv} />

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
          {isMiniBus ? `Mini Bus cabin · ${bookableSeats.length} passenger seats. Driver seat is locked.` : isCar
            ? `Car Cabin · ${isMuv ? "6/7-Passenger MUV" : "4-Passenger Sedan"} individual passenger seats. Driver seat is locked and non-bookable.`
            : "Positions follow vehicle layout. Prices are per passenger."}
        </span>
        <span>{selected.length} selected</span>
      </div>
    </Panel>
  );
}
