import { useEffect, useState } from "react";
import { api, type Identity } from "../../api/client";
import { PlatformTable } from "../../components/platform/PlatformTable";
import { Evidence } from "../../components/platform/PlatformDetails";
import { Panel } from "../../components/ui/Panel";
import {
  FinanceReviewForm,
  type ReviewField,
} from "../finance/FinanceReviewForm";
const reason: ReviewField = { name: "reason", label: "Business reason" },
  password: ReviewField = {
    name: "password",
    label: "Your current password",
    type: "password",
  };
export function PlatformUsers({ user }: { user: Identity }) {
  const [roles, setRoles] = useState<any[]>([]),
    [role, setRole] = useState("Platform Operations"),
    [selected, setSelected] = useState<any>(null),
    [revision, setRevision] = useState(0),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [form, setForm] = useState<{
    title: string;
    description: string;
    fields: ReviewField[];
    save: (v: Record<string, string>, key: string) => Promise<void>;
  } | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    void api("/platform/capabilities", { signal: abort.signal })
      .then((r) => {
        if (!abort.signal.aborted) setRoles(r.data.roles || []);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [revision]);
  async function save(
    path: string,
    body: unknown,
    key: string,
    method = "POST",
  ) {
    await api(path, {
      method,
      body: JSON.stringify(body),
      headers: { "Idempotency-Key": key },
    });
    setRevision((v) => v + 1);
    setSelected(null);
    setNotice(
      "Admin access recorded. Existing sessions for changed staff were revoked.",
    );
  }
  function editor(target?: any, nextRole = role) {
    const template = roles.find((r) => r.profile === nextRole);
    if (!template) {
      setError("Reload the available role policies first.");
      return;
    }
    const finance = ["Finance Manager", "Audit / Read Only"].includes(nextRole),
      same = target?.profile === nextRole;
    setForm({
      title: target ? "Update admin access" : "Create admin staff",
      description: `${target ? `${target.name}: ${target.profile} → ` : "New account: "}${nextRole}. Select explicit permissions. Bootstrap Super Admin accounts and your own privileged access are protected. Finance grants never bypass independent payout approval. Share an initial password only through your approved secure process; no invitation email is sent here.`,
      fields: [
        { name: "name", label: "Staff name", value: target?.name },
        {
          name: "email",
          label: "Staff email",
          type: "email",
          value: target?.email,
        },
        ...(!target
          ? [
              {
                name: "initialPassword",
                label: "Initial staff password (12+ characters)",
                type: "password" as const,
              },
            ]
          : []),
        {
          name: "active",
          label: "Account access",
          value: target?.active === false ? "Inactive" : "Active",
          options: ["Active", "Inactive"].map((value) => ({
            value,
            label: value,
          })),
        },
        {
          name: "permissions",
          label: "Operational permissions",
          multiple: true,
          optional: true,
          value: JSON.stringify(
            same ? target.permissions : template.defaultPermissions,
          ),
          options: template.permissions.map((p: string) => ({
            value: p,
            label: p.replace("platform:", "").replaceAll(":", " · "),
          })),
        },
        ...(finance
          ? [
              {
                name: "financeRead",
                label: "Financial evidence access",
                value: same && target.financeRead ? "Enabled" : "Disabled",
                options: ["Disabled", "Enabled"].map((value) => ({
                  value,
                  label: value,
                })),
              },
            ]
          : []),
        ...(nextRole === "Finance Manager"
          ? [
              {
                name: "financeActions",
                label: "Separate financial action grants",
                multiple: true,
                optional: true,
                value: JSON.stringify(same ? target.financeActions || [] : []),
                options: [
                  "refunds:review",
                  "settlements:prepare",
                  "settlements:approve",
                  "payouts:authorize",
                ].map((value) => ({
                  value,
                  label: value.replaceAll(":", " · "),
                })),
              },
            ]
          : []),
        reason,
        password,
      ],
      save: async (v, key) => {
        if (!target && v.initialPassword.length < 12)
          throw Error("Initial staff password needs at least 12 characters.");
        const body = {
          name: v.name,
          email: v.email,
          profile: nextRole,
          permissions: JSON.parse(v.permissions || "[]"),
          active: v.active === "Active",
          financeRead: v.financeRead === "Enabled",
          financeActions: JSON.parse(v.financeActions || "[]"),
          reason: v.reason,
          password: v.password,
          ...(target
            ? { version: target.version }
            : { initialPassword: v.initialPassword }),
        };
        await save(
          `/platform/admin-users${target ? `/${target.id}` : ""}`,
          body,
          key,
          target ? "PATCH" : "POST",
        );
      },
    });
  }
  return (
    <div className="platform-section">
      <Panel title="Admin roles and privileged access">
        <div className="panel-body">
          <p>
            Functional roles retain the existing authentication system.
            Passenger access and financial actions are separate grants. MFA
            enrollment is unavailable until secure factor storage and recovery
            are implemented; sensitive changes require your current password.
          </p>
          <label>
            Role for new staff or explicit role reassignment
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              {roles.map((r) => (
                <option key={r.profile}>{r.profile}</option>
              ))}
            </select>
          </label>
          <button
            className="btn primary"
            disabled={!roles.length}
            onClick={() => editor()}
          >
            Create admin staff
          </button>
          {error && (
            <p role="alert">
              {error}
              <button className="btn" onClick={() => setRevision((v) => v + 1)}>
                Retry role policies
              </button>
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
        </div>
      </Panel>
      <PlatformTable
        title="Admin users"
        path="/platform/admin-users"
        dates={false}
        revision={revision}
        columns={[
          ["name", "Name"],
          ["email", "Email"],
          ["profile", "Functional role"],
          ["active", "Active"],
          ["financeRead", "Finance read"],
        ]}
        onView={setSelected}
      />
      {selected && (
        <Panel title="Selected admin account">
          <div className="panel-body">
            <Evidence data={selected} />
            {selected.profile === "Super Admin" || selected.id === user.id ? (
              <p>
                Bootstrap Super Admin and self-access changes are protected.
              </p>
            ) : (
              <>
                <button
                  className="btn"
                  onClick={() => editor(selected, selected.profile)}
                >
                  Update status & permissions
                </button>
                <button className="btn" onClick={() => editor(selected, role)}>
                  Assign selected role
                </button>
                <button
                  className="btn"
                  onClick={() =>
                    setForm({
                      title: "Revoke admin sessions",
                      description: `${selected.name} will be signed out of every current session. The account and audit history remain intact.`,
                      fields: [reason, password],
                      save: (v, key) =>
                        save(
                          `/platform/admin-users/${selected.id}/revoke-sessions`,
                          v,
                          key,
                        ),
                    })
                  }
                >
                  Revoke all staff sessions
                </button>
              </>
            )}
            <button className="btn" onClick={() => setSelected(null)}>
              Close account
            </button>
          </div>
        </Panel>
      )}
      {form && (
        <FinanceReviewForm
          intent="platform"
          title={form.title}
          description={form.description}
          fields={form.fields}
          onSave={form.save}
          onClose={() => setForm(null)}
        />
      )}
    </div>
  );
}
