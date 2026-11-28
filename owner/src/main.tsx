import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRight,
  CarFront,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
} from "lucide-react";
import "./vehicle-owner.css";
import { login, logout, refresh, type Identity } from "./api";
import { VehicleOwnerPanel } from "./VehicleOwnerPanel";

function App() {
  const [user, setUser] = useState<Identity>();
  const [starting, setStarting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    let active = true;
    refresh()
      .then((identity) => {
        if (active) setUser(identity);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setStarting(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function signOut() {
    setError("");
    try {
      await logout();
      setUser(undefined);
    } catch (issue) {
      setError((issue as Error).message);
    }
  }

  if (starting)
    return (
      <main className="owner-signin">
        <p role="status">Checking your session…</p>
      </main>
    );
  if (user)
    return (
      <>
        {error && (
          <p role="alert" className="owner-auth-error">
            {error}
          </p>
        )}
        <VehicleOwnerPanel user={user} onSignOut={() => void signOut()} />
      </>
    );
  return (
    <main className="owner-signin">
      <img
        className="owner-signin-logo"
        src="/CRS.png"
        alt="CRS — Central Reservation System"
      />
      <section
        className="owner-signin-card"
        aria-labelledby="owner-signin-title"
      >
        <div className="owner-signin-brand">
          <span className="owner-brand-icon">
            <CarFront size={19} aria-hidden="true" />
          </span>
          <h1 id="owner-signin-title">Owner Login</h1>
        </div>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const fields = new FormData(event.currentTarget);
            setBusy(true);
            setError("");
            try {
              setUser(
                await login(
                  String(fields.get("email")),
                  String(fields.get("password")),
                ),
              );
            } catch (issue) {
              setError((issue as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="owner-signin-field">
            <Mail size={18} aria-hidden="true" />
            <div className="owner-signin-field-content">
              <label htmlFor="owner-email">Email</label>
              <input
                id="owner-email"
                type="email"
                name="email"
                autoComplete="username"
                placeholder="you@example.com"
                required
              />
            </div>
          </div>
          <div className="owner-signin-field">
            <LockKeyhole size={18} aria-hidden="true" />
            <div className="owner-signin-field-content">
              <label htmlFor="owner-password">Password</label>
              <input
                id="owner-password"
                type={showPassword ? "text" : "password"}
                name="password"
                autoComplete="current-password"
                required
              />
            </div>
            <button
              type="button"
              className="owner-password-toggle"
              aria-label={showPassword ? "Hide password" : "Show password"}
              onClick={() => setShowPassword((shown) => !shown)}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {error && <p role="alert">{error}</p>}
          <button className="btn primary" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
            {!busy && <ArrowRight size={17} aria-hidden="true" />}
          </button>
        </form>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
