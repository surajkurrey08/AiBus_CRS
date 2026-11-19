import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client.ts";
import {
  DataTable,
  MiniStats,
  Overlay,
  Panel,
  RecordForm,
} from "../../components/index.ts";
import { useWorkspace } from "../../context/WorkspaceContext.tsx";
import type { Row } from "../../data/demo-data.ts";
import { AgentForm } from "./components/AgentForm.tsx";
const money = (v = 0) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(
    v / 100,
  );
export function LiveStaff() {
  const ws = useWorkspace();
  const canRead =
    ws.user.permissions.includes("agents:read") ||
    ws.user.permissions.includes("staff:write");
  const canManage =
    ws.user.permissions.includes("agents:write") ||
    ws.user.permissions.includes("staff:write");
  const [tab, setTab] = useState("agents"),
    [staffForm, setStaffForm] = useState<Row | null>(null);
  const [form, setForm] = useState<any>(null),
    [link, setLink] = useState(false);
  const [report, setReport] = useState<any>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [detail, setDetail] = useState<any>(null),
    [detailLoading, setDetailLoading] = useState(false),
    [detailError, setDetailError] = useState("");
  const sequence = useRef(0),
    detailSequence = useRef(0);
  async function load() {
    if (!canRead) return;
    const seq = ++sequence.current;
    setLoading(true);
    setError("");
    try {
      const data = ws.demo
        ? { agents: [], totals: {} }
        : (await api("/operator/agents/performance")).data;
      if (seq === sequence.current) setReport(data);
    } catch (e) {
      if (seq === sequence.current) setError((e as Error).message);
    } finally {
      if (seq === sequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      sequence.current++;
    };
  }, [ws.revision, canRead]);
  useEffect(
    () => () => {
      detailSequence.current++;
    },
    [],
  );
  async function open(agent: any) {
    const seq = ++detailSequence.current;
    setDetail({ agent, bookings: [] });
    setDetailLoading(true);
    setDetailError("");
    try {
      const r = await api(`/operator/agents/${agent.id || agent._id}/bookings`);
      if (seq === detailSequence.current) setDetail(r.data);
    } catch (e) {
      if (seq === detailSequence.current) setDetailError((e as Error).message);
    } finally {
      if (seq === detailSequence.current) setDetailLoading(false);
    }
  }
  if (!canRead)
    return (
      <Panel>
        <p className="empty">
          You do not have permission to view agent management.
        </p>
      </Panel>
    );
  const agents = report?.agents || [],
    totals = report?.totals || {};
  const refresh = async () => {
    await ws.refresh();
    await load();
  };
  return (
    <>
      <div className="section-heading">
        <div>
          <h3>Agents & staff</h3>
          <p className="muted">
            Agencies belong to your operator. Internal booking staff are managed
            separately.
          </p>
        </div>
        {canManage && (
          <button className="btn primary" onClick={() => setForm({})}>
            Add agency
          </button>
        )}
      </div>
      <MiniStats
        items={[
          [String(totals.totalAgents || 0), "Agencies"],
          [String(totals.totalBookings || 0), "Agency bookings"],
          [money(totals.totalSalesPaise), "Confirmed paid sales"],
          [money(totals.commissionEarnedPaise), "Earned commission"],
        ]}
      />
      <div className="tabs">
        <button
          className={tab === "agents" ? "selected" : ""}
          onClick={() => setTab("agents")}
        >
          Agencies & commissions
        </button>
        {ws.user.permissions.includes("staff:write") && (
          <button
            className={tab === "staff" ? "selected" : ""}
            onClick={() => setTab("staff")}
          >
            Internal staff access
          </button>
        )}
      </div>
      {tab === "agents" ? (
        <>
          {error && (
            <Panel>
              <p role="alert">{error}</p>
              <button className="btn" onClick={() => void load()}>
                Retry agencies
              </button>
            </Panel>
          )}
          {loading && <p role="status">Loading agencies?</p>}
          {!error && !loading && (
            <DataTable
              title="agencies"
              rows={agents.map((a: any) => ({
                id: a.id,
                name: a.name,
                email: a.email || "?",
                strategy:
                  a.commissionType === "Fixed"
                    ? `${money(a.commissionRate)} / booking`
                    : `${(a.commissionRate ?? 500) / 100}%`,
                pending: String(a.pendingBookings || 0),
                confirmed: String(a.confirmedBookings || 0),
                sales: money(a.totalSalesPaise),
                commission: money(a.commissionEarnedPaise),
                status: a.active ? "Active" : "Inactive",
              }))}
              columns={[
                ["name", "Agency"],
                ["email", "Email"],
                ["strategy", "Commission"],
                ["pending", "Pending"],
                ["confirmed", "Confirmed"],
                ["sales", "Paid sales"],
                ["commission", "Earned commission"],
                ["status", "Status"],
              ]}
              actionLabel="View bookings"
              onView={(r) => void open(agents.find((a: any) => a.id === r.id))}
              onEdit={
                canManage
                  ? (r) => setForm(agents.find((a: any) => a.id === r.id))
                  : undefined
              }
              emptyTitle="No agencies yet"
              emptyDescription="Add an agency, then create or link its login users."
            />
          )}
        </>
      ) : (
        <>
          <button
            className="btn"
            onClick={() => setStaffForm({ role: "booking_staff" })}
          >
            Add internal staff
          </button>
          <DataTable
            title="staff"
            rows={(ws.raw.staff || [])
              .filter((u: any) => !u.salesPartnerId)
              .map((u: any) => ({
                id: String(u._id || u.id),
                name: u.name,
                email: u.email,
                role: u.role,
                status: u.active === false ? "Inactive" : "Active",
              }))}
            columns={[
              ["name", "Name"],
              ["email", "Email"],
              ["role", "Role"],
              ["status", "Status"],
            ]}
            onEdit={(r) => {
              if (r.role !== "operator_admin") setStaffForm(r);
            }}
          />
        </>
      )}
      {form && (
        <AgentForm
          agency={form}
          buses={ws.raw.buses || []}
          onClose={() => setForm(null)}
          onSave={async (value) => {
            await api("/operator/agents" + (form.id ? "/" + form.id : ""), {
              method: form.id ? "PATCH" : "POST",
              body: JSON.stringify(value),
            });
            setForm(null);
            await refresh();
            ws.notify("Agency saved");
          }}
        />
      )}
      {detail && (
        <Overlay
          drawer
          title={`Agency bookings ? ${detail.agent.name}`}
          onClose={() => {
            detailSequence.current++;
            setDetail(null);
          }}
        >
          <div className="settings-form">
            <p>
              Only confirmed, paid bookings earn commission. Pending, cancelled
              and refunded bookings are excluded.
            </p>
            <p>
              Linked users:{" "}
              {(detail.agent.linkedUsers || [])
                .map((u: any) => u.email)
                .join(", ") || "None linked yet"}
            </p>
            {canManage && (
              <button className="btn" onClick={() => setLink(true)}>
                Link agency user
              </button>
            )}
            {detailError && (
              <>
                <p role="alert">{detailError}</p>
                <button className="btn" onClick={() => void open(detail.agent)}>
                  Retry bookings
                </button>
              </>
            )}
            {detailLoading ? (
              <p role="status">Loading agency bookings?</p>
            ) : (
              !detailError && (
                <DataTable
                  title="agency bookings"
                  rows={detail.bookings.map((b: any) => ({
                    id: b.id,
                    pnr: b.pnr || "Pending",
                    passenger: b.passengerName || "Passenger",
                    seats: b.seats.join(", "),
                    total: money(b.totalPaise),
                    commission: money(b.commissionPaise),
                    status: b.status,
                    payment: b.paymentStatus,
                  }))}
                  columns={[
                    ["pnr", "PNR"],
                    ["passenger", "Passenger"],
                    ["seats", "Seats"],
                    ["total", "Total"],
                    ["commission", "Commission snapshot"],
                    ["status", "Booking"],
                    ["payment", "Payment"],
                  ]}
                  emptyTitle="No agency bookings yet"
                />
              )
            )}
          </div>
        </Overlay>
      )}
      {detail && link && (
        <AgencyUserForm
          staff={ws.raw.staff || []}
          onClose={() => setLink(false)}
          onSave={async (value) => {
            await api(
              `/operator/agents/${detail.agent.id || detail.agent._id}/users`,
              { method: "POST", body: JSON.stringify(value) },
            );
            setLink(false);
            await open(detail.agent);
            await refresh();
            ws.notify("Agency user linked");
          }}
        />
      )}
      {staffForm && (
        <RecordForm
          title={staffForm.id ? "Edit staff access" : "Add internal staff"}
          fields={
            staffForm.id
              ? ["name", "role", "status"]
              : ["name", "email", "password", "role"]
          }
          record={staffForm}
          onClose={() => setStaffForm(null)}
          onSave={async (value) => {
            await api(
              "/operator/staff" + (staffForm.id ? "/" + staffForm.id : ""),
              {
                method: staffForm.id ? "PATCH" : "POST",
                body: JSON.stringify({
                  name: value.name,
                  role: value.role,
                  ...(staffForm.id
                    ? { active: value.status === "Active" }
                    : { email: value.email, password: value.password }),
                }),
              },
            );
            setStaffForm(null);
            await refresh();
            ws.notify("Staff access saved");
          }}
        />
      )}
    </>
  );
}
function AgencyUserForm({
  staff,
  onClose,
  onSave,
}: {
  staff: any[];
  onClose: () => void;
  onSave: (value: any) => Promise<void>;
}) {
  const [id, setId] = useState(""),
    [create, setCreate] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  if (create)
    return (
      <RecordForm
        title="Create agency login"
        fields={["name", "email", "password"]}
        onClose={onClose}
        onSave={onSave}
      />
    );
  return (
    <Overlay title="Link agency user" onClose={onClose}>
      <form
        noValidate
        className="settings-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (saving) return;
          if (!id) {
            setError("Choose an unlinked booking staff user.");
            document.getElementById("agency-user")?.focus();
            return;
          }
          setSaving(true);
          setError("");
          try {
            await onSave({ userId: id });
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setSaving(false);
          }
        }}
      >
        <label htmlFor="agency-user">Existing booking staff user</label>
        <select
          id="agency-user"
          value={id}
          onChange={(e) => setId(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={error ? "agency-user-error" : undefined}
        >
          <option value="">Choose a user</option>
          {staff
            .filter((u) => u.role === "booking_staff" && !u.salesPartnerId)
            .map((u) => (
              <option key={String(u._id || u.id)} value={String(u._id || u.id)}>
                {u.name} ? {u.email}
              </option>
            ))}
        </select>
        {error && (
          <p id="agency-user-error" role="alert">
            {error}
          </p>
        )}
        <p>Linking a user changes their access to agency-only permissions.</p>
        <button className="btn primary" disabled={saving}>
          {saving ? "Linking?" : "Link user"}
        </button>
        <button type="button" className="btn" onClick={() => setCreate(true)}>
          Create new login instead
        </button>
      </form>
    </Overlay>
  );
}
