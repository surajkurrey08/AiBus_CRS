import { useEffect, useRef, useState } from "react";
import { api, type Identity } from "../../api/client";
import { PlatformTable } from "../../components/platform/PlatformTable";
import { Panel } from "../../components/ui/Panel";
import { FinanceReviewForm } from "../finance/FinanceReviewForm";

type Batch = {
  id: string;
  source: string;
  counts: Record<string, number>;
  total: number;
  cursor: number;
  inserted: number;
  skipped: number;
  status: string;
  rows?: {
    row: number;
    name?: string;
    state?: string;
    status: string;
    reason?: string;
  }[];
};
export function CityCatalog({ user }: { user: Identity }) {
  const writable = user.permissions.includes("platform:settings:write");
  const [batch, setBatch] = useState<Batch | null>(null),
    [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0),
    [dialog, setDialog] = useState<"add" | "import" | null>(null);
  const lock = useRef(false),
    upload = useRef<HTMLInputElement>(null);
  const resumeInput = useRef<HTMLInputElement>(null);
  const loadSequence = useRef(0);
  const [resumeId, setResumeId] = useState("");
  const load = async (id: string, p = 1) => {
    const sequence = ++loadSequence.current;
    const response = await api<Batch>(
      `/platform/city-catalog/imports/${encodeURIComponent(id)}?page=${p}&limit=25`,
    );
    if (sequence !== loadSequence.current) return;
    setBatch(response.data);
    setPage(p);
  };
  useEffect(() => {
    if (!busy) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [busy]);
  const preview = async (file: File) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (file.size > 5 * 1024 * 1024)
        throw new Error("Choose a JSON file smaller than 5 MB.");
      const parsed = JSON.parse((await file.text()).replace(/^\uFEFF/, ""));
      const rows = Array.isArray(parsed) ? parsed : parsed.data;
      if (!Array.isArray(rows) || !rows.length || rows.length > 50000)
        throw new Error(
          "Expected an array or a data array with 1–50,000 city records.",
        );
      const result = await api<Batch>(
        "/platform/city-catalog/imports/preview",
        {
          method: "POST",
          body: JSON.stringify({ source: file.name.slice(0, 120), rows }),
        },
      );
      await load(result.data.id);
      setResumeId(result.data.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
      if (upload.current) upload.current.value = "";
    }
  };
  return (
    <div className="platform-section">
      <Panel
        title="Central City Master"
        aside={
          writable ? (
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => setDialog("add")}
            >
              Add city
            </button>
          ) : undefined
        }
      >
        <div className="panel-body">
          <p>
            Manage AIBUS city names, permanent IDs and unique keys. Operators
            can select these cities when setting up their service areas.
          </p>
          <p className="platform-scope-note">
            Importing cities does not create routes or buses. Partner APIs
            continue to show only authorized trip inventory.
          </p>
          {writable && (
            <>
              <label>
                Import city JSON
                <input
                  ref={upload}
                  type="file"
                  accept=".json,.txt,application/json,text/plain"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void preview(file);
                  }}
                />
              </label>
              <p className="platform-scope-note">
                Upload the provider response with CityId, City and State. Review
                the complete file before importing; source IDs are retained as
                evidence and never become AIBUS IDs.
              </p>
              <form
                noValidate
                className="platform-filters-v5"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (lock.current || busy) return;
                  if (!/^[a-f0-9]{24}$/.test(resumeId)) {
                    setError(
                      "Enter the complete 24-character import ID from your preview.",
                    );
                    resumeInput.current?.focus();
                    return;
                  }
                  lock.current = true;
                  setBusy(true);
                  setError("");
                  void load(resumeId)
                    .catch((e) => setError(e.message))
                    .finally(() => {
                      lock.current = false;
                      setBusy(false);
                    });
                }}
              >
                <label>
                  Resume import ID
                  <input
                    ref={resumeInput}
                    value={resumeId}
                    onChange={(e) => setResumeId(e.target.value)}
                  />
                </label>
                <button className="btn" disabled={busy}>
                  Load preview
                </button>
              </form>
            </>
          )}
          {busy && (
            <p role="status">Processing city records… Keep this page open.</p>
          )}
          {error && <p role="alert">{error}</p>}
          {notice && <p role="status">{notice}</p>}
        </div>
      </Panel>
      {batch && (
        <Panel
          title="Import review"
          aside={
            <button
              className="btn primary"
              disabled={
                busy || !batch.counts.ready || batch.status === "Complete"
              }
              onClick={() => setDialog("import")}
            >
              Review and import valid cities
            </button>
          }
        >
          <div className="panel-body">
            <p>
              {batch.source} · Import ID: <code>{batch.id}</code>
            </p>
            <div className="platform-kpis">
              {Object.entries(batch.counts).map(([label, count]) => (
                <div key={label}>
                  <span>
                    {{
                      ready: "Ready to import",
                      conflict: "Needs review",
                      invalid: "Invalid records",
                      duplicate: "Duplicate rows",
                      existing: "Already in catalog",
                    }[label] || label}
                  </span>
                  <strong>{count}</strong>
                </div>
              ))}
            </div>
            <p>
              Processed {batch.cursor} / {batch.total} · Added {batch.inserted}{" "}
              · Skipped {batch.skipped} · {batch.status}
            </p>
            <p className="platform-scope-note">
              Conflicting and incomplete rows are excluded. Correct them in a
              separate file and preview again. Existing cities are never
              overwritten.
            </p>
            <div className="table-wrap">
              <table>
                <caption>Preview records — page {page}</caption>
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>City</th>
                    <th>State</th>
                    <th>Result</th>
                    <th>Review note</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.rows?.map((r) => (
                    <tr key={r.row}>
                      <td>{r.row}</td>
                      <td>{r.name || "—"}</td>
                      <td>{r.state || "—"}</td>
                      <td>{r.status}</td>
                      <td>{r.reason || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              className="btn"
              disabled={busy || page <= 1}
              onClick={() => {
                setError("");
                void load(batch.id, page - 1).catch((e) => setError(e.message));
              }}
            >
              Previous preview page
            </button>
            <button
              className="btn"
              disabled={busy || page * 25 >= batch.total}
              onClick={() => {
                setError("");
                void load(batch.id, page + 1).catch((e) => setError(e.message));
              }}
            >
              Next preview page
            </button>
          </div>
        </Panel>
      )}
      <PlatformTable
        title="City catalog"
        path="/platform/city-catalog"
        dates={false}
        exportable={false}
        revision={revision}
        columns={[
          ["cityId", "City ID"],
          ["name", "City"],
          ["state", "State"],
          ["key", "City key"],
          ["status", "Status"],
        ]}
      />
      {dialog && (
        <FinanceReviewForm
          intent="platform"
          title={
            dialog === "add" ? "Add catalog city" : "Import valid city records"
          }
          accountEmail={user.email}
          description={
            dialog === "add"
              ? "A permanent AIBUS ID and unique city key will be generated. Existing records remain unchanged."
              : `Import only eligible records from ${batch?.source}. Conflicts and invalid records will be skipped. Save the import ID to resume after an interruption.`
          }
          fields={[
            ...(dialog === "add"
              ? [
                  { name: "name", label: "City name" },
                  { name: "state", label: "State" },
                ]
              : []),
            { name: "reason", label: "Business reason" },
            {
              name: "password",
              label: "Your current password",
              type: "password" as const,
            },
          ]}
          onClose={() => setDialog(null)}
          onSave={async (values) => {
            if (lock.current) return;
            lock.current = true;
            setBusy(true);
            setError("");
            try {
              if (dialog === "add") {
                await api("/platform/city-catalog", {
                  method: "POST",
                  body: JSON.stringify({ ...values, country: "India" }),
                });
                setNotice("City saved to the central catalog.");
              } else if (batch) {
                let progress = batch;
                while (progress.status !== "Complete") {
                  const result = await api<Batch>(
                    `/platform/city-catalog/imports/${batch.id}/commit`,
                    {
                      method: "POST",
                      body: JSON.stringify({
                        cursor: progress.cursor,
                        reason: values.reason,
                        password: values.password,
                      }),
                    },
                  );
                  progress = result.data;
                  setBatch(progress);
                }
                await load(batch.id);
                setNotice(
                  `Import complete: ${progress.inserted} cities added; ${progress.skipped} records skipped.`,
                );
              }
              setRevision((v) => v + 1);
              setDialog(null);
            } finally {
              lock.current = false;
              setBusy(false);
              setRevision((v) => v + 1);
            }
          }}
        />
      )}
    </div>
  );
}
