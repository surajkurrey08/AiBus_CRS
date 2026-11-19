import { useEffect, useState } from "react";
import { api, type Identity } from "../../api/client";
import { Panel } from "../../components/ui/Panel";
import { FinanceReviewForm, type ReviewField } from "./FinanceReviewForm";
const reason: ReviewField = { name: "reason", label: "Review reason" };
const money = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(
    n / 100,
  );
export function AdminSettlements({ user }: { user: Identity }) {
  const [operators, setOperators] = useState<any[]>([]),
    [operatorSearch, setOperatorSearch] = useState(""),
    [operatorId, setOperator] = useState(""),
    [agencies, setAgencies] = useState<any[]>([]),
    [policy, setPolicy] = useState<any>(null),
    [runtime, setRuntime] = useState(false);
  const [rows, setRows] = useState<any[]>([]),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [revision, setRevision] = useState(0),
    [detail, setDetail] = useState<any>(null),
    [selection, setSelection] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const [dialog, setDialog] = useState<{
    title: string;
    description: string;
    fields: ReviewField[];
    save: (v: Record<string, string>, key: string) => Promise<void>;
  } | null>(null);
  const prepare = user.permissions.includes("settlements:prepare"),
    approve = user.permissions.includes("settlements:approve"),
    payout = user.permissions.includes("payouts:authorize");
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
      clearTimeout(timer);
      abort.abort();
    };
  }, [operatorSearch]);
  useEffect(() => {
    const abort = new AbortController();
    setError("");
    setLoading(true);
    setDetail(null);
    setPolicy(null);
    setAgencies([]);
    void (async () => {
      const r = await api(
        `/platform/finance/settlements?limit=25&page=${page}${operatorId ? `&operatorId=${operatorId}` : ""}`,
        { signal: abort.signal },
      );
      if (abort.signal.aborted) return;
      setRows(r.data);
      setTotal(r.meta?.total || 0);
      const mode = await api("/platform/finance/reports", {
        signal: abort.signal,
      });
      if (!abort.signal.aborted) setRuntime(mode.data.testModeAvailable);
      if (operatorId) {
        const [p, a] = await Promise.all([
          api(`/platform/finance/settlement-policy/${operatorId}`, {
            signal: abort.signal,
          }),
          api(`/platform/finance/agencies?operatorId=${operatorId}`, {
            signal: abort.signal,
          }),
        ]);
        if (!abort.signal.aborted) {
          setPolicy(p.data);
          setAgencies(a.data);
        }
      }
      if (selection) {
        const d = await api(`/platform/finance/settlements/${selection}`, {
          signal: abort.signal,
        });
        if (!abort.signal.aborted) setDetail(d.data);
      }
    })()
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [operatorId, page, revision, selection]);
  async function mutate(
    path: string,
    body: unknown,
    key: string,
    method = "POST",
  ) {
    await api(`/platform/finance${path}`, {
      method,
      body: JSON.stringify(body),
      headers: { "Idempotency-Key": key },
    });
    setRevision((v) => v + 1);
  }
  function action(title: string, path: string, extra: object = {}) {
    setDialog({
      title,
      description:
        "Record an authorized financial review using existing immutable payable evidence. Live payouts are unavailable. A test payout is complete only after independent simulator status verification.",
      fields: [reason],
      save: (v, key) => mutate(path, { ...extra, reason: v.reason }, key),
    });
  }
  return (
    <div className="admin-finance">
      <Panel title="Operator and agency settlements">
        <div className="panel-body">
          <p>
            Only mature, posted gateway-funded obligations without unresolved
            cancellation or refund cases are eligible. Wallet and credit custody
            require separate settlement policy. All payouts are simulated.
          </p>
          <label>
            Find operator
            <input
              value={operatorSearch}
              onChange={(e) => setOperatorSearch(e.target.value)}
              placeholder="Search company"
            />
          </label>
          <label>
            Operator scope
            <select
              value={operatorId}
              onChange={(e) => {
                setOperator(e.target.value);
                setPage(1);
                setSelection("");
              }}
            >
              <option value="">All authorized operators</option>
              {operators.map((o) => (
                <option value={o._id} key={o._id}>
                  {o.company}
                </option>
              ))}
            </select>
          </label>
          {operatorId && (
            <p>
              Settlement policy:{" "}
              {policy?.enabled
                ? "Enabled for isolated test"
                : "Disabled or unconfigured"}
            </p>
          )}
          {!runtime && (
            <p role="status">
              Test payout execution is disabled on this server.
            </p>
          )}
          {runtime && prepare && operatorId && policy && (
            <>
              <button
                className="btn"
                onClick={() =>
                  setDialog({
                    title: "Configure test settlement policy",
                    description:
                      "Confirm custody explicitly. Existing capture liabilities include operator taxes and charges. No new platform or gateway fees are calculated. This enables only a labelled isolated simulator, never bank settlement.",
                    fields: [
                      {
                        name: "enabled",
                        label: "Test settlement execution",
                        options: ["Disabled", "Enabled"].map((value) => ({
                          value,
                          label: value,
                        })),
                      },
                      {
                        name: "treatment",
                        label: "Accounting treatment",
                        options: [
                          "Unconfigured",
                          "Existing capture liabilities",
                        ].map((value) => ({ value, label: value })),
                      },
                      {
                        name: "funding",
                        label: "Receipt evidence",
                        options: [
                          "Unconfigured",
                          "Simulated gateway receipts",
                        ].map((value) => ({ value, label: value })),
                      },
                      reason,
                    ],
                    save: (v, key) =>
                      mutate(
                        `/settlement-policy/${operatorId}`,
                        {
                          enabled: v.enabled === "Enabled",
                          treatment: v.treatment,
                          funding: v.funding,
                          version: policy.version,
                          reason: v.reason,
                        },
                        key,
                        "PUT",
                      ),
                  })
                }
              >
                Configure test policy
              </button>
              <button
                className="btn primary"
                onClick={() =>
                  setDialog({
                    title: "Prepare settlement",
                    description:
                      "Claim unallocated payable lines once. Select Agency to settle only that agency's commission; select Operator for operator liabilities. Captures are not bank receipts.",
                    fields: [
                      {
                        name: "kind",
                        label: "Beneficiary",
                        options: ["Operator", "Agency"].map((value) => ({
                          value,
                          label: value,
                        })),
                      },
                      {
                        name: "agency",
                        label: "Agency selection",
                        options: [
                          {
                            value: "none",
                            label: "Operator settlement (no agency)",
                          },
                          ...agencies.map((a) => ({
                            value: a._id,
                            label: a.name,
                          })),
                        ],
                      },
                      { name: "from", label: "From · IST", type: "date" },
                      { name: "to", label: "To · IST", type: "date" },
                      reason,
                    ],
                    save: (v, key) => {
                      if ((v.kind === "Agency") !== (v.agency !== "none"))
                        throw Error(
                          "Choose one agency for Agency, or no agency for Operator.",
                        );
                      if (v.from > v.to) throw Error("Choose a valid period.");
                      return mutate(
                        "/settlements",
                        {
                          operatorId,
                          kind: v.kind,
                          ...(v.agency !== "none" ? { agentId: v.agency } : {}),
                          from: v.from,
                          to: v.to,
                          reason: v.reason,
                        },
                        key,
                      );
                    },
                  })
                }
              >
                Prepare settlement
              </button>
            </>
          )}
          {error && (
            <div role="alert">
              {error}
              <button className="btn" onClick={() => setRevision((v) => v + 1)}>
                Retry settlements
              </button>
            </div>
          )}
          {loading && <p role="status">Loading settlement evidence…</p>}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Beneficiary</th>
                  <th>Payable · INR</th>
                  <th>State</th>
                  <th>Mode</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r._id}>
                    <td>{r.externalId}</td>
                    <td>
                      {r.kind} {r.agentId}
                    </td>
                    <td>{money(r.netPaise)}</td>
                    <td>{r.workflowStatus}</td>
                    <td>TEST</td>
                    <td>
                      <button
                        className="btn"
                        onClick={() => setSelection(r._id)}
                      >
                        Review settlement
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && !rows.length && <p>No matching settlement batches.</p>}
          </div>
          <p>
            {total} records · Page {page}
          </p>
          <button
            className="btn"
            disabled={loading || page === 1}
            onClick={() => setPage((v) => v - 1)}
          >
            Previous
          </button>
          <button
            className="btn"
            disabled={loading || page * 25 >= total}
            onClick={() => setPage((v) => v + 1)}
          >
            Next
          </button>
        </div>
      </Panel>
      {detail && (
        <Panel title="Payable and approval evidence">
          <div className="panel-body">
            <h4>
              {detail.settlement.externalId} ·{" "}
              {detail.settlement.workflowStatus} · TEST
            </h4>
            <p>
              {money(detail.settlement.netPaise)} ·{" "}
              {detail.settlement.periodFrom} to {detail.settlement.periodTo}
            </p>
            <p>
              Preparer: {detail.settlement.preparedBy} · Approver:{" "}
              {detail.settlement.approvedBy || "Not approved"}
            </p>
            <p>
              Payout: {detail.payout?.status || "Not authorized"} ·{" "}
              {detail.payout?.externalId || "No verified reference"}
            </p>
            {detail.lines.map((l: any) => (
              <p key={l._id}>
                {l.kind} · {money(l.amountPaise)} · Booking {l.bookingId} ·
                Journal {l.journalId}
              </p>
            ))}
            {detail.approvals.map((a: any) => (
              <p key={a._id}>
                {a.action} · {a.reason}
              </p>
            ))}
            {detail.attempts.map((a: any) => (
              <p key={a._id}>
                Attempt: {a.outcome} · {a.reference || a.code}
              </p>
            ))}
            {runtime && (
              <div className="platform-row-actions">
                {prepare &&
                  detail.settlement.workflowStatus === "Calculated" && (
                    <button
                      className="btn"
                      onClick={() =>
                        action(
                          "Submit for independent review",
                          `/settlements/${selection}/review`,
                          { action: "Submit" },
                        )
                      }
                    >
                      Submit review
                    </button>
                  )}
                {approve &&
                  detail.settlement.workflowStatus === "Under review" &&
                  String(detail.settlement.preparedBy) !== user.id && (
                    <button
                      className="btn"
                      onClick={() =>
                        action(
                          "Approve payable evidence",
                          `/settlements/${selection}/review`,
                          { action: "Approve" },
                        )
                      }
                    >
                      Approve settlement
                    </button>
                  )}
                {payout && String(detail.settlement.preparedBy) !== user.id && (
                  <>
                    <button
                      className="btn"
                      onClick={() =>
                        action(
                          "Record isolated simulated receipts",
                          `/settlements/${selection}/test-receipts`,
                        )
                      }
                    >
                      Simulate receipt evidence
                    </button>
                    <button
                      className="btn"
                      onClick={() =>
                        action(
                          "Authorize isolated test payout",
                          `/settlements/${selection}/authorize-payout`,
                        )
                      }
                    >
                      Authorize test payout
                    </button>
                    {detail.payout && detail.payout.status !== "Paid" && (
                      <button
                        className="btn"
                        onClick={() =>
                          action(
                            "Process or reconcile original test payout",
                            `/settlements/${selection}/process-payout`,
                          )
                        }
                      >
                        Verify test payout
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
            {approve && (
              <button
                className="btn"
                onClick={() =>
                  action(
                    "Check settlement reconciliation",
                    `/settlements/${selection}/reconcile`,
                  )
                }
              >
                Reconcile posted evidence
              </button>
            )}
            <button className="btn" onClick={() => setSelection("")}>
              Close settlement
            </button>
          </div>
        </Panel>
      )}
      {dialog && (
        <FinanceReviewForm
          title={dialog.title}
          description={dialog.description}
          fields={dialog.fields}
          onSave={dialog.save}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
