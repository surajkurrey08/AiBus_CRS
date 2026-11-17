import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { api } from "../../../api/client";
import { Panel } from "../../../components/ui/Panel";
type Stop = { locationId: string; time?: string };
const normalize = (name: string) =>
  name.trim().replace(/\s+/g, " ").toLowerCase();
export function RouteStopAssignment({
  routes,
  cities,
  locations,
  canWrite,
  onSaved,
}: {
  routes: Record<string, any>[];
  cities: Record<string, any>[];
  locations: Record<string, any>[];
  canWrite: boolean;
  onSaved: () => void;
}) {
  const [routeId, setRouteId] = useState("");
  const [route, setRoute] = useState<Record<string, any> | null>(null);
  const [sourceCityId, setSourceCityId] = useState("");
  const [destinationCityId, setDestinationCityId] = useState("");
  const [boarding, setBoarding] = useState<Stop[]>([]);
  const [dropping, setDropping] = useState<Stop[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!routeId) {
      setRoute(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setNotice("");
    setRoute(null);
    api(`/operator/routes/${routeId}`, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        const record = result.data;
        setRoute(record);
        const matchCity = (name: string, saved?: string) => {
          const matching = cities.filter(
            (city) =>
              city.status === "Active" &&
              normalize(city.name) === normalize(name),
          );
          return (
            matching.find((city) => city._id === saved)?._id ||
            (matching.length === 1 ? matching[0]._id : "")
          );
        };
        const source = matchCity(record.source, record.sourceCityId),
          destination = matchCity(record.destination, record.destinationCityId);
        setSourceCityId(source);
        setDestinationCityId(destination);
        const matchStops = (stops: Record<string, any>[], cityId: string) =>
          stops.flatMap((stop) => {
            const location = locations.find(
              (point) =>
                point.cityId === cityId &&
                point.status === "Active" &&
                (point._id === stop.locationId ||
                  normalize(point.name) === normalize(stop.name)),
            );
            return location
              ? [
                  {
                    locationId: location._id,
                    ...(stop.time ? { time: stop.time } : {}),
                  },
                ]
              : [];
          });
        setBoarding(matchStops(record.boarding || [], source));
        setDropping(matchStops(record.dropping || [], destination));
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [routeId, revision]);
  function reorder(stops: Stop[], index: number, shift: number) {
    const next = [...stops];
    [next[index], next[index + shift]] = [next[index + shift], next[index]];
    return next;
  }
  function renderStops(
    title: string,
    cityId: string,
    selected: Stop[],
    change: (stops: Stop[]) => void,
    usage: string,
  ) {
    const available = locations.filter(
      (location) =>
        location.status === "Active" &&
        location.cityId === cityId &&
        [usage, "Both"].includes(location.usage),
    );
    return (
      <section className="area-stop-list">
        <h3>{title}</h3>
        {!cityId ? (
          <p className="muted">Select a city first.</p>
        ) : !available.length ? (
          <p className="muted">
            Create active {usage.toLowerCase()} points for this city.
          </p>
        ) : (
          <>
            <div className="area-stop-options">
              {available.map((point) => (
                <label key={point._id}>
                  <input
                    type="checkbox"
                    disabled={!canWrite || busy}
                    checked={selected.some(
                      (stop) => stop.locationId === point._id,
                    )}
                    onChange={(e) =>
                      change(
                        e.target.checked
                          ? [...selected, { locationId: point._id }]
                          : selected.filter(
                              (stop) => stop.locationId !== point._id,
                            ),
                      )
                    }
                  />
                  {point.name}
                </label>
              ))}
            </div>
            {selected.map((stop, index) => {
              const point = available.find(
                (point) => point._id === stop.locationId,
              );
              return (
                <div className="area-ordered-stop" key={stop.locationId}>
                  <strong>
                    {index + 1}. {point?.name || "Unavailable point"}
                  </strong>
                  <label>
                    {usage} time · IST
                    <input
                      aria-label={`${usage} time for ${point?.name}`}
                      type="time"
                      disabled={!canWrite || busy}
                      value={stop.time || ""}
                      onChange={(e) =>
                        change(
                          selected.map((value, i) =>
                            i === index
                              ? { ...value, time: e.target.value || undefined }
                              : value,
                          ),
                        )
                      }
                    />
                  </label>
                  <div>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Move ${point?.name} ${usage.toLowerCase()} earlier`}
                      disabled={!canWrite || busy || index === 0}
                      onClick={() => change(reorder(selected, index, -1))}
                    >
                      <ArrowUp size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Move ${point?.name} ${usage.toLowerCase()} later`}
                      disabled={
                        !canWrite || busy || index === selected.length - 1
                      }
                      onClick={() => change(reorder(selected, index, 1))}
                    >
                      <ArrowDown size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </section>
    );
  }
  return (
    <Panel title="Assign pickup and drop points">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!route || busy || !canWrite) return;
          setBusy(true);
          setError("");
          setNotice("");
          try {
            if (!boarding.length || !dropping.length)
              throw new Error("Select at least one pickup and one drop point");
            const result = await api(
              `/operator/area-master/routes/${routeId}/stops`,
              {
                method: "PUT",
                body: JSON.stringify({
                  sourceCityId,
                  destinationCityId,
                  boarding,
                  dropping,
                  expectedVersion: route.__v || 0,
                }),
              },
            );
            setRoute(result.data);
            setNotice("Route pickup and drop points saved.");
            onSaved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <label className="area-full-width">
            Route
            <select
              aria-label="Route to configure"
              disabled={busy}
              value={routeId}
              onChange={(e) => setRouteId(e.target.value)}
            >
              <option value="">Select route</option>
              {routes.map((route) => (
                <option value={route._id} key={route._id}>
                  {route.source} → {route.destination}
                </option>
              ))}
            </select>
          </label>
          {loading && <p role="status">Loading route stops...</p>}
          {route && (
            <>
              <label>
                Origin city
                <select
                  required
                  disabled={!canWrite || busy}
                  value={sourceCityId}
                  onChange={(e) => {
                    setSourceCityId(e.target.value);
                    setBoarding([]);
                  }}
                >
                  <option value="">Select origin city</option>
                  {cities
                    .filter(
                      (city) =>
                        city.status === "Active" &&
                        normalize(city.name) === normalize(route.source),
                    )
                    .map((city) => (
                      <option value={city._id} key={city._id}>
                        {city.name} · {city.state}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Destination city
                <select
                  required
                  disabled={!canWrite || busy}
                  value={destinationCityId}
                  onChange={(e) => {
                    setDestinationCityId(e.target.value);
                    setDropping([]);
                  }}
                >
                  <option value="">Select destination city</option>
                  {cities
                    .filter(
                      (city) =>
                        city.status === "Active" &&
                        normalize(city.name) === normalize(route.destination),
                    )
                    .map((city) => (
                      <option value={city._id} key={city._id}>
                        {city.name} · {city.state}
                      </option>
                    ))}
                </select>
              </label>
              <p className="muted area-full-width">
                Current route stops:{" "}
                {(route.boarding || [])
                  .map((stop: any) => stop.name)
                  .join(", ")}{" "}
                →{" "}
                {(route.dropping || [])
                  .map((stop: any) => stop.name)
                  .join(", ")}
                . Select master points in travel order and set their times.
              </p>
              <div className="area-full-width area-stop-columns">
                {renderStops(
                  "Pickup points",
                  sourceCityId,
                  boarding,
                  setBoarding,
                  "Pickup",
                )}
                {renderStops(
                  "Drop points",
                  destinationCityId,
                  dropping,
                  setDropping,
                  "Drop",
                )}
              </div>
            </>
          )}
          {notice && (
            <p role="status" className="area-full-width">
              {notice}
            </p>
          )}
          {error && (
            <div className="area-full-width">
              <p role="alert" className="error">
                {error}
              </p>
              <button
                type="button"
                className="text-btn"
                onClick={() => setRevision((value) => value + 1)}
              >
                Reload route
              </button>
            </div>
          )}
        </div>
        {canWrite && (
          <div className="dialog-foot">
            <button
              className="btn primary"
              disabled={!route || busy || loading}
            >
              {busy ? "Saving..." : "Save route stops"}
            </button>
          </div>
        )}
      </form>
    </Panel>
  );
}
