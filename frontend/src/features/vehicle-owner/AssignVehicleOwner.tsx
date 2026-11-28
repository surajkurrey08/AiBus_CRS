import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { Overlay } from "../../components";
import { OwnerAccountForm, type Owner } from "./OwnerAccountForm";

export function AssignVehicleOwner({
  vehicleId,
  registration,
  currentOwner,
  onClose,
  onSaved,
}: {
  vehicleId: string;
  registration: string;
  currentOwner?: string | null;
  onClose: () => void;
  onSaved: (ownerId: string | null) => void;
}) {
  const [owners, setOwners] = useState<Owner[]>([]);
  const [selected, setSelected] = useState(currentOwner ?? "");
  const [editor, setEditor] = useState<{ owner?: Owner } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const activeOwner = owners.find((owner) => owner.id === selected);

  useEffect(() => {
    const controller = new AbortController();
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
  }, []);

  if (editor)
    return (
      <OwnerAccountForm
        owner={editor.owner}
        onClose={() => setEditor(null)}
        onCreated={(owner) => {
          setOwners((list) => [
            ...list.filter((item) => item.id !== owner.id),
            owner,
          ]);
          setSelected(owner.id);
          setNotice(
            "Owner login created. Save assignment to link this vehicle.",
          );
          setEditor(null);
        }}
      />
    );

  return (
    <Overlay
      title="Assign vehicle owner"
      onClose={() => {
        if (!busy) onClose();
      }}
      className="car-editor-dialog"
    >
      <form
        className="car-editor-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            const ownerId = selected || null;
            await api("/operator/cars/" + vehicleId + "/owner", {
              method: "PATCH",
              body: JSON.stringify({
                ownerId,
                expectedOwnerId: currentOwner ?? null,
              }),
            });
            onSaved(ownerId);
          } catch (issue) {
            setError((issue as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="car-editor-body">
          <p className="car-editor-intro">
            {registration}. New trips will be attributed to the assigned owner.
          </p>
          <label>
            Vehicle owner
            <select
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
              disabled={loading || busy}
            >
              <option value="">Unassigned</option>
              {selected && !activeOwner && (
                <option value={selected}>Current owner</option>
              )}
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.name}
                  {owner.loginEmail ? " (" + owner.loginEmail + ")" : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="heading-actions">
            <button
              type="button"
              className="btn secondary"
              disabled={loading || busy}
              onClick={() => setEditor({})}
            >
              New owner account
            </button>
            {activeOwner && !activeOwner.loginEmail && (
              <button
                type="button"
                className="btn secondary"
                disabled={busy}
                onClick={() => setEditor({ owner: activeOwner })}
              >
                Create login for selected owner
              </button>
            )}
          </div>
          {notice && <p role="status">{notice}</p>}
          {error && <p role="alert">{error}</p>}
        </div>
        <div className="car-editor-footer">
          <button
            className="btn secondary"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={busy || loading || selected === (currentOwner ?? "")}
          >
            Save assignment
          </button>
        </div>
      </form>
    </Overlay>
  );
}
