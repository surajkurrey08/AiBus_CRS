import { useState } from "react";
import { api, authState, type Identity } from "../../api/client";
import { can } from "../../config";
import { Panel } from "../../../../admin/src/components/ui/Panel";
import { PlatformTable } from "../../../../admin/src/components/platform/PlatformTable";
import { Load, Facts } from "../../components/PortalPrimitives";
export function Usage({ user }: { user: Identity }) {
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [endpoint, setEndpoint] = useState(""),
    [status, setStatus] = useState(""),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const request: typeof api = (path, opts, retry) =>
    api(path + (query ? "&" + query : ""), opts, retry);
  return (
    <>
      <Panel title="Sandbox request filters">
        <form
          className="portal-pad portal-actions"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (from && to && from > to) {
              setError("End date must follow start date.");
              return;
            }
            setError("");
            setQuery(
              new URLSearchParams({
                ...(from ? { from } : {}),
                ...(to ? { to } : {}),
                ...(endpoint ? { endpoint } : {}),
                ...(status ? { status } : {}),
              }).toString(),
            );
          }}
        >
          <label className="portal-field">
            From · IST
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="portal-field">
            To · IST
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <label className="portal-field">
            Exact endpoint
            <input
              placeholder="GET /cities"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
            />
          </label>
          <label className="portal-field">
            HTTP status
            <input
              inputMode="numeric"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            />
          </label>
          <button className="btn">Apply filters</button>
        </form>
        {error && <p role="alert">{error}</p>}
        {can(user, "export") && (
          <button
            className="btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const { accessToken } = authState();
                const r = await fetch("/api/v1/partner/usage/export?" + query, {
                  headers: {
                    Authorization: "Bearer " + accessToken,
                    "X-Aibus-Client": "partner",
                  },
                  credentials: "include",
                });
                if (!r.ok)
                  throw Error(
                    "Export unavailable. Refresh your session or narrow the date range.",
                  );
                const url = URL.createObjectURL(await r.blob()),
                  a = document.createElement("a");
                a.href = url;
                a.download = "sandbox-usage.csv";
                a.click();
                URL.revokeObjectURL(url);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Export filtered CSV
          </button>
        )}
      </Panel>
      <Load path={"/partner/usage/summary?" + query}>
        {(d) => (
          <Panel title="Request performance">
            <div className="portal-pad">
              <Facts
                data={{
                  requests: d.total,
                  successful: d.success,
                  failed: d.failed,
                  averageLatencyMs: d.latencyMs,
                  environment: d.environment,
                }}
              />
              <pre className="portal-json">
                {JSON.stringify(d.endpoints, null, 2)}
              </pre>
            </div>
          </Panel>
        )}
      </Load>
      <PlatformTable
        key={query}
        request={request}
        title="API requests"
        path="/partner/usage"
        dates={false}
        exportable={false}
        columns={[
          ["requestId", "Request ID"],
          ["operation", "Endpoint"],
          ["status", "HTTP status"],
          ["durationMs", "Latency ms"],
          ["createdAt", "Time"],
        ]}
      />
    </>
  );
}
