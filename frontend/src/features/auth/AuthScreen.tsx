import { ArrowLeft, BookOpen, CheckCircle2, Code2, KeyRound, Layers3, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { api, login } from "../../api/client.ts";

export function AuthScreen() {
  const [showDocs, setShowDocs] = useState(false);
  const [mode, setMode] = useState(
      new URLSearchParams(location.search).has("reset") ? "reset" : "login",
    ),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="auth-page">
      {showDocs ? (
        <section className="auth-docs" aria-labelledby="auth-docs-title">
          <button className="auth-docs-back" onClick={() => setShowDocs(false)}>
            <ArrowLeft size={17} /> Back to sign in
          </button>
          <div className="auth-docs-heading">
            <span className="auth-docs-icon"><BookOpen size={22} /></span>
            <div>
              <div className="eyebrow">AIBUS API · GETTING STARTED</div>
              <h1 id="auth-docs-title">API overview</h1>
              <p>A first look at how customer applications will connect to Aibus.</p>
            </div>
          </div>
          <div className="auth-docs-callout">
            <ShieldCheck size={19} />
            <p><strong>Integration details are being finalized.</strong> Endpoint paths, credentials, request fields, and live examples will be added once the API contract is ready.</p>
          </div>
          <div className="auth-docs-grid">
            <article>
              <Code2 size={20} />
              <h2>What the API will do</h2>
              <p>Allow approved customer applications to connect with Aibus services, request available travel information, and submit booking requests.</p>
            </article>
            <article>
              <KeyRound size={20} />
              <h2>Access and security</h2>
              <p>API access will use credentials issued to an approved integration. Authentication, permissions, and credential setup instructions will be documented here.</p>
            </article>
            <article>
              <Layers3 size={20} />
              <h2>Responses and errors</h2>
              <p>Each endpoint will include a request example, response fields, status meanings, and guidance for handling errors and retries.</p>
            </article>
            <article>
              <CheckCircle2 size={20} />
              <h2>Booking lifecycle</h2>
              <p>Documentation will explain how to check availability, create a booking, confirm its status, and use the returned booking reference.</p>
            </article>
          </div>
          <div className="auth-docs-footer">For operator account access, return to sign in. API access instructions will appear here when the integration is ready.</div>
        </section>
      ) : (
      <section className="auth-card">
        <div className="startup-brand">aibus</div>
        <div className="eyebrow">OPERATOR WORKSPACE</div>
        <h1>
          {mode === "login"
            ? "Welcome back"
            : mode === "register"
              ? "Register your company"
              : mode === "reset"
                ? "Set a new password"
                : "Reset your password"}
        </h1>
        <p>Sign in to manage bookings, trips, and your operator account.</p>
        <form
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            setMessage("");
            const fields = Object.fromEntries(new FormData(e.currentTarget));
            try {
              if (mode === "login") await login(email, password);
              else if (mode === "register") {
                await api("/auth/register", {
                  method: "POST",
                  body: JSON.stringify({ ...fields, email, password }),
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
                setMessage("Password changed. Sign in to continue.");
              } else {
                await api("/auth/forgot-password", {
                  method: "POST",
                  body: JSON.stringify({ email }),
                });
                setMessage("If your account exists, a reset link was sent.");
              }
            } catch (e) {
              setError(e instanceof Error ? e.message : "Request failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          {mode === "register" &&
            ["name", "company", "phone", "address"].map((f) => (
              <label key={f}>
                {f.replace(/^./, (s) => s.toUpperCase())}
                <input
                  name={f}
                  autoComplete={f === "name" ? "name" : undefined}
                />
              </label>
            ))}
          {mode !== "reset" && (
            <label>
              Email
              <input
                type="email"
                name="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
          )}
          {mode !== "forgot" && (
            <label>
              Password
              <input
                type="password"
                name="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {message && <p role="status">{message}</p>}
          <button className="btn primary full" disabled={busy}>
            {busy
              ? "Please wait…"
              : mode === "login"
                ? "Sign in"
                : mode === "register"
                  ? "Submit registration"
                  : mode === "reset"
                    ? "Save password"
                    : "Send reset link"}
          </button>
        </form>
        <div className="auth-links">
          <button
            className="text-btn"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError("");
              setMessage("");
            }}
          >
            {mode === "login"
              ? "Register your operator company"
              : "Back to sign in"}
          </button>
          {mode === "login" && (
            <>
              <button className="text-btn" onClick={() => setMode("forgot")}>
                Forgot password?
              </button>
              <button className="text-btn auth-docs-link" onClick={() => setShowDocs(true)}>
                <BookOpen size={15} /> API Docs
              </button>
            </>
          )}
        </div>
      </section>
      )}
    </div>
  );
}
