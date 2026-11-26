import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { Panel } from "../../components/index";
import { CarBlueprint } from "../../components/seats/CarBlueprint";
import { MiniBusCabin } from "../../components/seats/MiniBusCabin";
import { useWorkspace } from "../../context/WorkspaceContext";
import type { CarRecord } from "../car-master/CarMaster";
import "./vehicle-layout.css";

type LayoutSeat = { number: string; row: number; column: number };
type Vehicle = CarRecord & { seatLayout?: LayoutSeat[] };
type SavedLayout = { _id: string; name: string; vehicleType: string; createdAt: string; seats: LayoutSeat[] };
const savedDate = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Kolkata" });

export function VehicleLayoutEditor() {
  const ws = useWorkspace();
  const canWrite = ws.user.permissions.includes("fleet:write");
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [templateType, setTemplateType] = useState("Car");
  const [templateCapacity, setTemplateCapacity] = useState(4);
  const [vehicleId, setVehicleId] = useState("");
  const [seats, setSeats] = useState<LayoutSeat[]>([]);
  const [columns, setColumns] = useState(4);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [templates, setTemplates] = useState<SavedLayout[]>([]);
  const [templateError, setTemplateError] = useState("");
  const [templatesLoading, setTemplatesLoading] = useState(!ws.demo);
  const [deleteTarget, setDeleteTarget] = useState<SavedLayout | null>(null);
  const [deleting, setDeleting] = useState(false);
  const vehicle = vehicles.find((item) => (item._id || item.id) === vehicleId);
  const category = vehicle?.vehicleCategory;
  const vehicleType = vehicle ? (category === "Bus" || category === "Mini Bus" ? category : "Car") : templateType;
  const isCar = vehicleType === "Car";
  const previewColumns = Math.max(isCar ? 3 : 1, ...seats.map((seat) => seat.column + 1));
  const previewRows = Math.max(1, ...seats.map((seat) => seat.row + 1));

  useEffect(() => {
    const controller = new AbortController();
    if (ws.demo) {
      setLoading(false);
      return;
    }
    api<Vehicle[]>("/operator/cars?limit=100", { signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setVehicles(data); })
      .catch((reason: Error) => { if (!controller.signal.aborted) setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [ws.demo]);

  useEffect(() => {
    if (ws.demo) return;
    const controller = new AbortController();
    async function loadTemplates() {
      try {
        const options = { signal: controller.signal };
        const first = await api<SavedLayout[]>("/operator/vehicle-layouts?limit=100", options);
        const remaining = await Promise.all(Array.from({ length: (first.meta?.pages ?? 1) - 1 }, (_, index) =>
          api<SavedLayout[]>(`/operator/vehicle-layouts?limit=100&page=${index + 2}`, options)));
        if (!controller.signal.aborted) setTemplates([...first.data, ...remaining.flatMap(({ data }) => data)]);
      } catch (reason) {
        if (!controller.signal.aborted) setTemplateError((reason as Error).message);
      } finally {
        if (!controller.signal.aborted) setTemplatesLoading(false);
      }
    }
    void loadTemplates();
    return () => controller.abort();
  }, [ws.demo]);

  async function deleteTemplate() {
    if (!deleteTarget || deleting || !canWrite) return;
    setDeleting(true);
    setTemplateError("");
    try {
      await api(`/operator/vehicle-layouts/${deleteTarget._id}`, { method: "DELETE" });
      setTemplates((items) => items.filter((item) => item._id !== deleteTarget._id));
      setDeleteTarget(null);
    } catch (reason) {
      setTemplateError((reason as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  function generate(capacity: number) {
    const rearColumns = isCar ? 3 : columns;
    setSeats([
      { number: "D", row: 0, column: rearColumns - 1 },
      ...Array.from({ length: capacity }, (_, index) => {
        const number = `CS-${index + 1}`;
        if (isCar && index === 0) return { number, row: 0, column: 0 };
        const rearIndex = isCar ? index - 1 : index;
        const row = 1 + Math.floor(rearIndex / rearColumns);
        const column = isCar && capacity === 6 && index === 5 ? 2 : rearIndex % rearColumns;
        return { number, row, column };
      }),
    ]);
    setNotice("");
  }

  async function save(asTemplate = !vehicle) {
    if (saving || !canWrite || (asTemplate && (templatesLoading || !templateName.trim()))) return;
    setNotice("");
    setError("");
    if (new Set(seats.map((seat) => seat.row + ":" + seat.column)).size !== seats.length) {
      setError("Two seats share a position. Give each seat its own row and column.");
      return;
    }
    setSaving(true);
    try {
      if (asTemplate) {
        const { data } = await api<SavedLayout>("/operator/vehicle-layouts", { method: "POST", body: JSON.stringify({ name: templateName, vehicleType, seats }) });
        setTemplates((items) => [data, ...items]);
        setTemplateName("");
        setNotice("Template saved. You can select it in Add Vehicle.");
        return;
      }
      const { data } = await api<Vehicle>("/operator/cars/" + vehicleId + "/layout", {
        method: "PUT", body: JSON.stringify({ seats }),
      });
      setVehicles((items) => items.map((item) => item === vehicle ? data : item));
      setNotice("Layout saved. New trips will use these seat positions.");
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return <>
  <Panel title="Seat Layout Designer">
    <div className="vehicle-layout-editor vehicle-layout-workspace">
      <div className="vehicle-layout-setup">
      <label>Layout destination
        <select value={vehicleId} disabled={saving || loading} onChange={(event) => {
          const id = event.target.value;
          setVehicleId(id);
          const selected = vehicles.find((item) => (item._id || item.id) === id);
          setSeats(selected?.seatLayout ?? []);
          setNotice("");
          setError("");
        }}>
          <option value="">{loading ? "Loading vehicles..." : "Create a reusable template"}</option>
          {vehicles.map((item) => <option key={item._id || item.id} value={item._id || item.id}>
            {item.registrationNumber} · {item.vehicleCategory} · {item.bookablePassengerCapacity} passengers
          </option>)}
        </select>
      </label>
      {error && <p role="alert" className="error">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {canWrite && <div className="vehicle-layout-controls">
        <label>Template name<input value={templateName} maxLength={80} disabled={saving} onChange={(event) => setTemplateName(event.target.value)} /></label>
        {!vehicle && <><label>Vehicle type<select value={templateType} disabled={saving} onChange={(event) => { setTemplateType(event.target.value); setSeats([]); }}>
          {["Car", "Mini Bus", "Bus"].map((type) => <option key={type}>{type}</option>)}
        </select></label>
        <label>Passenger capacity<input type="number" min={1} max={100} value={templateCapacity} disabled={saving} onChange={(event) => { setTemplateCapacity(Number(event.target.value)); setSeats([]); }} /></label></>}
      </div>}
      {(vehicle || canWrite) && <>
        {vehicle && <p>{vehicle.bookablePassengerCapacity} passenger seats and one locked driver seat.</p>}
        {canWrite && <div className="vehicle-layout-controls">
          {!isCar && <label>Seats per row
            <select value={columns} disabled={saving} onChange={(event) => setColumns(Number(event.target.value))}>
              {[1, 2, 3, 4, 5, 6].map((count) => <option key={count}>{count}</option>)}
            </select>
          </label>}
          <button className="btn secondary" disabled={saving || (!vehicle && (!Number.isInteger(templateCapacity) || templateCapacity < 1 || templateCapacity > 100))} onClick={() => generate(vehicle?.bookablePassengerCapacity ?? templateCapacity)}>Generate layout</button>
          <button className="btn primary" disabled={saving || !seats.length || (!vehicle && (templatesLoading || !templateName.trim()))} onClick={() => void save()}>{vehicle ? "Save layout" : "Save template"}</button>
          {vehicle && <button className="btn secondary" disabled={saving || templatesLoading || !seats.length || !templateName.trim()} onClick={() => void save(true)}>Save as template</button>}
        </div>}
      </>}
      </div>
        {seats.length > 0 && <section className="vehicle-layout-preview-pane" aria-label="Layout preview panel">
        {vehicleType === "Mini Bus" ? <div className="mini-bus-designer-preview">
          <MiniBusCabin columns={previewColumns}>
            {seats.map((seat) => <span key={seat.number} className={`mini-bus-preview-seat${seat.number === "D" ? " driver-position" : ""}`}
              style={{ gridRow: seat.row + 1, gridColumn: seat.column + 1 }}>
              {seat.number === "D" ? "Driver" : seat.number.replace(/^CS-/, "")}
            </span>)}
          </MiniBusCabin>
        </div> : <div className={isCar ? "vehicle-layout-preview-car" : undefined} role="group" aria-label="Seat layout preview">
          {isCar && <CarBlueprint isMuv={previewRows > 2} />}
          <div className="vehicle-layout-preview" style={{ gridTemplateColumns: `repeat(${previewColumns}, minmax(0, 1fr))`, gridTemplateRows: isCar ? `repeat(${previewRows}, minmax(32px, 1fr))` : undefined }}>
          {[...seats].sort((a, b) => a.row - b.row || a.column - b.column).map((seat) => (
            <span key={seat.number} className={seat.number === "D" ? "driver-position" : ""}
              style={{ gridRow: seat.row + 1, gridColumn: seat.column + 1 }}>
              {seat.number === "D" ? "Driver" : seat.number.slice(3)}
            </span>
          ))}
          </div>
        </div>}
        </section>}
        {seats.length > 0 && <div className="vehicle-layout-seats">
          {seats.map((seat, index) => <div key={seat.number}>
            <strong>{seat.number === "D" ? "Driver · locked" : seat.number.replace(/^CS-/, "Seat ")}</strong>
            {(["row", "column"] as const).map((field) => <label key={field}>{field === "row" ? "Row" : "Column"}
              <input type="number" min={1} max={field === "row" ? 101 : 6} value={seat[field] + 1}
                disabled={!canWrite || saving} onChange={(event) => {
                  const position = event.target.valueAsNumber;
                  if (Number.isInteger(position) && position >= 1 && position <= (field === "row" ? 101 : 6))
                    setSeats((items) => items.map((item, i) => i === index ? { ...item, [field]: position - 1 } : item));
                }} />
            </label>)}
          </div>)}
        </div>}
    </div>
  </Panel>
  <details className="saved-layouts-panel">
    <summary>Saved seat layouts ({templates.length})</summary>
    <div className="vehicle-layout-editor">
      {templateError && <p role="alert" className="error">{templateError}</p>}
      {templatesLoading && <p role="status">Loading saved layouts…</p>}
      {!templatesLoading && !templateError && templates.length === 0 && <p>No saved layouts yet.</p>}
      {templates.map((item) => <div className="saved-layout-row" key={item._id}>
        <div><strong>{item.name}</strong><small>{item.vehicleType} · {item.seats.length - 1} passengers · {savedDate.format(new Date(item.createdAt))} IST · {item._id.slice(-6)}</small></div>
        {canWrite && <button type="button" className="btn secondary" disabled={deleting || templatesLoading} onClick={() => setDeleteTarget(item)}>Delete</button>}
      </div>)}
      {deleteTarget && <div className="saved-layout-confirm" role="group" aria-label="Confirm template deletion">
        <p>Delete <strong>{deleteTarget.name}</strong> ({deleteTarget._id.slice(-6)}) from Add Vehicle? Vehicles already using this layout keep their seats.</p>
        <button type="button" className="btn secondary" disabled={deleting} onClick={() => setDeleteTarget(null)}>Cancel</button>
        <button type="button" className="btn primary" disabled={deleting} onClick={() => void deleteTemplate()}>{deleting ? "Deleting…" : "Delete template"}</button>
      </div>}
    </div>
  </details>
  </>;
}
