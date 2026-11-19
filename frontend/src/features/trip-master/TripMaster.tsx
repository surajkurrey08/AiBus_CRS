import { MasterSectionLayout } from "../../components/navigation/MasterSectionLayout";
import { useEffect, useState, type ReactNode } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { api } from "../../api/client";
import { loadAllRecords } from "../../api/loadAll";
import { DataTable, Overlay } from "../../components/index";
import { useWorkspace } from "../../context/WorkspaceContext";
import { configs, optionLabel, tabs, titles } from "./config";
import { MasterForm } from "./MasterForm";
import { Availability, Reports, ScheduleServices, Tracker } from "./Workflows";
import "./trip-master.css";
export function TripMaster({
  onCounter,
  onArea,
  routesContent,
  tripsContent,
  initialTab = "services",
}: {
  onCounter: () => void;
  onArea: () => void;
  routesContent?: ReactNode;
  tripsContent?: ReactNode;
  initialTab?: string;
}) {
  const ws = useWorkspace();
  const allowed = (p: string) => ws.user.permissions.includes(p);
  const [tab, setTab] = useState(initialTab),
    [revision, setRevision] = useState(0),
    [lookup, setLookup] = useState<Record<string, any[]>>({}),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [form, setForm] = useState<{ resource: string; record?: any } | null>(
      null,
    ),
    [assignment, setAssignment] = useState<any>(null),
    [voiding, setVoiding] = useState<any>(null),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = () => {
    setRevision((v) => v + 1);
    void ws.refresh();
  };
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const paths: Record<string, string> = {
      routes: "/operator/routes",
      buses: "/operator/buses",
      trips: "/operator/trips",
      locations: "/operator/area-master/locations",
      pois: "/operator/area-master/pois",
      services: "/operator/trip-master/services",
      tablets: "/operator/trip-master/tablets",
      partners: "/operator/trip-master/partners",
      links: "/operator/trip-master/links",
      stops: "/operator/trip-master/stops",
      assignments: "/operator/trip-master/tablet-assignments",
    };
    if (allowed("finance:read")) paths.fuel = "/operator/trip-master/fuel";
    if (allowed("pricing:write"))
      paths.commissions = "/operator/trip-master/commissions";
    Promise.all(
      Object.entries(paths).map(
        async ([key, path]) =>
          [key, await loadAllRecords(path, controller.signal)] as const,
      ),
    )
      .then((entries) => {
        if (!controller.signal.aborted) setLookup(Object.fromEntries(entries));
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision, ws.revision]);
  const rowLabel = (resource: string, id: string) => {
    const r = lookup[resource]?.find((r) => r._id === id);
    return r ? optionLabel(resource, r, lookup) : "Unavailable";
  };
  const rows = lookup[tab] || [];
  const columns =
    tab === "services"
      ? [
          "name",
          "code",
          "routeId",
          "busId",
          "departure",
          "doublePaise",
          "singlePaise",
          "status",
        ]
      : tab === "tablets"
        ? ["name", "serialNumber", "status", "assignment"]
        : tab === "partners"
          ? ["name", "kind", "parentPartnerId", "phone", "email", "status"]
          : tab === "commissions"
            ? [
                "partnerId",
                "serviceId",
                "tripId",
                "basis",
                "kind",
                "basisPoints",
                "fixedPaise",
                "status",
              ]
            : tab === "links"
              ? ["fromTripId", "toTripId", "kind", "transferMinutes", "status"]
              : tab === "fuel"
                ? [
                    "tripId",
                    "litresMillilitres",
                    "amountPaise",
                    "at",
                    "pump",
                    "status",
                  ]
                : ["tripId", "name", "kind", "arrivedAt", "departedAt"];
  const labels: Record<string, string> = {
    routeId: "Route",
    busId: "Bus",
    tripId: "Trip",
    serviceId: "Service",
    partnerId: "Partner",
    parentPartnerId: "Reports to",
    fromTripId: "From trip",
    toTripId: "To trip",
    doublePaise: "Double side · INR",
    singlePaise: "Single side · INR",
    fixedPaise: "Fixed · INR",
    basisPoints: "Percentage",
    litresMillilitres: "Litres",
    amountPaise: "Expense · INR",
    arrivedAt: "Arrival · IST",
    departedAt: "Departure · IST",
    at: "Purchased · IST",
    transferMinutes: "Transfer · min",
    serialNumber: "Serial number",
  };
  const render = (row: any, key: string) => {
    const value = row[key];
    if (key === "assignment") return value ? "Assigned" : "Unassigned";
    if (value === undefined || value === null || value === "") return "—";
    const rel: Record<string, string> = {
      routeId: "routes",
      busId: "buses",
      tripId: "trips",
      serviceId: "services",
      partnerId: "partners",
      parentPartnerId: "partners",
      fromTripId: "trips",
      toTripId: "trips",
    };
    if (rel[key]) return rowLabel(rel[key], value);
    if (key.endsWith("Paise") || key === "basisPoints")
      return (Number(value) / 100).toFixed(2);
    if (key === "litresMillilitres") return Number(value) / 1000;
    if (["at", "arrivedAt", "departedAt"].includes(key))
      return new Date(value).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
      });
    return String(value);
  };
  return (
    <MasterSectionLayout
      label="Trip Master"
      selected={tab}
      sections={tabs
        .filter((t) => t !== "commissions" || allowed("pricing:write"))
        .filter((t) => t !== "fuel" || allowed("finance:read"))
        .filter((t) => t !== "scheduling" || allowed("routes:write"))
        .map((id) => ({
          id,
          label: configs[id]?.title || titles[id],
          group: [
            "routes",
            "services",
            "trips",
            "scheduling",
            "links",
          ].includes(id)
            ? "Planning"
            : ["partners", "commissions"].includes(id)
              ? "Business"
              : "Operations",
        }))}
      onSelect={(value) => {
        setTab(value);
        setNotice("");
      }}
    >
      <div className="trip-master">
        <div className="tm-toolbar">
          <p className="muted">Services → dated trips → operational records</p>
          <div className="tm-actions">
            <button className="btn" onClick={onArea}>
              Cities & pickup / drop points
            </button>
            <button className="btn" onClick={refresh} disabled={loading}>
              <RefreshCw size={15} /> Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="tm-card">
            <p role="alert" className="error">
              {error}
            </p>
            <button className="btn" onClick={refresh}>
              Retry loading Trip Master
            </button>
          </div>
        )}
        {notice && <p role="status">{notice}</p>}
        {tab === "routes" ? (
          routesContent
        ) : tab === "trips" ? (
          tripsContent
        ) : loading ? (
          <p role="status">Loading Trip Master...</p>
        ) : (
          !error && (
            <>
              {tab === "scheduling" ? (
                <ScheduleServices
                  services={lookup.services || []}
                  refresh={refresh}
                />
              ) : tab === "availability" ? (
                <Availability
                  services={lookup.services || []}
                  onCounter={onCounter}
                />
              ) : tab === "operations" ? (
                <Tracker
                  lookup={lookup}
                  canWrite={allowed("routes:write")}
                  onArea={onArea}
                />
              ) : tab === "reports" ? (
                <Reports />
              ) : (
                <section className="tm-card">
                  <div className="section-heading">
                    <h3>{configs[tab].title}</h3>
                    {allowed(configs[tab].permission) && (
                      <button
                        className="btn primary"
                        onClick={() => setForm({ resource: tab })}
                      >
                        <Plus size={15} /> Add{" "}
                        {tab === "services"
                          ? "service"
                          : tab === "tablets"
                            ? "tablet"
                            : "record"}
                      </button>
                    )}
                  </div>
                  {tab === "services" && (
                    <p className="muted">
                      A service stores a recurring route, departure, bus and
                      fares. Use Multi-trip scheduling to create its dated
                      trips.
                    </p>
                  )}
                  {tab === "links" && (
                    <p className="muted">
                      Connections must match cities and leave enough transfer
                      time. Linked journeys keep separate bookings.
                    </p>
                  )}
                  <DataTable
                    key={tab}
                    title={configs[tab].title.toLowerCase()}
                    rows={rows.map((row) => ({
                      id: String(row._id),
                      status: String(row.status || "Active"),
                      ...Object.fromEntries(
                        columns.map((c) => [c, String(render(row, c))]),
                      ),
                    }))}
                    columns={columns.map(
                      (c) =>
                        [
                          c,
                          labels[c] || c.charAt(0).toUpperCase() + c.slice(1),
                        ] as [string, string],
                    )}
                    emptyTitle={
                      "No " + configs[tab].title.toLowerCase() + " yet."
                    }
                    emptyDescription="Use Add record to configure this section."
                    exportable
                    onEdit={
                      allowed(configs[tab].permission) &&
                      !["fuel", "stops"].includes(tab)
                        ? (r) =>
                            setForm({
                              resource: tab,
                              record: rows.find(
                                (row) => String(row._id) === r.id,
                              ),
                            })
                        : undefined
                    }
                    onView={
                      tab === "fuel" && allowed("fleet:write")
                        ? (r) => {
                            const row = rows.find(
                              (row) => String(row._id) === r.id,
                            );
                            if (row.status !== "Recorded") {
                              setNotice("This expense is already voided");
                              return;
                            }
                            setReason("");
                            setVoiding(row);
                          }
                        : tab === "tablets" && allowed("routes:write")
                          ? async (r) => {
                              const row = rows.find(
                                (row) => String(row._id) === r.id,
                              );
                              if (!row.assignment) {
                                setAssignment(row);
                                return;
                              }
                              if (busy) return;
                              setBusy(true);
                              try {
                                await api(
                                  `/operator/trip-master/tablet-assignments/${row.assignment._id}/release`,
                                  { method: "POST" },
                                );
                                setNotice("Tablet unassigned");
                                refresh();
                              } catch (e) {
                                setNotice((e as Error).message);
                              } finally {
                                setBusy(false);
                              }
                            }
                          : undefined
                    }
                    actionLabel={
                      tab === "fuel" ? "Void expense" : "Assign / unassign"
                    }
                  />
                  {tab === "tablets" && (
                    <>
                      <h4>Assignment history</h4>
                      <div className="tm-scroll">
                        <table className="tm-table">
                          <thead>
                            <tr>
                              <th>Tablet</th>
                              <th>Trip</th>
                              <th>Assignment status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(lookup.assignments || []).map((r) => (
                              <tr key={r._id}>
                                <td>{rowLabel("tablets", r.tabletId)}</td>
                                <td>{rowLabel("trips", r.tripId)}</td>
                                <td>
                                  {r.releasedAt ? "Released" : "Assigned"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </section>
              )}
            </>
          )
        )}
        {form && (
          <MasterForm
            key={`${form.resource}-${form.record?._id || "new"}`}
            {...form}
            lookup={lookup}
            onClose={() => setForm(null)}
            onSaved={() => {
              setForm(null);
              setNotice("Record saved");
              refresh();
            }}
          />
        )}
        {assignment && (
          <AssignTablet
            tablet={assignment}
            lookup={lookup}
            onClose={() => setAssignment(null)}
            onSaved={() => {
              setAssignment(null);
              refresh();
            }}
          />
        )}
        {voiding && (
          <Overlay title="Void fuel expense" onClose={() => setVoiding(null)}>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  await api(`/operator/trip-master/fuel/${voiding._id}/void`, {
                    method: "POST",
                    body: JSON.stringify({ reason }),
                  });
                  setVoiding(null);
                  refresh();
                } catch (e) {
                  setNotice((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div className="form-grid">
                <label>
                  Reason
                  <input
                    required
                    maxLength={200}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
              </div>
              <div className="dialog-foot">
                <button
                  type="button"
                  className="btn"
                  onClick={() => setVoiding(null)}
                >
                  Cancel
                </button>
                <button className="btn primary" disabled={busy}>
                  Void expense
                </button>
              </div>
            </form>
          </Overlay>
        )}
      </div>
    </MasterSectionLayout>
  );
}
function AssignTablet({
  tablet,
  lookup,
  onClose,
  onSaved,
}: {
  tablet: any;
  lookup: Record<string, any[]>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tripId, setTrip] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Overlay title={`Assign ${tablet.name}`} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await api("/operator/trip-master/tablet-assignments", {
              method: "POST",
              body: JSON.stringify({ tabletId: tablet._id, tripId }),
            });
            onSaved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <label>
            Trip
            <select
              required
              value={tripId}
              onChange={(e) => setTrip(e.target.value)}
            >
              <option value="">Select trip</option>
              {(lookup.trips || [])
                .filter((t) => ["Scheduled", "Departed"].includes(t.status))
                .map((t) => (
                  <option key={t._id} value={t._id}>
                    {optionLabel("trips", t, lookup)}
                  </option>
                ))}
            </select>
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button disabled={busy} className="btn primary">
            Assign tablet
          </button>
        </div>
      </form>
    </Overlay>
  );
}
