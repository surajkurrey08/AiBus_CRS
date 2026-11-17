import { Armchair, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../api/client.ts";
import { Badge, Panel } from "../../components/index.ts";
import { useWorkspace } from "../../context/WorkspaceContext.tsx";
import { type Raw } from "../../utils/normalize.ts";
import { LiveStaff } from "./StaffManagement";

export function LiveSettings() {
  const ws = useWorkspace(),
    [tab, setTab] = useState("Company profile"),
    [prefs, setPrefs] = useState<Record<string, boolean>>({}),
    [integration, setIntegration] = useState<Raw>({});
  useEffect(() => {
    if (ws.demo) return;
    api<Record<string, boolean>>("/operator/preferences")
      .then((r) => setPrefs(r.data))
      .catch((e) => ws.notify(e.message));
    api<Raw>("/operator/integrations")
      .then((r) => setIntegration(r.data))
      .catch((e) => ws.notify(e.message));
  }, [ws.revision]);
  return (
    <>
      <div className="tabs">
        {[
          "Company profile",
          ...(ws.user.permissions.includes("staff:write")
            ? ["Agents & Staff"]
            : []),
          "Notifications",
          "Integrations",
        ].map((t) => (
          <button
            className={tab === t ? "selected" : ""}
            key={t}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Company profile" ? (
        <Panel title="Company profile">
          <form
            className="settings-form"
            noValidate
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await ws.setProfile(
                  Object.fromEntries(new FormData(e.currentTarget)) as Record<
                    string,
                    string
                  >,
                );
                ws.notify("Company profile saved");
              } catch (e) {
                ws.notify((e as Error).message);
              }
            }}
          >
            <div className="company-avatar">
              {ws.profile.company.slice(0, 2).toUpperCase()}
              <span>Approved operator</span>
            </div>
            <div className="form-grid">
              {Object.entries(ws.profile).map(([key, value]) => (
                <label key={key}>
                  {key.replace(/^./, (s) => s.toUpperCase())}
                  <input
                    name={key}
                    defaultValue={value}
                    disabled={!ws.user.permissions.includes("settings:write")}
                  />
                </label>
              ))}
            </div>
            {ws.user.permissions.includes("settings:write") && (
              <div className="dialog-foot">
                <button className="btn primary">
                  <Save size={15} />
                  Save changes
                </button>
              </div>
            )}
          </form>
        </Panel>
      ) : tab === "Agents & Staff" || tab === "Staff & access" ? (
        <LiveStaff />
      ) : tab === "Notifications" ? (
        <Panel title="Notification preferences">
          {[
            "New bookings",
            "Cancellation requests",
            "Upcoming departures",
            "Settlement updates",
          ].map((name) => (
            <div className="preference" key={name}>
              <div>
                <strong>{name}</strong>
                <p>Workspace notifications for {name.toLowerCase()}.</p>
              </div>
              <button
                role="switch"
                aria-label={name}
                aria-checked={!!prefs[name]}
                className={`switch ${prefs[name] ? "on" : ""}`}
                onClick={async () => {
                  try {
                    const next = { ...prefs, [name]: !prefs[name] };
                    await api("/operator/preferences", {
                      method: "PATCH",
                      body: JSON.stringify(next),
                    });
                    setPrefs(next);
                  } catch (e) {
                    ws.notify((e as Error).message);
                  }
                }}
              >
                <i />
              </button>
            </div>
          ))}
        </Panel>
      ) : (
        <Panel title="API integration status">
          <div className="integration">
            <Armchair size={28} />
            <div>
              <h3>Reservation provider</h3>
              <p>
                {integration.reservation?.configured
                  ? "Connected"
                  : "Not configured. Your provider API can be connected through the backend adapter."}
              </p>
              <Badge
                value={
                  integration.reservation?.configured
                    ? "Active"
                    : "Not connected"
                }
              />
              <p>
                Payments:{" "}
                {integration.payment?.configured
                  ? "Connected"
                  : "Not configured"}
              </p>
            </div>
          </div>
        </Panel>
      )}
      <div className="section-heading">
        <span className="muted">Signed in as {ws.user.email}</span>
        <button className="btn" onClick={ws.logout}>
          Sign out
        </button>
      </div>
    </>
  );
}
