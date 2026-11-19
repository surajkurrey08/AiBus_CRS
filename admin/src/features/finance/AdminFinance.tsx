import { FinanceReviewForm } from "./FinanceReviewForm";
import { useEffect, useRef, useState } from "react";
import { api, type Identity } from "../../api/client";
import { Panel } from "../../components/ui/Panel";

const queues = ["exceptions", "refund-intents", "cancellations"] as const;
const money = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(
    n / 100,
  );
export function AdminFinance({ user }: { user: Identity }) {
  const [queue, setQueue] = useState<string>("exceptions"),
    [rows, setRows] = useState<any[]>([]),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0);
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState(""),
    [revision, setRevision] = useState(0),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<any>(null),
    [reason, setReason] = useState(""),
    [review, setReview] = useState(false),
    [busy, setBusy] = useState(false);
  const detailRequest = useRef<AbortController | null>(null);
  const [execution, setExecution] = useState(false),
    [operation, setOperation] = useState<{
      title: string;
      path: string;
      body: object;
    } | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    if (
      user.permissions.includes("platform:finance:read") &&
      user.permissions.includes("refunds:review")
    )
      void api("/platform/finance/reports", { signal: abort.signal })
        .then((r) => {
          if (!abort.signal.aborted)
            setExecution(r.data.testModeAvailable === true);
        })
        .catch(() => {});
    return () => {
      abort.abort();
      detailRequest.current?.abort();
    };
  }, []);
  const allowed = user.permissions.includes("platform:finance:read"),
    canReview = user.permissions.includes("refunds:review");
  useEffect(() => {
    if (!allowed) return;
    const abort = new AbortController();
    detailRequest.current?.abort();
    setLoading(true);
    setError("");
    setRows([]);
    setDetail(null);
    setReview(false);
    void api(
      `/platform/finance/${queue}?page=${page}&limit=25&search=${encodeURIComponent(filter)}`,
      { signal: abort.signal },
    )
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
  }, [queue, page, filter, revision, allowed]);
  if (!allowed)
    return <p role="alert">Explicit platform finance access is required.</p>;
  async function select(row: any) {
    detailRequest.current?.abort();
    const abort = new AbortController();
    detailRequest.current = abort;
    setError("");
    setReview(false);
    setDetail(null);
    try {
      const response = await api(`/platform/finance/${queue}/${row._id}`, {
        signal: abort.signal,
      });
      if (!abort.signal.aborted) setDetail({ row, ...response.data });
    } catch (e) {
      if (!abort.signal.aborted) setError((e as Error).message);
    }
  }
  async function acknowledge() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/platform/finance/exceptions/${detail.row._id}/review`, {
        method: "POST",
        body: JSON.stringify({ action: "Acknowledge", reason }),
      });
      setRevision((v) => v + 1);
      setReason("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="admin-finance">
      <Panel title="Refunds and payment reconciliation">
        <div className="panel-body">
          <p>
            Captured payments are not bank settlement. Cancellation approval is
            separate from verified refund completion. Live refunds are disabled.
          </p>
          <nav aria-label="Financial queues">
            {queues.map((q) => (
              <button
                className={`btn ${queue === q ? "primary" : ""}`}
                key={q}
                onClick={() => {
                  setQueue(q);
                  setPage(1);
                }}
              >
                {q.replaceAll("-", " ")}
              </button>
            ))}
          </nav>
        </div>
      </Panel>
      <Panel title="Financial records">
        <div className="panel-body">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setFilter(search);
              setPage(1);
            }}
          >
            <label>
              Search review records{" "}
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <button className="btn">Search</button>
            <button
              type="button"
              className="btn"
              onClick={() => setRevision((v) => v + 1)}
            >
              Refresh
            </button>
          </form>
          {error && (
            <div role="alert">
              {error}
              <button className="btn" onClick={() => setRevision((v) => v + 1)}>
                Retry
              </button>
            </div>
          )}
          {loading ? (
            <p role="status">Loading financial records…</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Operator</th>
                    <th>Record</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row._id}>
                      <td>{row.operatorId}</td>
                      <td>{row.kind || row.purpose || row.reason}</td>
                      <td>
                        {row.amountPaise === undefined
                          ? "—"
                          : money(row.amountPaise)}
                      </td>
                      <td>{row.status}</td>
                      <td>
                        {queue !== "cancellations" && (
                          <button
                            className="btn"
                            onClick={() => void select(row)}
                          >
                            View details
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!rows.length && <p>No matching financial records.</p>}
            </div>
          )}
          <p>
            {total} matching records · Page {page}
          </p>
          <button
            className="btn"
            disabled={page === 1 || loading}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </button>
          <button
            className="btn"
            disabled={page * 25 >= total || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      </Panel>
      {detail && (
        <Panel title="Financial evidence">
          <div className="panel-body">
            <p>
              {detail.row.kind || detail.row.purpose} · {detail.row.status}
            </p>
            <p>Booking: {detail.row.bookingId}</p>
            <p>
              Refund reference:{" "}
              {detail.intent?.externalRefundId || "Not recorded"}
            </p>
            <p>
              Journal:{" "}
              {detail.intent?.journalId || "No verified refund posting"}
            </p>
            {detail.attempts?.map((a: any) => (
              <p key={a._id}>
                {a.action} · {a.outcome} ·{" "}
                {new Date(a.createdAt).toLocaleString("en-IN")}
              </p>
            ))}
            {canReview &&
              execution &&
              queue === "refund-intents" &&
              detail.intent?.status !== "Processed" && (
                <>
                  <button
                    className="btn"
                    onClick={() =>
                      setOperation({
                        title: "Verify approved test refund",
                        path: "/refund-intents/" + detail.row._id + "/process",
                        body: {},
                      })
                    }
                  >
                    Process or verify approved test refund
                  </button>
                  <button
                    className="btn"
                    onClick={() =>
                      setOperation({
                        title: "Authorize bounded original refund recheck",
                        path: "/refund-intents/" + detail.row._id + "/recheck",
                        body: {},
                      })
                    }
                  >
                    Authorize refund recheck
                  </button>
                </>
              )}
            {canReview &&
              execution &&
              queue === "exceptions" &&
              ["Duplicate capture", "Late capture"].includes(
                detail.exception?.kind,
              ) && (
                <button
                  className="btn"
                  onClick={() =>
                    setOperation({
                      title: "Approve matched exception refund",
                      path: "/exceptions/" + detail.row._id + "/review",
                      body: { action: "Approve test refund" },
                    })
                  }
                >
                  Approve matched exception test refund
                </button>
              )}
            {canReview && queue === "exceptions" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (reason.trim().length < 5) {
                    setError(
                      "Enter a review reason of at least five characters.",
                    );
                    return;
                  }
                  if (!review) setReview(true);
                  else void acknowledge();
                }}
              >
                <label>
                  Review reason{" "}
                  <input
                    required
                    minLength={5}
                    maxLength={240}
                    value={reason}
                    onChange={(e) => {
                      setReason(e.target.value);
                      setReview(false);
                    }}
                  />
                </label>
                {review && (
                  <p>
                    Confirm acknowledgement of this exception. This does not
                    move money or resolve a discrepancy.
                  </p>
                )}
                <button className="btn" disabled={busy}>
                  {busy
                    ? "Recording…"
                    : review
                      ? "Confirm acknowledgement"
                      : "Review acknowledgement"}
                </button>
              </form>
            )}
            <button className="btn" onClick={() => setDetail(null)}>
              Close details
            </button>
          </div>
        </Panel>
      )}
      {operation && (
        <FinanceReviewForm
          title={operation.title}
          description="Only the original matched captured test payment can be refunded. Review does not mark the refund completed; provider verification and journal posting are required."
          fields={[{ name: "reason", label: "Review reason" }]}
          onClose={() => setOperation(null)}
          onSave={async (v, key) => {
            await api("/platform/finance" + operation.path, {
              method: "POST",
              body: JSON.stringify({
                ...operation.body,
                ...(operation.path.endsWith("/process")
                  ? {}
                  : { reason: v.reason }),
              }),
              headers: { "Idempotency-Key": key },
            });
            setRevision((r) => r + 1);
          }}
        />
      )}
    </div>
  );
}
