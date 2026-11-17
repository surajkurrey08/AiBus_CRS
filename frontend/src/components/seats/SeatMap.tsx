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
  category: "sleeper" | "seater";
  farePaise: number;
  state: "available" | "booked" | "held" | "blocked" | "quota";
  quotaLabel?: string;
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
  const decks = (["lower", "upper"] as const).filter((d) =>
    seats.some((s) => s.deck === d),
  );
  const active = decks.includes(deck) ? deck : decks[0] || "lower";
  const chart = variant === "counter-chart";
  const visible = chart ? seats : seats.filter((s) => s.deck === active);
  const deckColumns = (d: string) =>
    Math.max(1, ...seats.filter((s) => s.deck === d).map((s) => s.column + 1));
  const columns = chart
    ? decks.reduce((n, d) => n + deckColumns(d), 0)
    : Math.max(4, ...visible.map((s) => s.column + 1));
  const renderSeat = (seat: InventorySeat) => {
    const mine = heldSeats.includes(seat.number),
      isSelected = selected.includes(seat.number),
      state = isSelected ? "selected" : seat.state;
    return (
      <button
        type="button"
        key={seat.number}
        className={`berth ${state} inventory-${seat.state} deck-${seat.deck} ${seat.category === "seater" ? "seater" : ""}`}
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
        title={seat.quotaLabel ? `Quota: ${seat.quotaLabel}` : seat.number}
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
        {[
          ["Total", seats.length],
          ["Booked", seats.filter((s) => s.state === "booked").length],
          ["Available", seats.filter((s) => s.state === "available").length],
          ["Blocked", seats.filter((s) => s.state === "blocked").length],
          ["Held", seats.filter((s) => s.state === "held").length],
          ["Quota", seats.filter((s) => s.state === "quota").length],
        ].map(([label, count]) => (
          <div key={label}>
            <strong>{count}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      {!chart && (
        <div className="counter-deckbar">
          <div
            className="tabs counter-decks"
            role="tablist"
            aria-label="Bus deck"
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
      <div className="counter-legend">
        {["available", "booked", "held", "selected", "blocked", "quota"].map(
          (state) => (
            <span key={state}>
              <i className={state} />
              {state === "lower-available"
                ? "Lower · available"
                : state === "upper-available"
                  ? "Upper · available"
                  : state.replace(/^./, (s) => s.toUpperCase())}
            </span>
          ),
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
        aria-labelledby={chart ? undefined : `deck-${active}`}
        aria-label={chart ? "Complete bus seat chart" : undefined}
        aria-busy={loading}
      >
        {loading && !seats.length ? (
          <div className="empty" role="status">
            <span className="loading-ring" />
            Loading authoritative inventory…
          </div>
        ) : visible.length ? (
          <div className="counter-bus">
            {chart && (
              <div className="counter-chart-orientation" aria-hidden="true">
                <span>FRONT OF BUS</span>
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
            <div className="counter-bus-rear">REAR · EMERGENCY EXIT</div>
          </div>
        ) : (
          <div className="empty">
            <Armchair size={30} />
            <h3>Select a trip to view seats</h3>
            <p>Seat positions and fares load from its configured inventory.</p>
          </div>
        )}
      </div>
      <div className="counter-map-caption">
        <span>Positions follow the bus layout. Prices are per passenger.</span>
        <span>{selected.length} selected</span>
      </div>
    </Panel>
  );
}
