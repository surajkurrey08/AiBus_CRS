import { MasterSectionLayout } from "../../components/navigation/MasterSectionLayout";
import type { Row } from "../../data/demo-data";
import { useEffect, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { api } from "../../api/client";
import { DataTable, MiniStats, Overlay, Panel } from "../../components/index";
import { SeatMap, type InventorySeat } from "../../components/seats/SeatMap";
import { useWorkspace } from "../../context/WorkspaceContext";
import { masterColumns, masterTabs } from "./masterConfig";
import { loadAllRecords } from "../../api/loadAll";
import { MasterForm } from "./components/MasterForm";
import { BusAssignments } from "./components/BusAssignments";
import { CrewFields } from "./components/CrewFields";
import "./bus-master.css";
export function BusMaster({
  onAddBus,
  onEditBus,
}: {
  onAddBus?: () => void;
  onEditBus?: (row: Row) => void;
}) {
  const ws = useWorkspace();
  const canWrite = ws.user.permissions.includes("fleet:write");
  const [tab, setTab] = useState("vehicles");
  const [revision, setRevision] = useState(0);
  const [lookup, setLookup] = useState<Record<string, Record<string, any>[]>>(
    {},
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Record<string, any> | null | undefined>(
    undefined,
  );
  const [bus, setBus] = useState<Record<string, any> | null>(null);
  const [preview, setPreview] = useState<Record<string, any> | null>(null);
  const [gpsStatus, setGpsStatus] = useState<Record<string, any> | null>(null);
  const [tripId, setTripId] = useState("");
  const [crewIds, setCrewIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (ws.demo) {
      setLookup({ buses: ws.records?.buses || [], trips: ws.raw.trips || [] });
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const resources = ["owners", "coaches", "charts", "buses", "trips"];
    Promise.all(
      resources.map(
        async (resource) =>
          [
            resource,
            await loadAllRecords(
              resource === "buses" || resource === "trips"
                ? `/operator/${resource}`
                : `/operator/bus-master/${resource}`,
              controller.signal,
            ),
          ] as const,
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
  function saved() {
    setForm(undefined);
    setRevision((v) => v + 1);
    void ws.refresh();
  }
  async function editRecord(recordId: string) {
    try {
      const result = await api(`/operator/bus-master/${tab}/${recordId}`);
      setForm(result.data);
    } catch (e) {
      ws.notify((e as Error).message);
    }
  }
  return (
    <MasterSectionLayout
      label="Bus Master"
      selected={tab}
      sections={masterTabs.map((item) => ({
        ...item,
        group: ["vehicles", "charts", "coaches"].includes(item.id)
          ? "Bus setup"
          : ["crew", "owners"].includes(item.id)
            ? "People"
            : item.id === "trip-crew"
              ? "Trip assignment"
              : "Vehicle records",
      }))}
      onSelect={(value) => {
        setTab(value);
        setForm(undefined);
        setNotice("");
      }}
    >
      <div className="fleet-master">
        {error && (
          <div className="info-banner" role="alert">
            {error}
            <button
              className="text-btn"
              onClick={() => setRevision((v) => v + 1)}
            >
              Retry master data
            </button>
          </div>
        )}
        {notice && (
          <div className="info-banner" role="status">
            {notice}
          </div>
        )}
        <div className="section-heading">
          <h3>{masterTabs.find((item) => item.id === tab)?.label}</h3>
          <div className="fleet-master-actions">
            <button
              className="btn"
              disabled={loading}
              onClick={() => setRevision((v) => v + 1)}
            >
              <RefreshCw size={15} />
              Refresh
            </button>
            {tab === "vehicles"
              ? canWrite && (
                  <button className="btn primary" onClick={onAddBus}>
                    <Plus size={15} /> Add bus
                  </button>
                )
              : tab !== "trip-crew" &&
                canWrite && (
                  <button
                    className="btn primary"
                    disabled={loading || !!error}
                    onClick={() => setForm(null)}
                  >
                    <Plus size={15} />
                    Create{" "}
                    {masterTabs
                      .find((item) => item.id === tab)
                      ?.label.toLowerCase()}
                  </button>
                )}
          </div>
        </div>
        {tab === "vehicles" ? (
          <>
            <MiniStats
              items={[
                [String((lookup.buses || []).length), "Total buses"],
                [
                  String(
                    (lookup.buses || []).filter(
                      (bus) => bus.status === "Active",
                    ).length,
                  ),
                  "Active buses",
                ],
                [
                  String(
                    (lookup.buses || []).reduce(
                      (sum, bus) => sum + Number(bus.capacity || 0),
                      0,
                    ),
                  ),
                  "Total seat capacity",
                ],
              ]}
            />
            <DataTable
              key={`vehicles-${revision}`}
              rows={ws.records?.buses || []}
              onEdit={canWrite ? onEditBus : undefined}
              title="buses"
              columns={[
                ["id", "Registration"],
                ["name", "Bus"],
                ["type", "Type"],
                ["capacity", "Seats"],
                ["status", "Status"],
              ]}
              onView={
                canWrite && !ws.demo
                  ? async (row) => {
                      try {
                        const result = await api(`/operator/buses/${row._id}`);
                        setBus(result.data);
                      } catch (e) {
                        ws.notify((e as Error).message);
                      }
                    }
                  : undefined
              }
              actionLabel="Configure bus"
            />
          </>
        ) : tab === "trip-crew" ? (
          <Panel title="Assign crew to a scheduled trip">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  busy ||
                  !tripId ||
                  !ws.user.permissions.includes("routes:write")
                )
                  return;
                setBusy(true);
                setError("");
                try {
                  await api(`/operator/bus-master/trips/${tripId}/crew`, {
                    method: "PATCH",
                    body: JSON.stringify({ crewIds }),
                  });
                  setNotice("Trip crew saved.");
                  setRevision((v) => v + 1);
                  void ws.refresh();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div className="form-grid">
                <label className="fleet-full-width">
                  Scheduled trip
                  <select
                    required
                    value={tripId}
                    onChange={(e) => {
                      setTripId(e.target.value);
                      setCrewIds(
                        (lookup.trips || []).find(
                          (trip) => trip._id === e.target.value,
                        )?.crewIds || [],
                      );
                    }}
                  >
                    <option value="">Select trip</option>
                    {(lookup.trips || [])
                      .filter((trip) => trip.status === "Scheduled")
                      .map((trip) => (
                        <option value={trip._id} key={trip._id}>
                          {trip.journeyDate} ·{" "}
                          {(lookup.buses || []).find(
                            (bus) => bus._id === trip.busId,
                          )?.registration || trip.busId}{" "}
                          ·{" "}
                          {new Date(trip.departureAt).toLocaleTimeString(
                            "en-IN",
                            {
                              timeZone: "Asia/Kolkata",
                              hour: "2-digit",
                              minute: "2-digit",
                            },
                          )}
                        </option>
                      ))}
                  </select>
                </label>
                <CrewFields selected={crewIds} onChange={setCrewIds} />
              </div>
              {ws.user.permissions.includes("routes:write") && (
                <div className="dialog-foot">
                  <button className="btn primary" disabled={busy || !tripId}>
                    {busy ? "Saving..." : "Save trip crew"}
                  </button>
                </div>
              )}
            </form>
          </Panel>
        ) : (
          <>
            {tab === "gps" && (
              <div className="info-banner">
                Device mapping is available. Live location and device
                connectivity require a GPS provider integration.
              </div>
            )}
            <DataTable
              key={`${tab}-${revision}`}
              rows={[]}
              title={masterTabs.find((item) => item.id === tab)!.label}
              resourcePath={`bus-master/${tab}`}
              unsortableColumns={[
                "capacity",
                "registration",
                "telemetry",
                "type",
              ]}
              columns={masterColumns[tab]}
              onEdit={canWrite ? (row) => void editRecord(row.id) : undefined}
              onView={
                tab === "charts" || tab === "gps"
                  ? async (row) => {
                      try {
                        const result = await api(
                          `/operator/bus-master/${tab}/${row.id}${tab === "gps" ? "/status" : ""}`,
                        );
                        if (tab === "gps") setGpsStatus(result.data);
                        else setPreview(result.data);
                      } catch (e) {
                        ws.notify((e as Error).message);
                      }
                    }
                  : undefined
              }
              actionLabel={tab === "charts" ? "Preview chart" : "GPS status"}
            />
          </>
        )}
        {form !== undefined && (
          <MasterForm
            resource={tab}
            record={form || undefined}
            buses={lookup.buses || []}
            onClose={() => setForm(undefined)}
            onSaved={saved}
          />
        )}
        {bus && (
          <BusAssignments
            bus={bus}
            owners={lookup.owners || []}
            coaches={lookup.coaches || []}
            charts={lookup.charts || []}
            onClose={() => setBus(null)}
            onSaved={saved}
          />
        )}
        {preview && (
          <Overlay title={preview.name} onClose={() => setPreview(null)}>
            <div className="fleet-chart-preview">
              <SeatMap
                title="Seat chart"
                seats={
                  preview.seats.map((seat: any) => ({
                    ...seat,
                    state: "available",
                  })) as InventorySeat[]
                }
                selected={[]}
                onToggle={() => {}}
                disabled
              />
            </div>
          </Overlay>
        )}
        {gpsStatus && (
          <Overlay title="GPS device status" onClose={() => setGpsStatus(null)}>
            <dl className="fleet-gps-details">
              <dt>Provider</dt>
              <dd>{gpsStatus.provider}</dd>
              <dt>Device ID</dt>
              <dd>{gpsStatus.deviceId}</dd>
              <dt>Configuration</dt>
              <dd>{gpsStatus.configurationStatus}</dd>
              <dt>Live status</dt>
              <dd>{gpsStatus.telemetryStatus}</dd>
              <dt>Last location report</dt>
              <dd>{gpsStatus.lastReportedAt || "No provider data received"}</dd>
            </dl>
          </Overlay>
        )}
      </div>
    </MasterSectionLayout>
  );
}
