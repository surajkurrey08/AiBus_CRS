import { useRef, useState } from "react";
import { Overlay } from "../../../components/index.ts";
import "./agent-form.css";
export const privilegeLabels = {
  search: "Search trips",
  inventory: "View seat inventory",
  book: "Create bookings and payments",
  bookings: "View agency bookings",
  tickets: "Retrieve tickets",
  cancel: "Request cancellations",
  commissions: "View own commissions",
  settlements: "View settlement availability",
  wallet: "Use agency prepaid wallet (explicit approval)",
  credit: "Use approved agency credit (explicit approval)",
};
export function AgentForm({
  agency,
  buses,
  onClose,
  onSave,
}: {
  agency: any;
  buses: any[];
  onClose: () => void;
  onSave: (value: any) => Promise<void>;
}) {
  const initial = {
    name: agency.name || "",
    email: agency.email || "",
    phone: agency.phone || "",
    status: agency.status || "Active",
    commissionType: agency.commissionType || "Percent",
    rate: String((agency.commissionRate ?? 500) / 100),
    permissions:
      agency.permissions ||
      Object.keys(privilegeLabels).filter(
        (p) => !["wallet", "credit"].includes(p),
      ),
    allowedBusIds: (agency.allowedBusIds || []).map(String),
  };
  const [value, setValue] = useState(initial),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const [invalid, setInvalid] = useState(""),
    [discard, setDiscard] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const close = () => {
    if (!saving)
      JSON.stringify(value) === JSON.stringify(initial)
        ? onClose()
        : setDiscard(true);
  };
  return (
    <Overlay title={agency.id ? "Edit agency" : "Add agency"} onClose={close}>
      <form
        ref={form}
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (saving) return;
          const field = !value.name.trim()
            ? "name"
            : value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)
              ? "email"
              : !/^\d+(\.\d{1,2})?$/.test(value.rate) ||
                  Number(value.rate) >
                    (value.commissionType === "Percent" ? 100 : 1000000)
                ? "rate"
                : "";
          if (field) {
            setInvalid(field);
            setError(
              field === "rate"
                ? "Use a non-negative amount with up to two decimals. Percentage cannot exceed 100%."
                : `Enter a valid ${field === "name" ? "agency name" : "email"}.`,
            );
            form.current
              ?.querySelector<HTMLInputElement>(`#agent-${field}`)
              ?.focus();
            return;
          }
          setSaving(true);
          setError("");
          setInvalid("");
          try {
            const { rate, ...fields } = value;
            await onSave({
              ...fields,
              ...(value.email ? {} : { email: undefined }),
              commissionRate: Math.round(Number(rate) * 100),
            });
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setSaving(false);
          }
        }}
      >
        <div className="form-grid">
          {(["name", "email", "phone"] as const).map((field) => (
            <label key={field} htmlFor={`agent-${field}`}>
              {field === "name"
                ? "Agency name"
                : field === "email"
                  ? "Agency email (optional)"
                  : "Contact phone (optional)"}
              <input
                disabled={saving}
                id={`agent-${field}`}
                type={
                  field === "email"
                    ? "email"
                    : field === "phone"
                      ? "tel"
                      : "text"
                }
                maxLength={field === "phone" ? 20 : 200}
                value={value[field]}
                aria-invalid={invalid === field}
                aria-describedby={
                  invalid === field ? "agency-form-error" : undefined
                }
                onChange={(e) =>
                  setValue({ ...value, [field]: e.target.value })
                }
              />
            </label>
          ))}
          <label htmlFor="agent-status">
            Agency status
            <select
              disabled={saving}
              id="agent-status"
              value={value.status}
              onChange={(e) => setValue({ ...value, status: e.target.value })}
            >
              <option>Active</option>
              <option>Inactive</option>
            </select>
          </label>
          <label htmlFor="agent-commission-type">
            Commission type
            <select
              disabled={saving}
              id="agent-commission-type"
              value={value.commissionType}
              onChange={(e) =>
                setValue({ ...value, commissionType: e.target.value })
              }
            >
              <option>Percent</option>
              <option>Fixed</option>
            </select>
          </label>
          <label htmlFor="agent-rate">
            {value.commissionType === "Percent"
              ? "Commission percentage (%)"
              : "Fixed commission (INR per booking)"}
            <input
              disabled={saving}
              id="agent-rate"
              type="number"
              min="0"
              max={value.commissionType === "Percent" ? 100 : 1000000}
              step="0.01"
              value={value.rate}
              aria-invalid={invalid === "rate"}
              aria-describedby={
                invalid === "rate"
                  ? "agency-form-error"
                  : "agent-commission-help"
              }
              onChange={(e) => setValue({ ...value, rate: e.target.value })}
            />
          </label>
          <p id="agent-commission-help">
            Commission applies to discounted base fare. Historical booking
            snapshots stay unchanged.
          </p>
          <fieldset className="agency-options" disabled={saving}>
            <legend>Booking privileges</legend>
            {Object.entries(privilegeLabels).map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={value.permissions.includes(key)}
                  onChange={(e) =>
                    setValue({
                      ...value,
                      permissions: e.target.checked
                        ? [...value.permissions, key]
                        : value.permissions.filter((v: string) => v !== key),
                    })
                  }
                />
                {label}
              </label>
            ))}
          </fieldset>
          <fieldset className="agency-options" disabled={saving}>
            <legend>Authorized buses</legend>
            <p>
              Leave all unchecked to allow every bus owned by this operator.
            </p>
            {buses.map((bus) => {
              const busId = String(bus._id || bus.id);
              return (
                <label key={busId}>
                  <input
                    type="checkbox"
                    checked={value.allowedBusIds.includes(busId)}
                    onChange={(e) =>
                      setValue({
                        ...value,
                        allowedBusIds: e.target.checked
                          ? [...value.allowedBusIds, busId]
                          : value.allowedBusIds.filter(
                              (v: string) => v !== busId,
                            ),
                      })
                    }
                  />
                  {bus.registration} · {bus.name}
                </label>
              );
            })}
          </fieldset>
          {error && (
            <p id="agency-form-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="dialog-actions">
          <button
            className="btn"
            type="button"
            onClick={close}
            disabled={saving}
          >
            Cancel
          </button>
          <button className="btn primary" disabled={saving} aria-busy={saving}>
            {saving ? "Saving…" : "Save agency"}
          </button>
        </div>
      </form>
      {discard && (
        <Overlay
          title="Discard agency changes?"
          onClose={() => setDiscard(false)}
        >
          <p className="settings-form">
            Your unsaved agency changes will be lost.
          </p>
          <div className="dialog-actions">
            <button className="btn" onClick={() => setDiscard(false)}>
              Keep editing
            </button>
            <button className="btn primary" onClick={onClose}>
              Discard changes
            </button>
          </div>
        </Overlay>
      )}
    </Overlay>
  );
}
