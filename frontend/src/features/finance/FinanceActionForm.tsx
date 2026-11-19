import { useRef, useState } from "react";
import { Overlay } from "../../components/index";
export function inputPaise(value: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim()))
    throw Error("Enter an INR amount with at most two decimal places.");
  const [whole, fraction = ""] = value.trim().split(".");
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (amount > BigInt(Number.MAX_SAFE_INTEGER))
    throw Error("Amount exceeds the supported limit.");
  return Number(amount);
}
export type FinanceField = {
  name: string;
  label: string;
  value?: string;
  options?: string[];
  money?: boolean;
};
export function FinanceActionForm({
  title,
  description,
  fields,
  onClose,
  onSave,
}: {
  title: string;
  description: string;
  fields: FinanceField[];
  onClose: () => void;
  onSave: (values: Record<string, string>, key: string) => Promise<void>;
}) {
  const [values, setValues] = useState(
    Object.fromEntries(fields.map((f) => [f.name, f.value || ""])),
  );
  const [review, setReview] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [invalid, setInvalid] = useState(""),
    [discard, setDiscard] = useState(false);
  const key = useRef(crypto.randomUUID()),
    form = useRef<HTMLFormElement>(null),
    dirty = useRef(false);
  const close = () => {
    if (!saving) dirty.current ? setDiscard(true) : onClose();
  };
  return (
    <Overlay title={title} onClose={close}>
      <form
        noValidate
        ref={form}
        onSubmit={async (e) => {
          e.preventDefault();
          if (saving) return;
          setError("");
          setInvalid("");
          for (const field of fields) {
            try {
              if (!values[field.name]?.trim())
                throw Error(`${field.label} is required.`);
              if (field.money) inputPaise(values[field.name]);
              if (field.name === "reason" && values.reason.trim().length < 5)
                throw Error("Provide a reason with at least five characters.");
            } catch (err) {
              setInvalid(field.name);
              setError((err as Error).message);
              form.current
                ?.querySelector<HTMLElement>(`[name="${field.name}"]`)
                ?.focus();
              return;
            }
          }
          if (!review) {
            setReview(true);
            return;
          }
          setSaving(true);
          try {
            await onSave(values, key.current);
            dirty.current = false;
            onClose();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setSaving(false);
          }
        }}
      >
        <div className="dialog-body">
          <p>{description}</p>
          {review ? (
            <>
              <h4>Review {title.toLowerCase()}</h4>
              <dl>
                {fields.map((f) => (
                  <div key={f.name}>
                    <dt>{f.label}</dt>
                    <dd>{values[f.name]}</dd>
                  </div>
                ))}
              </dl>
              <p>
                Confirm this action for the selected agency. Funding evidence
                here is isolated test-provider evidence, not a live deposit.
              </p>
            </>
          ) : (
            <div className="form-grid">
              {fields.map((f) => (
                <label key={f.name} htmlFor={`finance-${f.name}`}>
                  {f.label}
                  {f.options ? (
                    <select
                      id={`finance-${f.name}`}
                      name={f.name}
                      value={values[f.name]}
                      disabled={saving}
                      aria-invalid={invalid === f.name}
                      aria-describedby={
                        invalid === f.name ? "finance-form-error" : undefined
                      }
                      onChange={(e) => {
                        dirty.current = true;
                        setValues({ ...values, [f.name]: e.target.value });
                      }}
                    >
                      <option value="">Choose {f.label.toLowerCase()}</option>
                      {f.options.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={`finance-${f.name}`}
                      name={f.name}
                      value={values[f.name]}
                      inputMode={f.money ? "decimal" : "text"}
                      disabled={saving}
                      aria-invalid={invalid === f.name}
                      aria-describedby={
                        invalid === f.name ? "finance-form-error" : undefined
                      }
                      onChange={(e) => {
                        dirty.current = true;
                        setValues({ ...values, [f.name]: e.target.value });
                      }}
                    />
                  )}
                </label>
              ))}
            </div>
          )}
          {error && (
            <p id="finance-form-error" className="form-error" role="alert">
              {error}
            </p>
          )}
          {discard && (
            <div role="alert">
              <p>Discard these unsaved finance details?</p>
              <button
                type="button"
                className="btn"
                onClick={() => setDiscard(false)}
              >
                Keep editing
              </button>
              <button type="button" className="btn" onClick={onClose}>
                Discard changes
              </button>
            </div>
          )}
        </div>
        <div className="dialog-actions">
          <button
            type="button"
            className="btn"
            disabled={saving}
            onClick={close}
          >
            Cancel
          </button>
          {review && (
            <button
              type="button"
              className="btn"
              disabled={saving}
              onClick={() => setReview(false)}
            >
              Edit details
            </button>
          )}
          <button
            type="submit"
            className="btn primary"
            disabled={saving}
            aria-busy={saving}
          >
            {saving ? "Saving…" : review ? "Confirm action" : "Review action"}
          </button>
        </div>
      </form>
    </Overlay>
  );
}
