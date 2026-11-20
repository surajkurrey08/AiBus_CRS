import { useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BusFront,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  LoaderCircle,
  Route,
  ShieldCheck,
  TicketCheck,
} from "lucide-react";
import { api, login } from "../../api/client.ts";
import { PasswordField } from "../../components/forms/PasswordField";
import "./auth.css";

type Mode = "login" | "register" | "forgot" | "reset";
const companyFields = [
  {
    name: "name",
    label: "Full name",
    placeholder: "Your full name",
    autoComplete: "name",
  },
  {
    name: "company",
    label: "Company name",
    placeholder: "Your travel company",
    autoComplete: "organization",
  },
  {
    name: "phone",
    label: "Phone number",
    placeholder: "Company contact number",
    autoComplete: "tel",
  },
  {
    name: "address",
    label: "Company address",
    placeholder: "City and business address",
    autoComplete: "street-address",
  },
];
const headings: Record<Mode, string> = {
  login: "Welcome back",
  register: "Register your company",
  forgot: "Forgot your password?",
  reset: "Set a new password",
};
const descriptions: Record<Mode, string> = {
  login: "Sign in to your operator workspace.",
  register:
    "Create your account. Your company will be reviewed before access is approved.",
  forgot: "Enter your account email and we’ll send you a reset link.",
  reset: "Choose a new password to get back to your workspace.",
};

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>(
    new URLSearchParams(location.search).has("reset") ? "reset" : "login",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  function changeMode(next: Mode) {
    if (pending.current) return;
    setMode(next);
    setPassword("");
    setError("");
    setMessage("");
    setFieldErrors({});
    requestAnimationFrame(() => heading.current?.focus());
  }
  function clearFieldError(name: string) {
    setFieldErrors((current) => {
      if (!current[name]) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    const invalid: Record<string, string> = {};
    if (mode === "register")
      for (const field of companyFields) {
        if (!String(fields[field.name] ?? "").trim())
          invalid[field.name] = `Enter your ${field.label.toLowerCase()}.`;
      }
    if (mode !== "reset" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      invalid.email = "Enter a valid email address.";
    if (mode !== "forgot" && !password)
      invalid.password = "Enter your password.";
    else if ((mode === "register" || mode === "reset") && password.length < 12)
      invalid.password = "Use at least 12 characters.";
    setFieldErrors(invalid);
    setError("");
    setMessage("");
    if (Object.keys(invalid).length) {
      (
        form.current?.elements.namedItem(
          Object.keys(invalid)[0],
        ) as HTMLInputElement | null
      )?.focus();
      return;
    }
    pending.current = true;
    setBusy(true);
    try {
      if (mode === "login") await login(email.trim(), password);
      else if (mode === "register") {
        await api("/auth/register", {
          method: "POST",
          body: JSON.stringify({ ...fields, email: email.trim(), password }),
        });
        setMessage(
          "Registration submitted. A platform administrator must approve your operator account.",
        );
      } else if (mode === "reset") {
        await api("/auth/reset-password", {
          method: "POST",
          body: JSON.stringify({
            token: new URLSearchParams(location.search).get("reset"),
            password,
          }),
        });
        history.replaceState({}, "", location.pathname);
        setMode("login");
        setPassword("");
        setMessage("Password changed. Sign in to continue.");
      } else {
        await api("/auth/forgot-password", {
          method: "POST",
          body: JSON.stringify({ email: email.trim() }),
        });
        setMessage("If your account exists, a reset link was sent.");
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Request failed. Please try again.",
      );
      requestAnimationFrame(() => feedback.current?.focus());
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="auth-page operator-auth">
      <header className="operator-auth-header">
        <div className="operator-auth-brand">
          <span className="operator-auth-logo">
            <BusFront size={25} strokeWidth={1.8} aria-hidden="true" />
          </span>
          <span className="operator-auth-wordmark">
            ai<span>bus</span>
          </span>
          <span className="operator-auth-portal">Operator workspace</span>
        </div>
        <span className="operator-auth-access">
          <ShieldCheck size={16} aria-hidden="true" /> Company account access
        </span>
      </header>
      <main className="operator-auth-main">
        <section
          className="operator-auth-intro"
          aria-labelledby="operator-intro-title"
        >
          <p className="operator-auth-eyebrow">YOUR OPERATIONS, CONNECTED</p>
          <h2 id="operator-intro-title">
            Every journey.
            <br />
            <span>Under control.</span>
          </h2>
          <p className="operator-auth-description">
            Your fleet, departures and bookings.
            <br />
            One workspace to keep them moving.
          </p>
          <ol className="operator-auth-journey">
            <li>
              <span className="operator-auth-step">
                <Route size={21} aria-hidden="true" />
              </span>
              <div>
                <h3>Set up your routes</h3>
                <p>Connect your cities, pickup and drop points.</p>
              </div>
            </li>
            <li>
              <span className="operator-auth-step">
                <CalendarClock size={21} aria-hidden="true" />
              </span>
              <div>
                <h3>Schedule your trips</h3>
                <p>Bring your buses, timings and fares together.</p>
              </div>
            </li>
            <li>
              <span className="operator-auth-step">
                <TicketCheck size={21} aria-hidden="true" />
              </span>
              <div>
                <h3>Manage your bookings</h3>
                <p>Keep seats and passenger details in view.</p>
              </div>
            </li>
          </ol>
        </section>
        <section
          className="auth-card operator-auth-card"
          aria-labelledby="operator-auth-title"
        >
          {mode !== "login" && (
            <button
              type="button"
              className="operator-auth-back"
              disabled={busy}
              onClick={() => changeMode("login")}
            >
              <ArrowLeft size={16} aria-hidden="true" /> Back to sign in
            </button>
          )}
          <div className="operator-auth-card-heading">
            <span className="operator-auth-eyebrow">
              {mode === "login" ? "OPERATOR SIGN IN" : "YOUR COMPANY ACCOUNT"}
            </span>
            <h1 id="operator-auth-title" ref={heading} tabIndex={-1}>
              {headings[mode]}
            </h1>
            <p>{descriptions[mode]}</p>
          </div>
          <form ref={form} noValidate aria-busy={busy} onSubmit={submit}>
            {mode === "register" && (
              <div className="operator-auth-company-fields">
                {companyFields.map((field) => (
                  <div className="operator-auth-field" key={field.name}>
                    <label htmlFor={`operator-${field.name}`}>
                      {field.label}
                    </label>
                    <input
                      id={`operator-${field.name}`}
                      name={field.name}
                      type={field.name === "phone" ? "tel" : "text"}
                      placeholder={field.placeholder}
                      autoComplete={field.autoComplete}
                      required
                      disabled={busy}
                      maxLength={200}
                      aria-invalid={!!fieldErrors[field.name]}
                      aria-describedby={
                        fieldErrors[field.name]
                          ? `operator-${field.name}-error`
                          : undefined
                      }
                      onChange={() => clearFieldError(field.name)}
                    />
                    {fieldErrors[field.name] && (
                      <span
                        className="operator-auth-field-error"
                        id={`operator-${field.name}-error`}
                      >
                        {fieldErrors[field.name]}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {mode !== "reset" && (
              <div className="operator-auth-field">
                <label htmlFor="operator-email">Email</label>
                <input
                  id="operator-email"
                  type="email"
                  name="email"
                  autoComplete={mode === "login" ? "username" : "email"}
                  placeholder="you@yourcompany.com"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    clearFieldError("email");
                  }}
                  required
                  disabled={busy}
                  maxLength={254}
                  spellCheck={false}
                  autoCapitalize="none"
                  aria-invalid={!!fieldErrors.email}
                  aria-describedby={
                    fieldErrors.email ? "operator-email-error" : undefined
                  }
                />
                {fieldErrors.email && (
                  <span
                    className="operator-auth-field-error"
                    id="operator-email-error"
                  >
                    {fieldErrors.email}
                  </span>
                )}
              </div>
            )}
            {mode !== "forgot" && (
              <div className="operator-auth-field">
                <div className="operator-auth-label-row">
                  <label htmlFor="operator-password">Password</label>
                  {mode === "login" && (
                    <button
                      type="button"
                      className="operator-auth-link"
                      disabled={busy}
                      onClick={() => changeMode("forgot")}
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <PasswordField
                  key={mode}
                  id="operator-password"
                  name="password"
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  placeholder={
                    mode === "login"
                      ? "Enter your password"
                      : "Create a password"
                  }
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    clearFieldError("password");
                  }}
                  required
                  disabled={busy}
                  maxLength={128}
                  aria-invalid={!!fieldErrors.password}
                  aria-describedby={
                    fieldErrors.password
                      ? "operator-password-error"
                      : mode === "login"
                        ? undefined
                        : "operator-password-help"
                  }
                />
                {fieldErrors.password ? (
                  <span
                    className="operator-auth-field-error"
                    id="operator-password-error"
                  >
                    {fieldErrors.password}
                  </span>
                ) : (
                  mode !== "login" && (
                    <span
                      className="operator-auth-hint"
                      id="operator-password-help"
                    >
                      Use at least 12 characters.
                    </span>
                  )
                )}
              </div>
            )}
            <div
              className={`operator-auth-feedback${error ? " is-error" : message ? " is-success" : ""}`}
              ref={feedback}
              tabIndex={-1}
              role={error ? "alert" : "status"}
            >
              {error ? (
                <>
                  <CircleAlert size={17} aria-hidden="true" />
                  <span>{error}</span>
                </>
              ) : message ? (
                <>
                  <CheckCircle2 size={17} aria-hidden="true" />
                  <span>{message}</span>
                </>
              ) : null}
            </div>
            <button
              type="submit"
              className="btn primary full operator-auth-submit"
              disabled={busy}
            >
              {busy ? (
                <>
                  <LoaderCircle
                    className="operator-auth-spinner"
                    size={18}
                    aria-hidden="true"
                  />{" "}
                  Please wait…
                </>
              ) : (
                <>
                  {mode === "login"
                    ? "Sign in"
                    : mode === "register"
                      ? "Submit registration"
                      : mode === "reset"
                        ? "Save password"
                        : "Send reset link"}
                  <ArrowRight size={18} aria-hidden="true" />
                </>
              )}
            </button>
          </form>
          {mode === "login" && (
            <div className="operator-auth-register">
              <span>New to AIBUS?</span>
              <button
                type="button"
                className="operator-auth-link"
                disabled={busy}
                onClick={() => changeMode("register")}
              >
                Register your operator company{" "}
                <ArrowRight size={15} aria-hidden="true" />
              </button>
            </div>
          )}
          <p className="operator-auth-footnote">
            <ShieldCheck size={15} aria-hidden="true" /> Access is limited to
            your company’s workspace.
          </p>
        </section>
      </main>
      <footer className="operator-auth-footer">
        <span>© {new Date().getFullYear()} AIBUS</span>
        <span>Bus operator management</span>
      </footer>
    </div>
  );
}
