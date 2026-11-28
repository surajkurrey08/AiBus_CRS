import { useEffect, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  CarFront,
  LayoutDashboard,
  LogOut,
  RefreshCw,
  UsersRound,
} from "lucide-react";
import { api, type Identity } from "./api";

interface Overview {
  vehicles: {
    id: string;
    registration: string;
    name: string;
    category: string;
    capacity: number;
    status: string;
  }[];
  trips: {
    id: string;
    number?: string;
    route?: string;
    registration?: string;
    departureAt: string;
    status: string;
    capacity: number;
    bookedSeats: number;
  }[];
  totalTrips: number;
}

const dateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const departureFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  dateStyle: "medium",
  timeStyle: "short",
});

export function VehicleOwnerPanel({
  user,
  onSignOut,
}: {
  user: Identity;
  onSignOut: () => void;
}) {
  const [data, setData] = useState<Overview>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(() => ({
    from: dateFormat.format(new Date()),
    to: dateFormat.format(new Date(Date.now() + 30 * 86_400_000)),
  }));
  const [range, setRange] = useState(filter);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const query = new URLSearchParams({ ...range, page: String(page) });
    api<Overview>(`/owner/overview?${query}`, { signal: controller.signal })
      .then(({ data: next }) => {
        if (!controller.signal.aborted) setData(next);
      })
      .catch((issue: Error) => {
        if (!controller.signal.aborted) setError(issue.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [range, page, revision]);

  const pages = Math.max(1, Math.ceil((data?.totalTrips ?? 0) / 25));
  const vehicles = data?.vehicles ?? [];
  const metrics = [
    {
      label: "Assigned vehicles",
      value: vehicles.length,
      Icon: CarFront,
      target: "#my-vehicles",
    },
    {
      label: "Active vehicles",
      value: vehicles.filter((vehicle) => vehicle.status === "Active").length,
      Icon: CarFront,
      target: "#my-vehicles",
    },
    {
      label: "Fleet passenger capacity",
      value: vehicles.reduce((total, vehicle) => total + vehicle.capacity, 0),
      Icon: UsersRound,
      target: "#my-vehicles",
    },
    {
      label: "Trips in selected dates",
      value: data?.totalTrips ?? 0,
      Icon: CalendarDays,
      target: "#owner-trips",
    },
  ];
  return (
    <div className="vehicle-owner-page">
      <header className="vehicle-owner-header">
        <div className="vehicle-owner-brand-group">
          <img
            className="vehicle-owner-logo"
            src="/CRS.png"
            alt="CRS — Central Reservation System"
          />
          <span className="vehicle-owner-brand-divider" aria-hidden="true" />
          <span className="vehicle-owner-portal-tag">Vehicle Owner</span>
        </div>
        <nav className="vehicle-owner-nav" aria-label="Vehicle owner workspace">
          <a href="#owner-overview">
            <LayoutDashboard size={16} /> Overview
          </a>
          <a href="#my-vehicles">
            <CarFront size={16} /> My vehicles
          </a>
          <a href="#owner-trips">
            <CalendarDays size={16} /> Trips &amp; occupancy
          </a>
        </nav>
        <button className="btn secondary owner-signout-btn" onClick={onSignOut}>
          <LogOut size={16} /> Sign out
        </button>
      </header>
      <main className="vehicle-owner-content" id="owner-overview">
        <div className="vehicle-owner-heading">
          <div className="vehicle-owner-heading-copy">
            <span className="vehicle-owner-eyebrow">
              <CarFront size={14} aria-hidden="true" /> Fleet &amp; Occupancy Portal
            </span>
            <h1>Vehicle Owner Dashboard</h1>
            <p>{user.name}</p>
          </div>
          <button
            className="btn secondary owner-refresh-btn"
            disabled={loading}
            onClick={() => setRevision((value) => value + 1)}
          >
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
        {loading && <p role="status">Loading owner records…</p>}
        <section aria-label="Fleet summary" className="vehicle-owner-metrics">
          {metrics.map(({ label, value, Icon, target }) => (
            <a key={label} href={target}>
              <span>
                <Icon size={18} aria-hidden="true" />
                <ArrowRight size={15} aria-hidden="true" />
              </span>
              <strong>{data && !error ? value : "—"}</strong>
              <span>{label}</span>
            </a>
          ))}
        </section>
        <section
          className="vehicle-owner-section"
          aria-labelledby="my-vehicles"
        >
          <h2 id="my-vehicles">
            <CarFront size={20} /> My vehicles{" "}
            {data ? `(${data.vehicles.length})` : ""}
          </h2>
          {data?.vehicles.length ? (
            <ul className="vehicle-owner-cards">
              {data.vehicles.map((vehicle) => (
                <li key={vehicle.id}>
                  <strong>{vehicle.registration}</strong>
                  <span>{vehicle.name}</span>
                  <span>
                    {vehicle.category} · {vehicle.capacity} passenger seats
                  </span>
                  <small>{vehicle.status}</small>
                </li>
              ))}
            </ul>
          ) : (
            data && (
              <div className="vehicle-owner-empty">
                <CarFront size={24} aria-hidden="true" />
                <strong>No vehicles assigned yet</strong>
                <p>
                  Ask your Vehicle Operator to link your vehicle from Vehicles →
                  Assign owner. Once it’s assigned, refresh this dashboard.
                </p>
              </div>
            )
          )}
        </section>
        <section
          className="vehicle-owner-section"
          aria-labelledby="owner-trips"
        >
          <h2 id="owner-trips">
            <CalendarDays size={20} /> Trips &amp; occupancy
          </h2>
          <form
            className="vehicle-owner-filters"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              setRange({ ...filter });
            }}
          >
            <label>
              From
              <input
                type="date"
                required
                max={filter.to}
                value={filter.from}
                onChange={(event) =>
                  setFilter({ ...filter, from: event.target.value })
                }
              />
            </label>
            <label>
              To
              <input
                type="date"
                required
                min={filter.from}
                value={filter.to}
                onChange={(event) =>
                  setFilter({ ...filter, to: event.target.value })
                }
              />
            </label>
            <button className="btn primary" disabled={loading}>
              Apply dates
            </button>
          </form>
          {data && !loading && !error && (
            <>
              {data.trips.length ? (
                <ul className="vehicle-owner-trips">
                  {data.trips.map((trip) => (
                    <li key={trip.id}>
                      <div>
                        <strong>
                          {trip.route || trip.number || "Scheduled trip"}
                        </strong>
                        <span>
                          {[
                            trip.registration,
                            departureFormat.format(new Date(trip.departureAt)) +
                              " IST",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        {trip.number && <small>{trip.number}</small>}
                      </div>
                      <span className="vehicle-owner-status">
                        {trip.status}
                      </span>
                      <div>
                        <strong>
                          {trip.bookedSeats} / {trip.capacity} booked
                        </strong>
                        {trip.capacity > 0 && (
                          <progress
                            aria-label="Seat occupancy"
                            value={trip.bookedSeats}
                            max={trip.capacity}
                          />
                        )}
                        {trip.capacity > 0 && (
                          <small>
                            {Math.round(
                              (trip.bookedSeats / trip.capacity) * 100,
                            )}
                            % occupied
                          </small>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="vehicle-owner-empty">
                  <CalendarDays size={24} aria-hidden="true" />
                  <strong>No trips in this date range</strong>
                  <p>
                    {vehicles.length
                      ? "Try a different date range or check with your Vehicle Operator about the next scheduled trip."
                      : "Trips will appear here after your operator assigns a vehicle and schedules it."}
                  </p>
                </div>
              )}
              {(pages > 1 || page > 1) && (
                <div className="vehicle-owner-pagination">
                  <span>
                    {data.totalTrips} trips · Page {page} of {pages}
                  </span>
                  <button
                    className="btn secondary"
                    disabled={page === 1}
                    onClick={() => setPage(page - 1)}
                  >
                    Previous
                  </button>
                  <button
                    className="btn secondary"
                    disabled={page >= pages}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
