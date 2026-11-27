import { useEffect, useRef, useState } from "react";
import {
  Copy,
  Download,
  Play,
  Search,
  ShieldCheck,
  Terminal,
  BookOpen,
} from "lucide-react";
import { post } from "../../api/client";
import { Panel } from "../../../../admin/src/components/ui/Panel";
import { Load } from "../../components/PortalPrimitives";
import {
  schemaExample,
  resolveSchema,
  requestExample,
  integrationExample,
  sandboxScenarios,
} from "./contracts";
import "./developer.css";

const group = (id: string) =>
  id === "authenticate" || id === "capabilities"
    ? "Getting started"
    : ["cities", "trips", "tripDetails", "seatLayout", "stops"].includes(id)
      ? "Inventory"
      : /[Cc]ancel|refund/.test(id)
        ? "Cancellations & refunds"
        : /webhook/.test(id)
          ? "Notifications"
          : /Unavailable/.test(id)
            ? "Unavailable capabilities"
            : "Reservations";
const title = (op: any) =>
  (op.summary || op.operationId).replace(/^\d+\.\s*/, "");
function Fields({ schema, spec }: { schema: any; spec: any }) {
  const s = resolveSchema(schema, spec);
  if (!Object.keys(s.properties || {}).length)
    return (
      <p className="dev-muted">
        {s.type === "array"
          ? "Returns an array. See the response example below."
          : "No JSON body fields are defined for this operation."}
      </p>
    );
  return (
    <div className="dev-table-wrap">
      <table className="dev-table">
        <caption className="sr-only">JSON object fields</caption>
        <thead>
          <tr>
            <th>Field</th>
            <th>Type</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(s.properties).map(([key, raw]: any) => {
            const field = resolveSchema(raw, spec);
            return (
              <tr key={key}>
                <td>
                  <code>{key}</code>
                  {s.required?.includes(key) && (
                    <small className="dev-required">Required</small>
                  )}
                </td>
                <td>
                  {field.type || (field.enum ? typeof field.enum[0] : "object")}
                  {field.nullable ? " / null" : ""}
                </td>
                <td>
                  {field.description ||
                    field.format ||
                    (field.enum
                      ? field.enum.join(" / ")
                      : field.minimum !== undefined
                        ? `Minimum: ${field.minimum}${field.maximum !== undefined ? `; maximum: ${field.maximum}` : ""}`
                        : "See example for shape and sample values.")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
function Explorer({ spec, playground }: { spec: any; playground: boolean }) {
  const endpoints = Object.entries(spec.paths || {})
    .flatMap(([path, methods]: any) =>
      Object.entries(methods)
        .filter(([, op]: any) => op.operationId)
        .map(([method, op]: any) => ({
          path,
          method: method.toUpperCase(),
          ...op,
        })),
    )
    .filter((op: any) => !playground || op.operationId !== "authenticate");
  const [selected, setSelected] = useState("capabilities"),
    [search, setSearch] = useState(""),
    [scenario, setScenario] = useState(""),
    [language, setLanguage] = useState("curl"),
    [copyStatus, setCopyStatus] = useState(""),
    [drafts, setDrafts] = useState<Record<string, string>>({}),
    [result, setResult] = useState<any>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const area = useRef<HTMLTextAreaElement>(null),
    dirty = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const unload = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      mounted.current = false;
      window.removeEventListener("beforeunload", unload);
    };
  }, []);
  const op =
    endpoints.find((o: any) => o.operationId === selected) || endpoints[0];
  if (!op)
    return (
      <Panel title="API reference unavailable">
        <div className="portal-pad">
          No endpoints are available in the returned contract. Refresh this page
          or contact support.
        </div>
      </Panel>
    );
  const choose = (id: string) => {
    if (busy) return;
    setSelected(id);
    setResult(undefined);
    setError("");
    setCopyStatus("");
  };
  const filtered = endpoints.filter((o: any) =>
    (o.method + o.operationId + o.path + title(o))
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const groups = [...new Set(filtered.map((o: any) => group(o.operationId)))];
  const request =
    drafts[op.operationId] ?? JSON.stringify(requestExample(op, spec), null, 2);
  const success = Object.entries(op.responses || {}).find(([status]) =>
    /^2\d\d$/.test(status),
  );
  const successSchema = (success?.[1] as any)?.content?.["application/json"]
    ?.schema;
  const unavailable = op.description?.includes("UNAVAILABLE:");
  const scope = op.description?.match(/Required scope: ([^.]+)/)?.[1];
  const code = integrationExample(op, spec, language);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopyStatus("Integration example copied");
    } catch {
      setCopyStatus(
        "Clipboard unavailable. Select and copy the example below.",
      );
    }
  };
  const run = async () => {
    if (busy) return;
    setError("");
    let values: any;
    try {
      values = JSON.parse(request);
      if (!values || typeof values !== "object" || Array.isArray(values))
        throw Error();
      for (const key of ["params", "query", "body"]) {
        if (
          key !== "body" &&
          values[key] !== undefined &&
          (!values[key] ||
            typeof values[key] !== "object" ||
            Array.isArray(values[key]))
        )
          throw Error();
      }
    } catch {
      setError(
        "Enter valid JSON with params and query objects before running the sandbox request.",
      );
      area.current?.focus();
      return;
    }
    setBusy(true);
    setResult(undefined);
    try {
      const response = await post("/partner/playground", {
        ...values,
        operationId: op.operationId,
      });
      if (mounted.current) {
        setResult(response.data);
        dirty.current = false;
      }
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <>
      <div className="dev-intro">
        <div>
          <span className="dev-eyebrow">DEVELOPER WORKSPACE</span>
          <h2>
            {playground
              ? "Bus API playground"
              : "Build with the AIBUS Booking API."}
          </h2>
          <p>
            {playground
              ? "Run authorized requests against the sandbox. No API secret needs to be entered here."
              : "Explore endpoints, required fields and server-side integration examples from the API contract."}
          </p>
        </div>
        <span className="dev-environment">
          <ShieldCheck size={15} />
          Sandbox / API v1
        </span>
      </div>
      <div className="dev-basics">
        <div>
          <strong>Base path</strong>
          <code>/api/v1/public</code>
          <small>Your provisioned sandbox host + this path</small>
        </div>
        <div>
          <strong>Authentication</strong>
          <span>Credential exchange → Bearer token</span>
          <small>Keep credentials and tokens on your server.</small>
        </div>
        <div>
          <strong>Request limits</strong>
          <span>Up to 120 requests / minute</span>
          <small>Your approved account limit may be lower.</small>
        </div>
      </div>
      <div className="dev-layout">
        <aside className="dev-navigation" aria-label="API endpoint navigation">
          <div className="dev-navigation-header">
            <label className="portal-field">
              <span>Find endpoint</span>
              <div className="dev-search">
                <Search size={15} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search method, path or name"
                />
              </div>
            </label>
            <small className="dev-muted">
              {filtered.length} of {endpoints.length} endpoints
            </small>
          </div>
          {groups.map((g) => (
            <section key={g}>
              <h3>{g}</h3>
              {filtered
                .filter((o: any) => group(o.operationId) === g)
                .map((o: any) => (
                  <button
                    className={op.operationId === o.operationId ? "active" : ""}
                    key={o.operationId}
                    disabled={busy}
                    onClick={() => choose(o.operationId)}
                    aria-current={
                      op.operationId === o.operationId ? "true" : undefined
                    }
                  >
                    <span
                      className={`dev-method method-${o.method.toLowerCase()}`}
                    >
                      {o.method}
                    </span>
                    <span>
                      {title(o)}
                      <code>{o.path}</code>
                    </span>
                  </button>
                ))}
            </section>
          ))}
          {!filtered.length && (
            <div className="dev-empty">
              <p>No matching endpoints.</p>
              <button className="btn" onClick={() => setSearch("")}>
                Clear search
              </button>
            </div>
          )}
        </aside>
        <div className="dev-reference">
          <Panel
            title={title(op)}
            aside={
              <span className="dev-environment">
                {unavailable ? "Unavailable / HTTP 501" : "Sandbox"}
              </span>
            }
          >
            <div className="portal-pad dev-operation">
              <div className="dev-path">
                <span
                  className={`dev-method method-${op.method.toLowerCase()}`}
                >
                  {op.method}
                </span>
                <code>/api/v1/public{op.path}</code>
              </div>
              <p>{op.description}</p>
              <div className="dev-scope">
                <ShieldCheck size={15} />
                <strong>Required access:</strong>
                <code>
                  {scope ||
                    (op.operationId === "authenticate"
                      ? "Server API credential"
                      : "Authenticated partner")}
                </code>
              </div>
              {unavailable && (
                <p className="dev-notice">
                  This capability is listed for discovery and returns an
                  unavailable response. It cannot issue a live booking, wallet
                  transaction or reschedule.
                </p>
              )}
              {!!op.parameters?.length && (
                <section>
                  <h3>Parameters &amp; headers</h3>
                  <div className="dev-table-wrap">
                    <table className="dev-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Location</th>
                          <th>Type / requirement</th>
                        </tr>
                      </thead>
                      <tbody>
                        {op.parameters.map((p: any) => (
                          <tr key={p.in + p.name}>
                            <td>
                              <code>{p.name}</code>
                            </td>
                            <td>{p.in}</td>
                            <td>
                              {p.schema?.type || "string"}
                              {p.required && (
                                <small className="dev-required">Required</small>
                              )}
                              {p.schema?.format && (
                                <small>{p.schema.format}</small>
                              )}
                              {p.schema?.minLength && (
                                <small>
                                  {p.schema.minLength}–{p.schema.maxLength}{" "}
                                  characters
                                </small>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
              {playground ? (
                <>
                  <details className="dev-scenario">
                    <summary>Sandbox scenarios &amp; test instructions</summary>
                    <label className="portal-field">
                      Choose a test scenario
                      <select
                        value={scenario}
                        disabled={busy}
                        onChange={(e) => {
                          setScenario(e.target.value);
                          const s = sandboxScenarios.find(
                            (s) => s.name === e.target.value,
                          );
                          if (s) choose(s.operation);
                        }}
                      >
                        <option value="">Choose scenario</option>
                        {sandboxScenarios.map((s) => (
                          <option key={s.name}>{s.name}</option>
                        ))}
                      </select>
                    </label>
                    <p>
                      {sandboxScenarios.find((s) => s.name === scenario)
                        ?.steps ||
                        "Use disposable test records authorized for your company. Scenarios provide instructions; they do not create fixtures or fabricate results."}
                    </p>
                  </details>
                  <div className="dev-request-response">
                    <section>
                      <div className="dev-section-heading">
                        <h3>
                          <Terminal size={16} />
                          Request
                        </h3>
                        <span className="dev-muted">JSON</span>
                      </div>
                      <p className="dev-muted">
                        Replace sample IDs with values from Inventory Access or
                        a previous response. Query values must be strings. Put a
                        stable request key in <code>idempotencyKey</code> where
                        required.
                      </p>
                      <label className="portal-field">
                        Sandbox request JSON
                        <textarea
                          ref={area}
                          disabled={busy}
                          value={request}
                          spellCheck={false}
                          aria-invalid={!!error}
                          aria-describedby={
                            error ? "playground-error" : undefined
                          }
                          onChange={(e) => {
                            setDrafts((d) => ({
                              ...d,
                              [op.operationId]: e.target.value,
                            }));
                            dirty.current = true;
                          }}
                        />
                      </label>
                      {error && (
                        <p
                          className="dev-notice dev-error"
                          role="alert"
                          id="playground-error"
                        >
                          {error}
                        </p>
                      )}
                      <button
                        className="btn primary dev-run"
                        disabled={busy}
                        onClick={() => void run()}
                      >
                        <Play size={15} />
                        {busy
                          ? "Executing sandbox request..."
                          : "Run sandbox request"}
                      </button>
                    </section>
                    <section
                      className="dev-response"
                      aria-label="Sandbox response"
                      aria-busy={busy}
                    >
                      <h3>Response</h3>
                      {busy ? (
                        <p role="status">Waiting for the sandbox response...</p>
                      ) : result ? (
                        <>
                          <p
                            role="status"
                            className={`dev-response-meta ${result.status >= 400 ? "dev-failed" : "dev-ok"}`}
                          >
                            <strong>HTTP {result.status}</strong>
                            <span>{result.durationMs} ms</span>
                          </p>
                          <p className="dev-request-id">
                            Request ID <code>{result.requestId}</code>
                          </p>
                          <pre className="portal-json">
                            {JSON.stringify(result.response, null, 2)}
                          </pre>
                          {result.status >= 400 && (
                            <p className="dev-muted">
                              Read <code>error.code</code> and correct the
                              request or access configuration. After a timeout,
                              reuse the same key and payload for idempotent
                              operations.
                            </p>
                          )}
                        </>
                      ) : (
                        <div className="dev-empty">
                          <Terminal size={25} />
                          <strong>No response yet</strong>
                          <p>
                            Run a sandbox request to see its actual HTTP status,
                            duration and response body.
                          </p>
                        </div>
                      )}
                    </section>
                  </div>
                </>
              ) : (
                <>
                  {op.requestBody && (
                    <section>
                      <h3>Request body</h3>
                      <Fields
                        schema={
                          op.requestBody.content?.["application/json"]?.schema
                        }
                        spec={spec}
                      />
                      <details>
                        <summary>
                          JSON body example · replace sample values
                        </summary>
                        <pre className="portal-json">
                          {JSON.stringify(
                            requestExample(op, spec).body,
                            null,
                            2,
                          )}
                        </pre>
                      </details>
                    </section>
                  )}
                  <section>
                    <div className="dev-section-heading">
                      <h3>Server-side integration</h3>
                      <div className="dev-code-controls">
                        <button
                          className="btn"
                          aria-pressed={language === "curl"}
                          onClick={() => {
                            setLanguage("curl");
                            setCopyStatus("");
                          }}
                        >
                          cURL
                        </button>
                        <button
                          className="btn"
                          aria-pressed={language === "javascript"}
                          onClick={() => {
                            setLanguage("javascript");
                            setCopyStatus("");
                          }}
                        >
                          JavaScript
                        </button>
                        <button className="btn" onClick={() => void copy()}>
                          <Copy size={14} />
                          Copy integration example
                        </button>
                      </div>
                    </div>
                    <pre className="portal-json">{code}</pre>
                    <p role="status" className="dev-copy-status">
                      {copyStatus}
                    </p>
                  </section>
                  <section>
                    <h3>
                      Response example{" "}
                      {success
                        ? `· HTTP ${success[0]}`
                        : "· unavailable capability"}
                    </h3>
                    <p className="dev-muted">
                      Illustrative values generated from the contract. This is
                      not a live booking response. Monetary amounts are integer
                      INR paise.
                    </p>
                    <pre className="portal-json">
                      {JSON.stringify(
                        schemaExample(
                          successSchema ||
                            op.responses?.["501"]?.content?.["application/json"]
                              ?.schema,
                          spec,
                        ) || {},
                        null,
                        2,
                      )}
                    </pre>
                  </section>
                  <details className="dev-details">
                    <summary>HTTP responses &amp; errors</summary>
                    <div className="dev-table-wrap">
                      <table className="dev-table">
                        <thead>
                          <tr>
                            <th>Status</th>
                            <th>Meaning</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(op.responses || {}).map(
                            ([code, r]: any) => (
                              <tr key={code}>
                                <td>
                                  <code>{code}</code>
                                </td>
                                <td>{r.description}</td>
                              </tr>
                            ),
                          )}
                        </tbody>
                      </table>
                    </div>
                    <p>
                      Use <code>error.code</code> and the returned request ID
                      when contacting support. Never infer booking or payment
                      success after a timeout.
                    </p>
                  </details>
                </>
              )}
              <details className="dev-details">
                <summary>
                  <BookOpen size={15} /> Full OpenAPI operation
                </summary>
                <pre className="portal-json">{JSON.stringify(op, null, 2)}</pre>
              </details>
            </div>
          </Panel>
          {!playground && (
            <Panel title="Integration checklist">
              <div className="portal-pad dev-checklist">
                <p>
                  <strong>1. Authenticate on your backend.</strong> Exchange a
                  sandbox credential at <code>/auth/token</code>. Tokens expire
                  after 45 minutes.
                </p>
                <p>
                  <strong>2. Use authorized references.</strong> Search cities
                  and dated trips, inspect seats, create a hold, then recheck
                  the hold-bound fare before booking.
                </p>
                <p>
                  <strong>3. Retry safely.</strong> Where required, send a
                  unique <code>Idempotency-Key</code>. Reuse the identical
                  payload and key after an uncertain response.
                </p>
                <p>
                  <strong>4. Keep lifecycle states distinct.</strong> A pending
                  booking is not a confirmed ticket. A cancellation request is
                  not a completed refund. Wallet and rescheduling are
                  unavailable.
                </p>
                <button
                  className="btn"
                  onClick={() => {
                    const blob = new Blob([JSON.stringify(spec, null, 2)], {
                      type: "application/json",
                    });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "aibus-public-api-v1-sandbox.json";
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  }}
                >
                  <Download size={15} />
                  Download OpenAPI JSON
                </button>
              </div>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
export function DeveloperWorkspace({ playground }: { playground: boolean }) {
  if (import.meta.env.DEV && !playground) {
    return (
      <Panel title="Car CRS provider documentation">
        <div className="portal-pad">
          <p>Search car trips, quote fares, hold seats, and manage one-way or round-trip bookings.</p>
          <a href="http://127.0.0.1:4010/api/v1/car/docs/">Open local car API Swagger</a>
        </div>
      </Panel>
    );
  }
  return (
    <Load path="/partner/documentation">
      {(spec) => (
        <Explorer
          key={String(playground)}
          spec={spec}
          playground={playground}
        />
      )}
    </Load>
  );
}
