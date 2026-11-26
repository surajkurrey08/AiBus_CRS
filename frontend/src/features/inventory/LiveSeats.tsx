import { Armchair, Car, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client.ts";
import { Overlay, Panel } from "../../components/index.ts";
import {
  SeatMap,
  type InventorySeat,
} from "../../components/seats/SeatMap.tsx";
import { useWorkspace } from "../../context/WorkspaceContext.tsx";
import { money } from "../../data/demo-data.ts";
import type { Raw } from "../../utils/normalize.ts";
export function LiveSeats({ date }: { date: string }) {
  const ws = useWorkspace(),
    [tripId, setTripId] = useState(""),
    [deck, setDeck] = useState("lower"),
    [seats, setSeats] = useState<Raw[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [hold, setHold] = useState<Raw | null>(null),
    [booking, setBooking] = useState(false),
    [passengers, setPassengers] = useState<
      Record<string, { name: string; phone: string }>
    >({});
  const bookingKey = useRef("");
  const trips = (ws.raw.trips || []).filter(
      (t) => t.journeyDate === date && t.status === "Scheduled",
    ),
    trip = trips.find((t) => t._id === tripId) || trips[0];
  const route = ws.records.routes.find((r) => r.id === trip?.routeId),
    bus = ws.raw.buses?.find((b) => b._id === trip?.busId);
  async function load() {
    if (!trip) {
      setSeats([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await api<Raw>(`/operator/trips/${trip._id}/seats`);
      setSeats(result.data.seats);
    } catch (e) {
      setError((e as Error).message);
      setSeats([]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    setSelected([]);
    setHold(null);
    setBooking(false);
    void load();
  }, [trip?._id, date]);
  useEffect(() => {
    void load();
  }, [ws.revision]);
  async function mutate(action: string) {
    if (!trip) return;
    setBusy(true);
    setError("");
    try {
      await api(`/operator/trips/${trip._id}/${action}`, {
        method: "POST",
        body: JSON.stringify({ seats: selected }),
      });
      setSelected([]);
      await load();
      await ws.refresh();
      ws.notify(action === "block" ? "Berths blocked" : "Berths released");
    } catch (e) {
      setError((e as Error).message);
      await load();
    } finally {
      setBusy(false);
    }
  }
  const visible = seats.filter((s) => s.deck === deck),
    total = seats
      .filter((s) => selected.includes(s.number))
      .reduce((n, s) => n + s.farePaise, 0),
    columns = Math.max(4, ...visible.map((s) => s.column + 1));
  return (
    <>
      <div className="trip-bar">
        <label>
          Select trip
          <select
            value={trip?._id || ""}
            onChange={(e) => setTripId(e.target.value)}
            disabled={!!hold}
          >
            <option value="" disabled>
              Select scheduled trip
            </option>
            {trips.map((t) => (
              <option value={t._id} key={t._id}>
                {ws.records.routes.find((r) => r.id === t.routeId)?.route} ·{" "}
                {new Date(t.departureAt).toLocaleTimeString("en-IN", {
                  timeZone: "Asia/Kolkata",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </option>
            ))}
          </select>
        </label>
        <span>
          <Car size={17} />
          {bus
            ? `${bus.registration} · ${bus.type || "4-Passenger Sedan"} · ${bus.capacity} seats`
            : "No scheduled trips for this date"}
        </span>
      </div>
      {error && (
        <div className="info-banner" role="alert">
          {error}
          <button className="text-btn" onClick={() => void load()}>
            Refresh layout
          </button>
        </div>
      )}
      <div className="seat-page">
        <SeatMap
          vehicleType={trip?.vehicleCategory}
          title="Berth inventory"
          seats={seats as InventorySeat[]}
          selected={selected}
          heldSeats={hold?.seats}
          disabled={!!hold || busy}
          loading={loading}
          onRefresh={() => void load()}
          selectable={
            ws.user.permissions.includes("inventory:write")
              ? ["available", "blocked"]
              : ws.user.permissions.includes("bookings:write")
                ? ["available"]
                : []
          }
          onToggle={(number) =>
            setSelected((old) =>
              old.includes(number)
                ? old.filter((n) => n !== number)
                : old.length >= 6
                  ? (ws.notify("Select up to six seats at a time"), old)
                  : [...old, number],
            )
          }
        />
        <Panel title="Selection summary">
          <div className="selection-body">
            <span className="muted">{route?.route || "Choose a trip"}</span>
            <h3>{date} · IST</h3>
            <div className="selected-chips">
              {selected.length ? (
                selected.map((s) => (
                  <span key={s}>
                    {s}
                    <button
                      disabled={!!hold}
                      aria-label={`Deselect ${s}`}
                      onClick={() =>
                        setSelected((old) => old.filter((n) => n !== s))
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
                </div>
              )}
            </div>
            <div className="detail-row">
              <span>Selected berths</span>
              <strong>{selected.length}</strong>
            </div>
            <div className="detail-row">
              <span>Total quoted fare</span>
              <strong>{money((hold?.amountPaise ?? total) / 100)}</strong>
            </div>
            {hold ? (
              <>
                <p className="seat-hint">
                  Held until{" "}
                  {new Date(hold.expiresAt).toLocaleTimeString("en-IN", {
                    timeZone: "Asia/Kolkata",
                  })}{" "}
                  IST. A hold is not a confirmed ticket.
                </p>
                <button
                  className="btn primary full"
                  onClick={() => setBooking(true)}
                >
                  Enter passenger details
                </button>
                <button
                  className="btn full"
                  onClick={async () => {
                    try {
                      await api(
                        `/operator/trips/${trip._id}/holds/${hold.holdId}`,
                        { method: "DELETE" },
                      );
                      setHold(null);
                      setSelected([]);
                      await load();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Release hold
                </button>
              </>
            ) : (
              <>
                {ws.user.permissions.includes("bookings:write") && (
                  <button
                    className="btn primary full"
                    disabled={
                      busy ||
                      !selected.length ||
                      selected.some(
                        (n) =>
                          seats.find((s) => s.number === n)?.state !==
                          "available",
                      )
                    }
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const result = await api<Raw>(
                          `/operator/trips/${trip._id}/holds`,
                          {
                            method: "POST",
                            body: JSON.stringify({ seats: selected }),
                          },
                        );
                        setHold(result.data);
                        bookingKey.current = crypto.randomUUID();
                        ws.notify("Seats held for five minutes");
                        await load();
                      } catch (e) {
                        setError((e as Error).message);
                        await load();
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Hold selected seats
                  </button>
                )}
                {ws.user.permissions.includes("inventory:write") && (
                  <>
                    <button
                      className="btn full"
                      disabled={
                        busy ||
                        !selected.length ||
                        selected.some(
                          (n) =>
                            seats.find((s) => s.number === n)?.state !==
                            "available",
                        )
                      }
                      onClick={() => void mutate("block")}
                    >
                      Block selected berths
                    </button>
                    <button
                      className="btn full"
                      disabled={
                        busy ||
                        !selected.length ||
                        selected.some(
                          (n) =>
                            seats.find((s) => s.number === n)?.state !==
                            "blocked",
                        )
                      }
                      onClick={() => void mutate("unblock")}
                    >
                      Release blocked berths
                    </button>
                  </>
                )}
              </>
            )}
            <p className="seat-hint">
              Availability is validated atomically by your backend. Payment
              integration is required before ticket confirmation.
            </p>
          </div>
        </Panel>
      </div>
      {booking && hold && (
        <Overlay title="Passenger details" onClose={() => setBooking(false)}>
          <form
            noValidate
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await api("/operator/bookings", {
                  method: "POST",
                  headers: { "Idempotency-Key": bookingKey.current },
                  body: JSON.stringify({
                    tripId: trip._id,
                    holdId: hold.holdId,
                    passengers: selected.map((seat) => ({
                      seat,
                      name: passengers[seat]?.name || "",
                      phone: passengers[seat]?.phone || undefined,
                    })),
                  }),
                });
                setBooking(false);
                setHold(null);
                setSelected([]);
                await ws.refresh();
                await load();
                ws.notify(
                  "Booking created pending payment. PNR and ticket will be issued only after confirmation.",
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="form-grid">
              {selected.map((seat) => (
                <label key={seat}>
                  Passenger · {seat}
                  <input
                    aria-label={`Passenger name ${seat}`}
                    placeholder="Full name"
                    value={passengers[seat]?.name || ""}
                    onChange={(e) =>
                      setPassengers({
                        ...passengers,
                        [seat]: { ...passengers[seat], name: e.target.value },
                      })
                    }
                  />
                  <input
                    aria-label={`Phone ${seat}`}
                    placeholder="Phone (optional)"
                    value={passengers[seat]?.phone || ""}
                    onChange={(e) =>
                      setPassengers({
                        ...passengers,
                        [seat]: { ...passengers[seat], phone: e.target.value },
                      })
                    }
                  />
                </label>
              ))}
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
            </div>
            <div className="dialog-foot">
              <button
                className="btn"
                type="button"
                onClick={() => setBooking(false)}
              >
                Back
              </button>
              <button className="btn primary" disabled={busy}>
                {busy ? "Saving…" : "Create pending booking"}
              </button>
            </div>
          </form>
        </Overlay>
      )}
    </>
  );
}
