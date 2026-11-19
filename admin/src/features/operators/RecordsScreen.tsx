import { useEffect, useState } from "react";
import { Download, Search } from "lucide-react";
import { api } from "../../api/client";
import { Overlay } from "../../components/ui/Overlay";

type RecordRow = {
  id: string;
  reference: string;
  pnr: string | null;
  source: string;
  status: string;
  paymentStatus: string;
  createdAt: string;
  totalPaise: number;
  passengers: { name: string; seat: string; phone?: string; email?: string; boarding?: string; dropping?: string }[];
  operator: string;
  operatorId: string;
  route: string;
  journeyDate: string | null;
  departureAt: string | null;
  enteredBy: string;
  enteredByEmail: string | null;
  enteredByRole: string | null;
  agentHierarchy: string[];
  totalPassengers: number;
};

type Payload = { bookings: RecordRow[]; counts: { api: number; operator: number } };

const currency = (paise: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format((paise || 0) / 100);

const dateLabel = (value?: string | null, time = false) =>
  value ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", ...(time ? {} : { dateStyle: "medium" }) }) : "—";

const formatRole = (role?: string | null) => {
  if (!role) return "Direct / API";
  if (role === "booking_staff") return "Agent";
  if (role === "operator_admin") return "Operator Admin";
  if (role === "manager") return "Manager";
  if (role === "read_only") return "Read Only";
  if (role === "super_admin") return "Platform Admin";
  return role.replace(/_/g, " ");
};

const csvCell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;

export function RecordsScreen({ channel }: { channel: "api" | "operator" }) {
  const [payload, setPayload] = useState<Payload>({ bookings: [], counts: { api: 0, operator: 0 } });
  const [operators, setOperators] = useState<{ _id: string; company: string }[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [operatorId, setOperatorId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<RecordRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api<{ _id: string; company: string }[]>("/platform/operators?page=1&limit=100", { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setOperators(result.data); })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ channel, page: String(page), limit: "20", search });
    if (status) params.set("status", status);
    if (operatorId) params.set("operatorId", operatorId);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const timer = setTimeout(() => {
      api<Payload>(`/platform/records/bookings?${params}`, { signal: controller.signal })
        .then((result) => {
          if (controller.signal.aborted) return;
          setPayload(result.data);
          setTotal(result.meta?.total || 0);
          setPages(result.meta?.pages || 1);
        })
        .catch((reason) => { if (!controller.signal.aborted) setError(reason.message); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [channel, page, search, status, operatorId, from, to, revision]);

  const exportCsv = () => {
    const columns = ["Booking reference", "PNR", "Operator", "Route", "Journey date", "Booking date", "Source", "Booking status", "Payment status", "Passengers", "Amount", "Entered by", "Agent hierarchy"];
    const lines = [columns, ...payload.bookings.map((row) => [row.reference, row.pnr, row.operator, row.route, row.journeyDate, row.createdAt, row.source, row.status, row.paymentStatus, row.totalPassengers, (row.totalPaise / 100).toFixed(2), row.enteredBy, row.agentHierarchy.join(" > ")])];
    const blob = new Blob([lines.map((line) => line.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `aibus-${channel}-bookings-page-${page}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const hasFilters = Boolean(search || status || operatorId || from || to);
  const label = channel === "api" ? "Bookings through API" : "Bookings through operators";

  return (
    <section className="records-screen" aria-label={label}>
      <div className="records-intro">
        <div className="records-summary-info">
          <span className="records-count-chip">
            <strong>{payload.counts[channel].toLocaleString("en-IN")}</strong> matching bookings
          </span>
          <span className="records-subtext">
            {channel === "api"
              ? "API, customer, and external reservation channels."
              : "Operator teams, counter staff, and booking agents."}
          </span>
        </div>
        <button className="btn" onClick={exportCsv} disabled={!payload.bookings.length || loading}>
          <Download size={15} /> Export page
        </button>
      </div>

      <div className="records-filters">
        <div className="records-search">
          <Search size={16} />
          <input
            aria-label="Search booking reference or PNR"
            placeholder="Search reference or PNR..."
            value={search}
            onChange={(event) => { setSearch(event.target.value); setPage(1); }}
          />
        </div>
        <select
          aria-label="Booking status"
          value={status}
          onChange={(event) => { setStatus(event.target.value); setPage(1); }}
        >
          <option value="">All booking statuses</option>
          {["Pending payment", "Confirmed", "Failed", "Cancelled", "Reconciliation required"].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <select
          aria-label="Bus operator"
          value={operatorId}
          onChange={(event) => { setOperatorId(event.target.value); setPage(1); }}
        >
          <option value="">All operators</option>
          {operators.map((operator) => (
            <option value={operator._id} key={operator._id}>{operator.company}</option>
          ))}
        </select>
        <div className="date-filter-group">
          <span className="date-filter-label">From</span>
          <input
            aria-label="From date"
            type="date"
            value={from}
            onChange={(event) => { setFrom(event.target.value); setPage(1); }}
          />
        </div>
        <div className="date-filter-group">
          <span className="date-filter-label">To</span>
          <input
            aria-label="To date"
            type="date"
            value={to}
            onChange={(event) => { setTo(event.target.value); setPage(1); }}
          />
        </div>
        {hasFilters && (
          <button
            className="text-btn records-clear-btn"
            onClick={() => {
              setSearch("");
              setStatus("");
              setOperatorId("");
              setFrom("");
              setTo("");
              setPage(1);
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {error ? (
        <div className="empty" role="alert">
          <p className="error">{error}</p>
          <button className="btn" onClick={() => setRevision((value) => value + 1)}>Retry records</button>
        </div>
      ) : loading ? (
        <div className="empty" role="status">Loading bookings…</div>
      ) : payload.bookings.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Booking</th>
                <th>Bus operator</th>
                <th>Route & travel</th>
                <th>Booked by / agent</th>
                <th>Booking status</th>
                <th>Payment</th>
                <th>Amount</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {payload.bookings.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong className="booking-ref">{row.reference}</strong>
                    <small>{row.pnr ? `PNR ${row.pnr}` : `${row.totalPassengers} passenger${row.totalPassengers === 1 ? "" : "s"}`}</small>
                    <small>{dateLabel(row.createdAt, true)}</small>
                  </td>
                  <td>
                    <strong>{row.operator}</strong>
                  </td>
                  <td>
                    <strong>{row.route}</strong>
                    <small>{row.journeyDate ? dateLabel(row.journeyDate) : "Travel date unavailable"}</small>
                  </td>
                  <td>
                    <strong>{row.enteredBy}</strong>
                    <small className="records-agent-tag">
                      {row.agentHierarchy.length ? row.agentHierarchy.join(" › ") : formatRole(row.enteredByRole)}
                    </small>
                  </td>
                  <td>
                    <span className={`records-status status-${row.status.toLowerCase().replaceAll(" ", "-")}`}>
                      {row.status}
                    </span>
                  </td>
                  <td>{row.paymentStatus}</td>
                  <td><strong>{currency(row.totalPaise)}</strong></td>
                  <td>
                    <button className="text-btn" onClick={() => setSelected(row)}>
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">
          <h3>No bookings found</h3>
          <p>Try changing the date range or filters.</p>
          <button
            className="btn"
            onClick={() => {
              setSearch("");
              setStatus("");
              setOperatorId("");
              setFrom("");
              setTo("");
              setPage(1);
            }}
          >
            Clear filters
          </button>
        </div>
      )}

      <div className="records-pagination">
        <span>{loading ? "Loading…" : `${total} booking${total === 1 ? "" : "s"}`}</span>
        <div>
          <button className="btn" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>
            Previous
          </button>
          <span>Page {page} of {pages}</span>
          <button className="btn" disabled={page >= pages || loading} onClick={() => setPage((value) => value + 1)}>
            Next
          </button>
        </div>
      </div>

      {selected && (
        <Overlay title={`Booking ${selected.reference}`} onClose={() => setSelected(null)} drawer>
          <div className="records-detail">
            <div className="records-detail-card">
              <div className="records-detail-grid">
                <div className="records-detail-row">
                  <span className="records-detail-label">PNR</span>
                  <strong className="records-detail-value">{selected.pnr || "Not issued"}</strong>
                </div>
                <div className="records-detail-row">
                  <span className="records-detail-label">Source</span>
                  <span className="records-detail-value">{selected.source}</span>
                </div>
                <div className="records-detail-row">
                  <span className="records-detail-label">Operator</span>
                  <strong className="records-detail-value">{selected.operator}</strong>
                </div>
                <div className="records-detail-row">
                  <span className="records-detail-label">Route</span>
                  <strong className="records-detail-value">{selected.route}</strong>
                </div>
                <div className="records-detail-row">
                  <span className="records-detail-label">Travel</span>
                  <span className="records-detail-value">
                    {selected.journeyDate || "—"}
                    {selected.departureAt ? ` · ${dateLabel(selected.departureAt, true)}` : ""}
                  </span>
                </div>
                <div className="records-detail-row">
                  <span className="records-detail-label">Booked</span>
                  <span className="records-detail-value">{dateLabel(selected.createdAt, true)}</span>
                </div>
                <div className="records-detail-row">
                  <span className="records-detail-label">Entered by</span>
                  <div className="records-detail-value">
                    <strong>{selected.enteredBy}</strong>
                    {selected.enteredByEmail && <div className="muted">{selected.enteredByEmail}</div>}
                    <span className="records-agent-tag" style={{ marginTop: "4px" }}>
                      {formatRole(selected.enteredByRole)}
                    </span>
                  </div>
                </div>
                <div className="records-detail-row">
                  <span className="records-detail-label">Agent hierarchy</span>
                  <span className="records-detail-value">
                    {selected.agentHierarchy.length ? selected.agentHierarchy.join(" › ") : "No partner attribution recorded"}
                  </span>
                </div>
                <div className="records-detail-row">
                  <span className="records-detail-label">Payment</span>
                  <strong className="records-detail-value">
                    {selected.paymentStatus} · {currency(selected.totalPaise)}
                  </strong>
                </div>
              </div>
            </div>

            <div className="passenger-section-heading">
              <h3>Passengers and seats</h3>
              <span className="muted">{selected.passengers.length} passenger{selected.passengers.length === 1 ? "" : "s"}</span>
            </div>

            <div className="records-passengers">
              {selected.passengers.map((passenger, index) => (
                <article key={`${passenger.seat}-${index}`} className="passenger-card">
                  <div className="passenger-card-top">
                    <div>
                      <strong className="passenger-name">{passenger.name}</strong>
                      {passenger.phone && (
                        <div className="passenger-phone">📱 {passenger.phone}</div>
                      )}
                    </div>
                    <span className="passenger-seat-badge">Seat {passenger.seat}</span>
                  </div>
                  <div className="passenger-stops-row">
                    <span className="stop-point">
                      <small>Boarding:</small> {passenger.boarding || "Not recorded"}
                    </span>
                    <span className="stop-arrow">→</span>
                    <span className="stop-point">
                      <small>Dropping:</small> {passenger.dropping || "Not recorded"}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </Overlay>
      )}
    </section>
  );
}
