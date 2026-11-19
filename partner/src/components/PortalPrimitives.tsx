import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api/client";
import { Overlay } from "../../../admin/src/components/ui/Overlay";
export function Load({
  path,
  children,
  revision = 0,
}: {
  path: string;
  children: (data: any) => ReactNode;
  revision?: number;
}) {
  const [data, setData] = useState<any>(),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setData(undefined);
    setError("");
    void api(path, { signal: abort.signal })
      .then((r) => {
        if (!abort.signal.aborted) setData(r.data);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [path, revision, retry]);
  return error ? (
    <div role="alert" className="portal-pad">
      {error}
      <button className="btn" onClick={() => setRetry((v) => v + 1)}>
        Retry
      </button>
    </div>
  ) : data === undefined ? (
    <p role="status" className="portal-pad">
      Loading workspace…
    </p>
  ) : (
    <>{children(data)}</>
  );
}
export function Facts({ data }: { data: Record<string, any> }) {
  return (
    <dl className="portal-facts">
      {Object.entries(data).map(([k, v]) => (
        <div key={k}>
          <dt>{k.replace(/([A-Z])/g, " $1")}</dt>
          <dd>
            {typeof v === "object" ? JSON.stringify(v) : String(v ?? "—")}
          </dd>
        </div>
      ))}
    </dl>
  );
}
export function OneTimeSecret({
  value,
  onClose,
}: {
  value: string;
  onClose: () => void;
}) {
  const [visible, setVisible] = useState(false),
    [copied, setCopied] = useState("");
  return (
    <Overlay title="Save your new sandbox secret" onClose={onClose}>
      <div className="dialog-body portal-secret">
        <p>
          This secret is shown once. Save it in your server’s secret manager.
          Closing this window clears it from this page.
        </p>
        <code aria-label="New secret">{visible ? value : "•".repeat(48)}</code>
        <div className="portal-actions">
          <button className="btn" onClick={() => setVisible(!visible)}>
            {visible ? "Hide secret" : "Show secret"}
          </button>
          <button
            className="btn"
            onClick={() =>
              void navigator.clipboard
                .writeText(value)
                .then(() => setCopied("Copied to clipboard"))
                .catch(() =>
                  setCopied("Copy unavailable. Reveal and save the secret."),
                )
            }
          >
            Copy secret
          </button>
          <button className="btn primary" onClick={onClose}>
            I have saved it
          </button>
        </div>
        <p role="status">{copied}</p>
      </div>
    </Overlay>
  );
}
