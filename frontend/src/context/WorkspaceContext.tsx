import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { io, type Socket } from "socket.io-client";

import {
  api,
  authState,
  logout,
  refreshSession,
  subscribeAuth,
  type Identity,
} from "../api/client.ts";

import { normalize, type Raw } from "../utils/normalize.ts";

import * as fixtures from "../data/demo-data.ts";

import type { Row } from "../data/demo-data.ts";
import { AuthScreen } from "../features/auth/AuthScreen";

type Resource =
  "bookings" | "buses" | "routes" | "fares" | "offers" | "refunds";

type Records = Record<Resource, Row[]>;

const empty: Records = {
  bookings: [],
  buses: [],
  routes: [],
  fares: [],
  offers: [],
  refunds: [],
};

interface Workspace {
  demo: boolean;
  user: Identity;
  records: Records;
  raw: Record<string, Raw[]>;
  summary: Raw;
  profile: { company: string; email: string; phone: string; address: string };
  error: string;
  loading: boolean;
  revision: number;
  refresh: () => Promise<void>;
  save: (kind: string, value: Row, existing?: Row) => Promise<void>;
  newBooking: (value: Row, date: string) => Promise<void>;
  setProfile: (value: Record<string, string>) => Promise<void>;
  notify: (message: string) => void;
  logout: () => void;
}

const Context = createContext<Workspace | null>(null);

export const useWorkspace = () => {
  const value = useContext(Context);
  if (!value) throw new Error("Workspace provider missing");
  return value;
};

export function WorkspaceProvider({
  children,
  demo = false,
}: {
  children: ReactNode;
  demo?: boolean;
}) {
  const [identity, setIdentity] = useState(authState().user),
    [starting, setStarting] = useState(!demo),
    [records, setRecords] = useState<Records>(
      demo
        ? {
            bookings: fixtures.bookings,
            buses: fixtures.fleet,
            routes: fixtures.routes,
            fares: fixtures.fares,
            offers: fixtures.offers,
            refunds: fixtures.refunds,
          }
        : empty,
    ),
    [raw, setRaw] = useState<Record<string, Raw[]>>({}),
    [summary, setSummary] = useState<Raw>({}),
    [profile, setProfileState] = useState({
      company: "",
      email: "",
      phone: "",
      address: "",
    }),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [revision, setRevision] = useState(0),
    [message, setMessage] = useState("");
  const user = demo
    ? {
        id: "demo",
        name: "Rajesh Kumar",
        email: "demo@example.test",
        operatorId: "demo",
        role: "operator_admin",
        permissions: [
          "read",
          "fleet:write",
          "routes:write",
          "inventory:write",
          "bookings:write",
          "manifest:read",
          "manifest:write",
          "pricing:write",
          "refunds:write",
          "offers:write",
          "staff:write",
          "settings:write",
          "finance:read",
        ],
      }
    : identity;
  const identityRef = useRef(identity?.id);
  useEffect(() => {
    if (demo) return;
    const unsub = subscribeAuth(() => {
      const next = authState().user;
      if (next?.id !== identityRef.current) {
        identityRef.current = next?.id;
        setRecords(empty);
        setRaw({});
        setSummary({});
        setProfileState({ company: "", email: "", phone: "", address: "" });
      }
      setIdentity(next);
    });
    refreshSession()
      .catch(() => {})
      .finally(() => setStarting(false));
    return unsub;
  }, [demo]);
  async function refresh() {
    if (demo) return;
    const requestingUser = authState().user?.id;
    setLoading(true);
    setError("");
    try {
      const resources = [
        "routes",
        "trips",
        "buses",
        "bookings",
        "fares",
        "offers",
        "notifications",
        ...(user?.permissions.includes("refunds:write") ? ["refunds"] : []),
        ...(user?.permissions.includes("finance:read") ? ["settlements"] : []),
        ...(user?.permissions.includes("staff:write") ? ["staff"] : []),
      ];
      const results = await Promise.all(
        resources.map(
          async (r) =>
            [r, (await api<Raw[]>(`/operator/${r}?limit=100`)).data] as const,
        ),
      );
      const lookup = Object.fromEntries(results);
      const [p, d] = await Promise.all([
        api<Raw>("/operator/profile"),
        api<Raw>("/operator/dashboard"),
      ]);
      if (authState().user?.id !== requestingUser) return;
      setRaw(lookup);
      setRecords(
        Object.fromEntries(
          Object.keys(empty).map((k) => [
            k,
            (lookup[k] || []).map((r) => normalize(k, r, lookup)),
          ]),
        ) as Records,
      );
      setSummary(d.data);
      setProfileState({
        company: p.data.company,
        email: p.data.email,
        phone: p.data.phone || "",
        address: p.data.address || "",
      });
      setRevision((r) => r + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load workspace");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (user && !demo && user.role !== "super_admin") void refresh();
  }, [identity?.id, demo]);
  useEffect(() => {
    if (!identity || demo || identity.role === "super_admin") return;
    let socket: Socket | undefined;
    const connect = () => {
      socket?.close();
      socket = io({
        transports: ["websocket"],
        auth: { token: authState().accessToken },
      });
      for (const event of [
        "seat.availability.changed",
        "booking.confirmed",
        "booking.created",
        "booking.updated",
        "pricing.updated",
        "booking.cancelled",
        "trip.status.updated",
        "area.master.updated",
        "refund.status.changed",
        "operator.notification",
      ])
        socket.on(event, () => void refresh());
      socket.on("connect_error", () => {
        /* REST remains usable; polling below restores state. */
      });
    };
    connect();
    const unsub = subscribeAuth(connect);
    const interval = setInterval(() => void refresh(), 60000);
    return () => {
      socket?.close();
      unsub();
      clearInterval(interval);
    };
  }, [identity?.id, demo]);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(""), 5000);
    return () => clearTimeout(t);
  }, [message]);
  const save = async (kind: string, v: Row, existing?: Row) => {
    const resource =
      kind === "Bus"
        ? "buses"
        : kind === "Route"
          ? "routes"
          : kind === "Fare"
            ? "fares"
            : "offers";
    if (demo) {
      const item = {
        ...existing,
        ...v,
        id: v.id || existing?.id || String(Date.now()),
      };
      setRecords((old) => ({
        ...old,
        [resource]: existing
          ? old[resource].map((r) => (r.id === existing.id ? item : r))
          : [item, ...old[resource]],
      }));
      return;
    }
    let payload: Raw = {};
    if (kind === "Bus")
      payload = {
        registration: v.id,
        name: v.name,
        type: v.type.replace(/ \(.+\)/, ""),
        capacity: Number(v.capacity),
        status: v.status,
      };
    if (kind === "Route") {
      const parts = v.route.split(/\s*→\s*/);
      const duration = Number(v.durationMinutes);
      payload = {
        source: v.source?.trim() || parts[0],
        destination: v.destination?.trim() || parts[1] || "",
        boarding: v.boarding.split(",").map((name) => ({ name: name.trim() })),
        dropping: v.dropping.split(",").map((name) => ({ name: name.trim() })),
        departure: v.departure,
        arrival: v.arrival,
        durationMinutes: duration,
        status: v.status,
      };
    }
    if (kind === "Fare") {
      const selected = raw.routes?.find(
        (r) => `${r.source} → ${r.destination}` === v.route,
      );
      if (!selected) throw new Error("Choose an existing route");
      payload = {
        routeId: selected._id,
        basePaise: Math.round(Number(v.weekday) * 100),
        weekendPaise: Math.round(Number(v.weekend) * 100),
        singlePaise: Math.round(Number(v.single) * 100),
        singleWeekendPaise: Math.round(Number(v.singleWeekend) * 100),
        specialDates:
          raw.fares?.find((r) => r._id === existing?.id)?.specialDates || [],
        seatFares:
          raw.fares?.find((r) => r._id === existing?.id)?.seatFares || [],
      };
    }
    if (kind === "Offer") {
      const dates = v.period.match(/\d{4}-\d{2}-\d{2}/g);
      if (!dates || dates.length !== 2)
        throw new Error("Use campaign dates as YYYY-MM-DD – YYYY-MM-DD");
      payload = {
        code: v.id,
        name: v.name,
        percent: Number(v.discount.replace("%", "")),
        startDate: dates[0],
        endDate: dates[1],
        status: v.status,
        routeIds:
          raw.offers?.find((r) => r._id === (existing?._id || existing?.id))
            ?.routeIds || [],
      };
    }
    await api(
      `/operator/${resource}${existing ? `/${existing._id || existing.id}` : ""}`,
      { method: existing ? "PATCH" : "POST", body: JSON.stringify(payload) },
    );
    await refresh();
  };
  async function newBooking(v: Row, date: string) {
    if (demo) {
      setRecords((old) => ({
        ...old,
        bookings: [
          {
            ...v,
            id: `AB${Date.now()}`,
            pnr: "Not issued",
            date,
            status: "Pending payment",
            bus: "",
            boarding: "",
            checkin: "Awaiting",
          },
          ...old.bookings,
        ],
      }));
      return;
    }
    const route = raw.routes?.find(
      (r) => `${r.source} → ${r.destination}` === v.route,
    );
    const trips = raw.trips?.filter(
      (t) =>
        t.routeId === route?._id &&
        t.journeyDate === date &&
        t.status === "Scheduled",
    );
    if (trips?.length !== 1)
      throw new Error(
        "Choose a route/date with exactly one scheduled trip, or reserve by trip in seat inventory.",
      );
    const hold = (
      await api<Raw>(`/operator/trips/${trips[0]._id}/holds`, {
        method: "POST",
        body: JSON.stringify({ seats: [v.seat] }),
      })
    ).data;
    try {
      await api("/operator/bookings", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          tripId: trips[0]._id,
          holdId: hold.holdId,
          passengers: [{ name: v.passenger, phone: v.phone, seat: v.seat }],
        }),
      });
    } catch (error) {
      await api(`/operator/trips/${trips[0]._id}/holds/${hold.holdId}`, {
        method: "DELETE",
      }).catch(() => {});
      throw error;
    }
    await refresh();
  }
  if (starting)
    return (
      <div className="startup-state" role="status">
        <div className="startup-brand">aibus</div>
        <p>Checking your session…</p>
      </div>
    );
  if (!user) return <AuthScreen />;
  if (user.role === "super_admin") {
    const adminUrl = new URL(location.href);
    if (["localhost", "127.0.0.1"].includes(adminUrl.hostname)) {
      adminUrl.port = "5174";
      adminUrl.pathname = "/";
    } else adminUrl.pathname = "/admin/";
    adminUrl.search = "";
    return (
      <div className="startup-state">
        <div className="startup-brand">aibus</div>
        <h1>Platform administrator</h1>
        <a className="btn primary" href={adminUrl.href}>
          Open admin panel
        </a>
        <button className="text-btn" onClick={() => void logout()}>
          Sign out
        </button>
      </div>
    );
  }
  return (
    <Context.Provider
      value={{
        demo,
        user,
        records,
        raw,
        summary,
        profile,
        error,
        loading,
        revision,
        refresh,
        save,
        newBooking,
        setProfile: async (value) => {
          if (!demo)
            await api("/operator/profile", {
              method: "PATCH",
              body: JSON.stringify(value),
            });
          setProfileState(value as typeof profile);
        },
        notify: setMessage,
        logout: () => void logout(),
      }}
    >
      {error && (
        <div className="workspace-error" role="alert">
          {error}
          <button onClick={() => void refresh()}>Retry</button>
        </div>
      )}
      {loading && (
        <div className="workspace-refresh-status" role="status">
          Updating operator records…
        </div>
      )}
      {children}
      {message && (
        <div role="status" className="toast">
          {message}
          <button onClick={() => setMessage("")}>Dismiss</button>
        </div>
      )}
    </Context.Provider>
  );
}
