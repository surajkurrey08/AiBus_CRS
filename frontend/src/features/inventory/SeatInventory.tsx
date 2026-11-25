import { Armchair, Car, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Panel, useStored } from "../../components/index.ts";
import { useWorkspace } from "../../context/WorkspaceContext.tsx";
import { type Row, money } from "../../data/demo-data.ts";
import { LiveSeats } from "./LiveSeats.tsx";
export function SeatInventory(props: {
  routes: Row[];
  date: string;
  notify: (m: string) => void;
}) {
  const ws = useWorkspace();
  return ws.demo ? (
    <DemoSeatInventory {...props} />
  ) : (
    <LiveSeats date={props.date} />
  );
}
function DemoSeatInventory({
  routes,
  date,
  notify,
}: {
  routes: Row[];
  date: string;
  notify: (m: string) => void;
}) {
  const [deck, setDeck] = useState("Lower deck"),
    [trip, setTrip] = useState(routes[0]?.route || ""),
    [selected, setSelected] = useState<string[]>([]);
  const [blocked, setBlocked] = useStored<string[]>("aibus-blocked", []);
  const prefix = deck === "Lower deck" ? "L" : "U";
  const seats = Array.from({ length: 18 }, (_, i) => `${prefix}${i + 1}`);
  const key = (s: string) => `${date}:${trip}:${s}`;
  const booked = (s: string) =>
    [2, 5, 8, 11, 14, 16].includes(Number(s.slice(1)));
  useEffect(() => setSelected([]), [date]);
  return (
    <>
      <div className="trip-bar">
        <label>
          Select route
          <select
            value={trip}
            onChange={(e) => {
              setTrip(e.target.value);
              setSelected([]);
            }}
          >
            {routes.map((r) => (
              <option key={r.id}>{r.route}</option>
            ))}
          </select>
        </label>
        <span>
          <Car size={17} />
          DL 01 AB 1234 · 4-Passenger Sedan (5 Physical Seats: 1 Driver + 4 Pax)
        </span>
      </div>
      <div className="seat-page">
        <Panel
          title="Berth inventory"
          aside={
            <span className="count">
              18 {deck === "Lower deck" ? "lower" : "upper"} berths
            </span>
          }
        >
          <div className="seat-tabs tabs">
            {["Lower deck", "Upper deck"].map((d) => (
              <button
                key={d}
                className={d === deck ? "selected" : ""}
                onClick={() => {
                  setDeck(d);
                  setSelected([]);
                }}
              >
                {d}
              </button>
            ))}
          </div>
          <div className="seat-legend">
            {["Available", "Booked", "Blocked", "Selected"].map((s) => (
              <span key={s}>
                <i className={s.toLowerCase()} />
                {s}
              </span>
            ))}
          </div>
          <div className="bus-layout">
            <div className="bus-front">
              <span>FRONT</span>
              <span className="steering">◉</span>
            </div>
            <div className="berth-grid">
              {seats.map((s, i) => {
                const state = booked(s)
                  ? "booked"
                  : selected.includes(s)
                    ? "selected"
                    : blocked.includes(key(s))
                      ? "blocked"
                      : "available";
                return (
                  <button
                    key={s}
                    aria-label={`${s}, ${state}, ${deck === "Lower deck" ? 1450 : 1350} rupees`}
                    disabled={state === "booked"}
                    className={`berth ${state} ${i % 3 === 2 ? "single" : ""}`}
                    onClick={() =>
                      setSelected(
                        selected.includes(s)
                          ? selected.filter((x) => x !== s)
                          : [...selected, s],
                      )
                    }
                  >
                    <span>{s}</span>
                    <small>{money(deck === "Lower deck" ? 1450 : 1350)}</small>
                    <i />
                  </button>
                );
              })}
            </div>
            <div className="bus-rear">REAR · EMERGENCY EXIT</div>
          </div>
          <p className="seat-hint">
            Select available or blocked berths to manage inventory.
          </p>
        </Panel>
        <Panel title="Selection summary">
          <div className="selection-body">
            <span className="muted">{trip}</span>
            <h3>{deck}</h3>
            <div className="selected-chips">
              {selected.length ? (
                selected.map((s) => (
                  <span key={s}>
                    {s}
                    <button
                      aria-label={`Deselect ${s}`}
                      onClick={() =>
                        setSelected(selected.filter((x) => x !== s))
                      }
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))
              ) : (
                <div className="empty-selection">
                  <Armchair size={32} />
                  <p>No berths selected</p>
                  <small>Choose berths from the layout.</small>
                </div>
              )}
            </div>
            <div className="detail-row">
              <span>Selected berths</span>
              <strong>{selected.length}</strong>
            </div>
            <div className="detail-row">
              <span>Total fare</span>
              <strong>
                {money(selected.length * (deck === "Lower deck" ? 1450 : 1350))}
              </strong>
            </div>
            <button
              className="btn primary full"
              disabled={!selected.length}
              onClick={() => {
                setBlocked([...new Set([...blocked, ...selected.map(key)])]);
                setSelected([]);
                notify("Selected berths blocked");
              }}
            >
              Block selected berths
            </button>
            <button
              className="btn full"
              disabled={!selected.some((s) => blocked.includes(key(s)))}
              onClick={() => {
                setBlocked(
                  blocked.filter((b) => !selected.map(key).includes(b)),
                );
                setSelected([]);
                notify("Selected berths released");
              }}
            >
              Release blocked berths
            </button>
            <p className="seat-hint">
              Inventory changes apply to this demo trip on this device.
            </p>
          </div>
        </Panel>
      </div>
    </>
  );
}
