import React, { useEffect, useState } from "react";
import {
  CalendarClock,
  Plus,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Play,
  Pause,
  XCircle,
  ShieldCheck,
  ArrowRight,
  Car,
} from "lucide-react";
import { api } from "../../api/client";
import { DataTable, MiniStats, Overlay, Panel } from "../../components/index";
import { useWorkspace } from "../../context/WorkspaceContext";

export interface CarTripRecord {
  _id: string;
  tripNumber: string;
  tripType: "ONE_WAY" | "ROUND_TRIP";
  carId: string;
  carRegistration?: string;
  vehicleCategory: "4-Passenger Sedan" | "7-Passenger MUV";
  bookableCapacity: number;
  totalPhysicalSeats: number;
  routeId: string;
  routeName?: string;
  departureAt: string;
  estimatedArrivalAt: string;
  baseFarePaise: number;
  bookingOpen: boolean;
  status:
    | "Draft"
    | "Scheduled"
    | "Boarding"
    | "On Road"
    | "Arrived"
    | "Completed"
    | "Cancelled";
  availableSeatsCount: number;
}

const DEMO_TRIPS: CarTripRecord[] = [
  {
    _id: "trip-001",
    tripNumber: "CAR-TRIP-PUN-MUM-001",
    tripType: "ONE_WAY",
    carId: "car-001",
    carRegistration: "DL-01-AB-1234 (Maruti Dzire)",
    vehicleCategory: "4-Passenger Sedan",
    bookableCapacity: 4,
    totalPhysicalSeats: 5,
    routeId: "route-001",
    routeName: "Pune → Mumbai",
    departureAt: new Date(Date.now() + 3600000 * 2).toISOString(),
    estimatedArrivalAt: new Date(Date.now() + 3600000 * 6).toISOString(),
    baseFarePaise: 45000,
    bookingOpen: true,
    status: "Scheduled",
    availableSeatsCount: 3,
  },
  {
    _id: "trip-002",
    tripNumber: "CAR-TRIP-BLR-CHE-002",
    tripType: "ROUND_TRIP",
    carId: "car-002",
    carRegistration: "MH-02-CD-5678 (Toyota Innova)",
    vehicleCategory: "7-Passenger MUV",
    bookableCapacity: 7,
    totalPhysicalSeats: 8,
    routeId: "route-002",
    routeName: "Bengaluru ⇄ Chennai",
    departureAt: new Date(Date.now() + 3600000 * 4).toISOString(),
    estimatedArrivalAt: new Date(Date.now() + 3600000 * 10).toISOString(),
    baseFarePaise: 65000,
    bookingOpen: true,
    status: "Scheduled",
    availableSeatsCount: 6,
  },
  {
    _id: "trip-003",
    tripNumber: "CAR-TRIP-DEL-JAI-003",
    tripType: "ONE_WAY",
    carId: "car-003",
    carRegistration: "KA-03-EF-9012 (Hyundai Aura)",
    vehicleCategory: "4-Passenger Sedan",
    bookableCapacity: 4,
    totalPhysicalSeats: 5,
    routeId: "route-003",
    routeName: "Delhi → Jaipur",
    departureAt: new Date(Date.now() + 3600000 * 24).toISOString(),
    estimatedArrivalAt: new Date(Date.now() + 3600000 * 29).toISOString(),
    baseFarePaise: 55000,
    bookingOpen: false,
    status: "Draft",
    availableSeatsCount: 4,
  },
];

export function CarTripMaster() {
  const ws = useWorkspace();
  const canWrite = ws.user.permissions.includes("routes:write");
  const [trips, setTrips] = useState<CarTripRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [selectedTrip, setSelectedTrip] = useState<CarTripRecord | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const [cars, setCars] = useState<any[]>([]);
  const [routes, setRoutes] = useState<any[]>([]);
  const [selectedCarId, setSelectedCarId] = useState("");
  const [selectedRouteId, setSelectedRouteId] = useState("");

  const [formData, setFormData] = useState({
    tripType: "ONE_WAY" as "ONE_WAY" | "ROUND_TRIP",
    vehicleCategory: "4-Passenger Sedan" as "4-Passenger Sedan" | "7-Passenger MUV",
    carRegistration: "DL-01-AB-1234",
    routeName: "Pune → Mumbai",
    departureDate: new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
    }).format(new Date()),
    departureTime: "08:00",
    arrivalDate: new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
    }).format(new Date()),
    arrivalTime: "12:00",
    baseFareRupees: 500,
  });
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  const loadFleetAndRoutes = async () => {
    if (ws.demo) return;
    try {
      const [carsRes, routesRes, citiesRes] = await Promise.all([
        api("/operator/cars?limit=100").catch(() => ({ data: [] })),
        api("/operator/routes?limit=100").catch(() => ({ data: [] })),
        api("/operator/area-master/cities?limit=100").catch(() => ({ data: [] })),
      ]);
      const carList = carsRes.data || [];
      let routeList = routesRes.data || [];
      const cityList = citiesRes.data || [];

      if (routeList.length === 0 && cityList.length >= 2) {
        routeList = [
          {
            _id: "",
            source: cityList[0].name,
            destination: cityList[1].name,
            distanceKm: 150,
          },
          {
            _id: "",
            source: cityList[1].name,
            destination: cityList[0].name,
            distanceKm: 150,
          },
        ];
      }

      setCars(carList);
      setRoutes(routeList);

      if (carList.length > 0) {
        setSelectedCarId((prevId) => {
          const currentValid = carList.some((c: any) => c._id === prevId);
          const chosenId = currentValid ? prevId : carList[0]._id;
          const chosen = carList.find((c: any) => c._id === chosenId) || carList[0];
          const reg = chosen.registrationNumber || chosen.registration || "";
          const cat = chosen.vehicleCategory || chosen.category || "4-Passenger Sedan";
          setFormData((f) => ({
            ...f,
            carRegistration: reg,
            vehicleCategory: cat,
          }));
          return chosenId;
        });
      }

      if (routeList.length > 0) {
        setSelectedRouteId((prevId) => {
          const currentValid = routeList.some((r: any) => r._id && r._id === prevId);
          const chosenId = currentValid ? prevId : (routeList[0]._id || "");
          const chosen = routeList.find((r: any) => r._id === chosenId) || routeList[0];
          setFormData((f) => ({
            ...f,
            routeName: `${chosen.source} → ${chosen.destination}`,
          }));
          return chosenId;
        });
      }
    } catch (e: any) {
      console.warn("Could not prefetch cars or routes:", e.message);
    }
  };

  const loadTrips = async () => {
    setLoading(true);
    setError("");
    if (ws.demo) {
      setTrips(DEMO_TRIPS);
      setLoading(false);
      return;
    }
    try {
      const res = await api("/operator/trips?limit=100");
      setTrips(res.data || []);
    } catch (e: any) {
      setTrips([]);
      setError(e.message || "Failed to load car trips");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTrips();
    loadFleetAndRoutes();
  }, [ws.revision]);

  const handlePublish = async (tripId: string) => {
    setBusy(true);
    try {
      if (ws.demo) {
        setTrips((prev) =>
          prev.map((t) =>
            t._id === tripId ? { ...t, status: "Scheduled", bookingOpen: true } : t
          )
        );
        setNotice("Car trip published. Booking is now open.");
      } else {
        await api(`/operator/trips/${tripId}/publish`, { method: "POST" });
        setNotice("Car trip published successfully.");
        loadTrips();
      }
    } catch (e: any) {
      setError(e.message || "Failed to publish trip");
    } finally {
      setBusy(false);
    }
  };

  const handleCloseSales = async (tripId: string) => {
    setBusy(true);
    try {
      if (ws.demo) {
        setTrips((prev) =>
          prev.map((t) => (t._id === tripId ? { ...t, bookingOpen: false } : t))
        );
        setNotice("Booking sales closed for trip.");
      } else {
        await api(`/operator/trips/${tripId}/close-sales`, { method: "POST" });
        setNotice("Booking sales closed.");
        loadTrips();
      }
    } catch (e: any) {
      setError(e.message || "Failed to close sales");
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!selectedTrip || !cancelReason.trim()) {
      setError("Cancellation reason is required.");
      return;
    }
    setBusy(true);
    try {
      if (ws.demo) {
        setTrips((prev) =>
          prev.map((t) =>
            t._id === selectedTrip._id
              ? { ...t, status: "Cancelled", bookingOpen: false }
              : t
          )
        );
        setNotice(`Trip ${selectedTrip.tripNumber} cancelled.`);
        setCancelDialogOpen(false);
      } else {
        await api(`/operator/trips/${selectedTrip._id}/cancel`, {
          method: "POST",
          body: JSON.stringify({ reason: cancelReason }),
        });
        setNotice("Trip cancelled.");
        setCancelDialogOpen(false);
        loadTrips();
      }
    } catch (e: any) {
      setError(e.message || "Failed to cancel trip");
    } finally {
      setBusy(false);
    }
  };

  const handleScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    const dep = new Date(`${formData.departureDate}T${formData.departureTime}:00+05:30`);
    const arr = new Date(`${formData.arrivalDate}T${formData.arrivalTime}:00+05:30`);

    if (arr <= dep) {
      setFormError("Arrival time must be after departure time.");
      return;
    }

    const bookableCapacity = formData.vehicleCategory === "4-Passenger Sedan" ? 4 : 7;
    const totalPhysicalSeats = formData.vehicleCategory === "4-Passenger Sedan" ? 5 : 8;

    if (!ws.demo) {
      if (cars.length > 0 && !selectedCarId) {
        setFormError("Please select an assigned vehicle from Car Master.");
        return;
      }
      if (cars.length === 0 && !formData.carRegistration.trim()) {
        setFormError("Please register a vehicle in Car Master first.");
        return;
      }
      if (!formData.routeName.trim()) {
        setFormError("Please select or enter a route.");
        return;
      }
    }

    const newTrip: CarTripRecord = {
      _id: `trip-${Date.now()}`,
      tripNumber: `CAR-TRIP-${Date.now().toString().slice(-6)}`,
      tripType: formData.tripType,
      carId: selectedCarId || `car-${Date.now()}`,
      carRegistration: formData.carRegistration,
      vehicleCategory: formData.vehicleCategory,
      bookableCapacity,
      totalPhysicalSeats,
      routeId: selectedRouteId || `route-${Date.now()}`,
      routeName: formData.routeName,
      departureAt: dep.toISOString(),
      estimatedArrivalAt: arr.toISOString(),
      baseFarePaise: Math.round(formData.baseFareRupees * 100),
      bookingOpen: true,
      status: "Scheduled",
      availableSeatsCount: bookableCapacity,
    };

    setBusy(true);
    try {
      if (ws.demo) {
        setTrips((prev) => [newTrip, ...prev]);
        setNotice("New car trip scheduled successfully in demo workspace.");
        setDialogOpen(false);
      } else {
        await api("/operator/trips", {
          method: "POST",
          body: JSON.stringify({
            ...(selectedCarId
              ? { carId: selectedCarId, busId: selectedCarId }
              : {}),
            ...(selectedRouteId ? { routeId: selectedRouteId } : {}),
            journeyDate: formData.departureDate,
            departureAt: dep.toISOString(),
            estimatedArrivalAt: arr.toISOString(),
            arrivalAt: arr.toISOString(),
            tripType: formData.tripType,
            vehicleCategory: formData.vehicleCategory,
            carRegistration: formData.carRegistration,
            routeName: formData.routeName,
            baseFarePaise: Math.round(formData.baseFareRupees * 100),
            baseFareRupees: formData.baseFareRupees,
            bookableCapacity,
            totalPhysicalSeats,
            status: "Scheduled",
            bookingOpen: true,
          }),
        });
        setNotice("Car trip created successfully.");
        setDialogOpen(false);
        loadTrips();
      }
    } catch (err: any) {
      setFormError(err.message || "Failed to schedule trip");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="car-trip-master-page">
      <MiniStats
        items={[
          [String(trips.length), "Total Car Trips"],
          [
            String(trips.filter((t) => t.status === "Scheduled").length),
            "Scheduled & Open",
          ],
          [
            String(trips.filter((t) => t.tripType === "ONE_WAY").length),
            "One Way Trips",
          ],
          [
            String(trips.filter((t) => t.tripType === "ROUND_TRIP").length),
            "Round Trips",
          ],
        ]}
      />

      <Panel
        title="Car Trip Master"
        aside={
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <button className="text-btn" onClick={loadTrips} disabled={loading}>
              <RefreshCw size={14} />
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            {canWrite && (
              <button
                className="btn primary"
                onClick={() => {
                  setFormError("");
                  loadFleetAndRoutes();
                  setDialogOpen(true);
                }}
              >
                <Plus size={15} />
                Schedule Car Trip
              </button>
            )}
          </div>
        }
      >
        {notice && (
          <div className="info-banner" style={{ marginBottom: "16px" }}>
            <CheckCircle2 size={18} />
            <div>
              <strong>{notice}</strong>
            </div>
          </div>
        )}

        {error && (
          <div className="counter-alert error" role="alert" style={{ marginBottom: "16px" }}>
            <AlertTriangle size={16} />
            <span>{error}</span>
          </div>
        )}

        <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr>
                <th>Trip #</th>
                <th>Type</th>
                <th>Car & Category</th>
                <th>Route</th>
                <th>Departure IST</th>
                <th>Arrival IST</th>
                <th>Base Fare</th>
                <th>Available Seats</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {trips.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ textAlign: "center", padding: "24px" }}>
                    No car trips scheduled yet. Click "Schedule Car Trip" to create one.
                  </td>
                </tr>
              ) : (
                trips.map((trip) => (
                  <tr key={trip._id}>
                    <td>
                      <strong>{trip.tripNumber}</strong>
                    </td>
                    <td>
                      <span className="badge">
                        {trip.tripType === "ONE_WAY" ? "One Way" : "Round Trip"}
                      </span>
                    </td>
                    <td>
                      <div>{trip.carRegistration}</div>
                      <small className="muted">{trip.vehicleCategory}</small>
                    </td>
                    <td>{trip.routeName}</td>
                    <td>
                      {new Date(trip.departureAt).toLocaleTimeString("en-IN", {
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "Asia/Kolkata",
                      })}{" "}
                      <small>
                        {new Date(trip.departureAt).toLocaleDateString("en-IN", {
                          timeZone: "Asia/Kolkata",
                        })}
                      </small>
                    </td>
                    <td>
                      {new Date(trip.estimatedArrivalAt).toLocaleTimeString("en-IN", {
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "Asia/Kolkata",
                      })}
                    </td>
                    <td>₹{(trip.baseFarePaise / 100).toLocaleString("en-IN")}</td>
                    <td>
                      <strong>
                        {trip.availableSeatsCount} / {trip.bookableCapacity} Seats
                      </strong>
                    </td>
                    <td>
                      <span
                        className={`status-pill ${
                          trip.status === "Scheduled"
                            ? "active"
                            : trip.status === "Cancelled"
                              ? "inactive"
                              : "pending"
                        }`}
                      >
                        {trip.status}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: "6px" }}>
                        {trip.status === "Draft" && canWrite && (
                          <button
                            className="btn primary small"
                            onClick={() => handlePublish(trip._id)}
                            disabled={busy}
                          >
                            <Play size={12} /> Publish
                          </button>
                        )}
                        {trip.status === "Scheduled" && trip.bookingOpen && canWrite && (
                          <button
                            className="btn secondary small"
                            onClick={() => handleCloseSales(trip._id)}
                            disabled={busy}
                          >
                            <Pause size={12} /> Close Sales
                          </button>
                        )}
                        {trip.status !== "Cancelled" && canWrite && (
                          <button
                            className="btn danger small"
                            onClick={() => {
                              setSelectedTrip(trip);
                              setCancelReason("");
                              setCancelDialogOpen(true);
                            }}
                            disabled={busy}
                          >
                            <XCircle size={12} /> Cancel
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {dialogOpen && (
        <Overlay title="Schedule Scheduled Car Trip" onClose={() => setDialogOpen(false)}>
          <form onSubmit={handleScheduleSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            {formError && (
              <div className="counter-alert error" role="alert">
                <AlertTriangle size={16} />
                <span>{formError}</span>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <label>
                Trip Type
                <select
                  value={formData.tripType}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      tripType: e.target.value as "ONE_WAY" | "ROUND_TRIP",
                    })
                  }
                >
                  <option value="ONE_WAY">One Way Trip</option>
                  <option value="ROUND_TRIP">Round Trip</option>
                </select>
              </label>

              <label>
                Car Category
                <select
                  value={formData.vehicleCategory}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      vehicleCategory: e.target.value as "4-Passenger Sedan" | "7-Passenger MUV",
                    })
                  }
                >
                  <option value="4-Passenger Sedan">4-Passenger Sedan (4 Bookable Seats)</option>
                  <option value="7-Passenger MUV">7-Passenger MUV (7 Bookable Seats)</option>
                </select>
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <label>
                Assigned Vehicle Registration
                {cars.length > 0 ? (
                  <select
                    required
                    value={selectedCarId}
                    onChange={(e) => {
                      const cid = e.target.value;
                      setSelectedCarId(cid);
                      const c = cars.find((car) => String(car._id) === cid);
                      if (c) {
                        const reg = c.registrationNumber || c.registration || "";
                        const cat =
                          c.vehicleCategory || c.category || "4-Passenger Sedan";
                        setFormData((f) => ({
                          ...f,
                          carRegistration: reg,
                          vehicleCategory: cat,
                        }));
                      }
                    }}
                  >
                    <option value="">Select Registered Car…</option>
                    {cars.map((c) => (
                      <option key={c._id} value={c._id}>
                        {c.registrationNumber || c.registration} ({c.make}{" "}
                        {c.model || c.modelName}) —{" "}
                        {c.vehicleCategory || c.category}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    required
                    placeholder="e.g. CG-04-MG-2001"
                    value={formData.carRegistration}
                    onChange={(e) =>
                      setFormData({ ...formData, carRegistration: e.target.value })
                    }
                  />
                )}
              </label>
              <label>
                Route (City Pair)
                {routes.length > 0 ? (
                  <select
                    required
                    value={selectedRouteId}
                    onChange={(e) => {
                      const rid = e.target.value;
                      setSelectedRouteId(rid);
                      const r = routes.find((rt) => String(rt._id) === rid);
                      if (r) {
                        setFormData((f) => ({
                          ...f,
                          routeName: `${r.source} → ${r.destination}`,
                          ...(r.departure ? { departureTime: r.departure } : {}),
                          ...(r.arrival ? { arrivalTime: r.arrival } : {}),
                        }));
                        setFormError("");
                      }
                    }}
                  >
                    <option value="">Select Route…</option>
                    {routes.map((r) => (
                      <option key={r._id} value={r._id}>
                        {r.source} → {r.destination}{" "}
                        {r.distanceKm ? `(${r.distanceKm} km)` : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    required
                    placeholder="e.g. Raipur → Bilaspur"
                    value={formData.routeName}
                    onChange={(e) =>
                      setFormData({ ...formData, routeName: e.target.value })
                    }
                  />
                )}
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <label>
                Departure Date
                <input
                  type="date"
                  required
                  value={formData.departureDate}
                  onChange={(e) => setFormData({ ...formData, departureDate: e.target.value })}
                />
              </label>
              <label>
                Departure Time (IST)
                <input
                  type="time"
                  required
                  value={formData.departureTime}
                  onChange={(e) => setFormData({ ...formData, departureTime: e.target.value })}
                />
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <label>
                Estimated Arrival Date
                <input
                  type="date"
                  required
                  value={formData.arrivalDate}
                  onChange={(e) => setFormData({ ...formData, arrivalDate: e.target.value })}
                />
              </label>
              <label>
                Arrival Time (IST)
                <input
                  type="time"
                  required
                  value={formData.arrivalTime}
                  onChange={(e) => setFormData({ ...formData, arrivalTime: e.target.value })}
                />
              </label>
            </div>

            <label>
              Base Fare per Seat (in Rupees ₹)
              <input
                type="number"
                min="50"
                max="50000"
                required
                value={formData.baseFareRupees}
                onChange={(e) => setFormData({ ...formData, baseFareRupees: Number(e.target.value) })}
              />
            </label>

            <div className="info-banner" style={{ fontSize: "12px" }}>
              <ShieldCheck size={16} />
              <div>
                <strong>Bus-Style Individual Seat Booking Rules</strong>:
                Front passenger seat carries 10% premium. Middle seats enjoy 10% discount. Driver seat (D) is strictly non-bookable and never sold.
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "16px" }}>
              <button type="button" className="btn secondary" onClick={() => setDialogOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn primary" disabled={busy}>
                {busy ? "Scheduling…" : "Schedule Trip"}
              </button>
            </div>
          </form>
        </Overlay>
      )}

      {cancelDialogOpen && selectedTrip && (
        <Overlay title={`Cancel Trip ${selectedTrip.tripNumber}`} onClose={() => setCancelDialogOpen(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <p>
              Are you sure you want to cancel car trip <strong>{selectedTrip.tripNumber}</strong> on route{" "}
              <strong>{selectedTrip.routeName}</strong>?
            </p>
            <label>
              Cancellation Reason (Required for audit log)
              <textarea
                required
                rows={3}
                placeholder="e.g. Unforeseen vehicle maintenance, road blockage"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              />
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button className="btn secondary" onClick={() => setCancelDialogOpen(false)}>
                Go Back
              </button>
              <button className="btn danger" onClick={handleCancel} disabled={busy || !cancelReason.trim()}>
                {busy ? "Cancelling…" : "Confirm Trip Cancellation"}
              </button>
            </div>
          </div>
        </Overlay>
      )}
    </div>
  );
}
