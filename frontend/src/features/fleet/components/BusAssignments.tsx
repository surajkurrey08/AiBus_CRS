import { LayoutEditor } from "../SeatLayoutEditor";
import { useState } from "react";
import { api } from "../../../api/client";
import { Overlay } from "../../../components/ui/Overlay";
export function BusAssignments({
  bus,
  owners,
  coaches,
  charts,
  onClose,
  onSaved,
}: {
  bus: Record<string, any>;
  owners: Record<string, any>[];
  coaches: Record<string, any>[];
  charts: Record<string, any>[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [ownerId, setOwnerId] = useState(bus.ownerId || "");
  const [coachTypeId, setCoachTypeId] = useState(bus.coachTypeId || "");
  const [templateId, setTemplateId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  return (
    <Overlay
      title={`Configure ${bus.registration}`}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="fleet-message">
        {bus.name} ? {bus.type} ? {bus.capacity} seats
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            await api(`/operator/bus-master/buses/${bus._id}/assignments`, {
              method: "PATCH",
              body: JSON.stringify({
                ownerId: ownerId || null,
                coachTypeId: coachTypeId || null,
              }),
            });
            setNotice("Owner and coach saved.");
            onSaved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <label>
            Owner / proprietor
            <select
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
            >
              <option value="">Not assigned</option>
              {owners
                .filter(
                  (row) => row.status === "Active" || row._id === bus.ownerId,
                )
                .map((row) => (
                  <option key={row._id} value={row._id}>
                    {row.name}
                    {row.status !== "Active" ? " (Inactive)" : ""}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Coach type
            <select
              value={coachTypeId}
              onChange={(e) => setCoachTypeId(e.target.value)}
            >
              <option value="">Not assigned</option>
              {coaches
                .filter(
                  (row) =>
                    row.status === "Active" || row._id === bus.coachTypeId,
                )
                .map((row) => (
                  <option key={row._id} value={row._id}>
                    {row.name} · {row.type}
                  </option>
                ))}
            </select>
          </label>
          <button className="btn primary" disabled={busy}>
            Save owner and coach
          </button>
        </div>
      </form>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || !templateId) return;
          setBusy(true);
          setError("");
          try {
            await api(`/operator/bus-master/buses/${bus._id}/chart`, {
              method: "POST",
              body: JSON.stringify({ templateId }),
            });
            setNotice("Seat chart applied. New trips will use this layout.");
            onSaved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <label className="fleet-full-width">
            Apply seat chart ({bus.capacity} seats)
            <select
              required
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              <option value="">Select a matching chart</option>
              {charts
                .filter(
                  (chart) =>
                    chart.status === "Active" &&
                    chart.seats.length === bus.capacity,
                )
                .map((chart) => (
                  <option value={chart._id} key={chart._id}>
                    {chart.name}
                  </option>
                ))}
            </select>
          </label>
          <p className="muted fleet-full-width">
            Applying a chart updates the bus layout used for new trips. Existing
            trips retain their saved seat positions and prices.
          </p>
          <button className="btn" disabled={busy || !templateId}>
            Apply chart
          </button>
        </div>
      </form>
      <div className="fleet-message">
        <LayoutEditor
          busId={String(bus._id)}
          busRecord={bus}
          onSaved={onSaved}
        />
      </div>
      {notice && (
        <p className="fleet-message" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="error fleet-message" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-foot">
        <button className="btn" disabled={busy} onClick={onClose}>
          Done
        </button>
      </div>
    </Overlay>
  );
}
