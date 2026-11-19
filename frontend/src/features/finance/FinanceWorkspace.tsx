import { useEffect, useState } from "react";
import { api, downloadFinanceStatement } from "../../api/client";
import "./finance.css";
import { Panel, DataTable } from "../../components/index";
import { useWorkspace } from "../../context/WorkspaceContext";
import {
  FinanceActionForm,
  inputPaise,
  type FinanceField,
} from "./FinanceActionForm";
const inr = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(
    v / 100,
  );
const reason: FinanceField = { name: "reason", label: "Reason" };
export function FinanceWorkspace() {
  const ws = useWorkspace(),
    manage = ws.user.permissions.includes("finance:manage");
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(
      null,
    ),
    [policy, setPolicy] = useState<any>(null),
    [detail, setDetail] = useState<any>(null);
  const [funding, setFunding] = useState<any[]>([]),
    [history, setHistory] = useState<any[]>([]),
    [credit, setCredit] = useState<any[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  const [dialog, setDialog] = useState<{
    title: string;
    description: string;
    fields: FinanceField[];
    save: (v: Record<string, string>, key: string) => Promise<void>;
  } | null>(null);
  const [overview, setOverview] = useState<any>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setOverview(null);
    setPolicy(null);
    setError("");
    setDetail(null);
    setFunding([]);
    setHistory([]);
    setCredit([]);
    const load = async () => {
      const p = await api("/operator/finance/policy", {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setPolicy(p.data);
      const summary = await api("/operator/finance/wallet-summary", {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setOverview(summary.data);
      if (selected) {
        const base = `/operator/finance/wallets/${selected.id}`;
        const values = await Promise.all([
          api(base, { signal: controller.signal }),
          api(`${base}/funding?limit=100`, { signal: controller.signal }),
          api(`${base}/transactions?limit=100`, { signal: controller.signal }),
          api(`${base}/credit/history?limit=100`, {
            signal: controller.signal,
          }),
        ]);
        if (!controller.signal.aborted) {
          setDetail(values[0].data);
          setFunding(values[1].data);
          setHistory(values[2].data);
          setCredit(values[3].data);
        }
      }
    };
    void load()
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [selected?.id, revision]);
  const mutation = async (
    path: string,
    method: string,
    body: unknown,
    key: string,
  ) => {
    await api(`/operator/finance${path}`, {
      method,
      body: JSON.stringify(body),
      headers: { "Idempotency-Key": key },
    });
    setRevision((v) => v + 1);
    ws.notify("Finance action recorded.");
  };
  const open = (
    title: string,
    fields: FinanceField[],
    save: (v: Record<string, string>, key: string) => Promise<void>,
    description = `${title} for ${selected?.name || "this operator"}. Review the details before confirming.`,
  ) => setDialog({ title, description, fields, save });
  const base = selected ? `/wallets/${selected.id}` : "";
  return (
    <div className="finance-workspace">
      <Panel
        title="Agent wallet & credit"
        aside={
          manage &&
          policy && (
            <button
              className="btn"
              onClick={() =>
                open(
                  "Configure finance policy",
                  [
                    {
                      name: "custody",
                      label: "Test custody owner",
                      options: ["Unconfigured", "Operator"],
                      value: policy.custodyOwner,
                    },
                    ...["wallet", "credit", "test"].map((name) => ({
                      name,
                      label: `${name === "test" ? "Isolated test operations" : `${name} funding`}`,
                      options: ["Disabled", "Enabled"],
                      value: policy[
                        name === "test"
                          ? "testOperationsEnabled"
                          : `${name}Enabled`
                      ]
                        ? "Enabled"
                        : "Disabled",
                    })),
                    reason,
                  ],
                  (v, key) =>
                    mutation(
                      "/policy",
                      "PUT",
                      {
                        custodyOwner: v.custody,
                        walletEnabled: v.wallet === "Enabled",
                        creditEnabled: v.credit === "Enabled",
                        testOperationsEnabled: v.test === "Enabled",
                        version: policy.version,
                        reason: v.reason,
                      },
                      key,
                    ),
                )
              }
            >
              Configure policy
            </button>
          )
        }
      >
        <div className="panel-body">
          <p>
            Prepaid funds, reserved balances and operator-approved credit are
            separate. Commission is not transferred into spendable funds.
          </p>
          <p role="status">
            {policy?.testModeAvailable
              ? "Isolated test funding available after policy approval. No live funding."
              : "Live funding is disabled. Test funding is not enabled on this server."}
          </p>
          {loading && <p role="status">Loading finance records…</p>}
          {error && (
            <div role="alert">
              <p>{error}</p>
              <button className="btn" onClick={() => setRevision((v) => v + 1)}>
                Retry finance records
              </button>
            </div>
          )}
        </div>
      </Panel>
      {overview && (
        <Panel title="Agency funding exposure">
          <div className="panel-body">
            <dl className="form-grid">
              {[
                [
                  "Prepaid liability (test funds)",
                  overview.prepaidLiabilityPaise,
                ],
                ["Reserved prepaid funds", overview.reservedPrepaidPaise],
                ["Outstanding credit exposure", overview.creditExposurePaise],
                ["Reserved credit", overview.reservedCreditPaise],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{inr(Number(value))}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Panel>
      )}
      <DataTable
        rows={[]}
        columns={[
          ["name", "Agency"],
          ["posted", "Prepaid balance"],
          ["reserved", "Reserved"],
          ["available", "Available"],
          ["creditLimit", "Credit limit"],
          ["outstanding", "Credit used"],
          ["status", "Wallet status"],
        ]}
        unsortableColumns={[
          "name",
          "posted",
          "reserved",
          "available",
          "creditLimit",
          "outstanding",
          "status",
        ]}
        resourcePath="finance/wallets"
        title="agency wallets"
        refreshKey={revision}
        actionLabel="Manage wallet"
        onView={(r) => setSelected({ id: r.id, name: r.name })}
      />
      {selected && !loading && detail && (
        <>
          <Panel
            title={selected.name}
            aside={
              <button className="btn" onClick={() => setSelected(null)}>
                Close agency
              </button>
            }
          >
            <div className="panel-body">
              <dl className="form-grid">
                {[
                  ["Posted prepaid", detail.postedPaise],
                  ["Reserved prepaid", detail.reservedPaise],
                  ["Available prepaid", detail.availablePaise],
                  ["Credit limit", detail.creditLimitPaise],
                  ["Outstanding credit", detail.creditOutstandingPaise],
                  ["Available credit", detail.creditAvailablePaise],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{inr(Number(value))}</dd>
                  </div>
                ))}
              </dl>
              {manage && (
                <div className="dialog-actions">
                  {!detail.wallet ? (
                    <button
                      className="btn primary"
                      onClick={() =>
                        open("Create wallet", [reason], (_v, key) =>
                          mutation(base, "POST", {}, key),
                        )
                      }
                    >
                      Create wallet
                    </button>
                  ) : (
                    <>
                      <button
                        className="btn"
                        onClick={() =>
                          open(
                            detail.wallet.status === "Active"
                              ? "Suspend wallet"
                              : "Activate wallet",
                            [reason],
                            (v, key) =>
                              mutation(
                                `${base}/status`,
                                "PATCH",
                                {
                                  status:
                                    detail.wallet.status === "Active"
                                      ? "Suspended"
                                      : "Active",
                                  reason: v.reason,
                                },
                                key,
                              ),
                          )
                        }
                      >
                        {detail.wallet.status === "Active"
                          ? "Suspend wallet"
                          : "Activate wallet"}
                      </button>
                      <button
                        className="btn"
                        onClick={() =>
                          open(
                            "Request funding",
                            [
                              {
                                name: "amount",
                                label: "Amount · INR",
                                money: true,
                              },
                              {
                                name: "purpose",
                                label: "Funding purpose",
                                options: ["Wallet", "Credit repayment"],
                                value: "Wallet",
                              },
                            ],
                            (v, key) =>
                              mutation(
                                `${base}/funding`,
                                "POST",
                                {
                                  amountPaise: inputPaise(v.amount),
                                  purpose: v.purpose,
                                },
                                key,
                              ),
                          )
                        }
                      >
                        Request funding
                      </button>
                    </>
                  )}
                  <button
                    className="btn"
                    onClick={() =>
                      open(
                        "Authorize agency credit",
                        [
                          {
                            name: "limit",
                            label: "Credit limit · INR",
                            money: true,
                            value: (detail.creditLimitPaise / 100).toFixed(2),
                          },
                          {
                            name: "status",
                            label: "Credit status",
                            options: ["Active", "Suspended"],
                            value: detail.credit?.status || "Suspended",
                          },
                          reason,
                        ],
                        (v, key) =>
                          mutation(
                            `${base}/credit`,
                            "PUT",
                            {
                              limitPaise: inputPaise(v.limit),
                              status: v.status,
                              reason: v.reason,
                            },
                            key,
                          ),
                      )
                    }
                  >
                    Manage credit
                  </button>
                </div>
              )}
            </div>
          </Panel>
          <Panel title="Funding requests">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Purpose</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Review</th>
                  </tr>
                </thead>
                <tbody>
                  {funding.length === 0 && (
                    <tr>
                      <td colSpan={4}>No funding requests for this agency.</td>
                    </tr>
                  )}
                  {funding.map((f) => (
                    <tr key={f._id}>
                      <td>{f.purpose}</td>
                      <td>{inr(f.amountPaise)}</td>
                      <td>{f.status}</td>
                      <td>
                        {manage &&
                          ["Requested", "Verified"].includes(f.status) && (
                            <>
                              {policy?.testModeAvailable && (
                                <button
                                  className="btn"
                                  onClick={() => {
                                    const action =
                                      f.status === "Requested"
                                        ? "Verify test evidence"
                                        : "Confirm";
                                    open(
                                      action === "Confirm"
                                        ? "Post verified test funding"
                                        : "Verify isolated test funding",
                                      [reason],
                                      (v, key) =>
                                        mutation(
                                          `${base}/funding/${f._id}/review`,
                                          "POST",
                                          { action, reason: v.reason },
                                          key,
                                        ),
                                      `${selected.name}: ${inr(f.amountPaise)} for ${f.purpose}. This uses isolated test-provider evidence only.`,
                                    );
                                  }}
                                >
                                  {f.status === "Requested"
                                    ? "Verify test evidence"
                                    : "Post verified funding"}
                                </button>
                              )}
                              <button
                                className="btn"
                                onClick={() =>
                                  open("Reject funding", [reason], (v, key) =>
                                    mutation(
                                      `${base}/funding/${f._id}/review`,
                                      "POST",
                                      { action: "Reject", reason: v.reason },
                                      key,
                                    ),
                                  )
                                }
                              >
                                Reject
                              </button>
                            </>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel title="Wallet & credit transactions">
            <div className="panel-body">
              <p>
                Latest 100 entries. Debit reduces prepaid funds or increases
                credit exposure; credit increases prepaid funds or repays
                credit.
              </p>
              {history.length === 0 ? (
                <p>No posted transactions.</p>
              ) : (
                history.map((row) => (
                  <div key={row.id}>
                    <strong>{row.kind}</strong> ·{" "}
                    {new Date(row.createdAt).toLocaleString("en-IN", {
                      timeZone: "Asia/Kolkata",
                    })}{" "}
                    IST
                    {row.lines.map((line: any, i: number) => (
                      <p key={i}>
                        Debit {inr(line.debitPaise)} · Credit{" "}
                        {inr(line.creditPaise)}
                      </p>
                    ))}
                  </div>
                ))
              )}
            </div>
          </Panel>
          <Panel title="Credit audit history">
            <div className="panel-body">
              {credit.length === 0 ? (
                <p>No credit authorizations.</p>
              ) : (
                credit.map((row) => (
                  <p key={row._id}>
                    {inr(row.beforePaise)} → {inr(row.afterPaise)} ·{" "}
                    {row.afterStatus} · {row.reason}
                  </p>
                ))
              )}
            </div>
          </Panel>
          <Panel title="Download agency statement">
            <div className="panel-body">
              <button
                className="btn"
                onClick={() =>
                  open(
                    "Download agency statement",
                    [
                      { name: "from", label: "From date · YYYY-MM-DD" },
                      { name: "to", label: "To date · YYYY-MM-DD" },
                    ],
                    async (v) => {
                      await downloadFinanceStatement(selected.id, v.from, v.to);
                    },
                  )
                }
              >
                Choose statement period
              </button>
            </div>
          </Panel>
        </>
      )}
      {dialog && (
        <FinanceActionForm
          title={dialog.title}
          description={dialog.description}
          fields={dialog.fields}
          onClose={() => setDialog(null)}
          onSave={dialog.save}
        />
      )}
    </div>
  );
}
