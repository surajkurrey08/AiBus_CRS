import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { Panel } from "../../components/ui/Panel";
const names: Record<string, string> = {
  totalOperators: "Registered operators",
  activeOperators: "Active operators",
  pendingOperators: "Pending approvals",
  buses: "Registered buses",
  activeTrips: "Active trips",
  departingToday: "Departing today",
  confirmedBookings: "Confirmed bookings",
  pendingBookings: "Pending bookings",
  cancelledBookings: "Cancelled bookings",
  availableSeats: "Available seats",
  grossBookingValuePaise: "Gross booking value",
  platformEarningsPaise: "Authorized platform earnings",
  pendingSettlements: "Pending settlements",
  refundExceptions: "Finance exceptions",
};
export function PlatformOverview() {
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [operatorId, setOperator] = useState(""),
    [source, setSource] = useState(""),
    [companies, setCompanies] = useState<any[]>([]),
    [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setError("");
    setData(null);
    if (from && to && from > to) {
      setError("Choose a valid date range.");
      return;
    }
    const params = new URLSearchParams({
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(operatorId ? { operatorId } : {}),
      ...(source ? { source } : {}),
    });
    void api(`/platform/overview${params.size ? `?${params}` : ""}`, {
      signal: abort.signal,
    })
      .then((r) => {
        if (!abort.signal.aborted) setData(r.data);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [from, to, operatorId, source, revision]);
  return (
    <div className="platform-section">
      <Panel title="Platform operations">
        <div className="platform-filters-v5">
          <label>
            From · IST
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            To · IST
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <label>
            Operator
            <select
              value={operatorId}
              onChange={(e) => setOperator(e.target.value)}
            >
              <option value="">All operators</option>
              {companies.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.company}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn"
            onClick={async () => {
              try {
                setCompanies((await api("/platform/operators?limit=100")).data);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Load operator filter
          </button>
          <label>
            Booking source
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">All sources</option>
              {["operator", "customer", "agent", "external"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <button className="btn" onClick={() => setRevision((v) => v + 1)}>
            Refresh overview
          </button>
        </div>
      </Panel>
      {error ? (
        <div className="platform-notice error" role="alert">
          {error}
          <button className="btn" onClick={() => setRevision((v) => v + 1)}>
            Retry overview
          </button>
        </div>
      ) : !data ? (
        <p className="platform-table-state" role="status">
          Loading platform operations…
        </p>
      ) : (
        <>
          <div className="platform-kpis">
            {Object.entries(
              data.metrics || {
                totalOperators: data.totalOperators,
                pendingOperators: data.operators?.pending,
                buses: data.buses,
                activeTrips: data.scheduledTrips,
              },
            ).map(([key, value]) => (
              <div key={key}>
                <span>{names[key] || key}</span>
                <strong>
                  {typeof value === "number"
                    ? key.endsWith("Paise")
                      ? new Intl.NumberFormat("en-IN", {
                          style: "currency",
                          currency: "INR",
                        }).format(value / 100)
                      : value.toLocaleString("en-IN")
                    : "Not available"}
                </strong>
              </div>
            ))}
          </div>
          <p className="platform-scope-note">
            {data.policy || "Current registered platform records."}
            {data.financeRestricted &&
              " Financial metrics require explicit platform finance access."}
          </p>
          <div className="platform-overview-grid">
            <Panel title="Booking trends by travel date">
              <div className="panel-body">
                {data.trends?.length ? (
                  data.trends.map((r: any) => (
                    <div className="platform-trend" key={r.label}>
                      <span>{r.label}</span>
                      <meter
                        min={0}
                        max={Math.max(
                          1,
                          ...data.trends.map((v: any) => v.count),
                        )}
                        value={r.count}
                      />
                      <strong>{r.count}</strong>
                    </div>
                  ))
                ) : (
                  <p>No recorded bookings for this scope.</p>
                )}
              </div>
            </Panel>
            <Panel title="Route performance">
              <div className="panel-body">
                {data.routes?.length ? (
                  data.routes.map((r: any) => (
                    <p key={r.label}>
                      {r.label} <strong>{r.count} bookings</strong>
                    </p>
                  ))
                ) : (
                  <p>No booked routes for this scope.</p>
                )}
              </div>
            </Panel>
            <Panel title="Operational alerts">
              <div className="panel-body">
                {data.alerts?.length ? (
                  data.alerts.map((a: any) => (
                    <p key={a.id}>
                      {a.operator} · {a.message}
                    </p>
                  ))
                ) : (
                  <p>
                    No recorded operational alerts for this scope. This does not
                    verify external provider health.
                  </p>
                )}
              </div>
            </Panel>
            <Panel title="Recent operational activity">
              <div className="panel-body">
                {data.recent?.length ? (
                  data.recent.map((a: any) => (
                    <p key={a._id}>
                      {a.action} ·{" "}
                      {new Date(a.createdAt).toLocaleString("en-IN", {
                        timeZone: "Asia/Kolkata",
                      })}{" "}
                      IST
                    </p>
                  ))
                ) : (
                  <p>No recorded operational events.</p>
                )}
              </div>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
