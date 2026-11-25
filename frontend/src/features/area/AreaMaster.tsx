import { MasterSectionLayout } from "../../components/navigation/MasterSectionLayout";
import { useEffect, useRef, useState } from "react";
import { MapPin, Plus, RefreshCw, Route } from "lucide-react";
import { api } from "../../api/client";
import { loadAllRecords } from "../../api/loadAll";
import { DataTable, Overlay } from "../../components/index";
import { useWorkspace } from "../../context/WorkspaceContext";
import { areaColumns, areaTabs } from "./areaConfig";
import { AreaForm } from "./components/AreaForm";
import { RouteForm } from "./components/RouteForm";
import { RouteStopAssignment } from "./components/RouteStopAssignment";
import "./area-master.css";

export function AreaMaster({ defaultTab = "cities" }: { defaultTab?: string }) {
  const ws = useWorkspace();
  const canWrite = ws.user.permissions.includes("routes:write");
  const [tab, setTab] = useState(defaultTab);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const [revision, setRevision] = useState(0);
  const [lookup, setLookup] = useState<Record<string, Record<string, any>[]>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState<{
    resource: string;
    record?: Record<string, any>;
  } | null>(null);
  const [details, setDetails] = useState<Record<string, any> | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    Promise.all(
      ["cities", "locations", "pois", "routes"].map(
        async (resource) =>
          [
            resource,
            await loadAllRecords(
              resource === "routes"
                ? "/operator/routes"
                : `/operator/area-master/${resource}`,
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
  }, [revision]);
  function reload() {
    setRevision((v) => v + 1);
    void ws.refresh();
  }
  async function loadRecord(recordId: string, edit: boolean) {
    const resource = tab;
    try {
      const url =
        resource === "routes"
          ? `/operator/routes/${recordId}`
          : `/operator/area-master/${resource}/${recordId}`;
      const result = await api(url);
      if (tabRef.current !== resource) return;
      if (edit) setForm({ resource, record: result.data });
      else setDetails(result.data);
    } catch (e) {
      ws.notify((e as Error).message);
    }
  }
  const recordName =
    tab === "routes"
      ? "route"
      : tab === "cities"
        ? "city"
        : tab === "locations"
          ? "pickup / drop point"
          : "POI / landmark";
  return (
    <MasterSectionLayout
      label="Route Master"
      selected={tab}
      sections={areaTabs.map((item) => ({
        ...item,
        group: ["routes", "route-stops"].includes(item.id)
          ? "Route mapping"
          : "Location setup",
      }))}
      onSelect={(value) => {
        setTab(value);
        setForm(null);
        setNotice("");
      }}
    >
      <div className="area-master">
        {error && (
          <div className="info-banner" role="alert">
            {error}
            <button
              className="text-btn"
              onClick={() => setRevision((v) => v + 1)}
            >
              Retry Route Master
            </button>
          </div>
        )}
        {notice && (
          <div className="info-banner" role="status">
            {notice}
          </div>
        )}
        <div className="section-heading">
          <h3>{areaTabs.find((item) => item.id === tab)?.label}</h3>
          <div className="area-actions">
            <button
              className="btn"
              disabled={loading}
              onClick={() => setRevision((v) => v + 1)}
            >
              <RefreshCw size={15} />
              Refresh
            </button>
            {tab !== "route-stops" && canWrite && (
              <button
                className="btn primary"
                disabled={loading || !!error}
                onClick={() => setForm({ resource: tab })}
              >
                <Plus size={15} />
                Create {recordName}
              </button>
            )}
          </div>
        </div>
        {tab === "route-stops" ? (
          loading ? (
            <p role="status">Loading cities and locations...</p>
          ) : (
            <RouteStopAssignment
              routes={lookup.routes || []}
              cities={lookup.cities || []}
              locations={lookup.locations || []}
              canWrite={canWrite}
              onSaved={reload}
            />
          )
        ) : (
          <>
            {tab !== "cities" &&
              tab !== "routes" &&
              !loading &&
              !(lookup.cities || []).some(
                (city) => city.status === "Active",
              ) && (
                <div className="info-banner">
                  Create an active city before adding pickup/drop points or
                  landmarks.
                </div>
              )}
            <DataTable
              key={`${tab}-${revision}`}
              rows={[]}
              title={areaTabs.find((item) => item.id === tab)!.label}
              resourcePath={tab === "routes" ? "routes" : `area-master/${tab}`}
              columns={areaColumns[tab]}
              unsortableColumns={tab === "routes" ? [] : ["cityName"]}
              onEdit={
                canWrite
                  ? (row) => void loadRecord(row.id || row._id, true)
                  : undefined
              }
              onView={(row) => void loadRecord(row.id || row._id, false)}
              actionLabel="View details"
            />
          </>
        )}
        {form && form.resource === "routes" && (
          <RouteForm
            record={form.record}
            cities={lookup.cities || []}
            locations={lookup.locations || []}
            onClose={() => setForm(null)}
            onSaved={() => {
              setForm(null);
              setNotice("Route saved successfully.");
              reload();
            }}
          />
        )}
        {form && form.resource !== "routes" && (
          <AreaForm
            resource={form.resource}
            record={form.record}
            cities={lookup.cities || []}
            pois={lookup.pois || []}
            onClose={() => setForm(null)}
            onSaved={() => {
              setForm(null);
              setNotice("Area record saved.");
              reload();
            }}
          />
        )}
        {details && (
          <Overlay
            title={
              details.source && details.destination
                ? `${details.source} → ${details.destination}`
                : details.name || "Details"
            }
            onClose={() => setDetails(null)}
          >
            {details.source && details.destination ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "16px 20px" }}>
                <div
                  style={{
                    padding: "10px 14px",
                    background: "#f0fdf4",
                    border: "1px solid #bbf7d0",
                    borderRadius: "6px",
                    fontWeight: 600,
                    color: "#166534",
                  }}
                >
                  {details.source} → {details.destination} ({details.departure} - {details.arrival})
                </div>
                <dl className="area-details" style={{ padding: 0 }}>
                  <div>
                    <dt>Duration</dt>
                    <dd>
                      {Math.floor((details.durationMinutes || 0) / 60)}h{" "}
                      {(details.durationMinutes || 0) % 60}m ({details.durationMinutes || 0} mins)
                    </dd>
                  </div>
                  {details.distanceKm && (
                    <div>
                      <dt>Distance</dt>
                      <dd>{details.distanceKm} km</dd>
                    </div>
                  )}
                  <div>
                    <dt>Status</dt>
                    <dd>{details.status}</dd>
                  </div>
                  {details.boarding?.length > 0 && (
                    <div>
                      <dt>Boarding Stops</dt>
                      <dd>
                        {details.boarding
                          .map((b: any) => `${b.name}${b.time ? ` (${b.time})` : ""}`)
                          .join(" · ")}
                      </dd>
                    </div>
                  )}
                  {details.dropping?.length > 0 && (
                    <div>
                      <dt>Dropping Stops</dt>
                      <dd>
                        {details.dropping
                          .map((d: any) => `${d.name}${d.time ? ` (${d.time})` : ""}`)
                          .join(" · ")}
                      </dd>
                    </div>
                  )}
                </dl>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px" }}>
                  <button
                    className="btn primary"
                    onClick={() => {
                      setDetails(null);
                      setTab("route-stops");
                    }}
                  >
                    Configure stops on map
                  </button>
                </div>
              </div>
            ) : (
              <dl className="area-details">
                {details.cityId && (
                  <>
                    <dt>City</dt>
                    <dd>
                      {(lookup.cities || []).find(
                        (city) => city._id === details.cityId,
                      )?.name || "City unavailable"}
                    </dd>
                  </>
                )}
                {[
                  "state",
                  "country",
                  "usage",
                  "category",
                  "address",
                  "phone",
                  "status",
                ]
                  .filter((key) => details[key])
                  .map((key) => (
                    <div key={key}>
                      <dt>
                        {key === "usage"
                          ? "Point type"
                          : key.charAt(0).toUpperCase() + key.slice(1)}
                      </dt>
                      <dd>{details[key]}</dd>
                    </div>
                  ))}
                {details.landmarkId && (
                  <>
                    <dt>Landmark</dt>
                    <dd>
                      {(lookup.pois || []).find(
                        (poi) => poi._id === details.landmarkId,
                      )?.name || "Not available"}
                    </dd>
                  </>
                )}
              </dl>
            )}
            {details.latitude !== undefined &&
              details.longitude !== undefined && (
                <div className="area-map-link">
                  <a
                    className="btn"
                    href={`https://www.google.com/maps?q=${details.latitude},${details.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <MapPin size={15} />
                    Open map
                  </a>
                </div>
              )}
          </Overlay>
        )}
      </div>
    </MasterSectionLayout>
  );
}
