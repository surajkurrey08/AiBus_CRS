import { useEffect, useState } from "react";
import { loadAllRecords } from "../../api/loadAll";
import { type Row } from "../../data/demo-data.ts";
import { Overlay } from "../ui/Overlay";

export function RecordForm({
  title,
  fields,
  record,
  onSave,
  onClose,
}: {
  title: string;
  fields: string[];
  record?: Row;
  onSave: (v: Row) => void | Promise<void>;
  onClose: () => void;
}) {
  const routeForm = /^(add|edit) route$/i.test(title);
  const [areaCities, setAreaCities] = useState<Record<string, any>[]>([]);
  useEffect(() => {
    if (!routeForm) return;
    const controller = new AbortController();
    loadAllRecords("/operator/area-master/cities", controller.signal)
      .then((rows) => {
        if (!controller.signal.aborted)
          setAreaCities(rows.filter((city) => city.status === "Active"));
      })
      .catch(() => {});
    return () => controller.abort();
  }, [routeForm]);
  const [values, setValues] = useState<Row>(() => {
    if (!routeForm) return record || {};
    const cities = (record?.route || "").split(/\s*(?:→| to )\s*/i);
    return {
      status: "Active",
      ...record,
      source: record?.source || cities[0] || "",
      destination: record?.destination || cities[1] || "",
    };
  });
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const busForm = /^(add|edit) bus$/i.test(title);
  const fareForm = /^(add|edit) fare$/i.test(title);
  const labelFor = (field: string) =>
    field === "commissionType"
      ? "Commission Strategy"
      : field === "commissionRate"
        ? values["commissionType"] === "Fixed"
          ? "Fixed Commission (₹ per booking)"
          : "Commission Percentage (%)"
        : busForm && field === "id"
          ? "Vehicle registration number"
          : fareForm
            ? {
                route: "Route",
                weekday: "Double-side weekday fare · INR per person",
                single: "Single-side weekday fare · INR per person",
                weekend: "Double-side weekend fare · INR per person",
                singleWeekend: "Single-side weekend fare · INR per person",
              }[field] || field
            : routeForm
              ? {
                  source: "From city",
                  destination: "To city",
                  boarding: "Boarding stops",
                  dropping: "Dropping stops",
                  departure: "Departure time · IST",
                  arrival: "Arrival time · IST",
                  durationMinutes: "Journey duration · minutes",
                  status: "Route status",
                }[field] || field
              : field.replace(/^./, (v) => v.toUpperCase());
  const routeHelp: Record<string, string> = {
    source: "Pune",
    destination: "Mumbai",
    boarding: "Nigdi, Wakad",
    dropping: "Vashi, Dadar",
    durationMinutes: "e.g. 240 for 4 hours",
  };
  return (
    <Overlay title={title} onClose={onClose}>
      <form
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          const missing = fields.find((f) => !values[f]?.trim());
          if (missing) {
            setError(missing);
            document.getElementById(`field-${missing}`)?.focus();
            return;
          }
          const numeric = fields.find(
            (f) =>
              [
                "fare",
                "weekday",
                "weekend",
                "single",
                "singleWeekend",
                "festival",
                "capacity",
              ].includes(f) &&
              (!Number.isFinite(Number(values[f])) || Number(values[f]) <= 0),
          );
          if (numeric) {
            setError(numeric);
            document.getElementById(`field-${numeric}`)?.focus();
            return;
          }
          if (
            busForm &&
            !/^[A-Z\d]{5,20}$/.test(
              (values.id || "").toUpperCase().replace(/[\s-]/g, ""),
            )
          ) {
            setError("id");
            document.getElementById("field-id")?.focus();
            return;
          }
          if (
            busForm &&
            (!Number.isInteger(Number(values.capacity)) ||
              Number(values.capacity) > 100)
          ) {
            setError("capacity");
            document.getElementById("field-capacity")?.focus();
            return;
          }
          if (saving) return;
          if (routeForm) {
            const invalid =
              ["departure", "arrival"].find(
                (f) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(values[f] || ""),
              ) ||
              (!Number.isInteger(Number(values.durationMinutes)) ||
              Number(values.durationMinutes) < 1 ||
              Number(values.durationMinutes) > 4320
                ? "durationMinutes"
                : "") ||
              (values.source.trim().toLowerCase() ===
              values.destination.trim().toLowerCase()
                ? "destination"
                : "") ||
              ["boarding", "dropping"].find((f) =>
                values[f].split(",").some((s) => !s.trim()),
              );
            if (invalid) {
              setError(invalid);
              document.getElementById(`field-${invalid}`)?.focus();
              return;
            }
          }
          setSaving(true);
          setSaveError("");
          try {
            await onSave(
              routeForm
                ? {
                    ...values,
                    route: `${values.source.trim()} → ${values.destination.trim()}`,
                  }
                : values,
            );
          } catch (error) {
            setSaveError(
              error instanceof Error ? error.message : "Could not save changes",
            );
          } finally {
            setSaving(false);
          }
        }}
      >
        {routeForm && (
          <div className="route-form-guide">
            Define the cities, stops and schedule. Times are in IST. For
            overnight journeys, enter the next morning’s arrival time and the
            full journey duration.
          </div>
        )}
        <div className="form-grid">
          {fields.map((f) => (
            <label key={f} htmlFor={`field-${f}`}>
              {labelFor(f)}
              {f === "type" ? (
                <select
                  id={`field-${f}`}
                  aria-label={labelFor(f)}
                  value={values[f] || ""}
                  onChange={(e) =>
                    setValues({ ...values, [f]: e.target.value })
                  }
                >
                  <option value="">Choose vehicle type</option>
                  {[
                    "AC Sleeper",
                    "Non-AC Sleeper",
                    "AC Seater",
                    "Non-AC Seater",
                    "Semi Sleeper",
                    "Mixed Seater/Sleeper",
                  ].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              ) : f === "role" ? (
                <select
                  id={`field-${f}`}
                  value={values[f] || ""}
                  onChange={(e) =>
                    setValues({ ...values, [f]: e.target.value })
                  }
                >
                  <option value="">Choose role</option>
                  <option value="booking_staff">Booking staff</option>
                  <option value="manager">Manager</option>
                  <option value="read_only">Read Only</option>
                </select>
              ) : f === "commissionType" ? (
                <select
                  id={`field-${f}`}
                  value={values[f] || "Percent"}
                  onChange={(e) =>
                    setValues({ ...values, [f]: e.target.value })
                  }
                >
                  <option value="Percent">Percentage of Fare (%)</option>
                  <option value="Fixed">Fixed Amount per Booking (₹)</option>
                </select>
              ) : f === "commissionRate" ? (
                <input
                  id={`field-${f}`}
                  type="number"
                  min="0"
                  step="any"
                  placeholder={
                    values["commissionType"] === "Fixed"
                      ? "e.g. 50 (in ₹)"
                      : "e.g. 5 (5% commission)"
                  }
                  value={values[f] ?? ""}
                  onChange={(e) =>
                    setValues({ ...values, [f]: e.target.value })
                  }
                />
              ) : f === "status" ? (
                <select
                  id={`field-${f}`}
                  value={values[f] || ""}
                  onChange={(e) =>
                    setValues({ ...values, [f]: e.target.value })
                  }
                >
                  <option value="">Choose status</option>
                  <option>Active</option>
                  <option>Inactive</option>
                  {!routeForm && <option>Scheduled</option>}
                </select>
              ) : (
                <input
                  id={`field-${f}`}
                  aria-label={labelFor(f)}
                  list={
                    routeForm && ["source", "destination"].includes(f)
                      ? "route-city-options"
                      : undefined
                  }
                  type={
                    f === "password"
                      ? "password"
                      : f === "email"
                        ? "email"
                        : routeForm && ["departure", "arrival"].includes(f)
                          ? "time"
                          : routeForm && f === "durationMinutes"
                            ? "number"
                            : fareForm && f !== "route"
                              ? "number"
                              : "text"
                  }
                  min={
                    fareForm && f !== "route"
                      ? 0.01
                      : routeForm && f === "durationMinutes"
                        ? 1
                        : undefined
                  }
                  max={routeForm && f === "durationMinutes" ? 4320 : undefined}
                  step={
                    fareForm && f !== "route"
                      ? "0.01"
                      : routeForm && f === "durationMinutes"
                        ? 1
                        : undefined
                  }
                  autoComplete={f === "password" ? "new-password" : undefined}
                  placeholder={
                    busForm && f === "id"
                      ? "e.g. MH 12 AB 1234"
                      : routeForm
                        ? routeHelp[f]
                        : undefined
                  }
                  value={values[f] || ""}
                  aria-invalid={error === f}
                  aria-describedby={
                    error === f
                      ? "field-error"
                      : busForm && f === "id"
                        ? "registration-help"
                        : undefined
                  }
                  onChange={(e) => {
                    setValues({ ...values, [f]: e.target.value });
                    setError("");
                  }}
                />
              )}
              {routeForm && ["boarding", "dropping"].includes(f) && (
                <small>Separate multiple stops with commas.</small>
              )}
              {routeForm && f === "durationMinutes" && (
                <small>
                  4 hours = 240 minutes. Include stops and overnight travel.
                </small>
              )}
              {busForm && f === "id" && error !== f && (
                <small id="registration-help">
                  Enter the vehicle registration number, e.g. MH 12 AB 1234.
                  This is not an internal bus ID.
                </small>
              )}
              {error === f && (
                <small className="error" id="field-error">
                  {busForm && f === "id"
                    ? "Enter a vehicle registration number with 5–20 letters or digits, e.g. MH 12 AB 1234."
                    : busForm && f === "capacity"
                      ? "Enter a whole-number capacity from 1 to 100."
                      : routeForm
                        ? f === "durationMinutes"
                          ? "Enter whole minutes from 1 to 4320."
                          : f === "destination"
                            ? "Enter a destination different from the origin."
                            : ["departure", "arrival"].includes(f)
                              ? "Enter a valid time, e.g. 12:00 or 18:30."
                              : `Enter ${labelFor(f).toLowerCase()}; do not leave empty stops between commas.`
                        : `Enter a valid ${f} to continue.`}
                </small>
              )}
            </label>
          ))}
        </div>
        {saveError && (
          <p className="form-save-error error" role="alert">
            {saveError}
          </p>
        )}
        {routeForm && (
          <datalist id="route-city-options">
            {areaCities.map((city) => (
              <option key={city._id} value={city.name}>
                {city.state}
              </option>
            ))}
          </datalist>
        )}
        <div className="dialog-foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </Overlay>
  );
}
