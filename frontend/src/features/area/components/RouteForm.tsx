import { useState, useId } from "react";
import { ArrowRight, MapPin, Plus, Trash2 } from "lucide-react";
import { api } from "../../../api/client";
import { Overlay } from "../../../components/ui/Overlay";
import "../../car-master/car-master.css";

export function RouteForm({
  record,
  cities,
  locations = [],
  onClose,
  onSaved,
}: {
  record?: Record<string, any>;
  cities: Record<string, any>[];
  locations?: Record<string, any>[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const sourceDatalistId = useId();
  const destDatalistId = useId();

  const [source, setSource] = useState(record?.source || "");
  const [destination, setDestination] = useState(record?.destination || "");
  const [departure, setDeparture] = useState(record?.departure || "06:00");
  const [arrival, setArrival] = useState(record?.arrival || "11:00");
  const [durationMinutes, setDurationMinutes] = useState<number>(
    record?.durationMinutes || 300,
  );
  const [distanceKm, setDistanceKm] = useState<string>(
    record?.distanceKm !== undefined ? String(record.distanceKm) : "",
  );
  const [viaLabel, setViaLabel] = useState<string>(record?.viaLabel || "");
  const [viaQuickText, setViaQuickText] = useState<string>("");
  const [viaStops, setViaStops] = useState<
    { city: string; distanceKm: string; durationMinutes: string }[]
  >(() =>
    Array.isArray(record?.viaStops)
      ? record.viaStops.map((s: any) => ({
          city: s.city || "",
          distanceKm: s.distanceKm !== undefined ? String(s.distanceKm) : "",
          durationMinutes: s.durationMinutes !== undefined ? String(s.durationMinutes) : "",
        }))
      : [],
  );
  const [status, setStatus] = useState<string>(record?.status || "Active");

  // Boarding & Dropping stops
  const [boarding, setBoarding] = useState<
    { name: string; time?: string; address?: string }[]
  >(() => {
    if (record?.boarding?.length) return record.boarding;
    return [{ name: record?.source ? `${record.source} Main Stand` : "Origin Point", time: record?.departure || "06:00" }];
  });

  const [dropping, setDropping] = useState<
    { name: string; time?: string; address?: string }[]
  >(() => {
    if (record?.dropping?.length) return record.dropping;
    return [{ name: record?.destination ? `${record.destination} Bus Stand` : "Destination Point", time: record?.arrival || "11:00" }];
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function calculateDuration(dep: string, arr: string) {
    if (!dep || !arr) return;
    const [dH, dM] = dep.split(":").map(Number);
    const [aH, aM] = arr.split(":").map(Number);
    if (!isNaN(dH) && !isNaN(dM) && !isNaN(aH) && !isNaN(aM)) {
      let diff = aH * 60 + aM - (dH * 60 + dM);
      if (diff <= 0) diff += 24 * 60;
      setDurationMinutes(diff);
    }
  }

  function handleDepartureChange(val: string) {
    setDeparture(val);
    calculateDuration(val, arrival);
    // Sync first boarding stop time if it matched previous departure
    if (boarding.length > 0 && (!boarding[0].time || boarding[0].time === departure)) {
      setBoarding((prev) => [
        { ...prev[0], time: val },
        ...prev.slice(1),
      ]);
    }
  }

  function handleArrivalChange(val: string) {
    setArrival(val);
    calculateDuration(departure, val);
    // Sync last dropping stop time if it matched previous arrival
    if (dropping.length > 0) {
      const lastIdx = dropping.length - 1;
      setDropping((prev) => [
        ...prev.slice(0, lastIdx),
        { ...prev[lastIdx], time: val },
      ]);
    }
  }

  function handleSourceChange(newSource: string) {
    setSource(newSource);
    if (
      boarding.length === 1 &&
      (!boarding[0].name ||
        boarding[0].name === "Origin Point" ||
        cities.some((c) => boarding[0].name.startsWith(c.name)))
    ) {
      setBoarding([{ name: `${newSource.trim()} Main Stand`, time: departure }]);
    }
  }

  function handleDestinationChange(newDest: string) {
    setDestination(newDest);
    if (
      dropping.length === 1 &&
      (!dropping[0].name ||
        dropping[0].name === "Destination Point" ||
        cities.some((c) => dropping[0].name.startsWith(c.name)))
    ) {
      setDropping([{ name: `${newDest.trim()} Bus Stand`, time: arrival }]);
    }
  }

  // Matching locations suggestions
  const activeCities = cities.filter((c) => c.status === "Active");
  const sourceCity = activeCities.find(
    (c) => c.name.toLowerCase() === source.trim().toLowerCase(),
  );
  const destCity = activeCities.find(
    (c) => c.name.toLowerCase() === destination.trim().toLowerCase(),
  );

  const sourceLocationSuggestions = locations.filter(
    (loc) =>
      loc.status === "Active" &&
      ["Pickup", "Both"].includes(loc.usage) &&
      (sourceCity ? loc.cityId === sourceCity._id : loc.cityName?.toLowerCase() === source.trim().toLowerCase()) &&
      !boarding.some((b) => b.name.toLowerCase() === loc.name.toLowerCase()),
  );

  const destLocationSuggestions = locations.filter(
    (loc) =>
      loc.status === "Active" &&
      ["Drop", "Both"].includes(loc.usage) &&
      (destCity ? loc.cityId === destCity._id : loc.cityName?.toLowerCase() === destination.trim().toLowerCase()) &&
      !dropping.some((d) => d.name.toLowerCase() === loc.name.toLowerCase()),
  );

  const hours = Math.floor(durationMinutes / 60);
  const mins = durationMinutes % 60;

  return (
    <Overlay
      title={`${record ? "Edit route" : "Create route (City pair)"}`}
      onClose={() => {
        if (!busy) onClose();
      }}
      className="car-editor-dialog route-editor-dialog"
    >
      <form
        className="car-editor-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          if (!source.trim() || !destination.trim()) {
            setError("Origin and Destination cities are required");
            return;
          }
          if (source.trim().toLowerCase() === destination.trim().toLowerCase()) {
            setError("Origin and Destination cities must be different");
            return;
          }
          setBusy(true);
          setError("");

          try {
            const cleanBoarding = boarding
              .filter((b) => b.name.trim())
              .map((b) => ({
                name: b.name.trim(),
                ...(b.time ? { time: b.time } : {}),
                ...(b.address ? { address: b.address.trim() } : {}),
              }));

            const cleanDropping = dropping
              .filter((d) => d.name.trim())
              .map((d) => ({
                name: d.name.trim(),
                ...(d.time ? { time: d.time } : {}),
                ...(d.address ? { address: d.address.trim() } : {}),
              }));

            const payload: Record<string, any> = {
              source: source.trim(),
              destination: destination.trim(),
              departure,
              arrival,
              durationMinutes: Number(durationMinutes) || 60,
              boarding: cleanBoarding.length
                ? cleanBoarding
                : [{ name: `${source.trim()} Main Stand`, time: departure }],
              dropping: cleanDropping.length
                ? cleanDropping
                : [{ name: `${destination.trim()} Bus Stand`, time: arrival }],
              status,
            };

            if (distanceKm && !isNaN(Number(distanceKm)) && Number(distanceKm) > 0) {
              payload.distanceKm = Number(distanceKm);
            }
            if (viaLabel.trim()) {
              payload.viaLabel = viaLabel.trim();
            }
            const cleanViaStops = viaStops
              .filter(
                (v) =>
                  v.city.trim() &&
                  v.city.trim().toLowerCase() !== source.trim().toLowerCase() &&
                  v.city.trim().toLowerCase() !== destination.trim().toLowerCase(),
              )
              .map((v) => ({
                city: v.city.trim(),
                distanceKm: Math.max(0, Number(v.distanceKm) || 0),
                durationMinutes: Math.max(0, Math.round(Number(v.durationMinutes) || 0)),
              }));
            if (cleanViaStops.length) {
              payload.viaStops = cleanViaStops;
            } else if (record?.viaStops?.length) {
              payload.viaStops = [];
            }

            await api(
              record ? `/operator/routes/${record._id || record.id}` : "/operator/routes",
              {
                method: record ? "PATCH" : "POST",
                body: JSON.stringify(payload),
              },
            );

            onSaved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {/* Visual Route Preview Banner */}
        <div className="route-editor-banner">
          <div className="route-editor-banner-pair">
            <span>{source.trim() || "From (e.g. Pune)"}</span>
            <ArrowRight size={16} />
            <span>{destination.trim() || "To (e.g. Nashik)"}</span>
            {viaLabel.trim() && (
              <span className="route-editor-via-tag">{viaLabel.trim()}</span>
            )}
          </div>
          <span className="route-editor-banner-meta">
            {departure} → {arrival} ({hours > 0 ? `${hours}h ` : ""}{mins}m)
            {distanceKm && Number(distanceKm) > 0 ? ` · ${distanceKm} km` : ""}
          </span>
        </div>

        <div className="car-editor-body route-editor-body">
          {/* City Pair & Core Timing Grid */}
          <div className="route-editor-grid">
            <label>
              From / Origin city *
              <input
                aria-label="From / Origin city"
                required
                type="text"
                list={sourceDatalistId}
                placeholder="e.g. Pune"
                value={source}
                onChange={(e) => handleSourceChange(e.target.value)}
              />
              <datalist id={sourceDatalistId}>
                {activeCities.map((c) => (
                  <option key={c._id} value={c.name}>
                    {c.name} ({c.state})
                  </option>
                ))}
              </datalist>
            </label>

            <label>
              To / Destination city *
              <input
                aria-label="To / Destination city"
                required
                type="text"
                list={destDatalistId}
                placeholder="e.g. Nashik"
                value={destination}
                onChange={(e) => handleDestinationChange(e.target.value)}
              />
              <datalist id={destDatalistId}>
                {activeCities.map((c) => (
                  <option key={c._id} value={c.name}>
                    {c.name} ({c.state})
                  </option>
                ))}
              </datalist>
            </label>

            <label>
              Scheduled Departure Time *
              <input
                aria-label="Departure time"
                required
                type="time"
                value={departure}
                onChange={(e) => handleDepartureChange(e.target.value)}
              />
            </label>

            <label>
              Scheduled Arrival Time *
              <input
                aria-label="Arrival time"
                required
                type="time"
                value={arrival}
                onChange={(e) => handleArrivalChange(e.target.value)}
              />
            </label>

            <label>
              Total Duration (mins) *
              <input
                aria-label="Duration in minutes"
                required
                type="number"
                min={1}
                max={4320}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value) || 0)}
              />
            </label>

            <label>
              Approx Distance (km)
              <input
                aria-label="Distance in km"
                type="number"
                min={1}
                max={5000}
                placeholder="e.g. 210"
                value={distanceKm}
                onChange={(e) => setDistanceKm(e.target.value)}
              />
            </label>

            <label>
              Route Status
              <select
                aria-label="Route status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </label>

            <label>
              Highway / Via Route Note
              <input
                aria-label="Highway / Via Route Note"
                type="text"
                placeholder="e.g. Via NH-60 (approx 5 hrs)"
                value={viaLabel}
                onChange={(e) => setViaLabel(e.target.value)}
              />
            </label>
          </div>

          {/* Via Cities / Intermediate Stops Section */}
          <div className="route-editor-card">
            <div className="route-editor-card-head">
              <strong>
                <MapPin size={15} color="#0f766e" />
                Via Cities / Intermediate Stops (Distance &amp; Time from {source.trim() || "Origin"})
              </strong>
              <button
                type="button"
                className="text-btn"
                onClick={() =>
                  setViaStops([...viaStops, { city: "", distanceKm: "", durationMinutes: "" }])
                }
              >
                <Plus size={13} /> Add via city
              </button>
            </div>
            <div className="route-via-quick-bar">
              <input
                type="text"
                aria-label="Quick add via cities"
                placeholder="Paste cities separated by comma (e.g. Moshi, Chakan, Rajgurunagar, Manchar, Sangamner)"
                value={viaQuickText}
                onChange={(e) => setViaQuickText(e.target.value)}
              />
              <button
                type="button"
                className="btn secondary"
                disabled={!viaQuickText.trim()}
                onClick={() => {
                  const names = viaQuickText
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean);
                  if (!names.length) return;
                  const totalDist = Number(distanceKm) || 0;
                  const totalDur = Number(durationMinutes) || 0;
                  const generated = names.map((city, idx) => {
                    const ratio = (idx + 1) / (names.length + 1);
                    return {
                      city,
                      distanceKm: totalDist > 0 ? String(Math.round(totalDist * ratio)) : "",
                      durationMinutes: totalDur > 0 ? String(Math.round(totalDur * ratio)) : "",
                    };
                  });
                  setViaStops([...viaStops.filter((v) => v.city.trim()), ...generated]);
                  setViaQuickText("");
                }}
              >
                Add stops
              </button>
            </div>
            {viaStops.length > 0 && (
              <div className="route-via-list">
                <div className="route-via-row route-via-cols-head">
                  <span>#</span>
                  <span>City Name</span>
                  <span>Distance (km)</span>
                  <span>Time (mins)</span>
                  <span />
                </div>
                {viaStops.map((vStop, idx) => (
                  <div key={idx} className="route-via-row">
                    <span className="route-via-index">{idx + 1}</span>
                    <input
                      type="text"
                      list={sourceDatalistId}
                      placeholder={`City ${idx + 1} (e.g. Rajgurunagar)`}
                      value={vStop.city}
                      onChange={(e) => {
                        const updated = [...viaStops];
                        updated[idx].city = e.target.value;
                        setViaStops(updated);
                      }}
                    />
                    <input
                      type="number"
                      min={0}
                      max={5000}
                      placeholder="Km"
                      title="Distance from origin (km)"
                      value={vStop.distanceKm}
                      onChange={(e) => {
                        const updated = [...viaStops];
                        updated[idx].distanceKm = e.target.value;
                        setViaStops(updated);
                      }}
                    />
                    <input
                      type="number"
                      min={0}
                      max={4320}
                      placeholder="Mins"
                      title="Approximate travel minutes from origin"
                      value={vStop.durationMinutes}
                      onChange={(e) => {
                        const updated = [...viaStops];
                        updated[idx].durationMinutes = e.target.value;
                        setViaStops(updated);
                      }}
                    />
                    <button
                      type="button"
                      className="text-btn"
                      title="Remove via city"
                      onClick={() => setViaStops(viaStops.filter((_, i) => i !== idx))}
                    >
                      <Trash2 size={15} color="#ef4444" />
                    </button>
                  </div>
                ))}
                <p className="route-via-path-preview">
                  Path: {[
                    source.trim() || "Origin",
                    ...viaStops
                      .map((v) => v.city.trim())
                      .filter(
                        (c) =>
                          c &&
                          c.toLowerCase() !== source.trim().toLowerCase() &&
                          c.toLowerCase() !== destination.trim().toLowerCase(),
                      ),
                    destination.trim() || "Destination",
                  ].join(" → ")}
                </p>
              </div>
            )}
          </div>

          <div className="route-stops-split">
            {/* Boarding (Pickup) Points Section */}
            <div className="route-editor-card">
              <div className="route-editor-card-head">
                <strong>
                  <MapPin size={15} color="#ea580c" />
                  Boarding Points ({source.trim() || "Origin"})
                </strong>
                <button
                  type="button"
                  className="text-btn"
                  onClick={() =>
                    setBoarding([...boarding, { name: "", time: departure }])
                  }
                >
                  <Plus size={13} /> Add stop
                </button>
              </div>

              {sourceLocationSuggestions.length > 0 && (
                <div className="route-quick-chips">
                  <span>Quick add:</span>
                  {sourceLocationSuggestions.slice(0, 4).map((loc) => (
                    <button
                      key={loc._id}
                      type="button"
                      className="btn"
                      onClick={() =>
                        setBoarding([...boarding, { name: loc.name, time: departure, address: loc.address }])
                      }
                    >
                      + {loc.name}
                    </button>
                  ))}
                </div>
              )}

              <div className="route-stop-rows">
                {boarding.map((stop, idx) => (
                  <div key={idx} className="route-stop-row">
                    <input
                      type="text"
                      required
                      placeholder={`Stop (e.g. ${source.trim() || "Pune"} Stand)`}
                      value={stop.name}
                      onChange={(e) => {
                        const updated = [...boarding];
                        updated[idx].name = e.target.value;
                        setBoarding(updated);
                      }}
                    />
                    <input
                      type="time"
                      value={stop.time || departure}
                      onChange={(e) => {
                        const updated = [...boarding];
                        updated[idx].time = e.target.value;
                        setBoarding(updated);
                      }}
                    />
                    {boarding.length > 1 && (
                      <button
                        type="button"
                        className="text-btn"
                        title="Remove stop"
                        onClick={() => setBoarding(boarding.filter((_, i) => i !== idx))}
                      >
                        <Trash2 size={15} color="#ef4444" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Dropping Points Section */}
            <div className="route-editor-card">
              <div className="route-editor-card-head">
                <strong>
                  <MapPin size={15} color="#0284c7" />
                  Dropping Points ({destination.trim() || "Destination"})
                </strong>
                <button
                  type="button"
                  className="text-btn"
                  onClick={() =>
                    setDropping([...dropping, { name: "", time: arrival }])
                  }
                >
                  <Plus size={13} /> Add stop
                </button>
              </div>

              {destLocationSuggestions.length > 0 && (
                <div className="route-quick-chips">
                  <span>Quick add:</span>
                  {destLocationSuggestions.slice(0, 4).map((loc) => (
                    <button
                      key={loc._id}
                      type="button"
                      className="btn"
                      onClick={() =>
                        setDropping([...dropping, { name: loc.name, time: arrival, address: loc.address }])
                      }
                    >
                      + {loc.name}
                    </button>
                  ))}
                </div>
              )}

              <div className="route-stop-rows">
                {dropping.map((stop, idx) => (
                  <div key={idx} className="route-stop-row">
                    <input
                      type="text"
                      required
                      placeholder={`Stop (e.g. ${destination.trim() || "Nashik"} CBS)`}
                      value={stop.name}
                      onChange={(e) => {
                        const updated = [...dropping];
                        updated[idx].name = e.target.value;
                        setDropping(updated);
                      }}
                    />
                    <input
                      type="time"
                      value={stop.time || arrival}
                      onChange={(e) => {
                        const updated = [...dropping];
                        updated[idx].time = e.target.value;
                        setDropping(updated);
                      }}
                    />
                    {dropping.length > 1 && (
                      <button
                        type="button"
                        className="text-btn"
                        title="Remove stop"
                        onClick={() => setDropping(dropping.filter((_, i) => i !== idx))}
                      >
                        <Trash2 size={15} color="#ef4444" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {error && (
            <p className="error" role="alert" style={{ margin: 0 }}>
              {error}
            </p>
          )}
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
          <button className="btn primary" disabled={busy}>
            {busy ? "Saving..." : record ? "Save changes" : "Save route"}
          </button>
        </div>
      </form>
    </Overlay>
  );
}
