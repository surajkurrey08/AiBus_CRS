import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BusFront,
  CheckCircle2,
  Code2,
  Eye,
  EyeOff,
  ShieldCheck,
} from "lucide-react";
import { login, post } from "../../api/client";
import { Panel } from "../../../../admin/src/components/ui/Panel";
import { Overlay } from "../../../../admin/src/components/ui/Overlay";

const registrationFields = [
  ["name", "Company name", "text", "Your travel company"],
  ["contactPerson", "Contact person", "text", "Full name"],
  ["businessEmail", "Business email", "email", "you@company.com"],
  ["phone", "Contact number", "tel", "Business contact number"],
  ["address", "Business address", "text", "Street, city and postal code"],
  [
    "registrationDetails",
    "Company registration details (optional)",
    "text",
    "Registration or business reference",
  ],
  [
    "technicalEmail",
    "Technical contact email",
    "email",
    "developer@company.com",
  ],
  [
    "intendedUsage",
    "Intended API usage",
    "text",
    "Tell us how you plan to use AIBUS APIs",
  ],
  [
    "password",
    "Owner password (8+ characters)",
    "password",
    "Create a strong password",
  ],
];
export function Auth() {
  const [mode, setMode] = useState("login"),
    [error, setError] = useState(""),
    [invalid, setInvalid] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [draft, setDraft] = useState<any>(),
    [visible, setVisible] = useState(false),
    [nextMode, setNextMode] = useState<string>();
  const form = useRef<HTMLFormElement>(null),
    dirty = useRef(false),
    errorSummary = useRef<HTMLDivElement>(null);
  const reset = new URLSearchParams(location.search).get("reset");
  const registering = !reset && mode === "register";
  useEffect(() => {
    if (error && !invalid) errorSummary.current?.focus();
  }, [error, invalid]);
  const fields = reset
    ? [["password", "New password", "password", "At least 8 characters"]]
    : registering
      ? registrationFields
      : mode === "reset"
        ? [["email", "Email", "email", "you@company.com"]]
        : [
            ["email", "Email", "email", "you@company.com"],
            ["password", "Password", "password", "Enter your password"],
          ];
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (dirty.current && registering) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [registering]);
  const changeMode = (value: string) => {
    setMode(value);
    setError("");
    setMessage("");
    setInvalid("");
    setVisible(false);
    dirty.current = false;
  };
  const navigate = (value: string) => {
    if (registering && dirty.current) setNextMode(value);
    else changeMode(value);
  };
  const renderField = ([name, label, type, placeholder]: string[]) => (
    <label
      className={`portal-field ${name === "password" && registering ? "auth-field-wide" : ""}`}
      key={name}
    >
      <span>{label}</span>
      <span
        className={
          type === "password" ? "auth-password-control" : "auth-input-control"
        }
      >
        <input
          name={name}
          aria-label={label}
          type={type === "password" && visible ? "text" : type}
          placeholder={placeholder}
          aria-invalid={invalid === name}
          aria-describedby={
            invalid === name
              ? "partner-auth-error"
              : name === "password" && registering
                ? "partner-password-hint"
                : undefined
          }
          autoComplete={
            type === "password"
              ? mode === "login" && !reset
                ? "current-password"
                : "new-password"
              : type === "email"
                ? "email"
                : name === "contactPerson"
                  ? "name"
                  : name === "phone"
                    ? "tel"
                    : name === "name"
                      ? "organization"
                      : "off"
          }
          disabled={busy}
        />
        {type === "password" && (
          <button
            type="button"
            className="icon-btn"
            aria-label={visible ? "Hide password" : "Show password"}
            aria-pressed={visible}
            disabled={busy}
            onClick={() => setVisible((v) => !v)}
          >
            {visible ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        )}
      </span>
      {name === "password" && registering && (
        <small id="partner-password-hint">
          Use 8?128 characters with at least 1 uppercase letter, 4 lowercase letters and 1 special character. This is your portal password, not an API
          key.
        </small>
      )}
    </label>
  );
  return (
    <main
      className={`portal-auth ${registering ? "portal-auth-register" : ""}`}
    >
      <header className="auth-page-header">
        <div className="auth-wordmark">
          <BusFront size={24} />
          <span>
            ai<strong>bus</strong>
          </span>
          <span className="auth-wordmark-divider" />
          <small>Partner platform</small>
        </div>
        <span className="auth-sandbox-label">
          <Code2 size={14} />
          Sandbox access
        </span>
      </header>
      <div className="auth-layout">
        <aside className="auth-context">
          <span className="auth-eyebrow">AIBUS FOR DEVELOPERS</span>
          <h2>Your next booking integration starts here.</h2>
          <p>
            Connect your travel platform to authorized bus inventory, booking
            APIs and signed notifications.
          </p>
          <ol className="auth-journey">
            <li>
              <span>1</span>
              <div>
                <strong>Register your company</strong>
                <p>Share your business and integration details.</p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>Get reviewed by AIBUS</strong>
                <p>Our team reviews your application and access.</p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>Build in the sandbox</strong>
                <p>Read the API docs and test approved inventory.</p>
              </div>
            </li>
          </ol>
          <div className="auth-trust-note">
            <ShieldCheck size={20} />
            <p>
              Inventory access and API scopes are granted separately after
              approval.
            </p>
          </div>
        </aside>
        <Panel className="auth-form-panel">
          <div className="auth-form-heading">
            <span className="auth-eyebrow">
              {registering
                ? "COMPANY APPLICATION"
                : reset || mode === "reset"
                  ? "ACCOUNT RECOVERY"
                  : "PARTNER WORKSPACE"}
            </span>
            <h1>
              {reset
                ? "Reset your password"
                : registering
                  ? "Register your company"
                  : mode === "reset"
                    ? "Recover access"
                    : "Welcome back"}
            </h1>
            <p>
              {registering
                ? "Tell us about your business. You can sign in after your application is approved."
                : reset
                  ? "Choose a new password to secure your account."
                  : mode === "reset"
                    ? "Enter your registered business email to request a reset link."
                    : "Sign in to manage your API access and sandbox integration."}
            </p>
          </div>
          {message && (
            <div className="auth-feedback auth-feedback-success" role="status">
              <CheckCircle2 size={18} />
              <span>{message}</span>
            </div>
          )}
          {error && (
            <div
              className="auth-feedback auth-feedback-error"
              id="partner-auth-error"
              role="alert"
              ref={errorSummary}
              tabIndex={-1}
            >
              <ShieldCheck size={18} />
              <span>{error}</span>
            </div>
          )}
          {draft ? (
            <div className="auth-draft">
              <h3>Your application draft is saved</h3>
              <p>
                Submit it for review within 24 hours, before leaving this page.
              </p>
              <button
                className="btn primary full"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await post(
                      "/partner/applications/" + draft.id + "/submit",
                      { submissionToken: draft.submissionToken },
                    );
                    setDraft(undefined);
                    changeMode("login");
                    setMessage(
                      "Application submitted. AIBUS will review your company.",
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Submitting..." : "Submit draft for review"}
                <ArrowRight size={16} />
              </button>
            </div>
          ) : (
            <form
              key={mode + Boolean(reset)}
              ref={form}
              noValidate
              onChange={() => {
                dirty.current = true;
              }}
              onSubmit={async (e) => {
                e.preventDefault();
                if (busy) return;
                setError("");
                setInvalid("");
                const values = Object.fromEntries(
                  new FormData(e.currentTarget),
                ) as Record<string, string>;
                for (const [name, label, type] of fields) {
                  if (
                    (name !== "registrationDetails" && !values[name]?.trim()) ||
                    (type === "email" &&
                      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values[name])) ||
                    ((reset || registering) &&
                      name === "password" &&
                      values[name].length < 8)
                  ) {
                    setInvalid(name);
                    setError("Enter a valid " + label.toLowerCase() + ".");
                    (
                      form.current?.elements.namedItem(name) as HTMLElement
                    )?.focus();
                    return;
                  }
                }
                setBusy(true);
                setVisible(false);
                try {
                  if (reset) {
                    await post("/auth/reset-password", {
                      token: reset,
                      password: values.password,
                    });
                    history.replaceState(null, "", location.pathname);
                    dirty.current = false;
                    changeMode("login");
                    setMessage(
                      "Password changed. Sign in with your new password.",
                    );
                    form.current?.reset();
                  } else if (mode === "login")
                    await login(values.email, values.password);
                  else if (mode === "reset") {
                    await post("/auth/forgot-password", {
                      email: values.email,
                    });
                    dirty.current = false;
                    setMessage(
                      "If the account exists, a reset link has been sent.",
                    );
                  } else {
                    const result = await post("/partner/applications", {
                      ...values,
                      registrationDetails:
                        values.registrationDetails?.trim() || undefined,
                      requestedEnvironment: values.requestedEnvironment,
                      submit: values.submit !== "draft",
                    });
                    dirty.current = false;
                    if (result.data.submissionToken) setDraft(result.data);
                    else {
                      changeMode("login");
                      setMessage(
                        "Application submitted. Sign-in becomes available after approval.",
                      );
                      form.current?.reset();
                    }
                  }
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {registering ? (
                <>
                  <fieldset className="auth-fieldset">
                    <legend>Company details</legend>
                    <div className="auth-fields-grid">
                      {fields.slice(0, 6).map(renderField)}
                    </div>
                  </fieldset>
                  <fieldset className="auth-fieldset">
                    <legend>Integration &amp; account access</legend>
                    <div className="auth-fields-grid">
                      {fields.slice(6).map(renderField)}
                      <label className="portal-field">
                        <span>Requested environment</span>
                        <select name="requestedEnvironment" disabled={busy}>
                          <option>Sandbox</option>
                          <option>Production</option>
                        </select>
                      </label>
                      <label className="portal-field">
                        <span>Application action</span>
                        <select name="submit" disabled={busy}>
                          <option value="submit">Submit for approval</option>
                          <option value="draft">Save draft</option>
                        </select>
                      </label>
                    </div>
                    <p className="auth-environment-note">
                      Sandbox access is available after review. Production
                      requests are recorded for a separate approval process.
                    </p>
                  </fieldset>
                </>
              ) : (
                <div className="auth-login-fields">
                  {fields.map(renderField)}
                </div>
              )}
              <div className="auth-submit-area">
                <button className="btn primary full" disabled={busy}>
                  {busy
                    ? "Please wait..."
                    : reset
                      ? "Reset password"
                      : registering
                        ? "Save application"
                        : mode === "reset"
                          ? "Send reset link"
                          : "Sign in"}
                  <ArrowRight size={16} />
                </button>
                {registering && (
                  <p>
                    Your application will be reviewed before portal access is
                    enabled.
                  </p>
                )}
              </div>
            </form>
          )}
          {!reset && !draft && (
            <div className="auth-form-footer">
              {mode === "login" ? (
                <>
                  <span>New to AIBUS APIs?</span>
                  <button
                    type="button"
                    className="text-btn"
                    disabled={busy}
                    onClick={() => navigate("register")}
                  >
                    Register company
                  </button>
                  <button
                    type="button"
                    className="text-btn auth-recovery-link"
                    disabled={busy}
                    onClick={() => navigate("reset")}
                  >
                    Forgot password?
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="text-btn"
                  disabled={busy}
                  onClick={() => navigate("login")}
                >
                  <ArrowLeft size={15} />
                  Back to sign in
                </button>
              )}
            </div>
          )}
        </Panel>
      </div>
      <footer className="auth-page-footer">
        AIBUS Partner Platform{" "}
        <span>Approved access. Controlled inventory. Sandbox first.</span>
      </footer>
      {nextMode && (
        <Overlay
          title="Discard company application?"
          onClose={() => setNextMode(undefined)}
        >
          <div className="dialog-body">
            <p>
              Your unsaved details will be cleared. Save a draft first if you
              want to submit it later.
            </p>
          </div>
          <div className="dialog-footer">
            <button className="btn" onClick={() => setNextMode(undefined)}>
              Keep editing
            </button>
            <button
              className="btn primary"
              onClick={() => {
                changeMode(nextMode);
                setNextMode(undefined);
              }}
            >
              Discard and continue
            </button>
          </div>
        </Overlay>
      )}
    </main>
  );
}
