import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { DataTable, Panel } from "../../components/index";
import { useWorkspace } from "../../context/WorkspaceContext";
import { FinanceActionForm, type FinanceField } from "./FinanceActionForm";
import "./finance.css";
const inr = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(
    v / 100,
  );
const reason: FinanceField = { name: "reason", label: "Review reason" };
export function RefundManagement() {
  const ws = useWorkspace(),
    manage =
      ws.user.permissions.includes("finance:manage") &&
      ws.user.permissions.includes("refunds:write");
  const [revision, setRevision] = useState(0),
    [policy, setPolicy] = useState<any>(null),
    [runtime, setRuntime] = useState<any>(null),
    [error, setError] = useState("");
  const [selection, setSelection] = useState<{
      type: "request" | "intent" | "exception";
      row: any;
    } | null>(null),
    [detail, setDetail] = useState<any>(null),
    [quote, setQuote] = useState<any>(null),
    [loading, setLoading] = useState(false);
  const [dialog, setDialog] = useState<{
    title: string;
    description: string;
    fields: FinanceField[];
    save: (v: Record<string, string>, key: string) => Promise<void>;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setPolicy(null);
    setRuntime(null);
    setDetail(null);
    setQuote(null);
    setLoading(true);
    const load = async () => {
      const [p, mode] = await Promise.all([
        api("/operator/finance/cancellation-accounting-policy", {
          signal: controller.signal,
        }),
        api("/operator/finance/policy", { signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;
      setPolicy(p.data);
      setRuntime(mode.data);
      if (selection) {
        const path =
          selection.type === "request"
            ? `/bookings/${selection.row.bookingId}/${manage && selection.row.status === "Requested" ? "cancellation-quote" : "refund-status"}`
            : selection.type === "intent"
              ? `/refund-intents/${selection.row.id}`
              : `/exceptions/${selection.row.id}`;

        const result = await api(
          `/operator/finance${path}`,
          selection.type === "request" &&
            manage &&
            selection.row.status === "Requested"
            ? { method: "POST", body: "{}", signal: controller.signal }
            : { signal: controller.signal },
        );
        if (!controller.signal.aborted)
          selection.type === "request" &&
          manage &&
          selection.row.status === "Requested"
            ? setQuote(result.data)
            : setDetail(result.data);
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
  }, [selection, revision]);
  const mutation = async (
    path: string,
    body: unknown,
    key: string,
    method = "POST",
  ) => {
    await api(`/operator/finance${path}`, {
      method,
      body: JSON.stringify(body),
      headers: { "Idempotency-Key": key },
    });
    setRevision((v) => v + 1);
    ws.notify("Financial review recorded. Check the current refund status.");
  };
  const review = (
    title: string,
    description: string,
    path: string,
    body: (v: Record<string, string>) => unknown,
    fields = [reason],
  ) =>
    setDialog({
      title,
      description,
      fields,
      save: (v, key) => mutation(path, body(v), key),
    });
  return (
    <div className="finance-workspace">
      <Panel
        title="Refund management"
        aside={
          <button className="btn" onClick={() => setRevision((v) => v + 1)}>
            Refresh refund records
          </button>
        }
      >
        <div className="panel-body">
          <p>
            Cancellation approval releases owned seats and creates a liability.
            A refund is complete only after verified processing to its original
            funding source.
          </p>
          <p>
            Full bookings only. Partial seat cancellation is unavailable until
            seat-level accounting rules are approved.
          </p>
          <p role="status">
            {runtime?.testModeAvailable
              ? "Isolated refund test mode available. Live gateway refunds are disabled."
              : "Refund execution is disabled on this server. Requests and financial records remain available."}
          </p>
          {loading && <p role="status">Loading refund review…</p>}
          {error && (
            <div role="alert">
              <p>{error}</p>
              <button className="btn" onClick={() => setRevision((v) => v + 1)}>
                Retry refund review
              </button>
            </div>
          )}
          {manage && policy && (
            <button
              className="btn"
              onClick={() =>
                setDialog({
                  title: "Configure cancellation accounting",
                  description:
                    "Choose explicit test accounting treatment. Cancellation percentage rules remain in the existing cancellation policy page. No default fees or tax treatment are assumed.",
                  fields: [
                    {
                      name: "enabled",
                      label: "Cancellation execution",
                      options: ["Disabled", "Enabled"],
                      value: policy.enabled ? "Enabled" : "Disabled",
                    },
                    {
                      name: "basis",
                      label: "Refund percentage basis",
                      options: ["Unconfigured", "Discounted base fare"],
                      value: policy.refundBasis,
                    },
                    {
                      name: "tax",
                      label: "Tax treatment",
                      options: [
                        "Unconfigured",
                        "Proportional refund",
                        "Non-refundable",
                      ],
                      value: policy.taxTreatment,
                    },
                    {
                      name: "charge",
                      label: "Additional charge treatment",
                      options: [
                        "Unconfigured",
                        "Proportional refund",
                        "Non-refundable",
                      ],
                      value: policy.chargeTreatment,
                    },
                    {
                      name: "commission",
                      label: "Commission adjustment",
                      options: ["Unconfigured", "Reverse all"],
                      value: policy.commissionTreatment,
                    },
                    {
                      name: "exceptions",
                      label: "Approved captured-exception refunds",
                      options: ["Disabled", "Enabled"],
                      value: policy.allowExceptionRefunds
                        ? "Enabled"
                        : "Disabled",
                    },
                    reason,
                  ],
                  save: (v, key) =>
                    mutation(
                      "/cancellation-accounting-policy",
                      {
                        enabled: v.enabled === "Enabled",
                        refundBasis: v.basis,
                        taxTreatment: v.tax,
                        chargeTreatment: v.charge,
                        commissionTreatment: v.commission,
                        allowExceptionRefunds: v.exceptions === "Enabled",
                        version: policy.version,
                        reason: v.reason,
                      },
                      key,
                      "PUT",
                    ),
                })
              }
            >
              Configure accounting policy
            </button>
          )}
        </div>
      </Panel>
      <DataTable
        rows={[]}
        resourcePath="finance/cancellations"
        title="cancellation requests"
        refreshKey={revision}
        columns={[
          ["bookingId", "Booking"],
          ["reason", "Request reason"],
          ["status", "Review state"],
        ]}
        unsortableColumns={["bookingId", "reason", "status"]}
        actionLabel="Review request"
        onView={(row) => setSelection({ type: "request", row })}
      />
      <DataTable
        rows={[]}
        resourcePath="finance/refund-intents"
        title="refund intents"
        refreshKey={revision}
        columns={[
          ["bookingId", "Booking"],
          ["purpose", "Purpose"],
          ["amountDisplay", "Amount · INR"],
          ["fundingMethod", "Original source"],
          ["status", "Refund state"],
        ]}
        unsortableColumns={[
          "bookingId",
          "purpose",
          "amountDisplay",
          "fundingMethod",
          "status",
        ]}
        actionLabel="View refund"
        onView={(row) => setSelection({ type: "intent", row })}
      />
      <DataTable
        rows={[]}
        resourcePath="finance/exceptions"
        title="financial exceptions"
        refreshKey={revision}
        columns={[
          ["kind", "Exception"],
          ["code", "Review code"],
          ["status", "State"],
        ]}
        unsortableColumns={["kind", "code", "status"]}
        actionLabel="View exception"
        onView={(row) => setSelection({ type: "exception", row })}
      />
      {selection && (
        <Panel
          title={
            selection.type === "request"
              ? "Cancellation quote review"
              : selection.type === "intent"
                ? "Refund transaction details"
                : "Financial exception details"
          }
          aside={
            <button className="btn" onClick={() => setSelection(null)}>
              Close review
            </button>
          }
        >
          <div className="panel-body">
            {quote && (
              <>
                <dl className="form-grid">
                  {[
                    ["Original booking", quote.originalPaise],
                    ["Base fare refund", quote.baseRefundPaise],
                    ["Tax refund", quote.taxRefundPaise],
                    ["Additional charge refund", quote.chargeRefundPaise],
                    ["Retained amount", quote.retainedPaise],
                    ["Commission reversed", quote.commissionReversePaise],
                    ["Refundable amount", quote.refundPaise],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{inr(Number(value))}</dd>
                    </div>
                  ))}
                </dl>
                <p>
                  Quote expires{" "}
                  {new Date(quote.expiresAt).toLocaleString("en-IN", {
                    timeZone: "Asia/Kolkata",
                  })}{" "}
                  IST. Approval does not mark the refund completed.
                </p>
                {manage && runtime?.testModeAvailable && (
                  <button
                    className="btn primary"
                    onClick={() =>
                      review(
                        "Accept full cancellation",
                        `Cancel booking ${selection.row.bookingId}, release only its owned seats and approve ${inr(quote.refundPaise)} to its original source. The ticket becomes invalid.`,
                        `/cancellations/${selection.row.id}/review`,
                        (v) => ({
                          action: "Accept",
                          quoteId: quote._id,
                          reason: v.reason,
                        }),
                      )
                    }
                  >
                    Accept full cancellation
                  </button>
                )}
              </>
            )}
            {selection.type === "request" &&
              manage &&
              selection.row.status === "Requested" && (
                <button
                  className="btn"
                  onClick={() =>
                    review(
                      "Reject cancellation",
                      "Keep this booking and ticket valid; record the review reason.",
                      `/cancellations/${selection.row.id}/review`,
                      (v) => ({ action: "Reject", reason: v.reason }),
                    )
                  }
                >
                  Reject cancellation
                </button>
              )}
            {detail?.bookingStatus && (
              <p>
                Booking: {detail.bookingStatus} ? Payment:{" "}
                {detail.paymentStatus} ? Refund:{" "}
                {detail.refund?.status || "No refund requested"}
              </p>
            )}
            {detail?.intent && (
              <>
                <p>
                  {inr(detail.intent.amountPaise)} ·{" "}
                  {detail.intent.fundingMethod} · {detail.intent.status}
                </p>
                <p>
                  Provider refund reference:{" "}
                  {detail.intent.externalRefundId || "Not recorded"}
                </p>
                <p>
                  Verified processed at:{" "}
                  {detail.intent.processedAt
                    ? new Date(detail.intent.processedAt).toLocaleString(
                        "en-IN",
                        { timeZone: "Asia/Kolkata" },
                      ) + " IST"
                    : "Not verified"}
                </p>
                {manage &&
                  runtime?.testModeAvailable &&
                  detail.intent.status !== "Processed" && (
                    <>
                      <button
                        className="btn primary"
                        onClick={() =>
                          review(
                            "Check approved refund",
                            "Verify the original refund intent. Uncertain requests are reconciled using their original identity; no new charge or refund amount is created.",
                            `/refund-intents/${selection.row.id}/process`,
                            () => ({}),
                          )
                        }
                      >
                        Process or verify approved refund
                      </button>
                      <button
                        className="btn"
                        onClick={() =>
                          review(
                            "Authorize status recheck",
                            "Grant one bounded retry cycle after finance review. The original request and gateway idempotency key stay fixed.",
                            `/refund-intents/${selection.row.id}/recheck`,
                            (v) => ({ reason: v.reason }),
                          )
                        }
                      >
                        Authorize status recheck
                      </button>
                    </>
                  )}
                <h4>Attempt history</h4>
                {detail.attempts.length ? (
                  detail.attempts.map((attempt: any) => (
                    <p key={attempt._id}>
                      {attempt.action} · {attempt.outcome} ·{" "}
                      {new Date(attempt.createdAt).toLocaleString("en-IN", {
                        timeZone: "Asia/Kolkata",
                      })}{" "}
                      IST
                    </p>
                  ))
                ) : (
                  <p>No dispatch attempts recorded.</p>
                )}
              </>
            )}
            {detail?.exception && (
              <>
                <p>
                  {detail.exception.kind} · {detail.exception.code} ·{" "}
                  {detail.exception.status}
                </p>
                <p>
                  Matched captured amount:{" "}
                  {detail.payment
                    ? inr(detail.payment.amountPaise)
                    : "Requires verified payment matching"}
                </p>
                {manage && (
                  <>
                    <button
                      className="btn"
                      onClick={() =>
                        review(
                          "Acknowledge financial exception",
                          "Record ownership of this review without changing balances.",
                          `/exceptions/${selection.row.id}/review`,
                          (v) => ({ action: "Acknowledge", reason: v.reason }),
                        )
                      }
                    >
                      Acknowledge review
                    </button>
                    {runtime?.testModeAvailable &&
                      ["Duplicate capture", "Late capture"].includes(
                        detail.exception.kind,
                      ) && (
                        <button
                          className="btn"
                          onClick={() =>
                            review(
                              "Approve captured-exception test refund",
                              `Approve the full matched extra capture of ${inr(detail.payment?.amountPaise || 0)}. No valid ticket is cancelled and no refund is marked complete by this approval.`,
                              `/exceptions/${selection.row.id}/review`,
                              (v) => ({
                                action: "Approve test refund",
                                reason: v.reason,
                              }),
                            )
                          }
                        >
                          Approve exception test refund
                        </button>
                      )}
                  </>
                )}
              </>
            )}
          </div>
        </Panel>
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
