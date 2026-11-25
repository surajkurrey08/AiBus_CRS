import { useState, type ReactNode } from "react";
import { api, post, type Identity } from "../../api/client";
import { can, scopes, roles, options, reviewFields } from "../../config";
import { Load, Facts, OneTimeSecret } from "../../components/PortalPrimitives";
import { Panel } from "../../../../admin/src/components/ui/Panel";
import { Overlay } from "../../../../admin/src/components/ui/Overlay";
import {
  FinanceReviewForm,
  type ReviewField,
} from "../../../../admin/src/features/finance/FinanceReviewForm";
import { PlatformTable } from "../../../../admin/src/components/platform/PlatformTable";
import { DeveloperWorkspace } from "../developer/DeveloperWorkspace";
import { Usage } from "../usage/Usage";
import {
  CredentialsGuide,
  InventoryAccess,
  credentialRequest,
} from "./ApiAccess";
import { PartnerSettlements } from "../settlements/PartnerSettlements";
export function Page({ page, user }: { page: string; user: Identity }) {
  const [revision, setRevision] = useState(0),
    [form, setForm] = useState<{
      title: string;
      fields: ReviewField[];
      path: string;
      map?: (v: any) => any;
    }>(),
    [secret, setSecret] = useState(""),
    [detail, setDetail] = useState<any>();
  const open = (
    title: string,
    path: string,
    fields: ReviewField[],
    map?: (v: any) => any,
  ) => setForm({ title, path, fields: [...fields, ...reviewFields], map });
  const btn = (label: string, action: () => void) => (
    <button className="btn primary" onClick={action}>
      {label}
    </button>
  );
  const issue = (row?: any) =>
    open(
      row ? "Rotate sandbox credential" : "Generate sandbox credential",
      "/partner/credentials",
      [
        { name: "label", label: "Credential label", value: row?.label },
        {
          name: "scopes",
          label: "Approved scopes",
          helperText:
            "Select only permissions approved by AIBUS for your company. The server also restricts scopes by your team role.",
          multiple: true,
          options: options(scopes),
          value: JSON.stringify(row?.scopes || []),
        },
        {
          name: "expiresAt",
          label: "Expiration date",
          type: "date",
          helperText:
            "Expires at 23:59:59 UTC on this date. Choose a date within the next 90 days.",
        },
      ],
      (v) => ({
        ...v,
        scopes: JSON.parse(v.scopes || "[]"),
        expiresAt: new Date(v.expiresAt + "T23:59:59Z").toISOString(),
        ...(row ? { rotateId: row.publicId } : {}),
      }),
    );
  let content: ReactNode;
  if (page === "overview")
    content = (
      <Load path="/partner/overview">
        {(d) => (
          <>
            <Panel
              title={d.name}
              aside={<span className="status-badge">{d.status} · Sandbox</span>}
            >
              <div className="portal-pad">
                <p>
                  {d.sandboxAvailable
                    ? "Your sandbox is ready for authorized requests."
                    : "Sandbox execution is unavailable. Contact AIBUS support to provision the isolated environment."}
                </p>
              </div>
            </Panel>
            <div className="portal-kpis">
              {[
                ["Authorized operators", d.authorizedOperators],
                ["Available trips", d.authorizedTrips],
                ["API requests", d.usage.total],
                ["Sandbox bookings", d.bookings],
                ["Successful requests", d.usage.success],
                ["Failed requests", d.usage.failed],
                ["Average latency", d.usage.latencyMs + " ms"],
                [
                  "Webhook deliveries",
                  d.webhooks.reduce((s: number, r: any) => s + r.count, 0),
                ],
              ].map(([k, v]) => (
                <div key={k}>
                  <span>{k}</span>
                  <strong>{v}</strong>
                </div>
              ))}
            </div>
            <Panel title="Recent organization activity">
              <div className="portal-pad">
                {d.activity.length ? (
                  d.activity.map((a: any) => (
                    <p key={a._id}>
                      {a.action}{" "}
                      <small>
                        {new Date(a.createdAt).toLocaleString("en-IN")}
                      </small>
                    </p>
                  ))
                ) : (
                  <p>
                    No recent activity. Generate a sandbox credential to start
                    your integration.
                  </p>
                )}
              </div>
            </Panel>
          </>
        )}
      </Load>
    );
  else if (page === "docs" || page === "playground")
    content = <DeveloperWorkspace playground={page === "playground"} />;
  else if (page === "credentials")
    content = (
      <>
        <CredentialsGuide writable={can(user, "credentials:write")} />
        <PlatformTable
          request={credentialRequest}
          title="Credentials"
          path="/partner/credentials"
          dates={false}
          exportable={false}
          revision={revision}
          columns={[
            ["label", "Label"],
            ["publicId", "Credential ID"],
            ["status", "Status"],
            ["scopesLabel", "Scopes"],
            ["expiryLabel", "Expires · IST"],
            ["lastUsedLabel", "Last used · IST"],
          ]}
          actions={
            can(user, "credentials:write") &&
            btn("Generate credential", () => issue())
          }
          onView={setDetail}
        />
      </>
    );
  else if (page === "inventory") content = <InventoryAccess />;
  else if (page === "bookings")
    content = (
      <PlatformTable
        request={api}
        title="Sandbox bookings"
        path="/partner/bookings"
        dates={false}
        exportable={false}
        columns={[
          ["reference", "Partner reference"],
          ["aibusReference", "AIBUS reference"],
          ["id", "API reference"],
          ["pnr", "PNR"],
          ["operator", "Operator"],
          ["route", "Route"],
          ["journeyDate", "Journey date"],
          ["seats", "Seats"],
          ["status", "Status"],
          ["paymentStatus", "Authorization"],
          ["cancellationStatus", "Cancellation"],
          ["refundStatus", "Refund"],
        ]}
        onView={(r) => setDetail({ bookingId: r.id })}
      />
    );
  else if (page === "settlements") content = <PartnerSettlements />;
  else if (page === "webhooks")
    content = (
      <>
        <PlatformTable
          request={api}
          title="Webhook subscriptions"
          path="/partner/webhooks"
          dates={false}
          exportable={false}
          revision={revision}
          columns={[
            ["publicId", "Subscription"],
            ["url", "HTTPS endpoint"],
            ["active", "Active"],
            ["signingVersion", "Signing version"],
          ]}
          actions={
            can(user, "webhooks:write") &&
            btn("Register endpoint", () =>
              open("Register webhook endpoint", "/partner/webhooks", [
                { name: "url", label: "Allowlisted public HTTPS URL" },
              ]),
            )
          }
          onView={setDetail}
        />
        <PlatformTable
          request={api}
          title="Delivery history"
          path="/partner/deliveries"
          dates={false}
          exportable={false}
          revision={revision}
          statuses={["Pending", "Delivering", "Delivered", "Manual review"]}
          columns={[
            ["status", "Status"],
            ["attempts", "Attempts"],
            ["retryLimit", "Attempt limit"],
            ["lastCode", "Result"],
            ["nextAttemptAt", "Next attempt"],
          ]}
          onView={(r) => setDetail({ ...r, delivery: true })}
        />
      </>
    );
  else if (page === "usage") content = <Usage user={user} />;
  else if (page === "team")
    content = (
      <PlatformTable
        request={api}
        title="Organization members"
        path="/partner/team"
        dates={false}
        exportable={false}
        revision={revision}
        columns={[
          ["name", "Name"],
          ["email", "Email"],
          ["partnerRole", "Role"],
          ["active", "Active"],
        ]}
        actions={
          can(user, "team:write") &&
          btn("Add member", () =>
            open("Add organization member", "/partner/team", [
              { name: "name", label: "Name" },
              { name: "email", label: "Email", type: "email" },
              {
                name: "role",
                label: "Organization role",
                options: options(roles),
              },
              {
                name: "initialPassword",
                label: "Initial password (12+ characters)",
                type: "password",
              },
            ]),
          )
        }
        onView={setDetail}
      />
    );
  else if (page === "support")
    content = (
      <>
        <p className="portal-note">
          Include request IDs and safe metadata. Never send API secrets,
          passwords or passenger details.
        </p>
        <PlatformTable
          request={api}
          title="Support requests"
          path="/partner/support"
          dates={false}
          exportable={false}
          revision={revision}
          columns={[
            ["subject", "Subject"],
            ["status", "Status"],
            ["response", "AIBUS response"],
            ["createdAt", "Created"],
          ]}
          onView={setDetail}
          actions={
            can(user, "support:write") &&
            btn("Request support", () =>
              setForm({
                title: "Request integration support",
                path: "/partner/support",
                fields: [
                  { name: "subject", label: "Subject" },
                  { name: "message", label: "Safe integration details" },
                ],
              }),
            )
          }
        />
      </>
    );
  else
    content = (
      <Load path={"/partner/" + page} revision={revision}>
        {(d) => (
          <Panel
            title={
              page === "settings" ? "Company details" : "Integration readiness"
            }
            aside={
              page === "settings" &&
              can(user, "settings:write") &&
              btn("Edit company details", () =>
                open(
                  "Edit company details",
                  "/partner/settings",
                  [
                    "name",
                    "contactPerson",
                    "phone",
                    "address",
                    "technicalEmail",
                  ].map((name) => ({
                    name,
                    label: name.replace(/([A-Z])/g, " $1"),
                    value: d[name],
                    ...(name === "technicalEmail"
                      ? { type: "email" as const }
                      : {}),
                  })),
                ),
              )
            }
          >
            <div className="portal-pad">
              <Facts data={d} />
            </div>
          </Panel>
        )}
      </Load>
    );
  return (
    <>
      {content}
      {form && (
        <FinanceReviewForm
          intent="platform"
          accountEmail={user.email}
          title={form.title}
          description="Review this organization change before confirming. Sandbox access only."
          fields={form.fields}
          onClose={() => setForm(undefined)}
          onSave={async (v, key) => {
            const r = await post(form.path, {
              ...(form.map ? form.map(v) : v),
              key,
            });
            if (r.data.credential || r.data.signingSecret)
              setSecret(r.data.credential || r.data.signingSecret);
            setRevision((v) => v + 1);
            setDetail(undefined);
          }}
        />
      )}
      {secret && <OneTimeSecret value={secret} onClose={() => setSecret("")} />}
      {detail && (
        <Overlay
          title={
            page === "bookings"
              ? "Owned sandbox booking"
              : "Organization record"
          }
          onClose={() => setDetail(undefined)}
          drawer
        >
          <div className="dialog-body">
            {detail.bookingId ? (
              <Load path={"/partner/bookings/" + detail.bookingId}>
                {(d) => <Facts data={d} />}
              </Load>
            ) : (
              <Facts data={detail} />
            )}
            <div className="portal-actions">
              {page === "credentials" &&
                can(user, "credentials:write") &&
                !detail.revokedAt && (
                  <>
                    {btn("Rotate credential", () => {
                      issue(detail);
                      setDetail(undefined);
                    })}
                    {btn("Revoke credential", () => {
                      open(
                        "Revoke sandbox credential",
                        "/partner/credentials/" + detail.publicId + "/revoke",
                        [],
                      );
                      setDetail(undefined);
                    })}
                  </>
                )}
              {page === "webhooks" &&
                can(user, "webhooks:write") &&
                (detail.delivery
                  ? detail.status === "Manual review" &&
                    btn("Retry eligible delivery", () => {
                      open(
                        "Retry sandbox delivery",
                        "/partner/deliveries/" + detail._id + "/retry",
                        [],
                      );
                      setDetail(undefined);
                    })
                  : [
                      detail.active ? "disable" : "enable",
                      "rotate",
                      "test",
                    ].map((action) => (
                      <button
                        className="btn"
                        key={action}
                        onClick={() => {
                          open(
                            action + " webhook",
                            "/partner/webhooks/" + detail.publicId,
                            [],
                            (v) => ({ ...v, action }),
                          );
                          setDetail(undefined);
                        }}
                      >
                        {action === "rotate"
                          ? "Rotate signing secret"
                          : action === "test"
                            ? "Queue test delivery"
                            : action === "disable"
                              ? "Disable endpoint"
                              : "Enable endpoint"}
                      </button>
                    )))}
              {page === "team" &&
                can(user, "team:write") &&
                detail._id !== user.id &&
                btn("Change membership", () => {
                  open(
                    "Change organization membership",
                    "/partner/team/" + detail._id,
                    [
                      {
                        name: "role",
                        label: "Role",
                        value: detail.partnerRole,
                        options: options(roles),
                      },
                      {
                        name: "active",
                        label: "Access",
                        value: String(detail.active),
                        options: [
                          { label: "Active", value: "true" },
                          { label: "Inactive", value: "false" },
                        ],
                      },
                    ],
                    (v) => ({ ...v, active: v.active === "true" }),
                  );
                  setDetail(undefined);
                })}
            </div>
          </div>
        </Overlay>
      )}
    </>
  );
}
