import { useState } from "react";
import { api, login } from "../../api/client.ts";

export function AuthScreen() {
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
        <p>Secure access to your operations.</p>
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
            <button className="text-btn" onClick={() => setMode("forgot")}>
              Forgot password?
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
