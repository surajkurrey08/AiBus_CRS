import React, { useEffect, useState } from "react";
import { Car, Plus, RefreshCw, CheckCircle2, AlertTriangle, ShieldCheck } from "lucide-react";
import { api } from "../../api/client";
import { DataTable, MiniStats, Overlay, Panel } from "../../components/index";
import { useWorkspace } from "../../context/WorkspaceContext";

export interface CarRecord {
  id?: string;
  _id?: string;
  registrationNumber: string;
  make: string;
  model: string;
  year: number;
  vehicleCategory: "4-Passenger Sedan" | "7-Passenger MUV";
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
  const [cars, setCars] = useState<CarRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"ALL" | "4-Passenger Sedan" | "7-Passenger MUV">("ALL");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCar, setEditingCar] = useState<CarRecord | null>(null);
  const [formData, setFormData] = useState({
    registrationNumber: "",
    make: "",
    model: "",
    year: new Date().getFullYear(),
    vehicleCategory: "4-Passenger Sedan" as "4-Passenger Sedan" | "7-Passenger MUV",
    color: "",
    status: "Active" as "Active" | "Inactive" | "Maintenance",
  });
  const [formError, setFormError] = useState("");
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

  const handleOpenAdd = () => {
    setEditingCar(null);
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

    const totalPhysicalSeats = formData.vehicleCategory === "4-Passenger Sedan" ? 5 : 8;
    const bookablePassengerCapacity = formData.vehicleCategory === "4-Passenger Sedan" ? 4 : 7;

    const payload = {
      ...formData,
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
          [String(cars.length), "Total Fleet Cars"],
          [String(activeCount), "Active Cars"],
          [String(sedanCount), "4-Passenger Sedans (5 Physical Seats)"],
          [String(muvCount), "7-Passenger MUVs (8 Physical Seats)"],
        ]}
      />

      <Panel
        title="Car Fleet Master"
        aside={
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <button className="text-btn" onClick={loadCars} disabled={loading}>
              <RefreshCw size={14} />
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            {canWrite && (
              <button className="btn primary" onClick={handleOpenAdd}>
                <Plus size={15} />
                Add Car
              </button>
            )}
          </div>
        }
      >
        <div style={{ display: "flex", gap: "10px", marginBottom: "16px" }}>
          {(["ALL", "4-Passenger Sedan", "7-Passenger MUV"] as const).map((cat) => (
            <button
              key={cat}
              className={`btn ${filter === cat ? "primary" : "secondary"}`}
              onClick={() => setFilter(cat)}
            >
              {cat === "ALL" ? "All Cars" : cat}
            </button>
          ))}
        </div>

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
                <th>Category</th>
                <th>Physical Seats</th>
                <th>Passenger Capacity</th>
                <th>Year</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredCars.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: "24px" }}>
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
                      <span className="badge">{car.vehicleCategory || (car as any).category}</span>
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
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {dialogOpen && (
        <Overlay
          title={editingCar ? "Edit Car" : "Add New Car"}
          onClose={() => setDialogOpen(false)}
        >
          <form onSubmit={handleSave} noValidate style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
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
                onChange={(e) => setFormData({ ...formData, registrationNumber: e.target.value })}
              />
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <label>
                Car Make
                <input
                  type="text"
                  required
                  placeholder="e.g. Maruti Suzuki, Toyota"
                  value={formData.make}
                  onChange={(e) => setFormData({ ...formData, make: e.target.value })}
                />
              </label>
              <label>
                Car Model
                <input
                  type="text"
                  required
                  placeholder="e.g. Dzire, Innova Crysta"
                  value={formData.model}
                  onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                />
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <label>
                Vehicle Category
                <select
                  value={formData.vehicleCategory}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      vehicleCategory: e.target.value as "4-Passenger Sedan" | "7-Passenger MUV",
                    })
                  }
                >
                  <option value="4-Passenger Sedan">4-Passenger Sedan (5 Physical = 1 Driver + 4 Pax)</option>
                  <option value="7-Passenger MUV">7-Passenger MUV (8 Physical = 1 Driver + 7 Pax)</option>
                </select>
              </label>
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

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
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

            <div className="info-banner" style={{ fontSize: "12px", marginTop: "8px" }}>
              <ShieldCheck size={16} />
              <div>
                <strong>Strict Physical Capacity Invariant</strong>: Driver seat is always non-bookable.
                {formData.vehicleCategory === "4-Passenger Sedan"
                  ? " Exactly 4 passenger seats will be bookable."
                  : " Exactly 7 passenger seats will be bookable."}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "16px" }}>
              <button type="button" className="btn secondary" onClick={() => setDialogOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn primary" disabled={saving}>
                {saving ? "Saving…" : "Save Car"}
              </button>
            </div>
          </form>
        </Overlay>
      )}
    </div>
  );
}
