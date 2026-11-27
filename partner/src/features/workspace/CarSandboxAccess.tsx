import { useState } from "react";
import { api } from "../../api/client";
import { Panel } from "../../../../admin/src/components/ui/Panel";

export function CarSandboxAccess() {
  const [password, setPassword] = useState("");
  const [result, setResult] = useState<{token: string; expiresAt: string}>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <Panel title="Car API sandbox — token and Swagger">
    <div className="portal-pad">
      <p>Generate a 45-minute Car API token using your current account password. Available to approved organization Owners and Admins with all booking scopes. This token accesses shared synthetic demo inventory only.</p>
      <form onSubmit={async event => {
        event.preventDefault(); setBusy(true); setError(""); setResult(undefined);
        try { const response = await api("/partner/car/token", {method: "POST", body: JSON.stringify({password})}); setResult(response.data); }
        catch (error) { setError(error instanceof Error ? error.message : "Unable to generate token"); }
        finally { setPassword(""); setBusy(false); }
      }}>
        <label>Current account password<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label>
        <button className="btn primary" disabled={busy}>{busy ? "Generating…" : "Generate / renew Car token"}</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {result && <div>
        <p>Expires: {new Date(result.expiresAt).toLocaleString()}. Copy this token into Swagger → Authorize. Renewal does not revoke earlier tokens.</p>
        <label>Car bearer token<textarea readOnly value={result.token} style={{width: "100%"}} /></label>
        <button className="btn" onClick={() => setResult(undefined)}>Hide token</button>
      </div>}
      <p><a href="/api/v1/car/docs/" target="_blank" rel="noreferrer">Open Car Swagger — Try it out</a></p>
      <p>In Swagger: Authorize → paste token → select an endpoint → Try it out → Execute. Search cities and future trips before selecting seats. Confirmation and cancellation change sandbox records; no real payment is collected.</p>
      <p>Base URL: <code>/api/v1/car</code>. Tokens stay on this screen only and are cleared when you leave. Existing credentials below belong to the separate legacy /api/v1/public API.</p>
    </div>
  </Panel>;
}
