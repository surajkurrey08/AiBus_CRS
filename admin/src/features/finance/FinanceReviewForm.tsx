import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { Overlay } from "../../components/ui/Overlay";
import "./review-form.css";
export type ReviewField = {
  name: string;
  label: string;
  value?: string;
  type?: "date" | "password" | "email" | "number";
  optional?: boolean;
  multiple?: boolean;
  min?: number;
  max?: number;
  helperText?: string;
  placeholder?: string;
  options?: { label: string; value: string }[];
};
export function FinanceReviewForm({
  title,
  intent = "finance",
  description,
  fields,
  onSave,
  onClose,
  accountEmail,
  confirmLabel,
}: {
  title: string;
  intent?: "finance" | "platform";
  description: string;
  fields: ReviewField[];
  onSave: (values: Record<string, string>, key: string) => Promise<void>;
  onClose: () => void;
  accountEmail?: string;
  confirmLabel?: (values: Record<string, string>) => string;
}) {
  const [values, setValues] = useState(
      Object.fromEntries(fields.map((f) => [f.name, f.value || ""])),
    ),
    [review, setReview] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [invalid, setInvalid] = useState(""),
    [discard, setDiscard] = useState(false),
    [visible, setVisible] = useState<Record<string, boolean>>({});
  const key = useRef(crypto.randomUUID()),
    dirty = useRef(false),
    form = useRef<HTMLFormElement>(null),
    errorSummary = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, []);
  useEffect(() => {
    if (!error) return;
    if (invalid && !review)
      (form.current?.elements.namedItem(invalid) as HTMLElement)?.focus();
    else errorSummary.current?.focus();
  }, [error, invalid, review]);
  const update = (name: string, value: string) => {
    setValues((v) => ({ ...v, [name]: value }));
    dirty.current = true;
  };
  const close = () => {
    if (!busy) dirty.current ? setDiscard(true) : onClose();
  };
  const formatted = (field: ReviewField) =>
    field.type === "password"
      ? "Hidden; checked on confirmation"
      : field.multiple
        ? (JSON.parse(values[field.name] || "[]") as string[])
            .map(
              (value) =>
                field.options?.find((o) => o.value === value)?.label || value,
            )
            .join(", ") || "None"
        : field.options?.find((o) => o.value === values[field.name])?.label ||
          values[field.name] ||
          "Not provided";
  return (
    <Overlay title={title} onClose={close} className="review-dialog">
      <form
        ref={form}
        className="review-form"
        noValidate
        autoComplete="off"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || discard) return;
          setError("");
          setInvalid("");
          for (const field of fields) {
            const value = values[field.name] || "";
            const empty = field.multiple
              ? !(JSON.parse(value || "[]") as string[]).length
              : !value.trim();
            const invalidEmail =
              field.type === "email" &&
              !!value &&
              !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
            const invalidNumber =
              field.type === "number" &&
              !!value &&
              (!Number.isInteger(Number(value)) ||
                (field.min !== undefined && Number(value) < field.min) ||
                (field.max !== undefined && Number(value) > field.max));
            if (
              (!field.optional && empty) ||
              (field.name === "reason" && value.trim().length < 5) ||
              invalidEmail ||
              invalidNumber
            ) {
              setReview(false);
              setInvalid(field.name);
              setError(
                invalidEmail
                  ? "Enter a valid email address."
                  : invalidNumber
                    ? `Enter ${field.label.toLowerCase()} within the allowed range.`
                    : `Enter ${field.label.toLowerCase()}${field.name === "reason" ? " (at least five characters)" : ""}.`,
              );
              return;
            }
          }
          if (!review) {
            setVisible({});
            setReview(true);
            return;
          }
          setBusy(true);
          try {
            await onSave(values, key.current);
            dirty.current = false;
            onClose();
          } catch (caught) {
            if ((caught as { code?: string }).code === "STEP_UP_REQUIRED") {
              setReview(false);
              setVisible({});
              setInvalid("password");
              setValues((v) => ({ ...v, password: "" }));
              setError(
                `Password verification failed. Enter the current password for ${accountEmail || "your signed-in account"}. Your other changes have been kept.`,
              );
            } else setError((caught as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="dialog-body">
          <ol className="review-progress" aria-label="Review progress">
            <li aria-current={!review ? "step" : undefined}>
              <span>{review ? <Check size={12} /> : "1"}</span>Details
            </li>
            <ArrowRight size={14} aria-hidden="true" />
            <li aria-current={review ? "step" : undefined}>
              <span>2</span>Review &amp; confirm
            </li>
          </ol>
          <p className="review-description">{description}</p>
          {error && (
            <div
              className="review-error"
              role="alert"
              id="review-form-error"
              tabIndex={-1}
              ref={errorSummary}
            >
              <ShieldCheck size={18} />
              <span>{error}</span>
            </div>
          )}
          <div className="review-fields" hidden={review || discard}>
            {fields.map((field) => (
              <div
                className={`review-field ${field.multiple || field.name === "reason" || field.type === "password" ? "review-field-wide" : ""}`}
                key={field.name}
              >
                {field.multiple ? (
                  <fieldset name={field.name} tabIndex={-1}>
                    <legend>{field.label}</legend>
                    {field.helperText && (
                      <p className="review-help">{field.helperText}</p>
                    )}
                    <div className="review-scope-grid">
                      {field.options?.map((option) => {
                        const selected: string[] = JSON.parse(
                          values[field.name] || "[]",
                        );
                        return (
                          <label key={option.value}>
                            <input
                              type="checkbox"
                              aria-label={option.label}
                              checked={selected.includes(option.value)}
                              disabled={busy}
                              onChange={(event) =>
                                update(
                                  field.name,
                                  JSON.stringify(
                                    event.target.checked
                                      ? [...selected, option.value]
                                      : selected.filter(
                                          (v) => v !== option.value,
                                        ),
                                  ),
                                )
                              }
                            />
                            <span>{option.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                ) : (
                  <>
                    {field.type === "password" &&
                      field.name !== "initialPassword" &&
                      accountEmail && (
                        <div className="review-account">
                          <label htmlFor="review-account">
                            Signed-in account
                          </label>
                          <input
                            id="review-account"
                            name="username"
                            autoComplete="username"
                            value={accountEmail}
                            readOnly
                          />
                        </div>
                      )}
                    <label htmlFor={`review-${field.name}`}>
                      {field.label}
                    </label>
                    {field.options ? (
                      <select
                        id={`review-${field.name}`}
                        name={field.name}
                        value={values[field.name]}
                        disabled={busy}
                        aria-invalid={invalid === field.name}
                        aria-describedby={
                          invalid === field.name
                            ? "review-form-error"
                            : undefined
                        }
                        onChange={(event) =>
                          update(field.name, event.target.value)
                        }
                      >
                        <option value="">
                          Choose {field.label.toLowerCase()}
                        </option>
                        {field.options.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : field.name === "reason" ? (
                      <textarea
                        id={`review-${field.name}`}
                        name={field.name}
                        value={values[field.name]}
                        maxLength={240}
                        autoComplete="off"
                        placeholder={
                          field.placeholder ||
                          "Explain the business reason for this change"
                        }
                        disabled={busy}
                        aria-invalid={invalid === field.name}
                        aria-describedby={
                          invalid === field.name
                            ? "review-form-error"
                            : undefined
                        }
                        onChange={(event) =>
                          update(field.name, event.target.value)
                        }
                      />
                    ) : (
                      <div
                        className={
                          field.type === "password"
                            ? "review-password"
                            : "review-input"
                        }
                      >
                        <input
                          id={`review-${field.name}`}
                          name={field.name}
                          type={
                            field.type === "password" && visible[field.name]
                              ? "text"
                              : field.type || "text"
                          }
                          min={field.min}
                          max={field.max}
                          step={field.type === "number" ? 1 : undefined}
                          placeholder={field.placeholder}
                          autoComplete={
                            field.type === "password"
                              ? field.name === "initialPassword"
                                ? "new-password"
                                : "current-password"
                              : "off"
                          }
                          maxLength={
                            field.name.startsWith("template")
                              ? 1000
                              : field.type === "password"
                                ? 128
                                : 240
                          }
                          value={values[field.name]}
                          disabled={busy}
                          aria-invalid={invalid === field.name}
                          aria-describedby={
                            invalid === field.name
                              ? "review-form-error"
                              : undefined
                          }
                          onChange={(event) =>
                            update(field.name, event.target.value)
                          }
                        />
                        {field.type === "password" && (
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={
                              (visible[field.name] ? "Hide " : "Show ") +
                              field.label.toLowerCase()
                            }
                            aria-pressed={!!visible[field.name]}
                            disabled={busy}
                            onClick={() =>
                              setVisible((v) => ({
                                ...v,
                                [field.name]: !v[field.name],
                              }))
                            }
                          >
                            {visible[field.name] ? (
                              <EyeOff size={18} />
                            ) : (
                              <Eye size={18} />
                            )}
                          </button>
                        )}
                      </div>
                    )}
                    {field.helperText && (
                      <p className="review-help">{field.helperText}</p>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
          {review && !discard && (
            <section className="review-summary" role="status">
              <h4>Review before recording</h4>
              <dl>
                {fields.map((field) => (
                  <div key={field.name}>
                    <dt>{field.label}</dt>
                    <dd>{formatted(field)}</dd>
                  </div>
                ))}
              </dl>
              <p className="review-safety">
                <ShieldCheck size={17} />
                {intent === "finance"
                  ? "This records a financial test operation. It does not authorize a live transfer."
                  : "Confirm the reviewed changes. Your current password is checked on confirmation."}
              </p>
            </section>
          )}
          {discard && (
            <section className="review-discard" role="alert">
              <h4>
                {intent === "finance"
                  ? "Discard unsaved financial review?"
                  : "Discard unsaved admin changes?"}
              </h4>
              <p>
                Your changes have not been saved. Keep editing to return to this
                draft.
              </p>
            </section>
          )}
        </div>
        <div className="dialog-footer">
          {discard ? (
            <>
              <button
                type="button"
                className="btn"
                onClick={() => setDiscard(false)}
              >
                Keep editing
              </button>
              <button type="button" className="btn primary" onClick={onClose}>
                Discard draft
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={close}
              >
                Cancel
              </button>
              {review && (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => setReview(false)}
                >
                  Edit details
                </button>
              )}
              <button className="btn primary" disabled={busy}>
                {busy
                  ? "Recording..."
                  : review
                    ? confirmLabel
                      ? confirmLabel(values)
                      : intent === "platform"
                        ? "Record reviewed change"
                        : "Confirm reviewed action"
                    : "Review action"}
                {!busy && <ArrowRight size={15} />}
              </button>
            </>
          )}
        </div>
      </form>
    </Overlay>
  );
}
