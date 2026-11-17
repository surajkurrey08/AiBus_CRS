import { useState } from "react";
import { api } from "../../../api/client";
import { Overlay } from "../../../components/ui/Overlay";
import { areaFields, areaTabs } from "../areaConfig";
export function AreaForm({
  resource,
  record,
  cities,
  pois,
  onClose,
  onSaved,
}: {
  resource: string;
  record?: Record<string, any>;
  cities: Record<string, any>[];
  pois: Record<string, any>[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {
      country: "India",
      status: "Active",
      usage: "Both",
      category: "Landmark",
    };
    for (const field of areaFields[resource])
      if (record?.[field.key] !== undefined)
        initial[field.key] = String(record[field.key]);
    return initial;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Overlay
      title={`${record ? "Edit" : "Create"} ${areaTabs.find((tab) => tab.id === resource)?.label.toLowerCase()}`}
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
            const payload = Object.fromEntries(
              areaFields[resource]
                .filter((field) => !field.optional || values[field.key]?.trim())
                .map((field) => [
                  field.key,
                  field.type === "number"
                    ? Number(values[field.key])
                    : (values[field.key] || "").trim(),
                ]),
            );
            await api(
              `/operator/area-master/${resource}${record ? `/${record._id}` : ""}`,
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
          {areaFields[resource].map((field) => {
            let options = field.options?.map((value) => ({
              value,
              label: value,
            }));
            if (field.key === "cityId")
              options = cities
                .filter(
                  (city) =>
                    city.status === "Active" || city._id === record?.cityId,
                )
                .map((city) => ({
                  value: city._id,
                  label: `${city.name} · ${city.state}${city.status !== "Active" ? " (Inactive)" : ""}`,
                }));
            if (field.key === "landmarkId")
              options = pois
                .filter(
                  (poi) =>
                    poi.status === "Active" && poi.cityId === values.cityId,
                )
                .map((poi) => ({ value: poi._id, label: poi.name }));
            return (
              <label key={field.key}>
                {field.label}
                {options ? (
                  <select
                    aria-label={field.label}
                    required={!field.optional}
                    value={values[field.key] || ""}
                    onChange={(e) =>
                      setValues({
                        ...values,
                        [field.key]: e.target.value,
                        ...(field.key === "cityId" ? { landmarkId: "" } : {}),
                      })
                    }
                  >
                    <option value="">
                      {field.optional
                        ? "Not assigned"
                        : `Select ${field.label.toLowerCase()}`}
                    </option>
                    {options.map((option) => (
                      <option value={option.value} key={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    aria-label={field.label}
                    required={!field.optional}
                    type={field.type || "text"}
                    step={field.type === "number" ? "any" : undefined}
                    min={
                      field.key === "latitude"
                        ? -90
                        : field.key === "longitude"
                          ? -180
                          : undefined
                    }
                    max={
                      field.key === "latitude"
                        ? 90
                        : field.key === "longitude"
                          ? 180
                          : undefined
                    }
                    value={values[field.key] || ""}
                    onChange={(e) =>
                      setValues({ ...values, [field.key]: e.target.value })
                    }
                  />
                )}
              </label>
            );
          })}
          {resource !== "cities" && (
            <p className="muted area-full-width">
              Latitude and longitude are optional. Enter both coordinates to
              provide a map link.
            </p>
          )}
          {error && (
            <p className="error area-full-width" role="alert">
              {error}
            </p>
          )}
        </div>
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
