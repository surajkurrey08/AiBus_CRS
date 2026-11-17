import { loadAllRecords } from "../../api/loadAll";
import { CalendarDays } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../api/client.ts";
import { DataTable, Overlay } from "../../components/index.ts";
import { useWorkspace } from "../../context/WorkspaceContext.tsx";
import { LayoutEditor } from "../fleet/SeatLayoutEditor";
import { CrewFields } from "../fleet/components/CrewFields";

export function TripControls() {
  const ws = useWorkspace(),
    [open, setOpen] = useState(false),
    [serviceId, setServiceId] = useState(""),
    [services, setServices] = useState<any[]>([]),
    [bus, setBus] = useState(""),
    [route, setRoute] = useState(""),
    [date, setDate] = useState(""),
    [time, setTime] = useState("21:30"),
    [doubleFare, setDoubleFare] = useState(""),
    [singleFare, setSingleFare] = useState(""),
    [crewIds, setCrewIds] = useState<string[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    loadAllRecords(
      "/operator/trip-master/services?status=Active",
      controller.signal,
    )
      .then((r) => {
        if (!controller.signal.aborted) setServices(r);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [open]);
  if (!ws.user.permissions.includes("routes:write")) return null;
  return (
    <>
      <div className="section-heading">
        <h3>Scheduled trips</h3>
        <button className="btn" onClick={() => setOpen(true)}>
          <CalendarDays size={15} />
          Schedule a trip
        </button>
      </div>
      <DataTable
        rows={(ws.raw.trips || []).map((t) => ({
          id: t._id,
          route:
            ws.records.routes.find((r) => r.id === t.routeId)?.route ||
            t.routeId,
          date: t.journeyDate,
          departure: new Date(t.departureAt).toLocaleTimeString("en-IN", {
            timeZone: "Asia/Kolkata",
            hour: "2-digit",
            minute: "2-digit",
          }),
          status: t.status,
        }))}
        columns={[
          ["route", "Route"],
          ["date", "Journey date"],
          ["departure", "Departure · IST"],
          ["status", "Status"],
        ]}
        title="trips"
        onView={async (r) => {
          try {
            await api(`/operator/trips/${r.id}/cancel`, { method: "POST" });
            await ws.refresh();
            ws.notify("Trip cancelled");
          } catch (e) {
            ws.notify((e as Error).message);
          }
        }}
        actionLabel="Cancel empty trip"
      />
      {open && (
        <Overlay title="Schedule a trip" onClose={() => setOpen(false)}>
          <form
            noValidate
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              setBusy(true);
              setError("");
              try {
                if (!bus || !route || !date)
                  throw new Error("Select a bus, route and date");
                const customFare =
                  ws.user.permissions.includes("pricing:write") &&
                  (doubleFare !== "" || singleFare !== "");
                if (
                  customFare &&
                  [doubleFare, singleFare].some(
                    (v) =>
                      !/^\d+(\.\d{1,2})?$/.test(v) ||
                      Number(v) <= 0 ||
                      Number(v) > 1000000,
                  )
                )
                  throw new Error(
                    "Enter both double-side and single-side fares, from ₹0.01 to ₹10,00,000 (up to 2 decimals)",
                  );
                await api("/operator/trips", {
                  method: "POST",
                  body: JSON.stringify({
                    busId: bus,
                    ...(serviceId ? { serviceId } : {}),
                    routeId: route,
                    journeyDate: date,
                    departureAt: `${date}T${time}:00+05:30`,
                    ...(crewIds.length || serviceId ? { crewIds } : {}),
                    ...(customFare
                      ? {
                          seatSideFares: {
                            doublePaise: Math.round(Number(doubleFare) * 100),
                            singlePaise: Math.round(Number(singleFare) * 100),
                          },
                        }
                      : {}),
                  }),
                });
                setOpen(false);
                await ws.refresh();
                ws.notify("Trip scheduled");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="form-grid">
              <label>
                Service ? optional
                <select
                  value={serviceId}
                  onChange={(e) => {
                    const service = services.find(
                      (s) => s._id === e.target.value,
                    );
                    setServiceId(e.target.value);
                    if (service) {
                      setBus(service.busId);
                      setRoute(service.routeId);
                      setTime(service.departure);
                      setDoubleFare(String(service.doublePaise / 100));
                      setSingleFare(String(service.singlePaise / 100));
                      setCrewIds(service.crewIds || []);
                    }
                  }}
                >
                  <option value="">Single trip ? no recurring service</option>
                  {services.map((s) => (
                    <option key={s._id} value={s._id}>
                      {s.name} ? {s.code}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Bus
                <select
                  value={bus}
                  onChange={(e) => {
                    setBus(e.target.value);
                    setDoubleFare("");
                    setSingleFare("");
                    setError("");
                  }}
                >
                  <option value="">Select bus</option>
                  {(ws.raw.buses || []).map((b) => (
                    <option value={b._id} key={b._id}>
                      {b.registration} · {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Route
                <select
                  value={route}
                  onChange={(e) => {
                    setRoute(e.target.value);
                    setServiceId("");
                    setDoubleFare("");
                    setSingleFare("");
                    setTime(
                      ws.raw.routes.find((r) => r._id === e.target.value)
                        ?.departure || "21:30",
                    );
                  }}
                >
                  <option value="">Select route</option>
                  {ws.records.routes.map((r) => (
                    <option value={r.id} key={r.id}>
                      {r.route}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Journey date
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <label>
                Departure · IST
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </label>
              {ws.user.permissions.includes("pricing:write") && (
                <>
                  <label>
                    Double-side fare (2) · INR per person
                    <input
                      type="number"
                      min="0.01"
                      max="1000000"
                      step="0.01"
                      placeholder="Use saved route fare"
                      value={doubleFare}
                      onChange={(e) => setDoubleFare(e.target.value)}
                    />
                  </label>
                  <label>
                    Single-side fare (1) · INR per person
                    <input
                      type="number"
                      min="0.01"
                      max="1000000"
                      step="0.01"
                      placeholder="Use saved route fare"
                      value={singleFare}
                      onChange={(e) => setSingleFare(e.target.value)}
                    />
                  </label>
                  <p className="muted" style={{ gridColumn: "1 / -1" }}>
                    For this trip only: both adjacent berths use the double-side
                    price per person; the berth across the aisle uses the
                    single-side price on both decks. Enter both prices to
                    override route fares, or leave both blank to use Fares-tab
                    pricing. Seater seats use the double-side rate.
                  </p>
                </>
              )}
              <CrewFields selected={crewIds} onChange={setCrewIds} />
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              {bus && ws.user.permissions.includes("fleet:write") && (
                <div className="trip-layout-setup">
                  <p>
                    Each bus needs a saved seat layout before its first trip.
                    Configure the layout and decks here if needed. Set this
                    trip’s prices above or use saved route fares.
                  </p>
                  <LayoutEditor
                    key={bus}
                    busId={bus}
                    showUpload={false}
                    onSaved={() => setError("")}
                  />
                </div>
              )}
            </div>
            <div className="dialog-foot">
              <button
                className="btn"
                type="button"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button className="btn primary" disabled={busy}>
                {busy ? "Scheduling…" : "Schedule trip"}
              </button>
            </div>
          </form>
        </Overlay>
      )}
    </>
  );
}
