import { useState } from "react";
import { api, type Identity } from "../../api/client";
import { PlatformTable } from "../../components/platform/PlatformTable";
import { PlatformDetails } from "../../components/platform/PlatformDetails";
import { Panel } from "../../components/ui/Panel";
import {
  FinanceReviewForm,
  type ReviewField,
} from "../finance/FinanceReviewForm";
export const canPlatform = (user: Identity, permission: string) =>
  user.permissions.includes(permission) ||
  (permission !== "platform:finance:read" &&
    user.permissions.includes("platform:manage"));
const reason: ReviewField = { name: "reason", label: "Business reason" },
  password: ReviewField = {
    name: "password",
    label: "Your current password",
    type: "password",
  };
const resources: Record<
  string,
  { title: string; columns: [string, string][] }
> = {
  buses: {
    title: "Registered buses",
    columns: [
      ["operator", "Operator"],
      ["registration", "Registration"],
      ["name", "Bus"],
      ["type", "Type"],
      ["capacity", "Seats"],
      ["status", "Status"],
    ],
  },
  trips: {
    title: "Trip monitoring",
    columns: [
      ["operator", "Operator"],
      ["registration", "Bus"],
      ["route", "Route"],
      ["date", "Travel date"],
      ["available", "Available"],
      ["booked", "Booked"],
      ["blocked", "Blocked"],
      ["status", "Status"],
    ],
  },
  routes: {
    title: "Operator routes",
    columns: [
      ["operator", "Operator"],
      ["route", "Route"],
      ["departure", "Departure"],
      ["arrival", "Arrival"],
      ["status", "Status"],
    ],
  },
  agencies: {
    title: "Operator agencies",
    columns: [
      ["operator", "Operator"],
      ["name", "Agency"],
      ["status", "Status"],
      ["bookingCount", "Bookings"],
      ["permissions", "Agency grants"],
    ],
  },
  bookings: {
    title: "Central bookings",
    columns: [
      ["reference", "Reference"],
      ["pnr", "PNR"],
      ["operator", "Operator"],
      ["agency", "Agency"],
      ["source", "Source"],
      ["date", "Travel date"],
      ["seats", "Seats"],
      ["status", "Booking"],
      ["paymentStatus", "Payment"],
      ["ticketStatus", "Ticket"],
    ],
  },
  audit: {
    title: "Admin audit logs",
    columns: [
      ["actor", "Actor"],
      ["operator", "Tenant"],
      ["action", "Action"],
      ["resourceId", "Resource"],
      ["time", "Time · UTC"],
      ["reason", "Reason"],
      ["retention", "Retention"],
    ],
  },
  alerts: {
    title: "Operational alerts",
    columns: [
      ["operator", "Operator"],
      ["code", "Alert"],
      ["message", "Recorded condition"],
      ["status", "Severity"],
    ],
  },
};
export function PlatformWorkspace({
  user,
  section,
}: {
  user: Identity;
  section: string;
}) {
  const [tab, setTab] = useState("buses"),
    [selected, setSelected] = useState<any>(null),
    [revision, setRevision] = useState(0),
    [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<{
    title: string;
    description: string;
    fields: ReviewField[];
    save: (v: Record<string, string>, key: string) => Promise<void>;
  } | null>(null);
  const resource = section === "monitor" ? tab : section;
  const mutate = async (
    path: string,
    body: any,
    key: string,
    method = "POST",
  ) => {
    await api(path, {
      method,
      body: JSON.stringify(body),
      headers: { "Idempotency-Key": key },
    });
    setRevision((v) => v + 1);
    setNotice("Review recorded. The latest server state is shown below.");
  };
  function reviewOperator(row: any) {
    const next: Record<string, string[]> = {
      pending: ["approved", "rejected"],
      approved: ["suspended"],
      suspended: ["approved", "rejected"],
      rejected: ["pending"],
    };
    setSelected(null);
    setDialog({
      title: "Change operator status",
      description: `${row.company}: new sales and portal access follow this status. Existing tickets, pending payment ownership and future trips are preserved. This action does not cancel or refund bookings.`,
      fields: [
        {
          name: "status",
          label: "New status",
          options: (next[row.status] || []).map((value) => ({
            value,
            label: value,
          })),
        },
        reason,
        password,
      ],
      save: async (v, key) => {
        await mutate(
          `/platform/operators/${row._id || row.id}/status`,
          {
            status: v.status,
            reason: v.reason,
            password: v.password,
            version: row.__v || 0,
          },
          key,
          "PATCH",
        );
        setNotice(`${row.company} is now ${v.status}.`);
      },
    });
  }
  if (section === "operators")
    return (
      <div className="platform-section">
        {notice && (
          <p className="platform-notice" role="status">
            {notice}
          </p>
        )}
        <PlatformTable
          statuses={["pending", "approved", "suspended", "rejected"]}
          title="Operators"
          path="/platform/operators"
          dates={false}
          columns={[
            ["company", "Company"],
            ["email", "Contact email"],
            ["status", "Status"],
            ["salesBlocked", "New sales blocked"],
          ]}
          revision={revision}
          onView={setSelected}
        />
        {selected && (
          <PlatformDetails
            title="Operator details"
            path={`/platform/operators/${selected._id || selected.id}`}
            revision={revision}
            onClose={() => setSelected(null)}
            actions={(row) => (
              <>
                {canPlatform(user, "platform:operators:write") && (
                  <>
                    <button
                      className="btn primary"
                      onClick={() => reviewOperator(row)}
                    >
                      Change operator status
                    </button>
                    <button
                      className="btn"
                      onClick={() => {
                        setSelected(null);
                        setDialog({
                          title: "Change new-sales policy",
                          description:
                            "Stop or reopen new holds and bookings while retaining existing tickets, owned holds and payment confirmation rules. Portal access is controlled separately by operator status.",
                          fields: [
                            {
                              name: "blocked",
                              label: "New sales",
                              value: row.salesBlocked ? "Blocked" : "Allowed",
                              options: ["Blocked", "Allowed"].map((value) => ({
                                value,
                                label: value,
                              })),
                            },
                            reason,
                            password,
                          ],
                          save: (v, key) =>
                            mutate(
                              `/platform/operators/${row._id}/status`,
                              {
                                salesBlocked: v.blocked === "Blocked",
                                version: row.__v || 0,
                                reason: v.reason,
                                password: v.password,
                              },
                              key,
                              "PATCH",
                            ),
                        });
                      }}
                    >
                      Change new-sales policy
                    </button>
                  </>
                )}
                {canPlatform(user, "platform:verification:write") && (
                  <>
                    <button
                      className="btn"
                      onClick={() => {
                        setSelected(null);
                        setDialog({
                          title: "Record company document reference",
                          description:
                            "Record a reference to evidence reviewed through your approved external verification process. No document files or identity scans are uploaded, no external locations are fetched, and company verification is not automated.",
                          fields: [
                            {
                              name: "kind",
                              label: "Document type",
                              options: [
                                "Business registration",
                                "Tax registration",
                                "Operating licence",
                                "Other",
                              ].map((value) => ({ value, label: value })),
                            },
                            { name: "reference", label: "Evidence reference" },
                            reason,
                            password,
                          ],
                          save: (v, key) =>
                            mutate(
                              `/platform/operators/${row._id}/documents`,
                              v,
                              key,
                            ),
                        });
                      }}
                    >
                      Record company evidence
                    </button>
                    {row.documents?.map((doc: any) => (
                      <button
                        className="btn"
                        key={doc._id}
                        onClick={() => {
                          setSelected(null);
                          setDialog({
                            title: "Review document reference",
                            description: `${doc.kind}: ${doc.reference}. This review does not automatically approve the operator.`,
                            fields: [
                              {
                                name: "status",
                                label: "Review result",
                                options: [
                                  "Reviewed",
                                  "Rejected",
                                  "Needs information",
                                ].map((value) => ({ value, label: value })),
                              },
                              reason,
                              password,
                            ],
                            save: (v, key) =>
                              mutate(
                                `/platform/operators/${row._id}/documents/${doc._id}/review`,
                                { ...v, version: doc.__v || 0 },
                                key,
                              ),
                          });
                        }}
                      >
                        Review {doc.kind}
                      </button>
                    ))}
                  </>
                )}
                {row.financeAvailable && (
                  <p>
                    Financial statements and review actions remain in Finance,
                    scoped by operator.
                  </p>
                )}
              </>
            )}
          />
        )}
        {dialog && (
          <FinanceReviewForm
            intent="platform"
            {...{
              title: dialog.title,
              description: dialog.description,
              fields: dialog.fields,
              onSave: dialog.save,
              onClose: () => setDialog(null),
            }}
          />
        )}
      </div>
    );
  const config = resources[resource];
  if (!config) return null;
  return (
    <div className="platform-section">
      {section === "monitor" && (
        <nav className="platform-section-tabs" aria-label="Fleet monitoring">
          {["buses", "trips", "routes", "alerts"].map((id) => (
            <button
              className={`btn ${tab === id ? "primary" : ""}`}
              aria-current={tab === id ? "page" : undefined}
              key={id}
              onClick={() => {
                setTab(id);
                setSelected(null);
              }}
            >
              {resources[id].title}
            </button>
          ))}
        </nav>
      )}
      <PlatformTable
        statuses={
          resource === "bookings"
            ? [
                "Pending payment",
                "Confirmed",
                "Failed",
                "Cancelled",
                "Reconciliation required",
              ]
            : resource === "trips"
              ? ["Scheduled", "Departed", "Completed", "Cancelled"]
              : resource === "buses" || resource === "agencies"
                ? ["Active", "Inactive"]
                : undefined
        }
        key={resource}
        title={config.title}
        path={`/platform/${resource}`}
        columns={config.columns}
        operators={canPlatform(user, "platform:operators:read")}
        source={resource === "bookings"}
        onView={resource !== "alerts" ? setSelected : undefined}
      />
      {selected && (
        <PlatformDetails
          title={
            resource === "bookings"
              ? "Booking evidence and timeline"
              : "Authorized platform details"
          }
          path={`/platform/${resource}/${selected.id}`}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
export function PlatformReports({ user }: { user: Identity }) {
  const [report, setReport] = useState("operator-performance");
  return (
    <div className="platform-section">
      <Panel title="Platform operational reports">
        <div className="panel-body">
          <p>
            Operational counts reuse monitoring and booking records. The
            existing 15 ledger-backed reports remain in Finance with separate
            authorization.
          </p>
          <label>
            Report
            <select value={report} onChange={(e) => setReport(e.target.value)}>
              {[
                "operator-performance",
                "agency-performance",
                "booking-source",
                "route-bookings",
                "bus-occupancy",
                "confirmed-cancelled",
                "payment-status",
                "operational-alerts",
              ].map((r) => (
                <option value={r} key={r}>
                  {r.replaceAll("-", " ")}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Panel>
      <PlatformTable
        key={report}
        title="Report records"
        path={`/platform/reports/${report}`}
        operators={canPlatform(user, "platform:operators:read")}
        columns={
          report === "bus-occupancy"
            ? [
                ["operator", "Operator"],
                ["route", "Route"],
                ["date", "Date"],
                ["total", "Seats"],
                ["booked", "Booked"],
                ["available", "Available"],
                ["occupancyPercent", "Occupancy %"],
              ]
            : report === "operational-alerts"
              ? [
                  ["operator", "Operator"],
                  ["code", "Condition"],
                  ["message", "Alert"],
                ]
              : ["confirmed-cancelled", "payment-status"].includes(report)
                ? [
                    ["reference", "Reference"],
                    ["operator", "Operator"],
                    ["date", "Travel date"],
                    ["status", "Booking"],
                    ["paymentStatus", "Payment"],
                  ]
                : [
                    ["group", "Group"],
                    ["bookings", "Bookings"],
                    ["confirmed", "Confirmed"],
                    ["cancelled", "Cancelled"],
                  ]
        }
      />
    </div>
  );
}
