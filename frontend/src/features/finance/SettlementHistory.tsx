import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { DataTable, Panel } from "../../components/index";
import "./finance.css";
const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(
    n / 100,
  );
export function SettlementHistory() {
  const [detail, setDetail] = useState<any>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<any>(null);
  useEffect(() => {
    if (!selected) return;
    const abort = new AbortController();
    setLoading(true);
    setError("");
    setDetail(null);
    void api(`/operator/finance/settlements/${selected.id}`, {
      signal: abort.signal,
    })
      .then((r) => {
        if (!abort.signal.aborted) setDetail(r.data);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [selected, revision]);
  const view = (row: any) => setSelected(row);
  return (
    <div className="finance-workspace">
      <Panel
        title="Settlement history"
        aside={
          <button className="btn" onClick={() => setRevision((v) => v + 1)}>
            Refresh settlements
          </button>
        }
      >
        <div className="panel-body">
          <p>
            Settlements use claimed payable journal lines, independent approval
            and verified payout evidence. Current execution is an isolated
            simulator; Paid (Test) does not mean a bank transfer.
          </p>
          {loading && <p role="status">Loading settlement evidence…</p>}
          {error && (
            <div role="alert">
              {error}
              <button className="btn" onClick={() => setRevision((v) => v + 1)}>
                Retry settlement details
              </button>
            </div>
          )}
        </div>
      </Panel>
      <DataTable
        rows={[]}
        resourcePath="finance/settlements"
        refreshKey={revision}
        title="settlements"
        columns={[
          ["externalId", "Reference"],
          ["kind", "Beneficiary"],
          ["netDisplay", "Payable · INR"],
          ["workflowStatus", "Approval state"],
          ["mode", "Evidence mode"],
        ]}
        unsortableColumns={[
          "externalId",
          "kind",
          "netDisplay",
          "workflowStatus",
          "mode",
        ]}
        onView={view}
      />
      {detail && (
        <Panel
          title="Settlement statement"
          aside={
            <button
              className="btn"
              onClick={() => {
                setDetail(null);
                setSelected(null);
              }}
            >
              Close statement
            </button>
          }
        >
          <div className="panel-body">
            <h4>
              {detail.settlement.externalId} ·{" "}
              {detail.settlement.workflowStatus} · TEST
            </h4>
            <p>
              {inr(detail.settlement.netPaise)} · {detail.settlement.periodFrom}{" "}
              to {detail.settlement.periodTo}
            </p>
            <p>
              Verified simulated payout reference:{" "}
              {detail.payout?.externalId || "Not processed"}
            </p>
            <h4>Payable evidence</h4>
            {detail.lines.map((line: any) => (
              <p key={line._id}>
                {line.kind} · Booking {line.bookingId} · {inr(line.amountPaise)}{" "}
                · Journal {line.journalId}
              </p>
            ))}
            <h4>Approval history</h4>
            {detail.approvals.map((a: any) => (
              <p key={a._id}>
                {a.action} · {a.reason} ·{" "}
                {new Date(a.createdAt).toLocaleString("en-IN", {
                  timeZone: "Asia/Kolkata",
                })}{" "}
                IST
              </p>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
