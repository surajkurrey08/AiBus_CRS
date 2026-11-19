import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BusFront,
  LayoutDashboard,
  KeyRound,
  Network,
  BookOpen,
  Code2,
  Ticket,
  Webhook,
  ChartNoAxesCombined,
  ShieldCheck,
  Users,
  LifeBuoy,
  Settings,
  LogOut,
} from "lucide-react";
import {
  api,
  login,
  logout,
  refreshSession,
  subscribeAuth,
  authState,
  type Identity,
} from "./api/client";
import { Panel } from "../../admin/src/components/ui/Panel";
import { Overlay } from "../../admin/src/components/ui/Overlay";
import {
  FinanceReviewForm,
  type ReviewField,
} from "../../admin/src/features/finance/FinanceReviewForm";
import { PlatformTable } from "../../admin/src/components/platform/PlatformTable";

import { can } from "./config";
import { Auth } from "./features/auth/PartnerAuth";
import { Page } from "./features/workspace/PartnerPages";
export { Load, OneTimeSecret } from "./components/PortalPrimitives";
const nav = [
  ["overview", "Overview", "overview", LayoutDashboard],
  ["credentials", "API Credentials", "credentials:read", KeyRound],
  ["inventory", "Inventory Access", "inventory", Network],
  ["docs", "API Documentation", "docs", BookOpen],
  ["playground", "API Playground", "playground", Code2],
  ["bookings", "Bookings", "bookings", Ticket],
  ["webhooks", "Webhooks", "webhooks:read", Webhook],
  ["usage", "Usage & Analytics", "analytics", ChartNoAxesCombined],
  ["integration-status", "Integration Status", "overview", ShieldCheck],
  ["team", "Team & Permissions", "team:read", Users],
  ["support", "Support", "support:read", LifeBuoy],
  ["settings", "Settings", "overview", Settings],
] as const;
export function App() {
  const [user, setUser] = useState(authState().user),
    [ready, setReady] = useState(false);
  useEffect(() => {
    const off = subscribeAuth(() => setUser(authState().user));
    void refreshSession()
      .catch(() => {})
      .finally(() => setReady(true));
    return off;
  }, []);
  return !ready ? (
    <p role="status">Restoring session…</p>
  ) : user ? (
    <Workspace user={user} />
  ) : (
    <Auth />
  );
}
function Workspace({ user }: { user: Identity }) {
  const [page, setPage] = useState("overview");
  const active = nav.find((n) => n[0] === page)!,
    available = nav.filter((n) => can(user, n[2]));
  useEffect(() => {
    document.title = active[1] + " | AIBUS Partner";
  }, [page]);
  return (
    <div className="platform-admin workspace-crs partner-shell">
      <aside className="platform-sidebar">
        <div className="platform-brand">
          <BusFront />
          <strong>
            ai<span>bus</span>
          </strong>
        </div>
        <span className="platform-nav-label">PARTNER PLATFORM</span>
        <nav aria-label="Partner navigation">
          {available.map(([id, label, , Icon]) => (
            <button
              key={id}
              className={id === page ? "active" : ""}
              aria-current={id === page ? "page" : undefined}
              onClick={() => setPage(id)}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
        <div className="platform-sidebar-footer">
          Authorized distribution · API v1
        </div>
      </aside>
      <div className="platform-main">
        <header className="platform-topbar">
          <span>Partner / {active[1]}</span>
          <div>
            <span>
              {user.name} · {user.partnerRole}
            </span>
            <button className="btn" onClick={() => void logout()}>
              <LogOut size={16} />
              Sign out
            </button>
          </div>
        </header>
        <div className="sandbox-ribbon">
          SANDBOX WORKSPACE · Test bookings only · Production access unavailable
        </div>
        <main className="platform-content partner-content">
          <div className="page-heading">
            <div>
              <h1>{active[1]}</h1>
              <p>Connect your application to AIBUS authorized inventory.</p>
            </div>
          </div>
          <Page key={page} page={page} user={user} />
        </main>
      </div>
    </div>
  );
}
