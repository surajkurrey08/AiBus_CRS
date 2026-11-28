import { useMemo, useState } from "react";
import {
  Calculator,
  CalendarPlus,
  Check,
  Clock,
  MapPin,
  Sparkles,
} from "lucide-react";
import { Overlay } from "../../../components/index.ts";
import {
  SeatMap,
  type InventorySeat,
} from "../../../components/seats/SeatMap.tsx";
import { money } from "../../../data/demo-data.ts";
import type { CounterTrip } from "../api/counter.api.ts";
import { TripAmenitiesFields } from "./TripAmenitiesFields.tsx";

export interface SegmentFareDraft {
  fromCity: string;
  toCity: string;
  distanceKm: number;
  fareRupees: string;
}

const formatIstTime = (value?: string) =>
  value
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "";

function buildInitialSegments(
  trip: CounterTrip,
  defaultFareRupees: number,
): SegmentFareDraft[] {
  const existing = new Map(
    (trip.segmentFares || []).map((seg) => [
      `${seg.fromCity.toLowerCase()}->${seg.toCity.toLowerCase()}`,
      seg,
    ]),
  );

  const stops: { city: string; distanceKm: number }[] = [];
  if (trip.source) stops.push({ city: trip.source, distanceKm: 0 });
  for (const v of trip.viaStops || []) {
    if (
      v.city &&
      !stops.some((s) => s.city.toLowerCase() === v.city.toLowerCase())
    ) {
      stops.push({ city: v.city, distanceKm: Number(v.distanceKm) || 0 });
    }
  }
  if (
    trip.destination &&
    !stops.some((s) => s.city.toLowerCase() === trip.destination.toLowerCase())
  ) {
    stops.push({
      city: trip.destination,
      distanceKm: Number(trip.distanceKm) || 0,
    });
  }

  if (stops.length < 2) return [];

  const rows: SegmentFareDraft[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    for (let j = i + 1; j < stops.length; j++) {
      if (i > 0 && stops.length > 6 && j < stops.length - 1) continue;
      const from = stops[i];
      const to = stops[j];
      const dist =
        to.distanceKm > 0 && to.distanceKm >= from.distanceKm
          ? to.distanceKm - from.distanceKm
          : 0;
      const saved = existing.get(
        `${from.city.toLowerCase()}->${to.city.toLowerCase()}`,
      );
      rows.push({
        fromCity: from.city,
        toCity: to.city,
        distanceKm: saved?.distanceKm ?? dist,
        fareRupees:
          saved !== undefined
            ? String(saved.farePaise / 100)
            : String(defaultFareRupees),
      });
    }
  }
  return rows;
}

export function SeatWiseFareModal({
  trip,
  seats,
  fareOverrides,
  setFareOverrides,
  fareSaving,
  error,
  canRepriceSeat,
  onClose,
  onSave,
}: {
  trip: CounterTrip;
  seats: InventorySeat[];
  fareOverrides: Record<string, string>;
  setFareOverrides: React.Dispatch<
    React.SetStateAction<Record<string, string>>
  >;
  fareSaving: boolean;
  error: string;
  canRepriceSeat: (seat: InventorySeat) => boolean;
  onClose: () => void;
  onSave: (
    segmentFares?: {
      fromCity: string;
      toCity: string;
      distanceKm?: number;
      farePaise: number;
    }[],
  ) => void;
}) {
  const repricableSeats = useMemo(
    () => seats.filter(canRepriceSeat),
    [seats, canRepriceSeat],
  );

  const defaultBaseRupees = useMemo(() => {
    if (trip.baseFarePaise != null) return Math.round(trip.baseFarePaise / 100);
    const first = repricableSeats[0];
    return first ? Math.round(first.farePaise / 100) : 500;
  }, [trip.baseFarePaise, repricableSeats]);

  const [bulkSeatsInput, setBulkSeatsInput] = useState("");
  const [bulkFareInput, setBulkFareInput] = useState(String(defaultBaseRupees));
  const [adjustValue, setAdjustValue] = useState("");
  const [adjustMode, setAdjustMode] = useState<"amt" | "pct">("amt");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  const [segments, setSegments] = useState<SegmentFareDraft[]>(() =>
    buildInitialSegments(trip, defaultBaseRupees),
  );
  const [segmentsDirty, setSegmentsDirty] = useState(false);

  const selectedBulkSeats = useMemo(() => {
    const tokens = bulkSeatsInput
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const validMap = new Map(
      repricableSeats.map((s) => [s.number.toUpperCase(), s.number]),
    );
    return tokens.map((t) => validMap.get(t)).filter(Boolean) as string[];
  }, [bulkSeatsInput, repricableSeats]);

  const previewSeats = useMemo(
    () =>
      seats.map((seat) => {
        const override = fareOverrides[seat.number];
        if (override && /^\d+(\.\d{1,2})?$/.test(override.trim())) {
          return {
            ...seat,
            farePaise: Math.round(Number(override.trim()) * 100),
          };
        }
        return seat;
      }),
    [seats, fareOverrides],
  );

  const filteredSegments = useMemo(
    () =>
      segments.filter(
        (seg) =>
          (!filterFrom.trim() ||
            seg.fromCity.toLowerCase().includes(filterFrom.trim().toLowerCase())) &&
          (!filterTo.trim() ||
            seg.toCity.toLowerCase().includes(filterTo.trim().toLowerCase())),
      ),
    [segments, filterFrom, filterTo],
  );

  const togglePreviewSeat = (seatNum: string) => {
    const current = [...selectedBulkSeats];
    const exists = current.includes(seatNum);
    const next = exists
      ? current.filter((s) => s !== seatNum)
      : [...current, seatNum];
    setBulkSeatsInput(next.join(", "));
  };

  const applyToSelectedSeats = () => {
    const amount = bulkFareInput.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(amount)) return;
    const targets = selectedBulkSeats.length
      ? selectedBulkSeats
      : repricableSeats.map((s) => s.number);
    setFareOverrides((prev) => {
      const next = { ...prev };
      for (const s of targets) next[s] = amount;
      return next;
    });
  };

  const applySamePriceAll = () => {
    const amount = bulkFareInput.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(amount)) return;
    setFareOverrides(() => {
      const next: Record<string, string> = {};
      for (const seat of repricableSeats) next[seat.number] = amount;
      return next;
    });
    if (segments.length > 0) {
      setSegments((prev) => prev.map((seg) => ({ ...seg, fareRupees: amount })));
      setSegmentsDirty(true);
    }
  };

  const autoCalculateByDistance = () => {
    const baseFull = Number(bulkFareInput.trim()) || defaultBaseRupees;
    if (baseFull <= 0 || segments.length === 0) return;
    const maxDist = Math.max(
      Number(trip.distanceKm) || 0,
      ...segments.map((s) => s.distanceKm || 0),
    );
    if (maxDist <= 0) return;
    setSegments((prev) =>
      prev.map((seg) => {
        if (!seg.distanceKm || seg.distanceKm <= 0) {
          return { ...seg, fareRupees: String(baseFull) };
        }
        const computed = Math.max(
          50,
          Math.round((baseFull * seg.distanceKm) / maxDist / 10) * 10,
        );
        return { ...seg, fareRupees: String(computed) };
      }),
    );
    setSegmentsDirty(true);
  };

  const applyAdjustment = () => {
    const delta = Number(adjustValue);
    if (isNaN(delta) || delta === 0) return;
    setFareOverrides((prev) => {
      const next = { ...prev };
      for (const seat of repricableSeats) {
        const cur = Number(prev[seat.number] ?? seat.farePaise / 100);
        const updated =
          adjustMode === "pct"
            ? Math.max(0, Math.round(cur * (1 + delta / 100)))
            : Math.max(0, Math.round((cur + delta) * 100) / 100);
        next[seat.number] = String(updated);
      }
      return next;
    });
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!segmentsDirty) {
      onSave(undefined);
      return;
    }
    const segmentPayload = segments.map((seg) => ({
      fromCity: seg.fromCity,
      toCity: seg.toCity,
      distanceKm: seg.distanceKm || 0,
      farePaise: Math.round((Number(seg.fareRupees) || 0) * 100),
    }));
    onSave(segmentPayload);
  };

  const canSubmit =
    !fareSaving && (Object.keys(fareOverrides).length > 0 || segmentsDirty);

  return (
    <Overlay
      title="Seat-wise Fare"
      onClose={() => {
        if (!fareSaving) onClose();
      }}
      className="car-editor-dialog crs-wide-workbench"
    >
      <form className="car-editor-form" onSubmit={handleSubmit}>
        <div className="crs-console-subbar">
          <div className="crs-subbar-meta">
            <span>
              <strong>Route:</strong> {trip.route}
            </span>
            <span>
              <strong>Date:</strong> {trip.journeyDate}
            </span>
            <span>
              <strong>Dep:</strong> {formatIstTime(trip.departureAt)} IST
            </span>
            <span>
              <strong>Vehicle:</strong> {trip.registration || trip.busName}
            </span>
            {trip.distanceKm ? (
              <span>
                <strong>Dist:</strong> {trip.distanceKm} km
              </span>
            ) : null}
          </div>
          {trip.viaLabel && (
            <span className="crs-via-pill">
              <MapPin size={12} /> {trip.viaLabel}
            </span>
          )}
        </div>

        <div className="crs-modal-split">
          <div className="crs-modal-main">
            {/* Compact Auto-Assign & Bulk Pricing Toolbar */}
            <div className="crs-console-toolbar">
              <div className="crs-toolbar-field crs-toolbar-seats">
                <span>Seat Nos. (Comma Separated or Click Map)</span>
                <input
                  type="text"
                  placeholder="e.g. FP, 2L, 2R (empty = all)"
                  value={bulkSeatsInput}
                  disabled={fareSaving}
                  onChange={(e) => setBulkSeatsInput(e.target.value)}
                />
              </div>
              <div className="crs-toolbar-field crs-toolbar-fare">
                <span>Fare (₹)</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={bulkFareInput}
                  disabled={fareSaving}
                  onChange={(e) => setBulkFareInput(e.target.value)}
                />
              </div>
              <div className="crs-toolbar-btns">
                <button
                  type="button"
                  className="btn secondary"
                  disabled={fareSaving || !bulkFareInput.trim()}
                  onClick={applyToSelectedSeats}
                >
                  Apply Seats
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={fareSaving || !bulkFareInput.trim()}
                  onClick={applySamePriceAll}
                >
                  Same Price All
                </button>
                {segments.some((s) => s.distanceKm > 0) && (
                  <button
                    type="button"
                    className="btn primary crs-auto-calc-btn"
                    disabled={fareSaving}
                    onClick={autoCalculateByDistance}
                  >
                    <Calculator size={13} />
                    Auto-Calculate by Distance
                  </button>
                )}
              </div>
              <div className="crs-toolbar-adjust">
                <input
                  type="number"
                  placeholder={adjustMode === "pct" ? "+10%" : "+50"}
                  value={adjustValue}
                  disabled={fareSaving}
                  onChange={(e) => setAdjustValue(e.target.value)}
                />
                <select
                  aria-label="Adjustment mode"
                  value={adjustMode}
                  disabled={fareSaving}
                  onChange={(e) =>
                    setAdjustMode(e.target.value as "amt" | "pct")
                  }
                >
                  <option value="amt">₹</option>
                  <option value="pct">%</option>
                </select>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={fareSaving || !adjustValue}
                  onClick={applyAdjustment}
                >
                  Adjust
                </button>
              </div>
            </div>

            {/* Compact Seat-wise Quick Override Matrix */}
            <div className="crs-compact-seats-wrap">
              <div className="crs-compact-head">
                <strong>Available Seat Fares ({repricableSeats.length})</strong>
                <span>Type rupee override or use bulk bar above</span>
              </div>
              <div className="trip-fare-grid">
                {repricableSeats.map((seat) => {
                  const isSelected = selectedBulkSeats.includes(seat.number);
                  return (
                    <label
                      key={seat.number}
                      className={`crs-seat-fare-cell${isSelected ? " active" : ""}`}
                    >
                      <span className="crs-seat-fare-lbl">
                        Seat {seat.number} · {money(seat.farePaise / 100)}
                      </span>
                      <input
                        inputMode="decimal"
                        placeholder={String(seat.farePaise / 100)}
                        disabled={fareSaving}
                        value={fareOverrides[seat.number] ?? ""}
                        onChange={(event) => {
                          const value = event.target.value;
                          setFareOverrides((current) => {
                            const next = { ...current };
                            if (value.trim()) next[seat.number] = value;
                            else delete next[seat.number];
                            return next;
                          });
                        }}
                      />
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Crisp CRS Segment / Stop-to-Stop Table */}
            {segments.length > 0 && (
              <div className="crs-segment-table-wrap">
                <table className="crs-segment-table">
                  <thead>
                    <tr>
                      <th>From City</th>
                      <th>To City</th>
                      <th>Dist (km)</th>
                      <th>Seat Nos.</th>
                      <th>SeatWise Fare (₹)</th>
                    </tr>
                    <tr className="crs-filter-row">
                      <th>
                        <input
                          type="text"
                          placeholder="Filter From City"
                          value={filterFrom}
                          onChange={(e) => setFilterFrom(e.target.value)}
                        />
                      </th>
                      <th>
                        <input
                          type="text"
                          placeholder="Filter To City"
                          value={filterTo}
                          onChange={(e) => setFilterTo(e.target.value)}
                        />
                      </th>
                      <th />
                      <th />
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSegments.map((seg) => {
                      const idx = segments.findIndex(
                        (s) =>
                          s.fromCity === seg.fromCity && s.toCity === seg.toCity,
                      );
                      return (
                        <tr key={`${seg.fromCity}->${seg.toCity}`}>
                          <td>{seg.fromCity}</td>
                          <td>{seg.toCity}</td>
                          <td className="crs-num-cell">
                            {seg.distanceKm > 0 ? `${seg.distanceKm} km` : "—"}
                          </td>
                          <td className="crs-muted-cell">
                            {selectedBulkSeats.length
                              ? selectedBulkSeats.join(", ")
                              : "All available"}
                          </td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              disabled={fareSaving}
                              value={seg.fareRupees}
                              onChange={(e) => {
                                const val = e.target.value;
                                setSegments((prev) =>
                                  prev.map((row, rIdx) =>
                                    rIdx === idx
                                      ? { ...row, fareRupees: val }
                                      : row,
                                  ),
                                );
                                setSegmentsDirty(true);
                              }}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {error && (
              <p className="counter-alert error" role="alert">
                {error}
              </p>
            )}
          </div>

          <div className="crs-modal-preview">
            <div className="crs-preview-title">
              <strong>Live Chart Preview</strong>
              <span>{trip.busType || "Vehicle"}</span>
            </div>
            <SeatMap
              variant="counter-chart"
              vehicleType={trip.busType}
              title="Live seat layout"
              seats={previewSeats}
              selected={selectedBulkSeats}
              onToggle={togglePreviewSeat}
              disabled={fareSaving}
              selectable={["available"]}
            />
            <div className="crs-preview-selected">
              <span>Selected:</span>{" "}
              <strong>
                {selectedBulkSeats.length
                  ? selectedBulkSeats.join(", ")
                  : "None (applies to all)"}
              </strong>
            </div>
          </div>
        </div>

        <div className="car-editor-footer">
          <button
            type="button"
            className="btn secondary"
            disabled={fareSaving}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="btn primary" disabled={!canSubmit}>
            {fareSaving ? "Saving…" : "Save fares"}
          </button>
        </div>
      </form>
    </Overlay>
  );
}

export function TripScheduleModal({
  trip,
  seats,
  schedule,
  setSchedule,
  scheduleSaving,
  scheduleError,
  onClose,
  onSwitchRepeat,
  onSave,
}: {
  trip: CounterTrip;
  seats: InventorySeat[];
  schedule: { departure: string; arrival: string; arrivalDate: string };
  setSchedule: React.Dispatch<
    React.SetStateAction<{
      departure: string;
      arrival: string;
      arrivalDate: string;
    }>
  >;
  scheduleSaving: boolean;
  scheduleError: string;
  onClose: () => void;
  onSwitchRepeat: () => void;
  onSave: () => void;
}) {
  const stopRows = useMemo(() => {
    const rows: {
      city: string;
      distanceKm: number;
      durationMinutes: number;
    }[] = [];
    if (trip.source)
      rows.push({ city: trip.source, distanceKm: 0, durationMinutes: 0 });
    for (const v of trip.viaStops || []) {
      if (v.city) {
        rows.push({
          city: v.city,
          distanceKm: Number(v.distanceKm) || 0,
          durationMinutes: Number(v.durationMinutes) || 0,
        });
      }
    }
    if (trip.destination) {
      rows.push({
        city: trip.destination,
        distanceKm: Number(trip.distanceKm) || 0,
        durationMinutes: Number(trip.durationMinutes) || 0,
      });
    }
    return rows;
  }, [trip]);

  return (
    <Overlay
      title="Trip Schedule"
      onClose={() => {
        if (!scheduleSaving) onClose();
      }}
      className="car-editor-dialog crs-wide-workbench"
    >
      <form
        className="car-editor-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <div className="crs-console-subbar">
          <div className="crs-subbar-meta">
            <span>
              <strong>Route:</strong> {trip.route}
            </span>
            <span>
              <strong>Journey Date:</strong> {trip.journeyDate}
            </span>
            <span>
              <strong>Vehicle:</strong> {trip.registration || trip.busName}
            </span>
            {trip.distanceKm ? (
              <span>
                <strong>Distance:</strong> {trip.distanceKm} km
              </span>
            ) : null}
          </div>
          <button
            className="btn secondary"
            type="button"
            disabled={scheduleSaving}
            onClick={onSwitchRepeat}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              minHeight: "32px",
              padding: "4px 12px",
              fontSize: "12px",
            }}
          >
            <CalendarPlus size={14} />
            Schedule more dates
          </button>
        </div>

        <div className="crs-modal-split">
          <div className="crs-modal-main">
            <div className="crs-console-toolbar">
              <div className="crs-schedule-head">
                <strong>
                  <Clock size={14} /> Edit this departure
                </strong>
                <span>
                  Timing changes require a trip with no booking history or reserved seats.
                </span>
              </div>
              <div className="crs-schedule-inputs">
                <label>
                  Departure time (IST)
                  <input
                    required
                    type="time"
                    value={schedule.departure}
                    disabled={scheduleSaving}
                    onChange={(event) =>
                      setSchedule({
                        ...schedule,
                        departure: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Arrival date
                  <input
                    required
                    type="date"
                    min={trip.journeyDate}
                    value={schedule.arrivalDate}
                    disabled={scheduleSaving}
                    onChange={(event) =>
                      setSchedule({
                        ...schedule,
                        arrivalDate: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Arrival time (IST)
                  <input
                    required
                    type="time"
                    value={schedule.arrival}
                    disabled={scheduleSaving}
                    onChange={(event) =>
                      setSchedule({ ...schedule, arrival: event.target.value })
                    }
                  />
                </label>
              </div>
            </div>

            {stopRows.length > 0 && (
              <div className="crs-segment-table-wrap">
                <table className="crs-segment-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>
                        Stop City {trip.viaLabel ? `(${trip.viaLabel})` : ""}
                      </th>
                      <th>Distance</th>
                      <th>Approx Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stopRows.map((stop, idx) => (
                      <tr key={`${stop.city}-${idx}`}>
                        <td className="crs-num-cell">{idx + 1}</td>
                        <td>
                          <strong>{stop.city}</strong>
                        </td>
                        <td className="crs-num-cell">
                          {stop.distanceKm > 0 ? `${stop.distanceKm} km` : "0 km"}
                        </td>
                        <td className="crs-muted-cell">
                          {stop.durationMinutes > 0
                            ? `+${Math.floor(stop.durationMinutes / 60)}h ${stop.durationMinutes % 60}m`
                            : "Start"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {trip.amenities && trip.amenities.length > 0 && (
              <div className="crs-inline-amenities-bar">
                <strong>Amenities:</strong>
                {trip.amenities.map((a) => (
                  <span key={a} className="crs-mini-amenity-tag">
                    <Check size={11} /> {a}
                  </span>
                ))}
              </div>
            )}

            {scheduleError && (
              <p className="counter-alert error" role="alert">
                {scheduleError}
              </p>
            )}
          </div>

          <div className="crs-modal-preview">
            <div className="crs-preview-title">
              <strong>Vehicle Seat Occupancy</strong>
              <span>{trip.busType || "Vehicle"}</span>
            </div>
            <SeatMap
              variant="counter-chart"
              vehicleType={trip.busType}
              title="Vehicle occupancy"
              seats={seats}
              selected={[]}
              onToggle={() => {}}
              disabled={true}
              selectable={[]}
            />
          </div>
        </div>

        <div className="car-editor-footer">
          <button
            className="btn secondary"
            type="button"
            disabled={scheduleSaving}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="btn primary" disabled={scheduleSaving}>
            {scheduleSaving ? "Saving…" : "Save timing"}
          </button>
        </div>
      </form>
    </Overlay>
  );
}

export function TripAmenitiesModal({
  trip,
  amenities,
  setAmenities,
  amenitiesSaving,
  amenitiesError,
  onClose,
  onSave,
}: {
  trip: CounterTrip;
  amenities: string[];
  setAmenities: (value: string[]) => void;
  amenitiesSaving: boolean;
  amenitiesError: string;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <Overlay
      title="Trip amenities"
      onClose={() => {
        if (!amenitiesSaving) onClose();
      }}
      className="car-editor-dialog crs-wide-workbench crs-amenities-dialog"
    >
      <form
        className="car-editor-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <div className="crs-console-subbar">
          <div className="crs-subbar-meta">
            <span>
              <strong>Route:</strong> {trip.route}
            </span>
            <span>
              <strong>Date:</strong> {trip.journeyDate}
            </span>
            <span>
              <strong>Dep:</strong> {formatIstTime(trip.departureAt)} IST
            </span>
            <span>
              <strong>Vehicle:</strong> {trip.registration || trip.busName}
            </span>
          </div>
          <span className="crs-via-pill">
            <Sparkles size={12} /> {amenities.length} selected
          </span>
        </div>

        <div className="car-editor-body">
          <p className="car-editor-intro">
            Select onboard facilities for this departure. Partner API trip details reflect changes immediately after saving.
          </p>
          <TripAmenitiesFields
            value={amenities}
            onChange={setAmenities}
            disabled={amenitiesSaving}
          />
          {amenitiesError && (
            <p className="counter-alert error" role="alert">
              {amenitiesError}
            </p>
          )}
        </div>
        <div className="car-editor-footer">
          <button
            className="btn secondary"
            type="button"
            disabled={amenitiesSaving}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="btn primary" disabled={amenitiesSaving}>
            {amenitiesSaving ? "Saving…" : "Save amenities"}
          </button>
        </div>
      </form>
    </Overlay>
  );
}
