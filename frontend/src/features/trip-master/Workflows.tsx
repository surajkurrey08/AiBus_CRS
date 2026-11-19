import {
  OperationalReports,
  OperationalIssues,
  TripIntegrity,
} from "./OperationalReliability";
import { MasterForm } from "./MasterForm";
import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { asIso, localNow, optionLabel, today } from "./config";
export function ScheduleServices({
  services,
  refresh,
}: {
  services: any[];
  refresh: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]),
    [from, setFrom] = useState(today()),
    [to, setTo] = useState(today()),
    [preview, setPreview] = useState<any[] | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const payload = { serviceIds: selected, from, to };
  const invalidate = () => {
    setPreview(null);
    setNotice("");
  };
  return (
    <section className="tm-card">
      <h3>Schedule services across dates</h3>
      <p className="muted">
        Up to 100 journeys per batch. Existing service/date trips are skipped.
        Any scheduling conflict prevents the entire new batch.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          setNotice("");
          setPreview(null);
          try {
            setPreview(
              (
                await api<any[]>("/operator/trip-master/scheduling/preview", {
                  method: "POST",
                  body: JSON.stringify(payload),
                })
              ).data,
            );
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy} className="tm-fieldset">
          <div className="tm-checks">
            {services
              .filter((s) => s.status === "Active")
              .map((s) => (
                <label key={s._id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(s._id)}
                    onChange={() => {
                      setSelected(
                        selected.includes(s._id)
                          ? selected.filter((id) => id !== s._id)
                          : [...selected, s._id],
                      );
                      invalidate();
                    }}
                  />
                  {s.name} · {s.departure} IST
                </label>
              ))}
          </div>
          {!services.length && <p>Create a service first.</p>}
          <div className="tm-actions">
            <label>
              From date
              <input
                required
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  invalidate();
                }}
              />
            </label>
            <label>
              To date
              <input
                required
                type="date"
                min={from}
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  invalidate();
                }}
              />
            </label>
            <button disabled={!selected.length} className="btn">
              {busy ? "Checking..." : "Preview journeys"}
            </button>
          </div>
        </fieldset>
      </form>
      {preview && (
        <>
          <Results
            rows={preview.map((p) => ({
              Service: p.serviceName,
              Route: p.route,
              Bus: p.registration,
              Date: p.journeyDate,
              State: p.state,
            }))}
          />
          <button
            className="btn primary"
            disabled={
              busy ||
              preview.some((p) => !["Ready", "Existing"].includes(p.state)) ||
              !preview.some((p) => p.state === "Ready")
            }
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const { data } = await api(
                  "/operator/trip-master/scheduling/create",
                  { method: "POST", body: JSON.stringify(payload) },
                );
                setNotice(
                  `${data.created} trips created; ${data.existing} existing trips skipped.`,
                );
                setPreview(null);
                refresh();
              } catch (e) {
                setError((e as Error).message);
                setPreview(null);
              } finally {
                setBusy(false);
              }
            }}
          >
            Schedule previewed journeys
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
export function Results({ rows }: { rows: Record<string, any>[] }) {
  return !rows.length ? (
    <p className="tm-empty">No records for this selection.</p>
  ) : (
    <div className="tm-scroll">
      <table className="tm-table">
        <thead>
          <tr>
            {Object.keys(rows[0]).map((k) => (
              <th key={k}>{k}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id || i}>
              {Object.entries(row).map(([k, v]) => (
                <td key={k}>
                  {v === null || v === undefined ? "Not recorded" : String(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Availability({
  services,
  onCounter,
}: {
  services: any[];
  onCounter: () => void;
}) {
  const [date, setDate] = useState(today()),
    [service, setService] = useState(""),
    [rows, setRows] = useState<any[] | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="tm-card">
      <h3>Multi-service trip availability</h3>
      <form
        className="tm-actions"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          setRows(null);
          try {
            setRows(
              (
                await api<any[]>(
                  `/operator/trip-master/availability?journeyDate=${date}${service ? `&serviceIds=${service}` : ""}`,
                )
              ).data,
            );
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Journey date
          <input
            type="date"
            required
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setRows(null);
            }}
          />
        </label>
        <label>
          Service
          <select
            value={service}
            onChange={(e) => {
              setService(e.target.value);
              setRows(null);
            }}
          >
            <option value="">All services & single trips</option>
            {services.map((s) => (
              <option key={s._id} value={s._id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button className="btn primary" disabled={busy}>
          {busy ? "Searching..." : "Check availability"}
        </button>
      </form>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {rows ? (
        <Results
          rows={rows.map((r) => ({
            Service: r.service,
            Route: r.route,
            Bus: r.registration,
            Departure: new Date(r.departureAt).toLocaleString("en-IN", {
              timeZone: "Asia/Kolkata",
            }),
            Status: r.status,
            "Booking open": r.bookingOpen ? "Yes" : "No",
            Total: r.total,
            Available: r.available,
            Booked: r.booked,
            Held: r.held,
            Blocked: r.blocked,
            Quota: r.quota,
          }))}
        />
      ) : (
        <p className="tm-empty">
          Choose a journey date, then check availability.
        </p>
      )}
      <button className="btn" onClick={onCounter}>
        Open Booking Counter · booking & quota
      </button>
    </section>
  );
}
export function Tracker({
  lookup,
  canWrite,
  onArea,
}: {
  lookup: Record<string, any[]>;
  canWrite: boolean;
  onArea: () => void;
}) {
  const [id, setId] = useState(""),
    [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [incident, setIncident] = useState(false);
  const [at, setAt] = useState(localNow()),
    [odo, setOdo] = useState(""),
    [fuel, setFuel] = useState(""),
    [key, setKey] = useState(() => crypto.randomUUID());
  useEffect(() => {
    setData(null);
    setError("");
    if (!id) return;
    const controller = new AbortController();
    setBusy(true);
    api(`/operator/trip-master/trips/${id}/tracker`, {
      signal: controller.signal,
    })
      .then((r) => {
        if (!controller.signal.aborted) {
          setData(r.data);
          setKey(crypto.randomUUID());
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [id, revision]);
  const next: Record<string, string> = {
    Scheduled: "Boarding",
    Boarding: "Boarding Completed",
    "Boarding Completed": "Departed",
    Departed: "In Transit",
    "In Transit": "Arrived",
    Arrived: "Completed",
  };
  const stage = data
    ? next[data.trip.operationStage || data.trip.status]
    : undefined;
  return (
    <section className="tm-card">
      <h3>Trip tracker</h3>
      <label>
        Choose trip
        <select
          value={id}
          onChange={(e) => {
            setId(e.target.value);
            setKey(crypto.randomUUID());
            setOdo("");
            setFuel("");
          }}
        >
          <option value="">Select a trip</option>
          {(lookup.trips || []).map((t) => (
            <option key={t._id} value={t._id}>
              {optionLabel("trips", t, lookup)}
            </option>
          ))}
        </select>
      </label>
      {busy && <p role="status">Loading...</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {data && (
        <>
          <div className="tm-status">
            <strong>{data.trip.operationStage || data.trip.status}</strong>
            <button
              className="btn"
              disabled={busy}
              onClick={() => setRevision((r) => r + 1)}
            >
              Refresh tracker
            </button>
          </div>
          <TripIntegrity tripId={id} />
          <p>
            Crew:{" "}
            {(data.crew || [])
              .map((c: any) => c.name + " (" + c.role + ")")
              .join(", ") || "No assigned crew"}
            . Active tablet assignments: {(data.tablets || []).length}.
          </p>
          <Results
            rows={(data.incidents || []).map((i: any) => ({
              Type: i.kind,
              Reason: i.reason,
              Time: i.at,
            }))}
          />
          {canWrite && (
            <button className="btn" onClick={() => setIncident(true)}>
              Record incident
            </button>
          )}
          {incident && (
            <MasterForm
              resource="incidents"
              endpoint={`/operator/operations/trips/${id}/incidents`}
              lookup={lookup}
              onClose={() => setIncident(false)}
              onSaved={() => {
                setIncident(false);
                setRevision((r) => r + 1);
              }}
            />
          )}
          <Results
            rows={data.events.map((e: any) => ({
              Stage: e.stage,
              "Actual time · IST": new Date(e.at).toLocaleString("en-IN", {
                timeZone: "Asia/Kolkata",
              }),
              "Odometer · km": e.odometerKm,
            }))}
          />
          {canWrite && stage && data.trip.inventoryOwner === "internal" && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                try {
                  await api(`/operator/trip-master/trips/${id}/operations`, {
                    method: "POST",
                    headers: { "Idempotency-Key": key },
                    body: JSON.stringify({
                      stage,
                      at: asIso(at),
                      expectedVersion: data.trip.__v,
                      ...(odo ? { odometerKm: Number(odo) } : {}),
                      ...(fuel
                        ? {
                            fuelConsumedMillilitres: Math.round(
                              Number(fuel) * 1000,
                            ),
                          }
                        : {}),
                    }),
                  });
                  setKey(crypto.randomUUID());
                  setRevision((r) => r + 1);
                  setAt(localNow());
                  setOdo("");
                  setFuel("");
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <fieldset className="tm-fieldset" disabled={busy}>
                <div className="tm-actions">
                  <label>
                    Actual {stage.toLowerCase()} time · IST
                    <input
                      required
                      type="datetime-local"
                      value={at}
                      onChange={(e) => {
                        setAt(e.target.value);
                        setKey(crypto.randomUUID());
                      }}
                    />
                  </label>
                  {["Departed", "Arrived"].includes(stage) && (
                    <label>
                      Odometer · km · optional
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={odo}
                        onChange={(e) => {
                          setOdo(e.target.value);
                          setKey(crypto.randomUUID());
                        }}
                      />
                    </label>
                  )}
                  {stage === "Arrived" && (
                    <label>
                      Measured fuel consumed · litres · optional
                      <input
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={fuel}
                        onChange={(e) => {
                          setFuel(e.target.value);
                          setKey(crypto.randomUUID());
                        }}
                      />
                    </label>
                  )}
                  <button className="btn primary">Record {stage}</button>
                </div>
              </fieldset>
            </form>
          )}
          <div className="tm-integration">
            <h4>Live GPS · {data.gps.telemetryStatus}</h4>
            <p>
              {data.gps.provider || "No GPS provider configured"}.
              Configuration: {data.gps.configurationStatus}. Live coordinates
              need a GPS provider connection.
            </p>
            <p>
              Revmax integration is not configured. Provider documentation and
              credentials are required.
            </p>
            <button className="btn" onClick={onArea}>
              Manage pickup, drop & POI coordinates in Area Master
            </button>
          </div>
        </>
      )}
    </section>
  );
}
export function Reports() {
  const [from, setFrom] = useState(today()),
    [to, setTo] = useState(today()),
    [data, setData] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <section className="tm-card">
      <h3>Operational reports</h3>
      <OperationalIssues />
      <OperationalReports />
      <p className="muted">
        Delay and mileage use recorded actual times, odometer readings and
        measured fuel consumption. Fuel purchases are reported separately.
      </p>
      <form
        className="tm-actions"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          setData(null);
          try {
            setData(
              (await api(`/operator/trip-master/reports?from=${from}&to=${to}`))
                .data,
            );
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          From
          <input
            type="date"
            required
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setData(null);
            }}
          />
        </label>
        <label>
          To
          <input
            type="date"
            required
            min={from}
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setData(null);
            }}
          />
        </label>
        <button className="btn primary" disabled={busy}>
          {busy ? "Loading..." : "Run reports"}
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {data && (
        <>
          <p>
            {data.summary.trips} trips · {data.summary.onTimeDepartures} on-time
            departures out of {data.summary.recordedDepartures} recorded
            departures · {data.summary.distanceKm} recorded km
          </p>
          <Results
            rows={data.rows.map((r: any) => ({
              Date: r.date,
              Service: r.service,
              Route: r.route,
              Bus: r.registration,
              Status: r.status,
              "Departure delay · min": r.departureDelayMinutes,
              "Arrival delay · min": r.arrivalDelayMinutes,
              "Distance · km": r.distanceKm,
              "Mileage · km/l": r.mileageKmPerLitre,
              "Fuel purchased · litres": r.purchasedLitres,
              "Stoppage · min": r.stoppageMinutes,
              ...(r.fuelExpensePaise !== undefined
                ? {
                    "Fuel expense · INR": (r.fuelExpensePaise / 100).toFixed(2),
                  }
                : {}),
            }))}
          />
          {data.summary.commissionPaise !== undefined && (
            <p>
              Confirmed booking commission: ₹
              {(data.summary.commissionPaise / 100).toFixed(2)}
            </p>
          )}
          <h4>Pickup / drop analysis · confirmed passengers</h4>
          <Results
            rows={data.pickupDropAnalysis.map((r: any) => ({
              Type: r.kind,
              Point: r.point,
              Passengers: r.passengers,
            }))}
          />
        </>
      )}
    </section>
  );
}
