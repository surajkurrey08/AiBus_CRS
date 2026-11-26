import { useEffect, useState } from "react";
import { api } from "../../api/client";
import {
  FinanceReviewForm,
  type ReviewField,
} from "../finance/FinanceReviewForm";

type Option = { id: string; label: string };
type Grant = {
  operatorId?: string;
  operator?: string;
  kind: string;
  targetId: string;
};
function useInventoryOptions(partnerId: string, query: string | null) {
  const [items, setItems] = useState<Option[]>([]);
  const [total, setTotal] = useState(0),
    [loading, setLoading] = useState(query !== null);
  const [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setItems([]);
    setTotal(0);
    setError("");
    setLoading(query !== null);
    if (query === null) return () => abort.abort();
    const timer = setTimeout(() => {
      void api(
        `/platform/api-partners/${partnerId}/inventory-options?${query}`,
        { signal: abort.signal },
      )
        .then((result) => {
          if (!abort.signal.aborted) {
            setItems(result.data);
            setTotal(result.meta?.total || 0);
          }
        })
        .catch((caught) => {
          if (!abort.signal.aborted) setError(caught.message);
        })
        .finally(() => {
          if (!abort.signal.aborted) setLoading(false);
        });
    }, 300);
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [partnerId, query, retry]);
  return {
    items,
    total,
    loading,
    error,
    retry: () => setRetry((value) => value + 1),
  };
}
const asOptions = (items: Option[]) =>
  items.map((item) => ({ value: item.id, label: item.label }));
const mergeOptions = (items: Option[], existing: Option[]) => [
  ...items,
  ...existing.filter(
    (item) => !items.some((current) => current.id === item.id),
  ),
];

export function SandboxInventoryGrant({
  partnerId,
  partnerName,
  accountEmail,
  grants = [],
  onClose,
  onSaved,
}: {
  partnerId: string;
  partnerName: string;
  accountEmail: string;
  grants?: Grant[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [selection, setSelection] = useState({
    operatorSearch: "",
    operatorId: "",
    kind: "Trip",
    resourceSearch: "",
    active: "true",
  });
  const operators = useInventoryOptions(
    partnerId,
    new URLSearchParams({
      kind: "Operator",
      search: selection.operatorSearch,
    }).toString(),
  );
  const resources = useInventoryOptions(
    partnerId,
    selection.operatorId &&
      selection.kind !== "Operator" &&
      selection.active === "true"
      ? new URLSearchParams({
          kind: selection.kind,
          operatorId: selection.operatorId,
          search: selection.resourceSearch,
        }).toString()
      : null,
  );
  const operatorItems = mergeOptions(
    operators.items,
    !selection.operatorSearch
      ? grants
          .filter((g) => g.operatorId)
          .map((g) => ({
            id: g.operatorId!,
            label: g.operator || "Previously assigned operator",
          }))
      : [],
  );
  const resourceItems =
    selection.kind === "Operator"
      ? operatorItems.filter((item) => item.id === selection.operatorId)
      : mergeOptions(
          resources.items,
          !selection.resourceSearch
            ? grants
                .filter(
                  (g) =>
                    g.operatorId === selection.operatorId &&
                    g.kind === selection.kind,
                )
                .map((g) => ({
                  id: g.targetId,
                  label: `Previously assigned ${g.kind.toLowerCase()} · ${g.targetId.slice(-6)}`,
                }))
            : [],
        );
  const uniqueOperators = operatorItems.filter(
    (item, index, list) =>
      list.findIndex((other) => other.id === item.id) === index,
  );
  const uniqueResources = resourceItems.filter(
    (item, index, list) =>
      list.findIndex((other) => other.id === item.id) === index,
  );
  const loading = operators.loading || resources.loading;
  const error = operators.error || resources.error;
  const fields: ReviewField[] = [
    {
      name: "operatorSearch",
      label: "Filter sandbox operators",
      optional: true,
      placeholder: "Search by company name",
    },
    {
      name: "operatorId",
      label: "Sandbox operator",
      options: asOptions(uniqueOperators),
      dependsOn: ["operatorSearch"],
      disabled: operators.loading,
      helperText: operators.loading
        ? "Loading sandbox operators…"
        : operators.total > 100
          ? "Showing the first 100 matches. Refine the company filter."
          : uniqueOperators.length
            ? "Choose the operator providing this test inventory."
            : "No approved sandbox operators are available. Test inventory must be provisioned first.",
    },
    {
      name: "kind",
      label: "Resource type",
      value: "Trip",
      options: ["Trip", "Route", "Service", "Operator"].map((value) => ({
        value,
        label: value,
      })),
      helperText:
        "Trip grants access to one trip. Operator grants all eligible inventory from that operator.",
    },
    {
      name: "resourceSearch",
      label: "Filter sandbox resources",
      optional: true,
      dependsOn: ["operatorId", "kind", "active"],
      placeholder: "Search by route, trip number or date",
    },
    {
      name: "targetId",
      label: "Sandbox resource",
      options: asOptions(uniqueResources),
      dependsOn: ["operatorId", "kind", "resourceSearch", "active"],
      disabled: !selection.operatorId || resources.loading,
      helperText: !selection.operatorId
        ? "Select a sandbox operator first."
        : resources.loading
          ? "Loading sandbox inventory…"
          : resources.total > 100
            ? "Showing the first 100 matches. Refine the resource filter."
            : uniqueResources.length
              ? "Trips show their route, departure date and time in IST."
              : "No eligible resources match. Trips must be scheduled, open and in the future.",
    },
    {
      name: "expiresAt",
      label: "Expiration date",
      type: "date",
      value: new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(Date.now() + 30 * 86400000)),
      helperText: "Access expires at the end of the selected day in IST.",
    },
    {
      name: "active",
      label: "Access",
      value: "true",
      options: [
        { value: "true", label: "Active" },
        { value: "false", label: "Inactive" },
      ],
    },
    {
      name: "reason",
      label: "Review reason",
      helperText: "Explain why this company needs this sandbox inventory.",
    },
    { name: "password", label: "Current password", type: "password" },
  ];
  return (
    <FinanceReviewForm
      title="Manage sandbox inventory grant"
      intent="platform"
      accountEmail={accountEmail}
      description={`Choose test inventory for ${partnerName}. Review the resource and expiry before saving access.`}
      fields={fields}
      blocked={loading || !!error}
      notice={
        error ? (
          <div role="alert" className="review-error">
            {error}{" "}
            <button
              type="button"
              className="btn"
              onClick={() => {
                operators.retry();
                resources.retry();
              }}
            >
              Retry inventory
            </button>
          </div>
        ) : loading ? (
          <p role="status">Loading sandbox inventory…</p>
        ) : undefined
      }
      onValuesChange={(values) =>
        setSelection({
          operatorSearch: values.operatorSearch,
          operatorId: values.operatorId,
          kind: values.kind,
          resourceSearch: values.resourceSearch,
          active: values.active,
        })
      }
      confirmLabel={(values) =>
        values.active === "true"
          ? "Grant sandbox access"
          : "Disable sandbox access"
      }
      onClose={onClose}
      onSave={async (values, key) => {
        const expiry = new Date(values.expiresAt + "T23:59:59+05:30");
        if (!Number.isFinite(+expiry) || +expiry <= Date.now())
          throw new Error("Choose a future expiration date.");
        await api(`/platform/api-partners/${partnerId}/grants`, {
          method: "POST",
          body: JSON.stringify({
            operatorId: values.operatorId,
            kind: values.kind,
            targetId: values.targetId,
            expiresAt: expiry.toISOString(),
            active: values.active === "true",
            reason: values.reason,
            password: values.password,
            key,
          }),
        });
        onSaved();
      }}
    />
  );
}
