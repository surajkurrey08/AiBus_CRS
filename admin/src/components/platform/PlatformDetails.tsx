import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { Overlay } from "../ui/Overlay";
import { valueLabel } from "./PlatformTable";
const label = (key: string) => {
  const text = key
    .replace(/([A-Z])/g, " $1")
    .replaceAll("_", " ")
    .toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
};
export function Evidence({ data }: { data: any }) {
  if (!data || typeof data !== "object")
    return <p>{String(data ?? "Not recorded")}</p>;
  return (
    <dl className="platform-evidence">
      {Object.entries(data)
        .filter(([key]) => !["_id", "__v", "salesRevision"].includes(key))
        .map(([key, value]) => (
          <div key={key}>
            <dt>{label(key)}</dt>
            <dd>
              {Array.isArray(value) ? (
                value.length ? (
                  value.map((v, i) => (
                    <div className="platform-evidence-item" key={i}>
                      {typeof v === "object" && v !== null ? (
                        <Evidence data={v} />
                      ) : (
                        String(v)
                      )}
                    </div>
                  ))
                ) : (
                  "No records"
                )
              ) : value && typeof value === "object" ? (
                <Evidence data={value} />
              ) : (
                valueLabel(value, key)
              )}
            </dd>
          </div>
        ))}
    </dl>
  );
}
export function PlatformDetails({
  title,
  path,
  onClose,
  actions,
  revision = 0,
}: {
  title: string;
  path: string;
  onClose: () => void;
  actions?: (data: any) => React.ReactNode;
  revision?: number;
}) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setData(null);
    setError("");
    void api(path, { signal: abort.signal })
      .then((r) => {
        if (!abort.signal.aborted) setData(r.data);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [path, retry, revision]);
  return (
    <Overlay title={title} onClose={onClose} drawer>
      <div className="dialog-body">
        {error ? (
          <div role="alert">
            {error}
            <button className="btn" onClick={() => setRetry((v) => v + 1)}>
              Retry details
            </button>
          </div>
        ) : !data ? (
          <p role="status">Loading authorized details…</p>
        ) : (
          <>
            {actions?.(data)}
            <Evidence data={data} />
          </>
        )}
      </div>
    </Overlay>
  );
}
