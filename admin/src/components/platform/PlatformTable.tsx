import { useEffect, useRef, useState } from "react";
import { api, downloadPlatformCsv } from "../../api/client";
import { Panel } from "../ui/Panel";
export function valueLabel(value: any, field: string) {
  return field.endsWith("Paise") && typeof value === "number"
    ? new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
      }).format(value / 100)
    : value === true
      ? "Yes"
      : value === false
        ? "No"
        : typeof value === "object" && value !== null
          ? JSON.stringify(value)
          : String(value ?? "—");
}
export function PlatformTable({
  title,
  path,
  columns,
  onView,
  actions,
  operators = false,
  dates = true,
  source = false,
  revision = 0,
  statuses,
  exportable = true,
  requirePeriodAndOperator = false,
  request = api,
  onRefresh,
}: {
  title: string;
  path: string;
  columns: [string, string][];
  onView?: (row: any) => void;
  actions?: React.ReactNode;
  operators?: boolean;
  dates?: boolean;
  source?: boolean;
  revision?: number;
  statuses?: string[];
  exportable?: boolean;
  requirePeriodAndOperator?: boolean;
  request?: typeof api;
  onRefresh?: () => void;
}) {
  const searchInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(""),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [operatorId, setOperator] = useState(""),
    [companies, setCompanies] = useState<any[]>([]),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [bookingSource, setSource] = useState("");
  const [composing, setComposing] = useState(false);
  useEffect(() => {
    if (composing) return;
    const timer = setTimeout(() => {
      setSearch(draft);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [draft, composing]);
  const [rows, setRows] = useState<any[]>([]),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [retry, setRetry] = useState(0),
    [exporting, setExporting] = useState(false);
  const query = new URLSearchParams({
    page: String(page),
    limit: "25",
    search,
    ...(status ? { status } : {}),
    ...(operatorId ? { operatorId } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(bookingSource ? { source: bookingSource } : {}),
  }).toString();
  useEffect(() => {
    if (requirePeriodAndOperator && (!operatorId || !from || !to)) {
      setRows([]);
      setTotal(0);
      setError("");
      setLoading(false);
      return;
    }
    if (from && to && from > to) {
      setError("From date must not follow to date.");
      setLoading(false);
      return;
    }
    const abort = new AbortController();
    setLoading(true);
    setError("");
    setRows([]);
    void request(`${path}?${query}`, { signal: abort.signal })
      .then((r) => {
        if (!abort.signal.aborted) {
          setRows(r.data);
          setTotal(r.meta?.total || 0);
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [path, query, retry, revision]);
  const filter = (save: (value: string) => void, value: string) => {
    save(value);
    setPage(1);
  };
  return (
    <Panel title={title} aside={actions}>
      <div className="platform-filters-v5">
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!composing) filter(setSearch, draft);
          }}
        >
          <label>
            Search {title.toLowerCase()}
            <span className="platform-search-control">
              <input
                ref={searchInput}
                aria-label={`Search ${title.toLowerCase()}`}
                onCompositionStart={() => setComposing(true)}
                onCompositionEnd={() => setComposing(false)}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              {draft && (
                <button
                  type="button"
                  className="btn"
                  aria-label={`Clear ${title.toLowerCase()} search`}
                  onClick={() => {
                    setDraft("");
                    filter(setSearch, "");
                    searchInput.current?.focus();
                  }}
                >
                  Clear
                </button>
              )}
            </span>
          </label>
          <button className="btn">Search</button>
        </form>
        {statuses && (
          <label>
            Status filter
            <select
              aria-label={
                title === "Operators"
                  ? "Operator status filter"
                  : `${title} status filter`
              }
              value={status}
              onChange={(e) => filter(setStatus, e.target.value)}
            >
              <option value="">All statuses</option>
              {statuses.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        )}
        {operators && (
          <>
            <label>
              Operator scope
              <select
                value={operatorId}
                onChange={(e) => filter(setOperator, e.target.value)}
              >
                <option value="">All operators</option>
                {companies.map((c) => (
                  <option value={c._id} key={c._id}>
                    {c.company}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="btn"
              onClick={async () => {
                try {
                  setCompanies(
                    (await request("/platform/operators?limit=100")).data,
                  );
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Load operator filter
            </button>
          </>
        )}
        {dates && (
          <>
            <label>
              From · IST
              <input
                type="date"
                value={from}
                onChange={(e) => filter(setFrom, e.target.value)}
              />
            </label>
            <label>
              To · IST
              <input
                type="date"
                value={to}
                onChange={(e) => filter(setTo, e.target.value)}
              />
            </label>
          </>
        )}
        {source && (
          <label>
            Booking source
            <select
              value={bookingSource}
              onChange={(e) => filter(setSource, e.target.value)}
            >
              <option value="">All sources</option>
              {["operator", "agent", "customer", "external"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        )}
        <button
          className="btn"
          onClick={() => (onRefresh ? onRefresh() : setRetry((v) => v + 1))}
        >
          Refresh
        </button>
        {dates && exportable && (
          <button
            className="btn"
            disabled={exporting || !from || !to || from > to}
            onClick={async () => {
              setExporting(true);
              try {
                await downloadPlatformCsv(path, query);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setExporting(false);
              }
            }}
          >
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
        )}
      </div>
      {error ? (
        <div className="platform-notice error" role="alert">
          {error}
          <button className="btn" onClick={() => setRetry((v) => v + 1)}>
            Retry {title.toLowerCase()}
          </button>
        </div>
      ) : loading ? (
        <div className="platform-table-state" role="status">
          Loading {title.toLowerCase()}…
        </div>
      ) : rows.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {columns.map(([key, label]) => (
                  <th key={key}>{label}</th>
                ))}
                {onView && <th>Action</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.id || row._id || i}>
                  {columns.map(([key]) => (
                    <td key={key}>{valueLabel(row[key], key)}</td>
                  ))}
                  {onView && (
                    <td>
                      <button className="text-btn" onClick={() => onView(row)}>
                        View details
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="platform-table-state">
          <h3>No matching {title.toLowerCase()}</h3>
          <p>Change the scope, dates or search to find records.</p>
          <button
            className="btn"
            onClick={() => {
              setDraft("");
              setSearch("");
              setStatus("");
              setFrom("");
              setTo("");
              setSource("");
              setOperator("");
              setPage(1);
            }}
          >
            Clear filters
          </button>
        </div>
      )}
      <div className="platform-pagination">
        <span>
          {total} records · Page {page}
        </span>
        <div>
          <button
            className="btn"
            disabled={loading || page === 1}
            onClick={() => setPage((v) => v - 1)}
          >
            Previous page
          </button>
          <button
            className="btn"
            disabled={loading || page * 25 >= total}
            onClick={() => setPage((v) => v + 1)}
          >
            Next page
          </button>
        </div>
      </div>
    </Panel>
  );
}
