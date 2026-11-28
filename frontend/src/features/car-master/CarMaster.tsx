import React, { useEffect, useState } from "react";
import { Car, Plus, RefreshCw, CheckCircle2, AlertTriangle, ShieldCheck } from "lucide-react";
import { api } from "../../api/client";
import { DataTable, MiniStats, Overlay, Panel } from "../../components/index";
import { useWorkspace } from "../../context/WorkspaceContext";
import { AssignVehicleOwner } from "../vehicle-owner/AssignVehicleOwner";
import "./car-master.css";

export interface CarRecord {
  id?: string;
  _id?: string;
  ownerId?: string | null;
  registrationNumber: string;
  make: string;
  model: string;
  year: number;
  vehicleCategory: "4-Passenger Sedan" | "7-Passenger MUV" | "Custom Car" | "Mini Bus" | "Bus";
  totalPhysicalSeats: number;
  bookablePassengerCapacity: number;
  color?: string;
  status: "Active" | "Inactive" | "Maintenance";
  createdAt?: string;
}

const DEMO_CARS: CarRecord[] = [
  {
    _id: "car-001",
    registrationNumber: "DL-01-AB-1234",
    make: "Maruti Suzuki",
    model: "Dzire",
    year: 2023,
    vehicleCategory: "4-Passenger Sedan",
    totalPhysicalSeats: 5,
    bookablePassengerCapacity: 4,
    color: "Arctic White",
    status: "Active",
  },
  {
    _id: "car-002",
    registrationNumber: "MH-02-CD-5678",
    make: "Toyota",
    model: "Innova Crysta",
    year: 2024,
    vehicleCategory: "7-Passenger MUV",
    totalPhysicalSeats: 8,
    bookablePassengerCapacity: 7,
    color: "Silver Metallic",
    status: "Active",
  },
  {
    _id: "car-003",
    registrationNumber: "KA-03-EF-9012",
    make: "Hyundai",
    model: "Aura",
    year: 2023,
    vehicleCategory: "4-Passenger Sedan",
    totalPhysicalSeats: 5,
    bookablePassengerCapacity: 4,
    color: "Titan Grey",
    status: "Active",
  },
  {
    _id: "car-004",
    registrationNumber: "TS-09-GH-3456",
    make: "Maruti Suzuki",
    model: "Ertiga",
    year: 2024,
    vehicleCategory: "7-Passenger MUV",
    totalPhysicalSeats: 8,
    bookablePassengerCapacity: 7,
    color: "Magma Grey",
    status: "Active",
  },
];

export function CarMaster() {
  const ws = useWorkspace();
  const canWrite = ws.user.permissions.includes("fleet:write");
  const [ownerVehicle, setOwnerVehicle] = useState<CarRecord | null>(null);
  const [cars, setCars] = useState<CarRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"ALL" | "4-Passenger Sedan" | "7-Passenger MUV" | "Custom Car" | "Mini Bus" | "Bus">("ALL");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCar, setEditingCar] = useState<CarRecord | null>(null);
  const [formData, setFormData] = useState({
    registrationNumber: "",
    make: "",
    model: "",
    year: new Date().getFullYear(),
    vehicleCategory: "4-Passenger Sedan" as "4-Passenger Sedan" | "7-Passenger MUV" | "Custom Car" | "Mini Bus" | "Bus",
    color: "",
    status: "Active" as "Active" | "Inactive" | "Maintenance",
  });
  const [formError, setFormError] = useState("");
  const [layouts, setLayouts] = useState<{ _id: string; name: string; vehicleType: string; seats: unknown[] }[]>([]);
  const [layoutId, setLayoutId] = useState("");
  const selectedLayout = layouts.find((layout) => layout._id === layoutId);
  const category = formData.vehicleCategory;
  const vehicleType = category === "Bus" || category === "Mini Bus" ? category : "Car";
  const custom = ["Custom Car", "Mini Bus", "Bus"].includes(formData.vehicleCategory);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const loadCars = async () => {
    setLoading(true);
    setError("");
    if (ws.demo) {
      setCars(DEMO_CARS);
      setLoading(false);
      return;
    }
    try {
      const res = await api("/operator/cars?limit=100");
      setCars(res.data || []);
    } catch (e: any) {
      // Fallback to demo cars if endpoint not yet deployed
      setCars([]);
      setError(e.message || "Failed to load cars from backend");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCars();
  }, [ws.revision]);

  async function loadLayouts() {
    try {
      const first = await api<typeof layouts>("/operator/vehicle-layouts?limit=100");
      const remaining = await Promise.all(Array.from({ length: (first.meta?.pages ?? 1) - 1 }, (_, index) =>
        api<typeof layouts>(`/operator/vehicle-layouts?limit=100&page=${index + 2}`)));
      setLayouts([...first.data, ...remaining.flatMap(({ data }) => data)]);
    } catch (error) {
      setFormError((error as Error).message);
    }
  }

  const handleOpenAdd = () => {
    setEditingCar(null);
    setLayoutId("");
    if (!ws.demo) void loadLayouts();
    setFormData({
      registrationNumber: "",
      make: "",
      model: "",
      year: new Date().getFullYear(),
      vehicleCategory: "4-Passenger Sedan",
      color: "",
      status: "Active",
    });
    setFormError("");
    setDialogOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    // Validate registration
    const regPattern = /^[A-Z]{2}[ -]?[0-9]{1,2}[ -]?[A-Z]{1,3}[ -]?[0-9]{4}$/i;
    if (!regPattern.test(formData.registrationNumber.trim())) {
      setFormError("Enter a valid Indian vehicle registration (e.g. DL-01-AB-1234 or MH02CD5678).");
      return;
    }
    if (!formData.make.trim() || !formData.model.trim()) {
      setFormError("Make and Model are required.");
      return;
    }

    if (!editingCar && custom && !selectedLayout) {
      setFormError(`Select a saved ${vehicleType} layout.`);
      return;
    }
    const totalPhysicalSeats = selectedLayout?.seats.length ?? editingCar?.totalPhysicalSeats ?? (category === "4-Passenger Sedan" ? 5 : 8);
    const bookablePassengerCapacity = totalPhysicalSeats - 1;

    const payload = {
      ...formData,
      vehicleCategory: selectedLayout && vehicleType === "Car" &&
        bookablePassengerCapacity !== (category === "4-Passenger Sedan" ? 4 : 7) ? "Custom Car" as const : category,
      ...(selectedLayout ? { layoutTemplateId: selectedLayout._id } : {}),
      registrationNumber: formData.registrationNumber.trim().toUpperCase(),
      totalPhysicalSeats,
      bookablePassengerCapacity,
    };

    setSaving(true);
    try {
      if (ws.demo) {
        if (editingCar) {
          setCars((prev) =>
            prev.map((c) => (c._id === editingCar._id ? { ...c, ...payload } : c))
          );
          setNotice("Car updated in demo workspace");
        } else {
          setCars((prev) => [
            { _id: `car-${Date.now()}`, ...payload },
            ...prev,
          ]);
          setNotice("Car added to fleet");
        }
        setDialogOpen(false);
      } else {
        if (editingCar) {
          await api(`/operator/cars/${editingCar._id}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
          });
          setNotice("Car updated successfully");
        } else {
          await api("/operator/cars", {
            method: "POST",
            body: JSON.stringify(payload),
          });
          setNotice("Car created successfully");
        }
        setDialogOpen(false);
        loadCars();
      }
    } catch (err: any) {
      setFormError(err.message || "Failed to save car");
    } finally {
      setSaving(false);
    }
  };

  async function manageCar(car: CarRecord, remove = false) {
    const id = car._id || car.id;
    if (!id || saving) return;
    if (remove && !window.confirm("Permanently delete car " + car.registrationNumber + "?")) return;
    setSaving(true);
    setError("");
    const status = car.status === "Active" ? "Inactive" : "Active";
    try {
      if (ws.demo) setCars((rows) => remove ? rows.filter((item) => item !== car) : rows.map((item) => item === car ? { ...item, status } : item));
      else {
        await api("/operator/cars/" + id + (remove ? "" : "/status"), {
          method: remove ? "DELETE" : "PATCH",
          ...(remove ? {} : { body: JSON.stringify({ status }) }),
        });
        await loadCars();
      }
    } catch (error) {
      setError((error as Error).message);
    } finally { setSaving(false); }
  }

  const filteredCars = cars.filter(
    (c) => filter === "ALL" || (c.vehicleCategory || (c as any).category) === filter
  );

  const activeCount = cars.filter((c) => c.status === "Active").length;
  const sedanCount = cars.filter((c) => (c.vehicleCategory || (c as any).category) === "4-Passenger Sedan").length;
  const muvCount = cars.filter((c) => (c.vehicleCategory || (c as any).category) === "7-Passenger MUV").length;

  return (
    <div className="car-master-page">
      <MiniStats
        items={[
          [String(cars.length), "Total Vehicles"],
          [String(activeCount), "Active Vehicles"],
          [String(sedanCount), "4-Passenger Sedans (5 Physical Seats)"],
          [String(muvCount), "7-Passenger MUVs (8 Physical Seats)"],
        ]}
      />

      <Panel
        title="Vehicle Fleet"
        aside={
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <button className="text-btn" onClick={loadCars} disabled={loading}>
              <RefreshCw size={14} />
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            {canWrite && (
              <button className="btn primary" onClick={handleOpenAdd}>
                <Plus size={15} />
                Add Vehicle
              </button>
            )}
          </div>
        }
      >
        <div style={{ display: "flex", gap: "10px", marginBottom: "16px" }}>
          {(["ALL", "4-Passenger Sedan", "7-Passenger MUV", "Custom Car", "Mini Bus", "Bus"] as const).map((cat) => (
            <button
              key={cat}
              className={`btn ${filter === cat ? "primary" : "secondary"}`}
              onClick={() => setFilter(cat)}
            >
              {cat === "ALL" ? "All Vehicles" : cat}
            </button>
          ))}
        </div>

        {error && <p className="error" role="alert">{error}</p>}
        {notice && (
          <div className="info-banner" style={{ marginBottom: "16px" }}>
            <CheckCircle2 size={18} />
            <div>
              <strong>{notice}</strong>
            </div>
          </div>
        )}

        <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr>
                <th>Registration</th>
                <th>Make & Model</th>
                <th>Vehicle type / Category</th>
                <th>Physical Seats</th>
                <th>Passenger Capacity</th>
                <th>Year</th>
                <th>Status</th>
                {canWrite && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filteredCars.length === 0 ? (
                <tr>
                  <td colSpan={canWrite ? 8 : 7} style={{ textAlign: "center", padding: "24px" }}>
                    No cars found matching category filter.
                  </td>
                </tr>
              ) : (
                filteredCars.map((car) => (
                  <tr key={car._id || car.registrationNumber || (car as any).registration}>
                    <td>
                      <strong>{car.registrationNumber || (car as any).registration}</strong>
                    </td>
                    <td>
                      {car.make} {car.model || (car as any).modelName}
                    </td>
                    <td>
                      <strong>{car.vehicleCategory === "Bus" || car.vehicleCategory === "Mini Bus" ? car.vehicleCategory : "Car"}</strong><br />
                      <small>{car.vehicleCategory || (car as any).category}</small>
                    </td>
                    <td>{car.totalPhysicalSeats} (1 Driver + {car.bookablePassengerCapacity} Pax)</td>
                    <td>
                      <strong>{car.bookablePassengerCapacity} Passenger Seats</strong>
                    </td>
                    <td>{car.year}</td>
                    <td>
                      <span
                        className={`status-pill ${car.status === "Active" ? "active" : "inactive"}`}
                      >
                        {car.status}
                      </span>
                    </td>
                    {canWrite && (
                      <td>
                        {!ws.demo && ws.user.role === "operator_admin" && (car._id || car.id) && (
                          <button className="btn secondary" disabled={saving} onClick={() => setOwnerVehicle(car)}>
                            {car.ownerId ? "Change owner" : "Assign owner"}
                          </button>
                        )}
                        <button className="btn secondary" disabled={saving} onClick={() => void manageCar(car)}>
                          {car.status === "Active" ? "Deactivate" : "Activate"}
                        </button>
                        {ws.user.role === "operator_admin" && car.status === "Inactive" && (
                          <button className="btn danger" disabled={saving} onClick={() => void manageCar(car, true)}>Hard Delete</button>
                        )}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {ownerVehicle && (
        <AssignVehicleOwner
          vehicleId={(ownerVehicle._id || ownerVehicle.id)!}
          registration={ownerVehicle.registrationNumber}
          currentOwner={ownerVehicle.ownerId}
          onClose={() => setOwnerVehicle(null)}
          onSaved={(ownerId) => {
            const vehicleId = ownerVehicle._id || ownerVehicle.id;
            setCars((list) => list.map((car) => (car._id || car.id) === vehicleId ? { ...car, ownerId } : car));
            setOwnerVehicle(null);
          }}
        />
      )}
      {dialogOpen && (
        <Overlay
          title={editingCar ? "Edit Car" : "Add New Vehicle"}
          onClose={() => setDialogOpen(false)}
          className="car-editor-dialog"
        >
          <form onSubmit={handleSave} noValidate className="car-editor-form">
            <div className="car-editor-body">
              <p className="car-editor-intro">
                Choose a vehicle type to see its registration and seating fields.
              </p>
              <fieldset className="vehicle-type-picker">
                <legend>Vehicle type</legend>
                {(["Car", "Mini Bus", "Bus"] as const).map((type) => (
                  <label key={type}>
                    <input type="radio" name="vehicle-type" checked={vehicleType === type} disabled={saving}
                      onChange={() => {
                        setFormData((data) => ({ ...data, vehicleCategory: type === "Car" ? "4-Passenger Sedan" : type }));
                        setLayoutId("");
                      }} />
                    {type}
                  </label>
                ))}
              </fieldset>
              {!editingCar && <label>
                Seat layout
                <select value={layoutId} required={custom} onChange={(event) => setLayoutId(event.target.value)}>
                  <option value="">{custom ? "Select a saved layout" : "Use standard car layout"}</option>
                  {layouts.filter((layout) => layout.vehicleType === vehicleType).map((layout) => (
                    <option value={layout._id} key={layout._id}>{layout.name} ({layout.seats.length - 1} passengers)</option>
                  ))}
                </select>
                {selectedLayout ? <small>{selectedLayout.seats.length - 1} passenger seats + 1 driver seat</small>
                  : !layouts.some((layout) => layout.vehicleType === vehicleType) &&
                    <small>Create a {vehicleType} template in Seat Layout Designer first.</small>}
              </label>}

              {formError && (
                <div className="counter-alert error" role="alert">
                  <AlertTriangle size={16} />
                  <span>{formError}</span>
                </div>
              )}

              <label>
                Vehicle Registration Number
                <input
                  type="text"
                  required
                  placeholder="e.g. DL-01-AB-1234"
                  value={formData.registrationNumber}
                  onChange={(e) => setFormData({ ...formData, registrationNumber: e.target.value.toUpperCase() })}
                />
              </label>

              <div className="car-editor-row">
                <label>
                  {vehicleType} Make
                  <input
                    type="text"
                    required
                    placeholder={vehicleType === "Car" ? "e.g. Maruti Suzuki, Toyota" : "e.g. Tata, Force"}
                    value={formData.make}
                    onChange={(e) => setFormData({ ...formData, make: e.target.value })}
                  />
                </label>
                <label>
                  {vehicleType} Model
                  <input
                    type="text"
                    required
                    placeholder={vehicleType === "Car" ? "e.g. Dzire, Innova Crysta" : vehicleType === "Mini Bus" ? "e.g. Traveller" : "e.g. Starbus"}
                    value={formData.model}
                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                  />
                </label>
              </div>

              <div className="car-editor-row">
                {vehicleType === "Car" && <label>
                  Car Category
                  <select
                    value={formData.vehicleCategory}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        vehicleCategory: e.target.value as "4-Passenger Sedan" | "7-Passenger MUV" | "Custom Car" | "Mini Bus" | "Bus",
                      })
                    }
                  >
                    <option value="4-Passenger Sedan">4-Passenger Sedan (5 Physical = 1 Driver + 4 Pax)</option>
                    <option value="7-Passenger MUV">7-Passenger MUV (8 Physical = 1 Driver + 7 Pax)</option>
                    <option value="Custom Car">Car with custom capacity</option>
                  </select>
                </label>}
                <label>
                  Model Year
                  <input
                    type="number"
                    min="2010"
                    max="2030"
                    value={formData.year}
                    onChange={(e) => setFormData({ ...formData, year: Number(e.target.value) })}
                  />
                </label>
              </div>

              <div className="car-editor-row">
                <label>
                  Color (Optional)
                  <input
                    type="text"
                    placeholder="e.g. White, Silver"
                    value={formData.color}
                    onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                  />
                </label>
                <label>
                  Status
                  <select
                    value={formData.status}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        status: e.target.value as "Active" | "Inactive" | "Maintenance",
                      })
                    }
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                    <option value="Maintenance">Maintenance</option>
                  </select>
                </label>
              </div>


              <div className="car-editor-capacity">
                <ShieldCheck size={18} />
                <div>
                  <strong>Strict Physical Capacity Invariant:</strong> Driver seat is always non-bookable.
                  {selectedLayout ? " Its seat positions come from the selected layout." : custom ? " Select a saved layout above." : formData.vehicleCategory === "4-Passenger Sedan"
                    ? " Exactly 4 passenger seats will be bookable."
                    : " Exactly 7 passenger seats will be bookable."}
                </div>
              </div>
            </div>

            <div className="car-editor-footer">
              <button type="button" className="btn secondary" onClick={() => setDialogOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn primary" disabled={saving}>
                {saving ? "Saving…" : "Save " + vehicleType}
              </button>
            </div>
          </form>
        </Overlay>
      )}
    </div>
  );
}
