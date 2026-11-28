import { useEffect, useState } from "react";
import { ArrowUpRight, Plus, RefreshCw } from "lucide-react";
import { api } from "../../api/client";
import { Panel } from "../../components";
import { OwnerAccountForm, type Owner } from "./OwnerAccountForm";

const portalUrl = ["localhost", "127.0.0.1"].includes(window.location.hostname)
  ? "http://127.0.0.1:5177/"
  : "https://owner.bookmybus.pro/";

export function VehicleOwnersPage({
  onOpenVehicles,
}: {
  onOpenVehicles: () => void;
}) {
  const [owners, setOwners] = useState<Owner[]>([]);
  const [editor, setEditor] = useState<{ owner?: Owner } | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<Owner>();

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<Owner[]>("/operator/vehicle-owners", { signal: controller.signal })
      .then(({ data }) => {
        if (!controller.signal.aborted) setOwners(data);
      })
      .catch((issue: Error) => {
        if (!controller.signal.aborted) setError(issue.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision]);

  return (
    <Panel
      title="Vehicle owner accounts"
      aside={
        <div className="heading-actions">
          <button
            className="btn secondary"
            disabled={loading}
            onClick={() => setRevision((value) => value + 1)}
          >
            <RefreshCw size={16} /> Refresh
          </button>
          <button className="btn primary" onClick={() => setEditor({})}>
            <Plus size={16} /> Create owner
          </button>
        </div>
      }
    >
      <div className="car-editor-body">
        <div className="heading-actions">
          <a
            className="btn secondary"
            href={portalUrl}
            target="_blank"
            rel="noreferrer"
          >
            Owner sign-in <ArrowUpRight size={16} />
          </a>
          <button className="text-btn" onClick={onOpenVehicles}>
            Go to Vehicles to assign an owner
          </button>
        </div>
        {created && (
          <p role="status">
            Login created for <strong>{created.loginEmail}</strong>. Share the
            owner sign-in link and initial password privately.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {loading && <p role="status">Loading owners…</p>}
        {owners.length > 0 ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Owner</th>
                  <th scope="col">Login email</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {owners.map((owner) => (
                  <tr key={owner.id}>
                    <td>{owner.name}</td>
                    <td>{owner.loginEmail ?? "Login pending"}</td>
                    <td>
                      {owner.loginEmail ? (
                        "Login created"
                      ) : (
                        <button
                          className="btn secondary"
                          aria-label={`Create login for ${owner.name}`}
                          onClick={() => setEditor({ owner })}
                        >
                          Create login
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !loading && !error && <p>No vehicle owners yet.</p>
        )}
      </div>
      {editor && (
        <OwnerAccountForm
          owner={editor.owner}
          onClose={() => setEditor(null)}
          onCreated={(owner) => {
            setCreated(owner);
            setEditor(null);
            setRevision((value) => value + 1);
          }}
        />
      )}
    </Panel>
  );
}
