import { useState } from "react";
import { KeyRound, LockKeyhole, ShieldCheck, RefreshCw } from "lucide-react";
import { api } from "../../api/client";
import { Load } from "../../components/PortalPrimitives";
import { Panel } from "../../../../admin/src/components/ui/Panel";
import { PlatformTable } from "../../../../admin/src/components/platform/PlatformTable";
import "../developer/developer.css";

export const credentialStatus = (row: any) =>
  row.revokedAt
    ? "Revoked"
    : new Date(row.expiresAt).getTime() <= Date.now()
      ? "Expired"
      : "Active";
export const credentialRequest: typeof api = async (path, options) => {
  const response = await api(path, options);
  return {
    ...response,
    data: response.data.map((row: any) => ({
      ...row,
      status: credentialStatus(row),
      scopesLabel: (row.scopes || []).join(", ") || "No scopes",
      expiryLabel:
        new Date(row.expiresAt).toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
        }) + " IST",
      lastUsedLabel: row.lastUsedAt
        ? new Date(row.lastUsedAt).toLocaleString("en-IN", {
            timeZone: "Asia/Kolkata",
          }) + " IST"
        : "Never used",
    })),
  };
};
export function CredentialsGuide({ writable }: { writable: boolean }) {
  return (
    <>
      <div className="dev-intro">
        <div>
          <span className="dev-eyebrow">SERVER ACCESS</span>
          <h2>Manage credentials for your integration.</h2>
          <p>
            Use a sandbox credential on your backend to obtain a short-lived API
            token.
          </p>
        </div>
        <span className="dev-environment">
          <KeyRound size={15} />
          Sandbox credentials
        </span>
      </div>
      <div className="dev-basics">
        <div>
          <strong>1. Generate a credential</strong>
          <span>Choose scopes and an expiry</span>
          <small>
            Only approved permissions are accepted. Maximum lifetime: 90 days.
          </small>
        </div>
        <div>
          <strong>2. Save the secret once</strong>
          <span>Store it in your server secret manager</span>
          <small>The saved credential list never exposes the secret.</small>
        </div>
        <div>
          <strong>3. Exchange for a token</strong>
          <code>POST /api/v1/public/auth/token</code>
          <small>
            Use the credential as the Bearer authorization value. Tokens last
            five minutes.
          </small>
        </div>
      </div>
      <p className="dev-notice">
        <LockKeyhole size={16} />
        {writable
          ? "Generate, rotate or revoke credentials through a reviewed action. Rotation revokes the old credential; update your backend after saving the replacement."
          : "Your role has read-only credential access. Ask an organization owner or authorized administrator to generate or change credentials."}
      </p>
    </>
  );
}
export function InventoryAccess() {
  const [revision, setRevision] = useState(0);
  return (
    <>
      <div className="dev-intro">
        <div>
          <span className="dev-eyebrow">AUTHORIZED INVENTORY</span>
          <h2>Know which inventory you can book.</h2>
          <p>
            AIBUS Admin grants access to specific operators, routes, services or
            trips. Company approval alone does not grant inventory.
          </p>
        </div>
        <button className="btn" onClick={() => setRevision((v) => v + 1)}>
          <RefreshCw size={15} />
          Refresh inventory
        </button>
      </div>
      <Load path="/partner/inventory" revision={revision}>
        {(d) => {
          const grants = d.grants || [],
            trips = d.trips || [];
          const active = grants.filter(
            (g: any) => g.active && g.sandboxEnabled,
          );
          const tableRequest: typeof api = async (path) => {
            const q = new URL(path, "https://local.invalid").searchParams;
            const page = Math.max(1, Number(q.get("page")) || 1),
              limit = 25,
              search = (q.get("search") || "").toLowerCase();
            const rows = trips
              .map((t: any) => ({
                ...t,
                routeLabel: `${t.route?.from?.name || "Unknown origin"} → ${t.route?.to?.name || "Unknown destination"}`,
                busType: t.bus?.type,
                availability: `${t.availableSeats} / ${t.seatCount}`,
                departure: new Date(t.departureAt).toLocaleString("en-IN", {
                  timeZone: "Asia/Kolkata",
                }),
              }))
              .filter((t: any) =>
                [t.id, t.operator, t.routeLabel, t.journeyDate]
                  .join(" ")
                  .toLowerCase()
                  .includes(search),
              );
            return {
              data: rows.slice((page - 1) * limit, page * limit),
              meta: {
                page,
                limit,
                total: rows.length,
                pages: Math.ceil(rows.length / limit),
              },
            };
          };
          return (
            <>
              <div className="dev-basics">
                <div>
                  <strong>Usable grants</strong>
                  <span>{active.length}</span>
                  <small>Active, unexpired and operator sandbox enabled</small>
                </div>
                <div>
                  <strong>Eligible trips</strong>
                  <span>{trips.length}</span>
                  <small>
                    Returned by the current authorized inventory query
                  </small>
                </div>
                <div>
                  <strong>Access owner</strong>
                  <span>AIBUS Admin</span>
                  <small>
                    Contact support to request additional inventory.
                  </small>
                </div>
              </div>
              {d.unavailable && (
                <p className="dev-notice" role="status">
                  {d.unavailable}
                </p>
              )}
              <Panel
                title="Inventory permissions"
                aside={
                  <span className="dev-environment">
                    <ShieldCheck size={14} />
                    Sandbox grants
                  </span>
                }
              >
                <div className="portal-pad">
                  <p className="dev-muted">
                    An active grant still requires an enabled operator sandbox
                    and an eligible future trip. Expired or inactive grants do
                    not authorize API requests. Latest {grants.length} grants
                    returned; the service returns at most 100.
                  </p>
                  {grants.length ? (
                    <div className="dev-grants">
                      {grants.map((g: any) => (
                        <article key={g.id} className="dev-grant">
                          <div className="dev-section-heading">
                            <h3>{g.operator || "Operator unavailable"}</h3>
                            <span
                              className={`dev-access-state ${g.active && g.sandboxEnabled ? "dev-ok" : "dev-failed"}`}
                            >
                              {!g.active
                                ? "Inactive / expired"
                                : !g.sandboxEnabled
                                  ? "Sandbox disabled"
                                  : "Active grant"}
                            </span>
                          </div>
                          <dl>
                            <div>
                              <dt>Access level</dt>
                              <dd>{g.kind}</dd>
                            </div>
                            <div>
                              <dt>Granted resource ID</dt>
                              <dd>
                                <code>{g.targetId}</code>
                              </dd>
                            </div>
                            <div>
                              <dt>Expires</dt>
                              <dd>
                                {new Date(g.expiresAt).toLocaleString("en-IN", {
                                  timeZone: "Asia/Kolkata",
                                })}{" "}
                                IST
                              </dd>
                            </div>
                          </dl>
                          <small className="dev-muted">
                            Grant IDs are administrative references. Use the
                            public trip IDs below in API requests.
                          </small>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="dev-empty">
                      <ShieldCheck size={26} />
                      <strong>No inventory granted yet</strong>
                      <p>
                        Ask AIBUS Admin to assign sandbox inventory. Generating
                        a credential will not grant access automatically.
                      </p>
                    </div>
                  )}
                </div>
              </Panel>
              {!trips.length && (
                <p className="dev-notice">
                  No eligible scheduled trips are available. Check the grant
                  expiry, operator sandbox status and future trip schedule with
                  AIBUS support.
                </p>
              )}
              <PlatformTable
                key={revision}
                request={tableRequest}
                onRefresh={() => setRevision((v) => v + 1)}
                title="Available authorized trips"
                path="/partner/inventory"
                dates={false}
                exportable={false}
                columns={[
                  ["id", "Public trip ID"],
                  ["operator", "Operator"],
                  ["routeLabel", "Route"],
                  ["journeyDate", "Journey date"],
                  ["departure", "Departure · IST"],
                  ["busType", "Bus type"],
                  ["availability", "Available / total"],
                ]}
              />
              <p className="dev-muted">
                Use the public trip ID in the playground. Search dates and city
                IDs through the API; seat availability and fares are validated
                again when you hold or book seats.
              </p>
            </>
          );
        }}
      </Load>
    </>
  );
}
