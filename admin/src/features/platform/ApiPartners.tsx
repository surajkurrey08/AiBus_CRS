import { Evidence } from "../../components/platform/PlatformDetails";
import { useEffect, useState } from "react";
import { api, type Identity } from "../../api/client";
import { PlatformTable } from "../../components/platform/PlatformTable";
import { Overlay } from "../../components/ui/Overlay";
import { SandboxInventoryGrant } from "./SandboxInventoryGrant";
import {
  FinanceReviewForm,
  type ReviewField,
} from "../finance/FinanceReviewForm";
const scopes = [
  "inventory:read",
  "holds:write",
  "bookings:write",
  "bookings:read",
  "tickets:read",
  "cancellations:write",
  "refunds:read",
  "webhooks:read",
];
const opts = (items: string[]) =>
  items.map((value) => ({ label: value, value }));
export function ApiPartners({ user }: { user: Identity }) {
  const [grantOpen, setGrantOpen] = useState(false);
  const [productionOperators, setProductionOperators] = useState<
    { label: string; value: string }[]
  >([]);
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0),
    [selected, setSelected] = useState(""),
    [record, setRecord] = useState<any>(),
    [error, setError] = useState(""),
    [form, setForm] = useState<{
      title: string;
      path: string;
      fields: ReviewField[];
      map?: (v: any) => any;
    }>();
  useEffect(() => {
    if (!selected) return;
    const abort = new AbortController();
    setRecord(undefined);
    setError("");
    void api("/platform/api-partners/" + selected, { signal: abort.signal })
      .then((r) => {
        if (!abort.signal.aborted) setRecord(r.data);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [selected, revision]);
  const writable = user.permissions.includes("platform:partners:write");
  useEffect(() => {
    if (!writable) return;
    const abort = new AbortController();
    void api("/platform/operators?limit=100", { signal: abort.signal })
      .then((result) => {
        if (!abort.signal.aborted)
          setProductionOperators(
            result.data.map((operator: any) => ({
              value: operator._id,
              label: operator.company,
            })),
          );
      })
      .catch(() => {});
    return () => abort.abort();
  }, [writable]);
  useEffect(() => {
    setGrantOpen(false);
    setNotice("");
  }, [selected]);
  const open = (
    title: string,
    path: string,
    fields: ReviewField[],
    map?: (v: any) => any,
  ) =>
    setForm({
      title,
      path: "/platform/api-partners/" + selected + path,
      fields: [
        ...fields,
        {
          name: "reason",
          label: "Review reason",
          helperText:
            "Explain the business decision. Do not enter an email address or password here.",
        },
        { name: "password", label: "Current password", type: "password" },
      ],
      map,
    });
  return (
    <>
      <p>
        Review external API companies independently of operator-owned agents.
        Approval grants no inventory and never enables production access.
      </p>
      <PlatformTable
        title="API Partners"
        path="/platform/api-partners"
        columns={[
          ["name", "Company"],
          ["businessEmail", "Business email"],
          ["onboardingStatus", "Application status"],
          ["requestedEnvironment", "Requested environment"],
          ["requestsPerMinute", "Requests / minute"],
        ]}
        statuses={[
          "Draft",
          "Submitted",
          "Under Review",
          "Approved",
          "Rejected",
          "Suspended",
        ]}
        dates={false}
        exportable={false}
        revision={revision}
        onView={(r) => setSelected(r._id)}
      />
      {selected && (
        <Overlay
          title="API partner organization"
          onClose={() => setSelected("")}
          drawer
          className="api-partner-details"
        >
          <div className="dialog-body">
            {error ? (
              <p role="alert">
                {error}
                <button
                  className="btn"
                  onClick={() => setRevision((v) => v + 1)}
                >
                  Retry
                </button>
              </p>
            ) : !record ? (
              <p role="status">Loading organization…</p>
            ) : (
              <>
                <h3>{record.partner.name}</h3>
                {notice && (
                  <p role="status" className="platform-notice">
                    {notice}
                  </p>
                )}
                <p>
                  {record.partner.onboardingStatus} · Sandbox · Production{" "}
                  {record.productionAccess?.status || "Disabled"}
                </p>
                {writable && (
                  <div className="platform-actions">
                    <button
                      className="btn primary"
                      onClick={() =>
                        open(
                          "Review partner access",
                          "/review",
                          [
                            {
                              name: "status",
                              label: "Application status",
                              value: ["Approved"].includes(
                                record.partner.onboardingStatus,
                              )
                                ? record.partner.onboardingStatus
                                : "",
                              helperText:
                                "Choose Approved to enable partner sign-in. Inventory is granted separately.",
                              options: opts(
                                (
                                  {
                                    Draft: ["Submitted"],
                                    Submitted: [
                                      "Under Review",
                                      "Approved",
                                      "Rejected",
                                    ],
                                    "Under Review": ["Approved", "Rejected"],
                                    Approved: ["Approved", "Suspended"],
                                    Suspended: ["Approved", "Rejected"],
                                    Rejected: ["Under Review"],
                                  } as Record<string, string[]>
                                )[record.partner.onboardingStatus] || [],
                              ),
                            },
                            {
                              name: "scopes",
                              label: "Approved sandbox scopes",
                              multiple: true,
                              optional: true,
                              helperText:
                                "Grant only the API permissions this company needs. Leaving all unchecked grants no scopes.",
                              options: opts(scopes),
                              value: JSON.stringify(
                                record.partner.scopes || [],
                              ),
                            },
                            {
                              name: "requestsPerMinute",
                              type: "number",
                              min: 1,
                              max: 120,
                              label: "Requests per minute (1–120)",
                              value: String(record.partner.requestsPerMinute),
                            },
                          ],
                          (v) => ({
                            ...v,
                            version: record.partner.revision,
                            scopes: JSON.parse(v.scopes || "[]"),
                            requestsPerMinute: Number(v.requestsPerMinute),
                          }),
                        )
                      }
                    >
                      Review approval, scopes & limits
                    </button>
                    <button className="btn" onClick={() => setGrantOpen(true)}>
                      Manage inventory grant
                    </button>
                    <button
                      className="btn"
                      onClick={() =>
                        open(
                          "Configure production access",
                          "/production-access",
                          [
                            {
                              name: "status",
                              label: "Production access",
                              options: opts(["Disabled", "Enabled", "Suspended"]),
                              value: record.productionAccess?.status || "Disabled",
                              helperText:
                                "Enabled allows real operator inventory. Suspended blocks access immediately.",
                            },
                            {
                              name: "operatorIds",
                              label: "Approved operators",
                              value: JSON.stringify(record.productionAccess?.operatorIds || []),
                              helperText: "Select the operators whose real inventory this partner may access.",
                              multiple: true,
                              options: productionOperators,
                              optional: true,
                            },
                            {
                              name: "allowedIps",
                              label: "Allowed backend IP addresses",
                              value: (record.productionAccess?.allowedIps || []).join(", "),
                              helperText: "Optional fixed outgoing server IP addresses separated by commas.",
                              optional: true,
                            },
                          ],
                          (v) => ({
                            ...v,
                            operatorIds: JSON.parse(v.operatorIds || "[]"),
                            allowedIps: v.allowedIps.split(",").map((value: string) => value.trim()).filter(Boolean),
                          }),
                        )
                      }
                    >
                      Configure production access
                    </button>
                    <button
                      className="btn"
                      disabled={record.productionAccess?.status !== "Enabled"}
                      onClick={() =>
                        open(
                          "Issue production credential",
                          "/production-credential",
                          [],
                        )
                      }
                    >
                      Issue or rotate production credential
                    </button>
                  </div>
                )}
                <h4>Application details</h4>
                <Evidence
                  data={{
                    company: record.partner.name,
                    contactPerson: record.partner.contactPerson,
                    businessEmail: record.partner.businessEmail,
                    phone: record.partner.phone,
                    address: record.partner.address,
                    technicalEmail: record.partner.technicalEmail,
                    intendedUsage: record.partner.intendedUsage,
                    requestedEnvironment: record.partner.requestedEnvironment,
                    applicationStatus: record.partner.onboardingStatus,
                  }}
                />
                <h4>Credential metadata</h4>
                {record.credentials.length ? (
                  record.credentials.map((c: any) => (
                    <div key={c.publicId}>
                      <p>
                        {c.label || c.publicId} ·{" "}
                        {c.revokedAt ? "Revoked" : "Active / expiry applies"} ·{" "}
                        {c.expiresAt}
                      </p>
                      {writable && !c.revokedAt && (
                        <button
                          className="btn"
                          onClick={() =>
                            open(
                              "Revoke compromised credential",
                              "/credentials/" + c.publicId + "/revoke",
                              [],
                            )
                          }
                        >
                          Revoke credential
                        </button>
                      )}
                    </div>
                  ))
                ) : (
                  <p>No issued credentials.</p>
                )}
                <h4>Inventory grants and integration health</h4>
                <Evidence
                  data={{
                    inventory: record.inventory,
                    usage: record.usage,
                    failedWebhooks: record.failures,
                  }}
                />
                <h4>Owned sandbox bookings</h4>
                <Evidence data={record.bookings} />
                <h4>Integration support</h4>
                {record.support.map((s: any) => (
                  <div key={s._id}>
                    <p>
                      {s.subject} · {s.status}
                    </p>
                    <p>{s.message}</p>
                    <p>{s.response}</p>
                    {writable && (
                      <button
                        className="btn"
                        onClick={() =>
                          open(
                            "Respond to integration support",
                            "/support/" + s._id,
                            [
                              { name: "response", label: "Response" },
                              {
                                name: "status",
                                label: "Status",
                                options: opts(["In review", "Resolved"]),
                              },
                            ],
                          )
                        }
                      >
                        Respond
                      </button>
                    )}
                  </div>
                ))}
                <h4>Partner audit history</h4>
                <Evidence data={record.audit} />
              </>
            )}
          </div>
        </Overlay>
      )}
      {grantOpen && record && (
        <SandboxInventoryGrant
          key={selected}
          partnerId={selected}
          partnerName={record.partner.name}
          accountEmail={user.email}
          grants={record.inventory?.grants || []}
          onClose={() => setGrantOpen(false)}
          onSaved={() => {
            setNotice("Sandbox inventory access updated.");
            setRevision((value) => value + 1);
          }}
        />
      )}
      {form && (
        <FinanceReviewForm
          title={form.title}
          intent="platform"
          accountEmail={user.email}
          confirmLabel={
            form.path.endsWith("/review")
              ? (values) =>
                  values.status === "Approved"
                    ? "Approve partner"
                    : values.status === "Suspended"
                      ? "Suspend partner"
                      : "Save reviewed decision"
              : undefined
          }
          description="Review the partner access and reason before confirming."
          fields={form.fields}
          onClose={() => setForm(undefined)}
          onSave={async (v, key) => {
            const response = await api(form.path, {
              method: "POST",
              body: JSON.stringify({ ...(form.map ? form.map(v) : v), key }),
            });
            if (form.path.endsWith("/production-credential"))
              setNotice(`Copy this production credential now. ${response.data.credential}`);
            setRevision((v) => v + 1);
          }}
        />
      )}
    </>
  );
}
