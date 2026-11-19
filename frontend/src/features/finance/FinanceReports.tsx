import { useEffect, useState } from "react";
import { api, downloadFinancialReport } from "../../api/client";
import { Panel } from "../../components/index";
import "./finance.css";
const titles: Record<string, string> = {
  "daily-ticket-revenue": "Daily ticket value",
  "monthly-ticket-revenue": "Monthly ticket value",
  "operator-revenue": "Operator earnings",
  "agency-revenue": "Agency sales",
  "route-revenue": "Route performance",
  "booking-source": "Booking sources",
  "commission-earned": "Earned commissions",
  "commission-payable": "Commission liabilities",
  "operator-settlements": "Settlement history",
  "pending-payments": "Pending payments",
  "refund-summary": "Refund summary",
  "wallet-balances": "Wallet liabilities",
  "credit-exposure": "Credit exposure",
  "payment-exceptions": "Payment exceptions",
  "settlement-reconciliation": "Settlement reconciliation",
};
export function FinanceReports({
  initial = "daily-ticket-revenue",
}: {
  initial?: string;
}) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [name, setName] = useState(initial),
    [from, setFrom] = useState(today.slice(0, 7) + "-01"),
    [to, setTo] = useState(today),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("");
  const [agentId, setAgent] = useState(""),
    [agencies, setAgencies] = useState<any[]>([]);
  const [submitted, setSubmitted] = useState<{
      name: string;
      from: string;
      to: string;
      search: string;
      status: string;
      agentId?: string;
    } | null>(null),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0),
    [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [exporting, setExporting] = useState(false);
  useEffect(() => {
    if (!submitted) return;
    const abort = new AbortController();
    setLoading(true);
    setError("");
    setData(null);
    const { name, ...query } = submitted;
    void api(
      `/operator/finance/reports/${name}?${new URLSearchParams({ ...query, ...(query.status ? {} : { status: "" }), page: String(page), limit: "25" })}`,
      { signal: abort.signal },
    )
      .then((r) => {
        if (!abort.signal.aborted) setData(r.data);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [submitted, page, revision]);
  const rows: any[] = data?.rows || [],
    fields: string[] = [
      ...new Set<string>(rows.flatMap((row) => Object.keys(row))),
    ];
  const label = (value: unknown, key: string) =>
    key.endsWith("Paise") && typeof value === "number"
      ? new Intl.NumberFormat("en-IN", {
          style: "currency",
          currency: "INR",
        }).format(value / 100)
      : String(value ?? "—");
  return (
    <div className="finance-workspace">
      <Panel title="Financial reports">
        <div className="panel-body">
          <p>
            Posted financial records only. Gross ticket value, platform revenue,
            payable liabilities and verified bank receipts are distinct. Test
            settlements are labelled.
          </p>
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              if (!from || !to || from > to) {
                setError("Choose a valid date range.");
                return;
              }
              setSubmitted({
                name,
                from,
                to,
                search,
                status,
                ...(agentId ? { agentId } : {}),
              });
              setPage(1);
            }}
          >
            <label>
              Report
              <select value={name} onChange={(e) => setName(e.target.value)}>
                {Object.entries(titles).map(([value, title]) => (
                  <option key={value} value={value}>
                    {title}
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
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label>
              Exact status (optional)
              <input
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              />
            </label>
            <label>
              Agency scope
              <select
                value={agentId}
                onChange={(e) => setAgent(e.target.value)}
              >
                <option value="">All owned agencies and direct bookings</option>
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
                  const r = await api("/operator/finance/agencies");
                  setAgencies(r.data);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Load agency filter
            </button>
            <button className="btn primary" disabled={loading}>
              Generate report
            </button>
          </form>
          {error && (
            <div role="alert">
              <p>{error}</p>
              <button className="btn" onClick={() => setRevision((v) => v + 1)}>
                Retry report
              </button>
            </div>
          )}
          {loading && <p role="status">Loading posted financial records…</p>}
          {!submitted && <p>Select a report and period, then generate it.</p>}
          {data && (
            <>
              <h4>{titles[submitted!.name]}</h4>
              <p>{data.coverage}</p>
              <button
                className="btn"
                disabled={exporting}
                onClick={async () => {
                  setExporting(true);
                  setError("");
                  try {
                    const { name, ...q } = submitted!;
                    await downloadFinancialReport(name, q);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setExporting(false);
                  }
                }}
              >
                {exporting ? "Exporting…" : "Download CSV for Excel"}
              </button>
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
                      <tr key={row.id || i}>
                        {fields.map((f) => (
                          <td key={f}>{label(row[f], f)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!rows.length && (
                  <p>No matching financial records for this period.</p>
                )}
              </div>
              <p>
                {data.total} matching records · Page {page}
              </p>
              <button
                className="btn"
                disabled={page === 1 || loading}
                onClick={() => setPage((v) => v - 1)}
              >
                Previous
              </button>
              <button
                className="btn"
                disabled={page * 25 >= data.total || loading}
                onClick={() => setPage((v) => v + 1)}
              >
                Next
              </button>
            </>
          )}
        </div>
      </Panel>
    </div>
  );
}
