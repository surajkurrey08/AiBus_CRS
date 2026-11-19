import { useEffect, useState } from "react";
import {
  Building2,
  BusFront,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  ListChecks,
  LogOut,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { api, logout, type Identity } from "../../api/client.ts";
import { Overlay } from "../../components/ui/Overlay";
import { Panel } from "../../components/ui/Panel";
import { RecordsScreen } from "./RecordsScreen";
type Raw = Record<string, any>;
import "./platform.css";

type OperatorStatus = "pending" | "approved" | "suspended" | "rejected";
type Overview = {
  totalOperators: number;
  operators: Partial<Record<OperatorStatus, number>>;
  buses: number;
  routes: number;
  scheduledTrips: number;
};
const statuses: OperatorStatus[] = [
  "pending",
  "approved",
  "suspended",
  "rejected",
];
const statusLabel = (status: string) =>
  status.charAt(0).toUpperCase() + status.slice(1);
function OperatorStatusBadge({ status }: { status: string }) {
  return (
    <span className={`platform-status status-${status}`}>
      {statusLabel(status)}
    </span>
  );
}
function OperatorDetails({
  id,
  onClose,
  onReview,
}: {
  id: string;
  onClose: () => void;
  onReview: (operator: Raw) => void;
}) {
  const [operator, setOperator] = useState<Raw | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setOperator(null);
    setError("");
    api<Raw>(`/platform/operators/${id}`, { signal: controller.signal })
      .then((r) => {
        if (!controller.signal.aborted) setOperator(r.data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [id, retry]);
  return (
    <Overlay title="Operator details" onClose={onClose} drawer>
      <div className="platform-details">
        {error ? (
          <div role="alert">
            <p className="error">{error}</p>
            <button className="btn" onClick={() => setRetry((r) => r + 1)}>
              Retry
            </button>
          </div>
        ) : !operator ? (
          <p role="status">Loading operator details...</p>
        ) : (
          <>
            <div className="platform-company-heading">
              <Building2 size={28} />
              <div>
                <h2>{operator.company}</h2>
                <OperatorStatusBadge status={operator.status} />
              </div>
            </div>
            <dl className="platform-contact">
              <dt>Email</dt>
              <dd>{operator.email}</dd>
              <dt>Phone</dt>
              <dd>{operator.phone || "Not provided"}</dd>
              <dt>Address</dt>
              <dd>{operator.address || "Not provided"}</dd>
              <dt>Registered</dt>
              <dd>
                {operator.createdAt
                  ? new Date(operator.createdAt).toLocaleDateString("en-IN", {
                      timeZone: "Asia/Kolkata",
                    })
                  : "Not recorded"}
              </dd>
              <dt>Last status review</dt>
              <dd>
                {operator.approvedAt
                  ? new Date(operator.approvedAt).toLocaleString("en-IN", {
                      timeZone: "Asia/Kolkata",
                    })
                  : "Awaiting review"}
              </dd>
            </dl>
            <div className="platform-metrics">
              <div>
                <strong>{operator.counts.buses}</strong>
                <span>Buses</span>
              </div>
              <div>
                <strong>{operator.counts.routes}</strong>
                <span>Routes</span>
              </div>
              <div>
                <strong>{operator.counts.scheduledTrips}</strong>
                <span>Scheduled trips</span>
              </div>
            </div>
            <button className="btn primary" onClick={() => onReview(operator)}>
              Change operator status
            </button>
          </>
        )}
      </div>
    </Overlay>
  );
}
export function PlatformScreen({ user }: { user: Identity }) {
  const [page, setPage] = useState<"overview" | "operators" | "records-api" | "records-operator">("overview");
  const [rows, setRows] = useState<Raw[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [summaryError, setSummaryError] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [revision, setRevision] = useState(0);
  const [detail, setDetail] = useState<string | null>(null);
  const [review, setReview] = useState<Raw | null>(null);
  const [nextStatus, setNextStatus] = useState("approved");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setSummaryError("");
    api<Overview>("/platform/overview", { signal: controller.signal })
      .then((r) => {
        if (!controller.signal.aborted) setOverview(r.data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setSummaryError(e.message);
      });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setRows([]);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        page: String(currentPage),
        limit: "10",
        search,
        ...(status ? { status } : {}),
      });
      api<Raw[]>(`/platform/operators?${params}`, { signal: controller.signal })
        .then((r) => {
          if (controller.signal.aborted) return;
          setRows(r.data);
          setTotal(r.meta?.total || 0);
          setPages(r.meta?.pages || 1);
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [currentPage, search, status, revision]);
  function openReview(operator: Raw) {
    setDetail(null);
    setReview(operator);
    setSaveError("");
    setNextStatus(operator.status === "approved" ? "suspended" : "approved");
  }
  function showOperators(filter = "") {
    setPage("operators");
    setStatus(filter);
    setSearch("");
    setCurrentPage(1);
  }
  const pageTitle = page === "overview" ? "Overview" : page === "operators" ? "Bus Operators" : "Records";
  const recordsPage = page === "records-api" || page === "records-operator";
  return (
    <div className="platform-admin workspace-crs">
      <aside className="platform-sidebar">
        <div className="platform-brand">
          <BusFront />
          <strong>
            ai<span>bus</span>
          </strong>
        </div>
        <span className="platform-nav-label">ADMIN PANEL</span>
        <nav aria-label="Admin navigation">
          <button
            className={page === "overview" ? "active" : ""}
            aria-current={page === "overview" ? "page" : undefined}
            onClick={() => setPage("overview")}
          >
            <LayoutDashboard size={19} />
            Overview
          </button>
          <button
            className={page === "operators" ? "active" : ""}
            aria-current={page === "operators" ? "page" : undefined}
            onClick={() => showOperators()}
          >
            <Building2 size={19} />
            Bus Operators
          </button>
          <div className="platform-nav-section">BOOKING RECORDS</div>
          <button className={page === "records-api" ? "active" : ""} aria-current={page === "records-api" ? "page" : undefined} onClick={() => setPage("records-api")}>
            <ListChecks size={19} />
            Bookings through API
          </button>
          <button className={page === "records-operator" ? "active" : ""} aria-current={page === "records-operator" ? "page" : undefined} onClick={() => setPage("records-operator")}>
            <Building2 size={19} />
            Bookings through operators
          </button>
        </nav>
        <div className="platform-sidebar-footer">
          <ShieldCheck size={18} />
          Platform administration
        </div>
      </aside>
      <div className="platform-main">
        <header className="platform-topbar">
          <span>
            Admin <ChevronRight size={15} />{" "}
            {pageTitle}
          </span>
          <div>
            <span>{user.name}</span>
            <button className="btn" onClick={() => void logout()}>
              <LogOut size={15} />
              Sign out
            </button>
          </div>
        </header>
        <main className="platform-content">
          <div className="page-heading">
            <div>
              <h1>
                {page === "overview" ? "Admin overview" : page === "operators" ? "Bus Operators" : page === "records-api" ? "Bookings through API" : "Bookings through operators"}
              </h1>
              <p>
                {page === "overview"
                  ? "Operator registrations and fleet activity across Aibus."
                  : page === "operators"
                    ? "Review companies, contact details and account access."
                    : page === "records-api"
                      ? "Review bookings submitted through API and customer channels."
                      : "Review operator, agent, and branch booking activity."}
              </p>
            </div>
            <button
              className="btn"
              disabled={loading}
              onClick={() => setRevision((r) => r + 1)}
            >
              <RefreshCw size={15} />
              Refresh
            </button>
          </div>
          {notice && (
            <div className="platform-notice" role="status">
              {notice}
            </div>
          )}
          {summaryError && (
            <div className="platform-notice error" role="alert">
              {summaryError}
              <button
                className="text-btn"
                onClick={() => setRevision((r) => r + 1)}
              >
                Retry overview
              </button>
            </div>
          )}
          {page !== "records-api" && page !== "records-operator" && <div className="platform-summary">
            {statuses.map((s) => (
              <button
                key={s}
                onClick={() => showOperators(s)}
                aria-label={`View ${s} operators`}
              >
                <span>
                  {s === "pending"
                    ? "Awaiting approval"
                    : `${statusLabel(s)} operators`}
                </span>
                <strong>{overview ? overview.operators[s] || 0 : "—"}</strong>
                <small>
                  View operators <ChevronRight size={13} />
                </small>
              </button>
            ))}
          </div>}
          {page === "overview" ? (
            <>
              <Panel title="Platform activity">
                <div className="platform-metrics">
                  <div>
                    <strong>{overview?.totalOperators ?? "—"}</strong>
                    <span>Total operators</span>
                  </div>
                  <div>
                    <strong>{overview?.buses ?? "—"}</strong>
                    <span>Total buses</span>
                  </div>
                  <div>
                    <strong>{overview?.routes ?? "—"}</strong>
                    <span>Total routes</span>
                  </div>
                  <div>
                    <strong>{overview?.scheduledTrips ?? "—"}</strong>
                    <span>Scheduled trips</span>
                  </div>
                </div>
              </Panel>
              <Panel
                title="Operator registrations"
                aside={
                  <button className="text-btn" onClick={() => showOperators()}>
                    View all operators <ChevronRight size={15} />
                  </button>
                }
              >
                <div className="platform-review-intro">
                  <Building2 size={30} />
                  <div>
                    <h3>
                      {overview
                        ? `${overview.operators.pending || 0} companies awaiting approval`
                        : "Loading registrations..."}
                    </h3>
                    <p>
                      Review company details before approving access to the
                      operator workspace.
                    </p>
                  </div>
                  <button
                    className="btn primary"
                    onClick={() => showOperators("pending")}
                  >
                    Review registrations
                  </button>
                </div>
              </Panel>
            </>
          ) : recordsPage ? (
            <Panel className="records-panel">
              <RecordsScreen channel={page === "records-api" ? "api" : "operator"} />
            </Panel>
          ) : (
            <Panel title="Operator directory">
              <div className="platform-filters">
                <label className="platform-search">
                  <Search size={17} />
                  <input
                    aria-label="Search operators"
                    placeholder="Search company or email"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setCurrentPage(1);
                    }}
                  />
                </label>
                <select
                  aria-label="Operator status filter"
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    setCurrentPage(1);
                  }}
                >
                  <option value="">All statuses</option>
                  {statuses.map((s) => (
                    <option key={s} value={s}>
                      {statusLabel(s)}
                    </option>
                  ))}
                </select>
              </div>
              {error ? (
                <div className="empty" role="alert">
                  <p className="error">{error}</p>
                  <button
                    className="btn"
                    onClick={() => setRevision((r) => r + 1)}
                  >
                    Retry operators
                  </button>
                </div>
              ) : loading ? (
                <div className="empty" role="status">
                  Loading operators...
                </div>
              ) : rows.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Company</th>
                        <th>Contact</th>
                        <th>Registered</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r._id}>
                          <td>
                            <strong>{r.company}</strong>
                          </td>
                          <td>
                            <span>{r.email}</span>
                            <small className="platform-phone">
                              {r.phone || "Phone not provided"}
                            </small>
                          </td>
                          <td>
                            {new Date(r.createdAt).toLocaleDateString("en-IN", {
                              timeZone: "Asia/Kolkata",
                            })}
                          </td>
                          <td>
                            <OperatorStatusBadge status={r.status} />
                          </td>
                          <td>
                            <div className="platform-row-actions">
                              <button
                                className="text-btn"
                                onClick={() => setDetail(r._id)}
                              >
                                View details
                              </button>
                              <button
                                className="btn"
                                onClick={() => openReview(r)}
                              >
                                Change status
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty">
                  <h3>No matching operators</h3>
                  <p>
                    {search || status
                      ? "Try another company name or status."
                      : "Operator registrations will appear here."}
                  </p>
                  {(search || status) && (
                    <button className="btn" onClick={() => showOperators()}>
                      Clear filters
                    </button>
                  )}
                </div>
              )}
              <div className="platform-pagination">
                <span>{loading ? "Loading..." : `${total} operators`}</span>
                <div>
                  <button
                    className="icon-btn"
                    aria-label="Previous operators page"
                    disabled={currentPage <= 1 || loading}
                    onClick={() => setCurrentPage((p) => p - 1)}
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <span>
                    {currentPage} / {pages}
                  </span>
                  <button
                    className="icon-btn"
                    aria-label="Next operators page"
                    disabled={currentPage >= pages || loading}
                    onClick={() => setCurrentPage((p) => p + 1)}
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>
            </Panel>
          )}
        </main>
      </div>
      {detail && (
        <OperatorDetails
          id={detail}
          onClose={() => setDetail(null)}
          onReview={openReview}
        />
      )}
      {review && (
        <Overlay
          title="Change operator status"
          onClose={() => {
            if (!saving) setReview(null);
          }}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (saving) return;
              setSaving(true);
              setSaveError("");
              try {
                await api(`/platform/operators/${review._id}/status`, {
                  method: "PATCH",
                  body: JSON.stringify({ status: nextStatus }),
                });
                setNotice(`${review.company} is now ${nextStatus}.`);
                setReview(null);
                setRevision((r) => r + 1);
              } catch (e) {
                setSaveError((e as Error).message);
              } finally {
                setSaving(false);
              }
            }}
          >
            <div className="form-grid">
              <p className="platform-full-width">
                <strong>{review.company}</strong>
                <br />
                Current status <OperatorStatusBadge status={review.status} />
              </p>
              <label className="platform-full-width">
                New status
                <select
                  value={nextStatus}
                  onChange={(e) => setNextStatus(e.target.value)}
                >
                  {statuses
                    .filter((s) => s !== "pending" && s !== review.status)
                    .map((s) => (
                      <option value={s} key={s}>
                        {statusLabel(s)}
                      </option>
                    ))}
                </select>
              </label>
              <p className="muted platform-full-width">
                Approving enables operator access. Suspending or rejecting
                prevents access to the operator workspace.
              </p>
              {saveError && (
                <p role="alert" className="error platform-full-width">
                  {saveError}
                </p>
              )}
            </div>
            <div className="dialog-foot">
              <button
                type="button"
                className="btn"
                disabled={saving}
                onClick={() => setReview(null)}
              >
                Cancel
              </button>
              <button className="btn primary" disabled={saving}>
                {saving ? "Saving..." : "Confirm status change"}
              </button>
            </div>
          </form>
        </Overlay>
      )}
    </div>
  );
}
