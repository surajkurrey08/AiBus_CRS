import { useEffect, useState } from "react";
import { api, type Identity } from "../../api/client";
import { Panel } from "../../components/ui/Panel";
import { Evidence } from "../../components/platform/PlatformDetails";
import { FinanceReviewForm } from "../finance/FinanceReviewForm";
import { canPlatform } from "./PlatformWorkspace";
export function PlatformSettings({ user }: { user: Identity }) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [edit, setEdit] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    setData(null);
    setError("");
    void api("/platform/settings", { signal: abort.signal })
      .then((r) => {
        if (!abort.signal.aborted) setData(r.data);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [revision]);
  return (
    <div className="platform-section">
      <Panel title="Platform profile and policy status">
        <div className="panel-body">
          {notice && <p role="status">{notice}</p>}
          {error ? (
            <div role="alert">
              {error}
              <button className="btn" onClick={() => setRevision((v) => v + 1)}>
                Retry settings
              </button>
            </div>
          ) : !data ? (
            <p role="status">Loading approved settings…</p>
          ) : (
            <>
              <h3>{data.settings.displayName}</h3>
              <p>
                {data.settings.supportEmail || "Support contact unconfigured"}
              </p>
              <p>
                Operator onboarding: {data.settings.onboardingMode}. Automatic
                approval, public API credentials, live bank transfers and
                unapproved fee/tax policies remain unavailable.
              </p>
              {canPlatform(user, "platform:settings:write") && (
                <button className="btn primary" onClick={() => setEdit(true)}>
                  Edit platform profile & template drafts
                </button>
              )}
              <Evidence data={data.integration} />
              <p>
                MFA enrollment: unavailable; secure factor storage and recovery
                are not configured. Integration configuration does not prove
                provider connectivity.
              </p>
            </>
          )}
        </div>
      </Panel>
      {edit && data && (
        <FinanceReviewForm
          intent="platform"
          title="Update controlled platform settings"
          description="Update the public profile and notification template drafts. This does not send email, expose secrets, enable automatic onboarding or change finance policies."
          fields={[
            {
              name: "displayName",
              label: "Platform name",
              value: data.settings.displayName,
            },
            {
              name: "supportEmail",
              label: "Support email",
              type: "email",
              value: data.settings.supportEmail,
            },
            {
              name: "templateApproved",
              label: "Operator approved notification draft",
              optional: true,
              value: data.settings.templates?.operatorApproved || "",
            },
            {
              name: "templateSuspended",
              label: "Operator suspended notification draft",
              optional: true,
              value: data.settings.templates?.operatorSuspended || "",
            },
            {
              name: "templateSupport",
              label: "Booking support notification draft",
              optional: true,
              value: data.settings.templates?.bookingSupport || "",
            },
            { name: "reason", label: "Business reason" },
            {
              name: "password",
              label: "Your current password",
              type: "password",
            },
          ]}
          onClose={() => setEdit(false)}
          onSave={async (v) => {
            await api("/platform/settings", {
              method: "PUT",
              body: JSON.stringify({
                displayName: v.displayName,
                supportEmail: v.supportEmail,
                onboardingMode: "Manual review",
                templates: {
                  operatorApproved: v.templateApproved,
                  operatorSuspended: v.templateSuspended,
                  bookingSupport: v.templateSupport,
                },
                version: data.settings.version,
                reason: v.reason,
                password: v.password,
              }),
            });
            setRevision((n) => n + 1);
            setNotice(
              "Profile and template drafts updated. No notification was sent.",
            );
          }}
        />
      )}
    </div>
  );
}
