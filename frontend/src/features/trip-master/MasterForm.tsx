import { useState } from "react";
import { api } from "../../api/client";
import { Overlay } from "../../components/index";
import { CrewFields } from "../fleet/components/CrewFields";
import { asIso, configs, localNow, optionLabel } from "./config";
export function MasterForm({
  resource,
  record,
  lookup,
  onClose,
  onSaved,
}: {
  resource: string;
  record?: any;
  lookup: Record<string, any[]>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const config = configs[resource];
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      config.fields.map((f) => [
        f.key,
        record?.[f.key] !== undefined
          ? String(
              f.money
                ? Number(record[f.key]) /
                    (f.key === "litresMillilitres" ? 1000 : 100)
                : record[f.key],
            )
          : f.key === "scope"
            ? record?.tripId
              ? "Trip"
              : "Service"
            : f.type === "datetime-local"
              ? localNow()
              : f.options?.[0] ||
                (f.type === "number" && !f.optional ? "0" : ""),
      ]),
    ),
  );
  const [days, setDays] = useState<number[]>(
    record?.daysOfWeek || [0, 1, 2, 3, 4, 5, 6],
  );
  const [crew, setCrew] = useState<string[]>(
    (record?.crewIds || []).map(String),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  const visible = config.fields.filter((f) =>
    resource === "commissions"
      ? f.key !== (values.scope === "Trip" ? "serviceId" : "tripId") &&
        f.key !== (values.kind === "Fixed" ? "basisPoints" : "fixedPaise")
      : resource === "stops"
        ? !["locationId", "poiId", "name"].includes(f.key) ||
          f.key ===
            (values.kind === "POI"
              ? "poiId"
              : values.kind === "Other"
                ? "name"
                : "locationId")
        : true,
  );
  return (
    <Overlay
      title={`${record ? "Edit" : "Add"} ${config.title.toLowerCase()}`}
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            const payload: Record<string, any> = {};
            for (const f of visible) {
              if (f.key === "scope") continue;
              const value = values[f.key];
              if (f.optional && !value) continue;
              payload[f.key] = f.money
                ? Math.round(
                    Number(value) *
                      (f.key === "litresMillilitres" ? 1000 : 100),
                  )
                : f.type === "number"
                  ? Number(value)
                  : f.type === "datetime-local"
                    ? asIso(value)
                    : value;
            }
            if (resource === "services") {
              payload.daysOfWeek = days;
              payload.crewIds = crew;
            }
            await api(
              `/operator/trip-master/${resource}${record ? `/${record._id}` : ""}`,
              {
                method: record ? "PATCH" : "POST",
                headers: { "Idempotency-Key": key },
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
        <fieldset disabled={busy} className="tm-fieldset">
          <div className="form-grid">
            {visible.map((f) => (
              <label key={f.key}>
                {f.label}
                {f.optional ? " · optional" : ""}
                {f.lookup || f.options ? (
                  <select
                    required={!f.optional}
                    value={values[f.key] || ""}
                    onChange={(e) =>
                      setValues({ ...values, [f.key]: e.target.value })
                    }
                  >
                    {!f.options && (
                      <option value="">Select {f.label.toLowerCase()}</option>
                    )}
                    {f.options?.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                    {f.lookup &&
                      (lookup[f.lookup] || [])
                        .filter(
                          (r) =>
                            r.status !== "Inactive" || r._id === values[f.key],
                        )
                        .map((r) => (
                          <option key={r._id} value={r._id}>
                            {optionLabel(f.lookup!, r, lookup)}
                          </option>
                        ))}
                  </select>
                ) : (
                  <input
                    required={!f.optional}
                    type={f.money ? "number" : f.type || "text"}
                    min={f.money || f.type === "number" ? 0 : undefined}
                    step={
                      f.money
                        ? f.key === "litresMillilitres"
                          ? "0.001"
                          : "0.01"
                        : f.type === "number"
                          ? "any"
                          : undefined
                    }
                    value={values[f.key] || ""}
                    onChange={(e) =>
                      setValues({ ...values, [f.key]: e.target.value })
                    }
                  />
                )}
              </label>
            ))}
            {resource === "services" && (
              <>
                <fieldset className="tm-full">
                  <legend>Operating days</legend>
                  <div className="tm-checks">
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                      (day, i) => (
                        <label key={day}>
                          <input
                            type="checkbox"
                            checked={days.includes(i)}
                            onChange={() =>
                              setDays(
                                days.includes(i)
                                  ? days.filter((d) => d !== i)
                                  : [...days, i],
                              )
                            }
                          />
                          {day}
                        </label>
                      ),
                    )}
                  </div>
                </fieldset>
                <div className="tm-full">
                  <CrewFields selected={crew} onChange={setCrew} />
                  <p className="muted">
                    Service fares apply to new trips. Existing trip prices stay
                    unchanged.
                  </p>
                </div>
              </>
            )}
            {resource === "commissions" && (
              <p className="muted tm-full">
                Base fare means fare after discounts, before tax and charges. A
                trip rule overrides a service rule. Fixed commission is per
                booking; it does not increase the passenger fare.
              </p>
            )}
            {resource === "links" && (
              <p className="muted tm-full">
                Links record related journeys. Each trip keeps its own booking
                and payment.
              </p>
            )}
            {error && (
              <p role="alert" className="error tm-full">
                {error}
              </p>
            )}
          </div>
        </fieldset>
        <div className="dialog-foot">
          <button
            type="button"
            className="btn"
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
