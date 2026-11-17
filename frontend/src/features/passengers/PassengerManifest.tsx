import { Printer } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../api/client.ts";
import { DataTable, Panel } from "../../components/index.ts";
import { useWorkspace } from "../../context/WorkspaceContext.tsx";
import type { Row } from "../../data/demo-data.ts";
import { type Raw } from "../../utils/normalize.ts";

export function LiveManifest({
  date,
  initialRoute,
}: {
  date: string;
  initialRoute: string;
}) {
  const ws = useWorkspace(),
    [selected, setSelected] = useState(""),
    [passengers, setPassengers] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const trips = (ws.raw.trips || []).filter((t) => t.journeyDate === date);
  const trip =
    trips.find((t) => t._id === selected) ||
    trips.find(
      (t) =>
        ws.records.routes.find((r) => r.id === t.routeId)?.route ===
        initialRoute,
    ) ||
    trips[0];
  async function load() {
    if (ws.demo) {
      setPassengers(
        ws.records.bookings.filter(
          (r) => r.route === initialRoute && r.status === "Confirmed",
        ),
      );
      return;
    }
    if (!trip) {
      setPassengers([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await api<Raw>(`/operator/trips/${trip._id}/manifest`);
      setPassengers(
        result.data.passengers.map((p: Raw, i: number) => ({
          id: `${p.bookingId}-${i}`,
          bookingId: p.bookingId,
          pnr: p.pnr,
          seat: p.seat,
          passenger: p.name,
          phone: p.phone || "Not supplied",
          boarding: p.boarding || "Not supplied",
          checkin: p.checkedInAt ? "Checked in" : "Awaiting",
          status: p.checkedInAt ? "Checked in" : "Awaiting",
        })),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [selected, date, ws.revision]);
  return (
    <>
      <div className="trip-bar">
        <label>
          Choose trip
          <select
            value={trip?._id || ""}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="" disabled>
              Select a scheduled trip
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
        <button
          className="btn"
          disabled={!passengers.length}
          title={
            !passengers.length
              ? "Confirmed passengers are required to print a manifest"
              : "Print confirmed passenger manifest"
          }
          onClick={() => window.print()}
        >
          <Printer size={16} />
          Print manifest
        </button>
      </div>
      {!ws.demo && (
        <div className="info-banner" role="note">
          Only confirmed bookings appear on this boarding manifest.
          Pending-payment bookings are listed in Bookings & tickets and are
          excluded until payment and reservation are verified.
        </div>
      )}
      {error && (
        <div className="info-banner" role="alert">
          {error}
          <button onClick={() => void load()}>Retry</button>
        </div>
      )}
      {loading ? (
        <Panel>
          <div className="empty" role="status">
            Loading passenger manifest…
          </div>
        </Panel>
      ) : (
        <DataTable
          rows={passengers}
          columns={[
            ["seat", "Seat"],
            ["passenger", "Passenger"],
            ["phone", "Contact"],
            ["boarding", "Boarding point"],
            ["checkin", "Check-in status"],
          ]}
          title="passengers"
          emptyTitle={
            !ws.demo
              ? trip
                ? "No confirmed passengers for this trip"
                : "No trip scheduled for this date"
              : undefined
          }
          emptyDescription={
            !ws.demo
              ? trip
                ? "A saved pending-payment booking will appear here after verified confirmation. Check Bookings & tickets for its current status."
                : "Choose a date with a scheduled trip to view its manifest."
              : undefined
          }
          actionLabel="Toggle check-in"
          onView={
            ws.user.permissions.includes("manifest:write")
              ? async (r) => {
                  try {
                    if (ws.demo)
                      setPassengers((old) =>
                        old.map((p) =>
                          p.id === r.id
                            ? {
                                ...p,
                                checkin:
                                  p.checkin === "Checked in"
                                    ? "Awaiting"
                                    : "Checked in",
                              }
                            : p,
                        ),
                      );
                    else {
                      await api(`/operator/bookings/${r.bookingId}/check-in`, {
                        method: "PATCH",
                        body: JSON.stringify({
                          seat: r.seat,
                          checkedIn: r.checkin !== "Checked in",
                        }),
                      });
                      await load();
                    }
                    ws.notify("Passenger check-in updated");
                  } catch (e) {
                    ws.notify((e as Error).message);
                  }
                }
              : undefined
          }
        />
      )}
    </>
  );
}
