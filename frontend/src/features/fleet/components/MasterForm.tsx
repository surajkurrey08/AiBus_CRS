import { useState } from "react";
import { api } from "../../../api/client";
import { Overlay } from "../../../components/ui/Overlay";
import { SeatMap, type InventorySeat } from "../../../components/seats/SeatMap";
import { masterFields, masterTabs } from "../masterConfig";
import { buildSeatLayout } from "../utils/buildSeatLayout";
export function MasterForm({
  resource,
  record,
  buses,
  onClose,
  onSaved,
}: {
  resource: string;
  record?: Record<string, any>;
  buses: Record<string, any>[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {
      status: "Active",
      type: "AC Sleeper",
      role: "Driver",
      layoutType: "sleeper",
      decks: "2",
      arrangement: "2+1",
      capacity: "30",
    };
    for (const field of masterFields[resource])
      if (record?.[field.key] !== undefined)
        initial[field.key] = Array.isArray(record[field.key])
          ? record[field.key].join(", ")
          : String(record[field.key]);
    if (record?.seats) {
      initial.capacity = String(record.seats.length);
      initial.decks = record.seats.some((s: any) => s.deck === "upper")
        ? "2"
        : "1";
      const categories = new Set(record.seats.map((s: any) => s.category));
      initial.layoutType =
        categories.size > 1 ? "mixed" : record.seats[0]?.category || "sleeper";
    }
    return initial;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const capacity = Number(values.capacity);
  const preview =
    resource === "charts" &&
    Number.isInteger(capacity) &&
    capacity >= 1 &&
    capacity <= 100
      ? buildSeatLayout(capacity, values.layoutType, Number(values.decks))
      : [];
  return (
    <Overlay
      title={`${record ? "Edit" : "Create"} ${masterTabs.find((tab) => tab.id === resource)?.label.toLowerCase()}`}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            let payload: Record<string, any> = Object.fromEntries(
              masterFields[resource]
                .filter((field) => !field.optional || values[field.key]?.trim())
                .map((field) => [field.key, (values[field.key] || "").trim()]),
            );
            if (resource === "charts") {
              if (!preview.length)
                throw new Error(
                  "Seat capacity must be a whole number from 1 to 100",
                );
              payload = {
                name: values.name.trim(),
                status: values.status,
                seats: preview,
              };
            }
            if (resource === "coaches") {
              payload.decks = Number(values.decks);
              payload.amenities = (values.amenities || "")
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean);
            }
            await api(
              `/operator/bus-master/${resource}${record ? `/${record._id}` : ""}`,
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
        <div className="form-grid">
          {masterFields[resource].map((field) => {
            const options =
              field.key === "busId"
                ? buses.map((bus) => ({
                    value: bus._id,
                    label: `${bus.registration} · ${bus.name}`,
                  }))
                : field.options?.map((value) => ({ value, label: value }));
            const required =
              !field.optional ||
              (resource === "crew" &&
                values.role === "Driver" &&
                ["licenceNumber", "licenceExpiry"].includes(field.key));
            return (
              <label key={field.key}>
                {field.label}
                {options ? (
                  <select
                    aria-label={field.label}
                    required={required}
                    value={values[field.key] || ""}
                    onChange={(e) =>
                      setValues({ ...values, [field.key]: e.target.value })
                    }
                  >
                    <option value="">Select {field.label.toLowerCase()}</option>
                    {options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    aria-label={field.label}
                    required={required}
                    type={field.type || "text"}
                    min={field.key === "capacity" ? 1 : undefined}
                    max={field.key === "capacity" ? 100 : undefined}
                    step={field.type === "number" ? 1 : undefined}
                    value={values[field.key] || ""}
                    onChange={(e) =>
                      setValues({ ...values, [field.key]: e.target.value })
                    }
                  />
                )}
              </label>
            );
          })}
          {resource === "charts" && (
            <p className="muted fleet-full-width">
              Chart templates define seat positions. Apply a matching-capacity
              chart to a bus, then set fares when scheduling its trips.
            </p>
          )}
          {error && (
            <p className="error fleet-full-width" role="alert">
              {error}
            </p>
          )}
        </div>
        {resource === "charts" && (
          <div className="fleet-chart-preview">
            <SeatMap
              seats={
                preview.map((seat) => ({
                  ...seat,
                  state: "available",
                })) as InventorySeat[]
              }
              selected={[]}
              onToggle={() => {}}
              disabled
              title="Seat chart preview"
            />
          </div>
        )}
        <div className="dialog-foot">
          <button
            className="btn"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="btn primary" disabled={busy}>
            {busy ? "Saving..." : "Save changes"}
          </button>
        </div>
      </form>
    </Overlay>
  );
}
