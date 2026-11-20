import { ApiPartners } from "../platform/ApiPartners";
import { CityCatalog } from "../platform/CityCatalog";
import { OperationsConsole } from "../platform/OperationsConsole";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Building2,
  BusFront,
  Users,
  Ticket,
  Wallet,
  ChartNoAxesCombined,
  ClipboardList,
  UserCog,
  Settings,
  LogOut,
  Network,
} from "lucide-react";
import { logout, type Identity } from "../../api/client";
import { AdminFinanceHub } from "../finance/AdminFinanceHub";
import { PlatformOverview } from "../platform/PlatformOverview";
import {
  PlatformWorkspace,
  PlatformReports,
  canPlatform,
} from "../platform/PlatformWorkspace";
import { PlatformUsers } from "../platform/PlatformUsers";
import { PlatformSettings } from "../platform/PlatformSettings";
import "./platform.css";
import "../platform/platform.css";
const navigation = [
  {
    id: "overview",
    label: "Overview",
    title: "Admin overview",
    icon: LayoutDashboard,
    permission: "platform:overview:read",
  },
  { id: "city-catalog", label: "City Master", title: "Central City Master", icon: Building2, permission: "platform:settings:read" },
  {
    id: "api-partners", label: "API Partners", title: "API partner management", icon: Network, permission: "platform:partners:read",
  },
  {
    id: "operators",
    label: "Bus Operators",
    title: "Bus Operators",
    icon: Building2,
    permission: "platform:operators:read",
  },
  {
    id: "monitor",
    label: "Buses & Trips",
    title: "Fleet and trip monitoring",
    icon: BusFront,
    permission: "platform:monitor:read",
  },
  {
    id: "agencies",
    label: "Agencies",
    title: "Operator agency oversight",
    icon: Users,
    permission: "platform:agencies:read",
  },
  {
    id: "bookings",
    label: "Bookings",
    title: "Central bookings",
    icon: Ticket,
    permission: "platform:bookings:read",
  },
  {
    id: "finance",
    label: "Finance",
    title: "Financial oversight",
    icon: Wallet,
    permission: "platform:finance:read",
  },
  {
    id: "reports",
    label: "Reports",
    title: "Platform reports",
    icon: ChartNoAxesCombined,
    permission: "platform:reports:read",
  },
  {
    id: "audit",
    label: "Audit Logs",
    title: "Security and audit history",
    icon: ClipboardList,
    permission: "platform:audit:read",
  },
  {
    id: "users",
    label: "Admin Users & Roles",
    title: "Admin users and roles",
    icon: UserCog,
    permission: "platform:staff:write",
  },
  {
    id: "settings",
    label: "Settings",
    title: "Platform settings",
    icon: Settings,
    permission: "platform:settings:read",
  },
];
export function PlatformScreen({ user }: { user: Identity }) {
  const available = navigation.filter((n) => canPlatform(user, n.permission));
  const [page, setPage] = useState(available[0]?.id || "");
  const active = available.find((n) => n.id === page) || available[0];
  useEffect(() => {
    document.title = (active?.title || "Access required") + " | AIBUS Admin";
  }, [active?.title]);
  return (
    <div className="platform-admin workspace-crs">
      <aside className="platform-sidebar">
        <div className="platform-brand">
          <BusFront />
          <strong>
            ai<span>bus</span>
          </strong>
        </div>
        <span className="platform-nav-label">ADMIN PANEL</span>
        <nav aria-label="Admin navigation">
          {available.map((n) => (
            <button
              key={n.id}
              className={active?.id === n.id ? "active" : ""}
              aria-current={active?.id === n.id ? "page" : undefined}
              onClick={() => setPage(n.id)}
            >
              <n.icon size={19} />
              {n.label}
            </button>
          ))}
        </nav>
        <div className="platform-sidebar-footer">Platform administration</div>
      </aside>
      <div className="platform-main">
        <header className="platform-topbar">
          <span>Admin / {active?.label || "Access required"}</span>
          <div>
            <span>
              {user.name} / {user.platformProfile || "Super Admin"}
            </span>
            <button className="btn" onClick={() => void logout()}>
              <LogOut size={16} />
              Sign out
            </button>
          </div>
        </header>
        <main className="platform-content">
          <div className="page-heading">
            <div>
              <h1>{active?.title || "No authorized modules"}</h1>
              <p>
                Platform oversight with operator ownership and explicit
                financial authority.
              </p>
            </div>
          </div>
          {!active ? (
            <p role="alert">
              Ask an authorized Super Admin to assign the required functional
              permissions.
            </p>
          ) : active.id === "overview" ? (
            <PlatformOverview />
          ) : active.id === "city-catalog" ? (
            <CityCatalog user={user} />
          ) : active.id === "api-partners" ? (
            <ApiPartners user={user} />
          ) : active.id === "finance" ? (
            <AdminFinanceHub user={user} />
          ) : active.id === "monitor" ? (
            <>
              <OperationsConsole user={user} />
              <PlatformWorkspace user={user} section="monitor" />
            </>
          ) : active.id === "reports" ? (
            <PlatformReports user={user} />
          ) : active.id === "users" ? (
            <PlatformUsers user={user} />
          ) : active.id === "settings" ? (
            <PlatformSettings user={user} />
          ) : (
            <PlatformWorkspace
              key={active.id}
              user={user}
              section={active.id}
            />
          )}
        </main>
      </div>
    </div>
  );
}
