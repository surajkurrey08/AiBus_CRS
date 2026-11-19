import { useEffect, useState } from "react";
import { api, authState, downloadFinancialReport } from "../../api/client";
export const operationalReportOptions = [
  "daily-trips",
  "scheduled-completed",
  "departure-delays",
  "arrival-delays",
  "bus-utilization",
  "seat-occupancy",
  "route-performance",
  "passenger-boarding",
  "cancellation-trends",
  "fuel-expenses",
  "distance",
  "mileage",
  "stoppage-duration",
  "crew-assignments",
  "booking-source",
];
const label = (text: string) =>
  text.replaceAll("-", " ").replace(/([a-z])([A-Z])/g, "$1 $2");
export function TripIntegrity({ tripId }: { tripId: string }) {
  const [rows, setRows] = useState<any[] | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    setRows(null);
    setError("");
  }, [tripId]);
  useEffect(() => {
    if (!revision) return;
    const controller = new AbortController();
    setBusy(true);
    setError("");
    api(`/operator/operations/trips/${tripId}/integrity`, {
      signal: controller.signal,
    })
      .then((r) => {
        if (!controller.signal.aborted) setRows(r.data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [tripId, revision]);
  return (
    <section aria-label="Reservation integrity">
      <button
        className="btn"
        disabled={busy}
        onClick={() => setRevision((r) => r + 1)}
      >
        {busy ? "Checking inventory..." : "Check reservation integrity"}
      </button>
      {error && (
        <p role="alert" className="error">
          {error} Retry the integrity check.
        </p>
      )}
      {rows && (
        <>
          <p role="status">
            {rows.length
              ? `${rows.length} discrepancies require review. No records have been repaired.`
              : "No reservation discrepancies found in this snapshot."}
          </p>
          <ul>
            {rows.map((r, i) => (
              <li key={i}>
                {label(r.code)}: {r.resourceId}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
/** Displays the operator's own open/resolved operational issues with pagination. */
export function OperationalIssues() {
  const [issues, setIssues] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [page, setPage] = useState(1),
    [status, setStatus] = useState("Open"),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError("");
    const q = new URLSearchParams({ status, page: String(page), limit: "25" });
    api(`/operator/operations/issues?${q}`, { signal: controller.signal })
      .then((r) => {
        if (!controller.signal.aborted) setIssues({ ...r.meta, rows: r.data });
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [page, status, revision]);
  return (
    <section aria-label="Operational issues">
      <div className="tm-actions">
        <label>
          Filter
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="Open">Open</option>
            <option value="Resolved">Resolved</option>
          </select>
        </label>
        <button
          className="btn"
          disabled={busy}
          onClick={() => setRevision((r) => r + 1)}
        >
          Refresh issues
        </button>
      </div>
      {busy && <p role="status">Loading operational issues...</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {issues && (
        <>
          <p role="status">
            {issues.total} issue{issues.total !== 1 ? "s" : ""} — observations
            only; records are not auto-repaired.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Exception</th>
                  <th>Category</th>
                  <th>Trip</th>
                  <th>Status</th>
                  <th>Last observed</th>
                </tr>
              </thead>
              <tbody>
                {issues.rows.map((i: any) => (
                  <tr key={i._id}>
                    <td>{label(i.code)}</td>
                    <td>{i.category}</td>
                    <td>{i.tripId || "—"}</td>
                    <td>{i.status}</td>
                    <td>
                      {i.lastSeenAt
                        ? new Date(i.lastSeenAt).toLocaleString()
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!issues.rows.length && (
            <p>No {status.toLowerCase()} issues found.</p>
          )}
          <div className="tm-actions">
            <button
              className="btn"
              disabled={page === 1 || busy}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <span>
              {page} / {issues.pages}
            </span>
            <button
              className="btn"
              disabled={page >= issues.pages || busy}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </>
      )}
      <p>
        <small>
          Financial exceptions require Finance permission. Integrity scanner is
          read-only — it records but never repairs.
        </small>
      </p>
    </section>
  );
}
export function OperationalReports() {
  const [name, setName] = useState("daily-trips"),
    [from, setFrom] = useState(
      new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }),
    ),
    [to, setTo] = useState(from),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [report, setReport] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [submitted, setSubmitted] = useState<{
      name: string;
      from: string;
      to: string;
      search: string;
    } | null>(null),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!submitted) return;
    const controller = new AbortController();
    setBusy(true);
    setError("");
    const q = new URLSearchParams({
      from: submitted.from,
      to: submitted.to,
      search: submitted.search,
      page: String(page),
      limit: "25",
    });
    api(`/operator/operations/reports/${submitted.name}?${q}`, {
      signal: controller.signal,
    })
      .then((r) => {
        if (!controller.signal.aborted) setReport({ ...r.meta, rows: r.data });
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [submitted, page, revision]);
  const clear = () => {
    setSubmitted(null);
    setReport(null);
    setPage(1);
  };
  return (
    <section aria-label="Detailed operational reports">
      <form
        className="tm-actions"
        onSubmit={(e) => {
          e.preventDefault();
          setReport(null);
          setPage(1);
          setSubmitted({ name, from, to, search });
        }}
      >
        <label>
          Report
          <select
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              clear();
            }}
          >
            {operationalReportOptions
              .filter(
                (n) =>
                  n !== "fuel-expenses" ||
                  authState().user?.permissions.includes("finance:read"),
              )
              .map((n) => (
                <option key={n} value={n}>
                  {label(n)}
                </option>
              ))}
          </select>
        </label>
        <label>
          From date
          <input
            type="date"
            required
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              clear();
            }}
          />
        </label>
        <label>
          To date
          <input
            type="date"
            required
            min={from}
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              clear();
            }}
          />
        </label>
        <label>
          Search operational records
          <input
            maxLength={100}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              clear();
            }}
          />
        </label>
        <button className="btn" disabled={busy}>
          Load detailed report
        </button>
      </form>
      {busy && <p role="status">Loading operational records...</p>}
      {error && (
        <p role="alert" className="error">
          {error}{" "}
          <button className="btn" onClick={() => setRevision((r) => r + 1)}>
            Retry report
          </button>
        </p>
      )}
      {report && (
        <>
          <p>{report.policy}</p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {report.columns?.map((c: string) => (
                    <th key={c}>{label(c)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r: any) => (
                  <tr key={r.id}>
                    {report.columns?.map((c: string) => (
                      <td key={c}>
                        {r[c] === null ? "Not recorded" : String(r[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!report.rows.length && (
            <p>No operational records match these filters.</p>
          )}
          <div className="tm-actions">
            <button
              className="btn"
              disabled={page === 1 || busy}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <span>
              {page} / {report.pages} ({report.total} records)
            </span>
            <button
              className="btn"
              disabled={page >= report.pages || busy}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={async () => {
                if (!submitted) return;
                setBusy(true);
                try {
                  await downloadFinancialReport(
                    submitted.name,
                    {
                      from: submitted.from,
                      to: submitted.to,
                      search: submitted.search,
                    },
                    true,
                    "operations",
                  );
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Export operational CSV
            </button>
          </div>
        </>
      )}
    </section>
  );
}
