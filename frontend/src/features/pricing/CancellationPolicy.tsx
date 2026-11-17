import { useEffect, useState } from "react";
import { api } from "../../api/client.ts";
import { Panel, RecordForm } from "../../components/index.ts";
import { useWorkspace } from "../../context/WorkspaceContext.tsx";
import { type Raw } from "../../utils/normalize.ts";

export function LivePolicy() {
  const ws = useWorkspace(),
    [policy, setPolicy] = useState<Raw | null>(null),
    [editing, setEditing] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!ws.demo)
      api<Raw>("/operator/cancellation-policy")
        .then((r) => setPolicy(r.data))
        .catch((e) => setError(e.message));
  }, [ws.revision]);
  return (
    <Panel
      title="Cancellation policy"
      aside={
        ws.user.permissions.includes("refunds:write") ? (
          <button className="text-btn" onClick={() => setEditing(true)}>
            Edit policy
          </button>
        ) : null
      }
    >
      <div className="policy">
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {policy?.rules?.length ? (
          policy.rules.map((r: Raw) => (
            <p key={r.hoursBefore}>
              At least {r.hoursBefore} hours before departure
              <strong>{r.refundPercent}% refund</strong>
            </p>
          ))
        ) : (
          <p>
            No cancellation policy configured. Set your operator rules before
            accepting cancellation requests.
          </p>
        )}
        <small>
          Existing cancellation requests keep the policy version recorded when
          they were requested.
        </small>
      </div>
      {editing && (
        <RecordForm
          title="Cancellation policy"
          fields={["hoursBefore", "refundPercent"]}
          record={{
            hoursBefore: String(policy?.rules?.[0]?.hoursBefore || 24),
            refundPercent: String(policy?.rules?.[0]?.refundPercent || 90),
          }}
          onClose={() => setEditing(false)}
          onSave={async (v) => {
            await api("/operator/cancellation-policy", {
              method: "PUT",
              body: JSON.stringify({
                rules: [
                  {
                    hoursBefore: Number(v.hoursBefore),
                    refundPercent: Number(v.refundPercent),
                  },
                ],
              }),
            });
            setEditing(false);
            await ws.refresh();
            ws.notify("Policy saved");
          }}
        />
      )}
    </Panel>
  );
}
