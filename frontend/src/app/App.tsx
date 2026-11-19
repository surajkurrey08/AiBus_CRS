import { MasterHub } from "../features/masters/MasterHub";
import {
  Armchair,
  ArrowRight,
  ArrowUpRight,
  BadgePercent,
  Bell,
  BusFront,
  Calculator,
  CalendarDays,
  CalendarClock,
  ChartNoAxesCombined,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Download,
  Headphones,
  Folders,
  IndianRupee,
  LayoutDashboard,
  Menu,
  PanelLeftClose,
  Plus,
  Printer,
  Route,
  Settings,
  ShieldCheck,
  Tag,
  Ticket,
  TicketCheck,
  TicketX,
  TrendingUp,
  Users,
  Warehouse,
  MapPin,
  X,
} from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, downloadRevenue } from "../api/client.ts";
import {
  Badge,
  DataTable,
  MiniStats,
  Overlay,
  Panel,
  RecordForm,
  RevenueChart,
} from "../components/index.ts";
import {
  WorkspaceProvider,
  useWorkspace,
} from "../context/WorkspaceContext.tsx";
import { type Row, money } from "../data/demo-data.ts";
import { BookingCounter } from "../features/booking-counter/BookingCounter.tsx";
import { RazorpayPaymentActions } from "../features/payments/components/RazorpayPaymentActions";
import {
  LiveManifest,
  LivePolicy,
  LiveSettings,
  TripControls,
} from "../features/index.ts";
import { SeatInventory } from "../features/inventory/SeatInventory.tsx";
import { TripCalendar } from "../features/trips/TripCalendar.tsx";
import { BusMaster } from "../features/fleet/BusMaster";
import { TripMaster } from "../features/trip-master/TripMaster";
import { AreaMaster } from "../features/area/AreaMaster";
import "../styles/base.css";
import "../styles/theme.css";
import { normalize } from "../utils/normalize.ts";
const nav = [
  ["Overview", LayoutDashboard],
  ["Bus & fleet", BusFront],
  ["Routes & trips", Route],
  ["Seat inventory", Armchair],
  ["Bookings & tickets", TicketCheck],
  ["Passenger manifest", ClipboardList],
  ["Fare & pricing", IndianRupee],
  ["Cancellations & refunds", TicketX],
  ["Offers & promotions", BadgePercent],
  ["Reports & earnings", ChartNoAxesCombined],
  ["Operator settings", Settings],
  ["Booking counter", Calculator],
  ["Bus Master", Warehouse],
  ["Area Master", MapPin],
  ["Trip Master", CalendarClock],
  ["Master", Folders],
] as const;
const navCaptions = [
  "Overview",
  "Fleet",
  "Routes",
  "Seats",
  "Bookings",
  "Passengers",
  "Fares",
  "Refunds",
  "Offers",
  "Reports",
  "Settings",
  "Counter",
  "Bus Master",
  "Area Master",
  "Trip Master",
  "Master",
];
const descriptions = [
  "Your operator records, departures and recorded ticket sales.",
  "Manage your buses and keep your fleet ready for every journey.",
  "Connect cities. Keep every departure on schedule.",
  "A clear view of every berth, on every journey.",
  "Every booking, from confirmation to boarding.",
  "Keep your crew and passengers on the same page.",
  "Manage fares across routes, seats and travel seasons.",
  "Track requests and manage passenger refunds.",
  "Give passengers one more reason to travel with you.",
  "Understand your performance and track every rupee.",
  "Manage your company, team and workspace preferences.",
  "Search trips, manage seats and handle counter bookings in one workspace.",
  "Manage reusable seat charts, coach types, crew, owners, vehicle records and GPS mappings.",
  "Manage service cities, pickup/drop points, landmarks and route stop assignments.",
  "Manage services, bulk scheduling, operational records and commission rules.",
  "Choose Bus Master, Area Master or Trip Master to manage your setup.",
];
// Keep the workspace focused on the screens each operator role uses. The
// API remains the source of truth for authorization; this controls navigation
// and in-app page changes only.
const rolePages: Record<string, number[]> = {
  operator_admin: Array.from({ length: nav.length }, (_, index) => index),
  manager: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15],
  booking_staff: [0, 3, 4, 5, 11],
  read_only: [0, 1, 2, 3, 4, 5, 6, 8, 12, 13, 14, 15],
};
export function App({ demo = false }: { demo?: boolean }) {
  return (
    <WorkspaceProvider demo={demo}>
      <Dashboard />
    </WorkspaceProvider>
  );
}
function Dashboard() {
  const ws = useWorkspace();
  const counterGuard = useRef<((proceed: () => void) => void) | null>(null);
  const permitted = (p: string) => ws.user.permissions.includes(p);
  const visiblePages = rolePages[ws.user.role] || [0];
  const canAccessPage = (index: number) => visiblePages.includes(index);
  const routeNames = ws.records.routes.map((r) => r.route);
  const [page, setPage] = useState(0),
    [collapsed, setCollapsed] = useState(false),
    [tripMasterTab, setTripMasterTab] = useState("services");
  const { bookings, buses: fleet, routes, fares, offers, refunds } = ws.records;
  const [toast, setToast] = useState(""),
    [detail, setDetail] = useState<Row | null>(null),
    [form, setForm] = useState<{
      title: string;
      fields: string[];
      record?: Row;
      save: (r: Row) => void | Promise<void>;
    } | null>(null);
  const [notifications, setNotifications] = useState(false),
    [account, setAccount] = useState(false),
    [date, setDate] = useState(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
    ),
    [reportFrom, setReportFrom] = useState("2026-11-01"),
    [chartPeriod, setChartPeriod] = useState("This month"),
    [settingsTab, setSettingsTab] = useState("Company profile"),
    [trip, setTrip] = useState(routeNames[0]);
  const profile = ws.demo
    ? {
        company: "Sree Kaleswari Travels",
        email: "operations@kaleswaritravels.in",
        phone: "+91 98490 12345",
        address: "Gachibowli, Hyderabad",
      }
    : ws.profile;
  const setProfile = ws.setProfile;
  const [report, setReport] = useState<Record<string, any>>({});
  useEffect(() => {
    if (!canAccessPage(page)) setPage(0);
  }, [page, ws.user.role]);
  useEffect(() => {
    if (!ws.demo && permitted("finance:read"))
      api("/operator/reports/revenue?from=" + reportFrom + "&to=" + date)
        .then((r) => setReport(r.data))
        .catch((e) => ws.notify(e.message));
  }, [reportFrom, date, ws.revision]);
  const reportPoints = (report.dailyRevenue || []).map(
    (r: Record<string, any>) => ({
      day: r._id,
      revenue: r.grossPaise / 100,
      previous: 0,
    }),
  );
  const reportGross = (report.grossPaise || 0) / 100;
  const summary = ws.summary;
  const notify = (m: string) => setToast(m);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  const navigate = (i: number) => {
    if (!canAccessPage(i)) return;
    const proceed = () => {
      const target = i === 1 ? 12 : i === 2 ? 14 : i;
      if (i === 2) setTripMasterTab("trips");
      else if (i === 14) setTripMasterTab("services");
      setPage(target);

      setDetail(null);
    };
    if (page === 11 && i !== 11 && counterGuard.current)
      counterGuard.current(proceed);
    else proceed();
  };
  const edit = (kind: string, r?: Row) => {
    const fields =
      kind === "Bus"
        ? ["id", "name", "type", "capacity", "status"]
        : kind === "Route"
          ? [
              "source",
              "destination",
              "boarding",
              "dropping",
              "departure",
              "arrival",
              "durationMinutes",
              "status",
            ]
          : kind === "Fare"
            ? ["route", "weekday", "single", "weekend", "singleWeekend"]
            : ["id", "name", "discount", "period", "status"];
    setForm({
      title: (r ? "Edit " : "Add ") + kind.toLowerCase(),
      fields,
      record: r,
      save: async (values) => {
        await ws.save(kind, values, r);
        setForm(null);
        notify(kind + " saved");
      },
    });
  };
  const newBooking = () => {
    if (!ws.demo) {
      navigate(11);
      return;
    }
    setForm({
      title: "New booking",
      fields: ["passenger", "phone", "route", "seat"],
      save: async (values) => {
        await ws.newBooking(values, date);
        setForm(null);
        notify(
          "Booking pending payment. No ticket is issued until authoritative confirmation.",
        );
      },
    });
  };
  const bookingCols: [string, string][] = [
    ["id", "Booking ID"],
    ["passenger", "Passenger"],
    ["route", "Route"],
    ["seat", "Seat"],
    ["fare", "Amount"],
    ["status", "Status"],
  ];
  return (
    <div
      className={`app workspace-crs ${collapsed ? "sidebar-collapsed" : ""} ${page === 11 ? "is-booking-counter" : ""}`}
    >
      <aside className="sidebar" id="workspace-sidebar">
        <a
          className="brand"
          aria-label="Aibus overview"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate(0);
          }}
        >
          <span className="brand-mark">
            <BusFront size={24} />
          </span>
          {!collapsed && (
            <>
              <span>
                ai<span className="brand-light">bus</span>
                <small>OPERATOR WORKSPACE</small>
              </span>
              <span className="brand-dot" />
            </>
          )}
        </a>
        <button className="workspace" onClick={() => setAccount(!account)}>
          <span className="operator-icon">
            {profile.company
              .split(" ")
              .map((s) => s[0])
              .slice(0, 2)
              .join("")}
          </span>
          {!collapsed && (
            <>
              <span>
                <strong>{profile.company || "Operator workspace"}</strong>
                <small>Operator account</small>
              </span>
              <ChevronDown size={14} />
            </>
          )}
        </button>
        <div className="nav-label">{collapsed ? "•••" : "WORKSPACE"}</div>
        <nav id="workspace-navigation" aria-label="Workspace navigation">
          {[0, 15, 3, 11, 4, 5, 6, 7, 8, 9, 10]
            .filter(canAccessPage)
            .map((i) => ({
              entry: nav[i],
              i,
            }))
            .map(({ entry: [label, Icon], i }) =>
              [5, 7, 9].includes(i) &&
              !permitted(
                i === 5
                  ? "manifest:read"
                  : i === 7
                    ? "refunds:write"
                    : "finance:read",
              ) ? null : (
                <React.Fragment key={label}>
                  {i === 6 && (
                    <div className="nav-label">
                      {collapsed ? "•••" : "BUSINESS"}
                    </div>
                  )}
                  {i === 10 && <div className="nav-divider" />}
                  <button
                    aria-label={label}
                    title={label}
                    aria-current={page === i ? "page" : undefined}
                    className={
                      page === i || (i === 15 && [12, 13, 14].includes(page))
                        ? "nav-item active"
                        : "nav-item"
                    }
                    onClick={() => navigate(i)}
                  >
                    <Icon size={21} aria-hidden="true" />
                    <span className="nav-caption" aria-hidden="true">
                      {navCaptions[i]}
                    </span>
                  </button>
                </React.Fragment>
              ),
            )}
        </nav>
        <div className="sidebar-bottom">
          {!collapsed && (
            <div className="support">
              <span className="support-icon">
                <Headphones size={20} />
              </span>
              <strong>Here to keep you moving</strong>
              <p>Your operator support team.</p>
              <button
                onClick={() =>
                  notify(
                    "Contact your Aibus platform administrator for operator support.",
                  )
                }
              >
                Contact support
                <ArrowUpRight size={14} />
              </button>
            </div>
          )}
          <button
            className="collapse-btn"
            onClick={() => setCollapsed(!collapsed)}
            aria-label="Toggle sidebar"
          >
            <PanelLeftClose size={17} />
            {!collapsed && "Collapse sidebar"}
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="sidebar-toggle"
              aria-label={collapsed ? "Show sidebar" : "Hide sidebar"}
              aria-expanded={!collapsed}
              aria-controls="workspace-sidebar"
              title={collapsed ? "Show sidebar" : "Hide sidebar"}
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? <Menu size={21} /> : <X size={21} />}
            </button>
            Workspace
            <ChevronRight size={13} />
            {[12, 13, 14].includes(page) && (
              <>
                <button
                  className="text-btn"
                  aria-label="All masters"
                  onClick={() => navigate(15)}
                >
                  Master
                </button>
                <ChevronRight size={13} />
              </>
            )}
            <strong>{nav[page][0]}</strong>
          </div>
          <div className="header-right">
            <span className="live">
              <i />
              {ws.error
                ? "Connection requires attention"
                : "Operator API connected"}
            </span>
            <div className="header-divider" />
            <button
              className="notification icon-btn"
              aria-label="Notifications"
              onClick={() => {
                setNotifications(!notifications);
                setAccount(false);
              }}
            >
              <Bell size={19} />
              <i />
            </button>
            <button
              className="account"
              onClick={() => {
                setAccount(!account);
                setNotifications(false);
              }}
            >
              <span className="avatar">
                {ws.user.name
                  .split(" ")
                  .map((s) => s[0])
                  .slice(0, 2)
                  .join("")}
              </span>
              <span>
                <strong>{ws.user.name}</strong>
                <small>{ws.user.role.replaceAll("_", " ")}</small>
              </span>
              <ChevronDown size={14} />
            </button>
          </div>
          {notifications && (
            <div className="header-popover">
              <h3>Notifications</h3>
              {(ws.raw.notifications || []).length ? (
                (ws.raw.notifications || []).map((n) => (
                  <p key={n._id}>
                    <strong>{n.title}</strong>
                    <br />
                    {n.message}
                  </p>
                ))
              ) : (
                <p>No new operator notifications.</p>
              )}
              <button
                className="text-btn"
                onClick={async () => {
                  try {
                    await Promise.all(
                      (ws.raw.notifications || [])
                        .filter((n) => !n.readAt)
                        .map((n) =>
                          api(`/operator/notifications/${n._id}/read`, {
                            method: "PATCH",
                          }),
                        ),
                    );
                    setNotifications(false);
                    await ws.refresh();
                    notify("Notifications marked as read");
                  } catch (e) {
                    notify((e as Error).message);
                  }
                }}
              >
                Mark all as read
                <Check size={14} />
              </button>
            </div>
          )}
          {account && (
            <div className="header-popover account-pop">
              <strong>{profile.company}</strong>
              <p>Operator ID · {ws.user.operatorId}</p>
              {canAccessPage(10) && (
                <button
                  className="text-btn"
                  onClick={() => {
                    navigate(10);
                    setAccount(false);
                  }}
                >
                  Manage account
                  <Settings size={15} />
                </button>
              )}
              <button className="text-btn" onClick={ws.logout}>
                Sign out
              </button>
            </div>
          )}
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {profile.company.toUpperCase()}{" "}
                <span>· {ws.user.operatorId?.slice(-8)}</span>
              </div>
              <h1>
                {page === 0 ? "Your operations, at a glance." : nav[page][0]}
              </h1>
              <p>{descriptions[page]}</p>
            </div>
            <div className="heading-actions">
              {[0, 2, 3, 4, 5, 9].includes(page) && (
                <label className="date-control">
                  <CalendarDays size={16} />
                  <input
                    aria-label="Journey date"
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </label>
              )}
              {[0, 4].includes(page) && permitted("bookings:write") ? (
                <button className="btn primary" onClick={newBooking}>
                  <Plus size={16} />
                  New booking
                </button>
              ) : page === 8 && permitted("offers:write") ? (
                <button className="btn primary" onClick={() => edit("Offer")}>
                  <Plus size={16} />
                  Create offer
                </button>
              ) : page === 9 ? (
                <button
                  className="btn primary"
                  onClick={async () => {
                    try {
                      await downloadRevenue(reportFrom, date);
                    } catch (e) {
                      notify((e as Error).message);
                    }
                  }}
                >
                  <Download size={16} />
                  Export report
                </button>
              ) : null}
            </div>
          </div>
          <div className="demo-strip">
            <span className="demo-dot" />
            {ws.demo ? "Demo workspace" : "Operator workspace"}
            <span className="demo-caption">
              {ws.demo
                ? "Sample operational data"
                : "Connected to operator API"}
            </span>
            <span className="today-pill">{date}</span>
          </div>
          {page === 0 && (
            <>
              <div className="stats-grid">
                {[
                  {
                    label: "Today's bookings",
                    value: String(summary.totalBookings || 0),
                    change: "Recorded bookings",
                    note: "today",
                    Icon: Ticket,
                    chart: [3, 5, 4, 6, 5, 8, 7, 10],
                  },
                  {
                    label: "Total ticket sales",
                    value: money((summary.grossPaise || 0) / 100),
                    change: "Gross sales",
                    note: "vs. yesterday",
                    Icon: IndianRupee,
                    chart: [3, 4, 3, 6, 5, 7, 7, 10],
                  },
                  {
                    label: "Active buses",
                    value: String(
                      fleet.filter((r) => r.status === "Active").length,
                    ),
                    change: `${fleet.length} total fleet`,
                    note: `${fleet.filter((r) => r.status !== "Active").length} inactive`,
                    Icon: BusFront,
                    chart: [5, 5, 6, 6, 7, 7, 7, 8],
                  },
                  {
                    label: "Seats booked",
                    value: String(summary.occupancy || 0) + "%",
                    change: `${summary.bookedSeats || 0} / ${summary.totalSeats || 0}`,
                    note: `${summary.availableSeats || 0} seats available`,
                    Icon: Armchair,
                    chart: [2, 4, 4, 5, 7, 6, 8, 9],
                  },
                ].map((s, i) => (
                  <div className="stat-card" key={s.label}>
                    <div className="stat-top">
                      <span>{s.label}</span>
                      <span className={`stat-icon s${i}`}>
                        <s.Icon size={17} />
                      </span>
                    </div>
                    <div className="stat-body">
                      <strong>{s.value}</strong>
                      <div className="sparkline">
                        {s.chart.map((v, j) => (
                          <i
                            key={j}
                            style={{ height: v * 3, opacity: 0.25 + j * 0.09 }}
                          />
                        ))}
                      </div>
                    </div>
                    <div className="stat-bottom">
                      <span className={i < 2 ? "positive" : ""}>
                        {s.change}
                      </span>
                      <small>{s.note}</small>
                    </div>
                  </div>
                ))}
              </div>
              <div className="overview-grid">
                <div className="overview-left">
                  <Panel
                    title="Revenue overview"
                    aside={
                      <div className="segmented">
                        {["This week", "This month"].map((p) => (
                          <button
                            key={p}
                            onClick={() => setChartPeriod(p)}
                            className={chartPeriod === p ? "selected" : ""}
                          >
                            {p}
                          </button>
                        ))}
                      </div>
                    }
                  >
                    <div className="chart-summary">
                      <div>
                        <strong>
                          {money((summary.grossPaise || 0) / 100)}
                        </strong>
                        <span className="growth">
                          <TrendingUp size={13} />
                          Recorded
                        </span>
                        <small>Actual recorded ticket value</small>
                      </div>
                      <div className="chart-legend">
                        <span>
                          <i />
                          This period
                        </span>
                        <span>
                          <i />
                          Previous period
                        </span>
                      </div>
                    </div>
                    <RevenueChart
                      weekly={chartPeriod === "This week"}
                      points={(summary.dailyRevenue || []).map(
                        (r: Record<string, any>) => ({
                          day: r._id,
                          revenue: r.grossPaise / 100,
                          previous: 0,
                        }),
                      )}
                    />
                    <div className="chart-note">
                      <span>
                        <span className="tiny-dot" />
                        Revenue is based on confirmed ticket sales
                      </span>
                      <button className="text-btn" onClick={() => navigate(9)}>
                        View report
                        <ArrowRight size={13} />
                      </button>
                    </div>
                  </Panel>
                  <Panel
                    title="Route performance"
                    aside={
                      <button className="text-btn" onClick={() => navigate(2)}>
                        All routes
                        <ArrowUpRight size={14} />
                      </button>
                    }
                  >
                    <div className="performance-head">
                      <span>ROUTE</span>
                      <span>OCCUPANCY</span>
                      <span>REVENUE</span>
                    </div>
                    {routeNames.slice(0, 3).map((r, i) => (
                      <div className="performance-row" key={r}>
                        <div>
                          <span className="route-icon">
                            <Route size={16} />
                          </span>
                          <div>
                            <strong>{r}</strong>
                            <small>
                              {summary.routePerformance?.[i]?.trips || 0} trips
                            </small>
                          </div>
                        </div>
                        <div className="occupancy">
                          <div>
                            <i
                              style={{
                                width: `${summary.routePerformance?.[i]?.occupancy || 0}%`,
                              }}
                            />
                          </div>
                          <span>
                            {summary.routePerformance?.[i]?.occupancy || 0}%
                          </span>
                        </div>
                        <strong>
                          {summary.routePerformance?.[i]?.booked || 0} booked
                        </strong>
                      </div>
                    ))}
                  </Panel>
                </div>
                <div className="overview-right">
                  <Panel
                    title="Upcoming departures"
                    aside={
                      <span className="count">
                        {summary.upcomingDepartures?.length || 0} upcoming
                      </span>
                    }
                  >
                    <div className="departure-date">
                      <CalendarDays size={14} />
                      {date} <span>IST</span>
                    </div>
                    {(ws.demo
                      ? routes.slice(0, 3)
                      : (summary.upcomingDepartures || []).map(
                          (t: Record<string, any>) => {
                            const r = routes.find((r) => r.id === t.routeId);
                            return {
                              ...r,
                              id: t._id,
                              departure: new Intl.DateTimeFormat("en-IN", {
                                timeZone: "Asia/Kolkata",
                                hour: "2-digit",
                                minute: "2-digit",
                                hour12: false,
                              }).format(new Date(t.departureAt)),
                              route: r?.route || "Trip",
                              booked: (t.seats || []).filter(
                                (s: Record<string, any>) =>
                                  s.state === "booked",
                              ).length,
                              capacity: t.seats?.length,
                            };
                          },
                        )
                    ).map((r: Record<string, any>, i: number) => (
                      <div className="departure" key={r.id}>
                        <div className="departure-time">
                          <strong>{r.departure}</strong>
                          <span className={i === 0 ? "leaving" : ""}>
                            Scheduled
                          </span>
                        </div>
                        <h4>{r.route}</h4>
                        <p>
                          <BusFront size={13} />
                          {fleet[i]?.id} <span>AC Sleeper</span>
                        </p>
                        <div className="departure-bottom">
                          <span>
                            <Users size={13} />
                            {r.booked || 0} / {r.capacity || 0} booked
                          </span>
                          <button
                            className="text-btn"
                            onClick={() => {
                              setTrip(r.route);
                              navigate(5);
                            }}
                          >
                            Manifest
                            <ArrowUpRight size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                    <button className="full-link" onClick={() => navigate(2)}>
                      View all departures
                      <ArrowRight size={14} />
                    </button>
                  </Panel>
                  <Panel title="Quick actions">
                    <div className="quick-actions">
                      {[
                        { Icon: Armchair, label: "Manage seats", target: 3 },
                        { Icon: BusFront, label: "Add a bus", target: 1 },
                        { Icon: Tag, label: "Create offer", target: 8 },
                        { Icon: Download, label: "Download report", target: 9 },
                      ]
                        .filter(({ target }) =>
                          permitted(
                            target === 1
                              ? "fleet:write"
                              : target === 8
                                ? "offers:write"
                                : target === 9
                                  ? "finance:read"
                                  : "read",
                          ),
                        )
                        .map(({ Icon, label, target }) => (
                          <button
                            key={label}
                            onClick={() => {
                              navigate(target);
                              if (target === 1) edit("Bus");
                              if (target === 8) edit("Offer");
                            }}
                          >
                            <Icon size={18} />
                            <span>{label}</span>
                            <ChevronRight size={14} />
                          </button>
                        ))}
                    </div>
                  </Panel>
                </div>
              </div>
              <div className="section-heading">
                <h3>
                  Recent bookings <span className="count">Today</span>
                </h3>
                <button className="text-btn" onClick={() => navigate(4)}>
                  View all bookings
                  <ArrowRight size={14} />
                </button>
              </div>
              <DataTable
                rows={bookings}
                journeyDate={date}
                columns={bookingCols}
                title="bookings"
                onView={setDetail}
              />
            </>
          )}
          {page === 3 && (
            <SeatInventory routes={routes} date={date} notify={notify} />
          )}
          {page === 4 && (
            <>
              <MiniStats
                items={[
                  [String(bookings.length), "Total bookings"],
                  [
                    String(
                      bookings.filter((r) => r.status === "Confirmed").length,
                    ),
                    "Confirmed",
                  ],
                  [
                    String(
                      bookings.filter((r) => r.status === "Pending").length,
                    ),
                    "Awaiting payment",
                  ],
                  [
                    money(
                      bookings
                        .filter((r) => r.status === "Confirmed")
                        .reduce((s, r) => s + Number(r.fare), 0),
                    ),
                    "Confirmed ticket sales",
                  ],
                ]}
              />
              <DataTable
                key="bookings"
                journeyDate={date}
                rows={bookings.filter((r) => r.date === date)}
                columns={[
                  ...bookingCols.slice(0, 3),
                  ["date", "Journey date"],
                  ...bookingCols.slice(3),
                ]}
                onView={setDetail}
                title="bookings"
                exportable
              />
            </>
          )}
          {page === 5 && <LiveManifest date={date} initialRoute={trip} />}
          {page === 6 && (
            <>
              {permitted("pricing:write") && (
                <div className="section-heading">
                  <h3>Route fares</h3>
                  <button className="btn primary" onClick={() => edit("Fare")}>
                    <Plus size={15} />
                    Add fare
                  </button>
                </div>
              )}
              <div className="info-banner">
                <ShieldCheck size={20} />
                <div>
                  <strong>Pricing that works for every journey</strong>
                  <p>
                    Set double-side and single-side fares per passenger for
                    weekdays and weekends. Applies to new trips on this route;
                    existing trips keep their saved fares.
                  </p>
                </div>
              </div>
              <DataTable
                key="fares"
                rows={fares}
                columns={[
                  ["route", "Route"],
                  ["weekday", "Double · weekday"],
                  ["single", "Single · weekday"],
                  ["weekend", "Double · weekend"],
                  ["singleWeekend", "Single · weekend"],
                ]}
                onEdit={
                  permitted("pricing:write")
                    ? (r) => edit("Fare", r)
                    : undefined
                }
                title="fares"
              />
              <Panel title="Seat-wise pricing">
                <div className="pricing-rules">
                  <div>
                    <Armchair />
                    <strong>Double side</strong>
                    <span>Same fare per person for both adjacent berths</span>
                  </div>
                  <div>
                    <Armchair />
                    <strong>Single side</strong>
                    <span>
                      Separate fare for the berth across the aisle on both decks
                    </span>
                  </div>
                  <div>
                    <Users />
                    <strong>Seater / special fares</strong>
                    <span>
                      Seaters use the double-side rate. Date and seat overrides
                      take priority.
                    </span>
                  </div>
                </div>
              </Panel>
            </>
          )}
          {page === 7 && (
            <>
              <MiniStats
                items={[
                  [
                    String(
                      refunds.filter((r) => r.status === "Requested").length,
                    ),
                    "Pending requests",
                  ],
                  [
                    money(
                      refunds
                        .filter((r) => r.status === "Requested")
                        .reduce((s, r) => s + Number(r.amount), 0),
                    ),
                    "Pending refunds",
                  ],
                  [
                    money(
                      refunds
                        .filter((r) => r.status === "Refunded")
                        .reduce((s, r) => s + Number(r.amount), 0),
                    ),
                    "Refunded",
                  ],
                  [String(summary.cancelled || 0), "Recorded cancellations"],
                ]}
              />
              <DataTable
                key="refunds"
                rows={refunds}
                columns={[
                  ["id", "Refund ID"],
                  ["passenger", "Passenger"],
                  ["route", "Route"],
                  ["amount", "Refund amount"],
                  ["date", "Requested on"],
                  ["status", "Status"],
                ]}
                title="refunds"
                onView={setDetail}
              />
              <LivePolicy />
            </>
          )}
          {page === 8 && (
            <>
              <MiniStats
                items={[
                  [
                    String(offers.filter((o) => o.status === "Active").length),
                    "Active offers",
                  ],
                  [
                    String(offers.reduce((n, o) => n + Number(o.used || 0), 0)),
                    "Total redemptions",
                  ],
                  ["—", "Attributed revenue unavailable"],
                  ["—", "Conversion not recorded"],
                ]}
              />
              <div className="offers-grid">
                {offers.map((o) => (
                  <Panel key={o.id}>
                    <div className="offer-top">
                      <span className="offer-icon">
                        <Tag size={23} />
                      </span>
                      <Badge value={o.status} />
                    </div>
                    <h2>{o.discount} off</h2>
                    <h3>{o.name}</h3>
                    <div className="promo-code">{o.id}</div>
                    <p className="muted">
                      <CalendarDays size={14} />
                      {o.period}
                    </p>
                    <div className="offer-foot">
                      <span>{o.used || "0"} redemptions</span>
                      <button
                        className="text-btn"
                        disabled={!permitted("offers:write")}
                        onClick={() => edit("Offer", o)}
                      >
                        Edit offer
                        <ArrowUpRight size={14} />
                      </button>
                    </div>
                  </Panel>
                ))}
              </div>
            </>
          )}
          {page === 9 && (
            <>
              <div className="report-range">
                <label>
                  From
                  <input
                    aria-label="Report from"
                    type="date"
                    value={reportFrom}
                    max={date}
                    onChange={(e) => setReportFrom(e.target.value)}
                  />
                </label>
                <label>
                  To
                  <input
                    aria-label="Report to"
                    type="date"
                    min={reportFrom}
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </label>
                <select
                  aria-label="Revenue period"
                  value={chartPeriod}
                  onChange={(e) => setChartPeriod(e.target.value)}
                >
                  <option>This month</option>
                  <option>This week</option>
                </select>
              </div>
              <MiniStats
                items={[
                  [money(reportGross), "Gross revenue"],
                  [
                    money((report.commissionPaise || 0) / 100),
                    "Recorded commission",
                  ],
                  [money((report.netEarningsPaise || 0) / 100), "Net earnings"],
                  [String(report.occupancy || 0) + "%", "Average occupancy"],
                ]}
              />
              <div className="reports-grid">
                <Panel title="Ticket sales & revenue">
                  <RevenueChart
                    weekly={chartPeriod === "This week"}
                    points={reportPoints}
                  />
                </Panel>
                <Panel title="Route occupancy">
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart
                      data={routeNames.map((r, i) => ({
                        route: r.split(" → ")[1],
                        occupancy: report.routePerformance?.[i]?.occupancy || 0,
                      }))}
                    >
                      <CartesianGrid vertical={false} stroke="#edf1f3" />
                      <XAxis
                        dataKey="route"
                        fontSize={11}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis fontSize={11} axisLine={false} tickLine={false} />
                      <Tooltip />
                      <Bar
                        dataKey="occupancy"
                        fill="#146c74"
                        radius={[5, 5, 0, 0]}
                        barSize={35}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </Panel>
              </div>
              <DataTable
                key="settlements"
                rows={(ws.raw.settlements || []).map((r) =>
                  normalize("settlements", r),
                )}
                columns={[
                  ["id", "Settlement ID"],
                  ["date", "Settled on"],
                  ["amount", "Net amount"],
                  ["commission", "Commission"],
                  ["status", "Status"],
                ]}
                title="settlements"
                exportable
              />
            </>
          )}
          {page === 10 && <LiveSettings />}
          {page === 11 && <BookingCounter navigationGuard={counterGuard} />}
          {page === 12 && (
            <BusMaster
              onAddBus={() => edit("Bus")}
              onEditBus={(row) => edit("Bus", row)}
            />
          )}
          {page === 13 && <AreaMaster />}
          {page === 15 && (
            <MasterHub
              onOpen={navigate}
              allowedIds={([12, 13, 14] as const).filter(canAccessPage)}
            />
          )}
          {page === 14 && (
            <TripMaster
              onCounter={() => navigate(11)}
              onArea={() => navigate(13)}
              key={tripMasterTab}
              initialTab={tripMasterTab}
              routesContent={
                <>
                  <div className="section-heading">
                    <h3>Routes</h3>
                    {permitted("routes:write") && (
                      <button
                        className="btn primary"
                        onClick={() => edit("Route")}
                      >
                        <Plus size={15} />
                        Add route
                      </button>
                    )}
                  </div>
                  <DataTable
                    key="routes"
                    rows={routes}
                    columns={[
                      ["id", "Route ID"],
                      ["route", "Route"],
                      ["departure", "Departure"],
                      ["arrival", "Arrival"],
                      ["duration", "Duration"],
                      ["status", "Status"],
                    ]}
                    onView={setDetail}
                    onEdit={
                      permitted("routes:write")
                        ? (row) => edit("Route", row)
                        : undefined
                    }
                    title="routes"
                  />
                </>
              }
              tripsContent={
                <>
                  <div className="section-heading">
                    <h3>Trip calendar</h3>
                    <label>
                      Journey date
                      <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                      />
                    </label>
                  </div>
                  <TripCalendar date={date} onChange={setDate} />
                  <TripControls />
                </>
              }
            />
          )}
          <footer className="app-footer">
            <span>© 2026 Aibus · Operator workspace</span>
            <span>
              <ShieldCheck size={12} />
              Built for journeys that matter.
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {form && (
        <RecordForm
          {...form}
          onSave={form.save}
          onClose={() => setForm(null)}
        />
      )}
      {detail && (
        <Overlay
          title={
            detail.pnr
              ? "Booking details"
              : detail.id?.startsWith("RF")
                ? "Refund request"
                : "Record details"
          }
          onClose={() => setDetail(null)}
          drawer
        >
          <div className="detail-content">
            <div className="detail-hero">
              <span className="route-icon">
                {detail.pnr ? <Ticket size={24} /> : <BusFront size={24} />}
              </span>
              <h2>{detail.id}</h2>
              <Badge value={detail.status || "Active"} />
            </div>

            {page === 4 &&
              !ws.demo &&
              permitted("bookings:write") &&
              detail.status === "Pending payment" && (
                <RazorpayPaymentActions
                  bookingId={detail._id || detail.id}
                  onUpdated={(payment) => {
                    setDetail({
                      ...detail,
                      status: payment.status,
                      paymentStatus:
                        payment.paymentStatus ||
                        detail.paymentStatus ||
                        "Pending",
                      pnr: payment.pnr || detail.pnr || "Not issued",
                    });
                    void ws.refresh();
                  }}
                />
              )}
            {Object.entries(detail).map(([k, v]) => (
              <div className="detail-row" key={k}>
                <span>{k.replace(/^./, (s) => s.toUpperCase())}</span>
                <strong>{["fare", "amount"].includes(k) ? money(v) : v}</strong>
              </div>
            ))}
            {detail.pnr &&
              detail.pnr !== "Not issued" &&
              detail.status === "Confirmed" && (
                <div className="ticket-stub">
                  <div className="brand ticket-brand">
                    aibus <span>E-TICKET</span>
                  </div>
                  <h3>{detail.route}</h3>
                  <p>
                    {detail.passenger} · Seat {detail.seat}
                  </p>
                  <p>{detail.date} · Journey date shown in IST</p>
                  <strong>PNR {detail.pnr}</strong>
                  <div className="barcode" />
                  <small>Confirmed ticket</small>
                </div>
              )}
            <div className="detail-actions">
              {detail.status === "Confirmed" &&
                detail.pnr &&
                permitted("refunds:write") &&
                !ws.demo && (
                  <button
                    className="btn"
                    onClick={() =>
                      setForm({
                        title: "Request cancellation",
                        fields: ["reason"],
                        save: async (values) => {
                          await api(
                            "/operator/bookings/" +
                              (detail._id || detail.id) +
                              "/cancellation",
                            { method: "POST", body: JSON.stringify(values) },
                          );
                          setForm(null);
                          setDetail(null);
                          await ws.refresh();
                          notify(
                            "Cancellation request recorded. No refund has been completed.",
                          );
                        },
                      })
                    }
                  >
                    Request cancellation
                  </button>
                )}
              {detail.pnr &&
                detail.pnr !== "Not issued" &&
                detail.status === "Confirmed" && (
                  <button
                    className="btn primary"
                    onClick={async () => {
                      try {
                        if (!ws.demo)
                          await api(
                            "/operator/bookings/" +
                              (detail._id || detail.id) +
                              "/ticket",
                          );
                        window.print();
                      } catch (error) {
                        notify((error as Error).message);
                      }
                    }}
                  >
                    <Printer size={16} />
                    Print e-ticket
                  </button>
                )}
              {page === 7 &&
                permitted("refunds:write") &&
                detail.status === "Requested" && (
                  <button
                    className="btn primary"
                    onClick={async () => {
                      try {
                        await api(
                          "/operator/refunds/" + detail.id + "/process",
                          { method: "POST" },
                        );
                        await ws.refresh();
                      } catch (error) {
                        notify((error as Error).message);
                      }
                    }}
                  >
                    Request refund processing
                  </button>
                )}
              <button className="btn" onClick={() => setDetail(null)}>
                Close details
              </button>
            </div>
          </div>
        </Overlay>
      )}
    </div>
  );
}
