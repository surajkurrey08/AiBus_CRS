import { useEffect, useState } from "react";
import { api, downloadFinancialReport } from "../../api/client";
import { Panel } from "../../components/ui/Panel";
export function AdminReports({
  initial = "daily-ticket-revenue",
  audit = false,
}: {
  initial?: string;
  audit?: boolean;
}) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [name, setName] = useState(initial),
    [reports, setReports] = useState<string[]>([]),
    [from, setFrom] = useState(today.slice(0, 7) + "-01"),
    [to, setTo] = useState(today),
    [operatorId, setOperator] = useState(""),
    [operators, setOperators] = useState<any[]>([]),
    [operatorSearch, setOperatorSearch] = useState(""),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("");
  const [agentId, setAgent] = useState(""),
    [agencies, setAgencies] = useState<any[]>([]);
  const [request, setRequest] = useState<{
      name: string;
      query: Record<string, string>;
    } | null>(null),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0),
    [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [exporting, setExporting] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    void api("/platform/finance/reports", { signal: abort.signal })
      .then((r) => {
        if (!abort.signal.aborted) setReports(r.data.reports);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void api(
        `/platform/operators?limit=25&search=${encodeURIComponent(operatorSearch)}`,
        { signal: abort.signal },
      )
        .then((r) => {
          if (!abort.signal.aborted) setOperators(r.data);
        })
        .catch((e) => {
          if (!abort.signal.aborted) setError(e.message);
        });
    }, 200);
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [operatorSearch]);
  useEffect(() => {
    if (!request) return;
    const abort = new AbortController();
    setError("");
    setLoading(true);
    setData(null);
    const params = new URLSearchParams({
      ...request.query,
      page: String(page),
      limit: "25",
    });
    void api(
      `/platform/finance/${audit ? "audit" : `reports/${request.name}`}?${params}`,
      { signal: abort.signal },
    )
      .then((r) => {
        if (!abort.signal.aborted)
          setData(
            audit
              ? {
                  rows: r.data,
                  total: r.meta?.total || 0,
                  coverage:
                    "Permanent financial audit events; no automatic balancing adjustments.",
                }
              : r.data,
          );
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [request, page, revision, audit]);
  const rows: any[] = data?.rows || [],
    fields: string[] = [
      ...new Set<string>(rows.flatMap((r) => Object.keys(r))),
    ];
  const display = (value: any, key: string) =>
    key.endsWith("Paise") && typeof value === "number"
      ? new Intl.NumberFormat("en-IN", {
          style: "currency",
          currency: "INR",
        }).format(value / 100)
      : typeof value === "object" && value !== null
        ? JSON.stringify(value)
        : String(value ?? "—");
  return (
    <Panel
      title={
        audit ? "Financial audit history" : "Ledger-backed financial reports"
      }
    >
      <div className="panel-body">
        <p>
          Ticket value and collections are not AIBUS platform revenue. Bank
          receipt integration is unavailable. All settlement payout records are
          explicitly simulated; no bank account details are exposed.
        </p>
        <form
          className="finance-filters"
          onSubmit={(e) => {
            e.preventDefault();
            if (!from || !to || from > to) {
              setError("Choose a valid date range.");
              return;
            }
            setRequest({
              name,
              query: {
                from,
                to,
                search,
                ...(status ? { status } : {}),
                ...(operatorId ? { operatorId } : {}),
                ...(!audit && agentId ? { agentId } : {}),
              },
            });
            setPage(1);
          }}
        >
          {!audit && (
            <label>
              Report
              <select value={name} onChange={(e) => setName(e.target.value)}>
                {reports.map((r) => (
                  <option value={r} key={r}>
                    {r.replaceAll("-", " ")}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Find operator
            <input
              value={operatorSearch}
              onChange={(e) => setOperatorSearch(e.target.value)}
            />
          </label>
          <label>
            Operator scope
            <select
              value={operatorId}
              onChange={(e) => {
                setOperator(e.target.value);
                setAgent("");
                setAgencies([]);
              }}
            >
              <option value="">All authorized operators</option>
              {operators.map((o) => (
                <option key={o._id} value={o._id}>
                  {o.company}
                </option>
              ))}
            </select>
          </label>
          <label>
            From · IST
            <input
              type="date"
              required
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            To · IST
            <input
              type="date"
              required
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <label>
            Search records
            <input value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          {!audit && (
            <label>
              Exact status (optional)
              <input
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              />
            </label>
          )}
          {!audit && operatorId && (
            <>
              <label>
                Agency scope
                <select
                  value={agentId}
                  onChange={(e) => setAgent(e.target.value)}
                >
                  <option value="">All agencies and direct bookings</option>
                  {agencies.map((a) => (
                    <option value={a._id} key={a._id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  try {
                    const r = await api(
                      `/platform/finance/agencies?operatorId=${operatorId}`,
                    );
                    setAgencies(r.data);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Load agency filter
              </button>
            </>
          )}
          <button className="btn primary" disabled={loading}>
            Generate report
          </button>
        </form>
        {error && (
          <div role="alert">
            {error}
            <button className="btn" onClick={() => setRevision((v) => v + 1)}>
              Retry financial report
            </button>
          </div>
        )}
        {loading && <p role="status">Loading financial records…</p>}
        {!request && (
          <p>Select a report and period to load financial records.</p>
        )}
        {data && (
          <>
            <p>{data.coverage}</p>
            {!audit && (
              <button
                className="btn"
                disabled={exporting}
                onClick={async () => {
                  setExporting(true);
                  setError("");
                  try {
                    await downloadFinancialReport(
                      request!.name,
                      request!.query,
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setExporting(false);
                  }
                }}
              >
                {exporting ? "Exporting…" : "Download CSV for Excel"}
              </button>
            )}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {fields.map((f) => (
                      <th key={f}>
                        {f
                          .replace(/([A-Z])/g, " $1")
                          .replace(" Paise", " · INR")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={row.id || row._id || i}>
                      {fields.map((f) => (
                        <td key={f}>{display(row[f], f)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!rows.length && <p>No matching financial records.</p>}
            </div>
            <p>
              {data.total} records · Page {page}
            </p>
            <button
              className="btn"
              disabled={loading || page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <button
              className="btn"
              disabled={loading || page * 25 >= data.total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </>
        )}
      </div>
    </Panel>
  );
}
