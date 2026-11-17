import { FileText, Plus, Users } from "lucide-react";
import { useEffect, useState } from "react";
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
import { normalize } from "../../utils/normalize.ts";

const ROLE_LABELS: Record<string, string> = {
  booking_staff: "Agent",
  manager: "Manager",
  read_only: "Read Only",
  operator_admin: "Admin",
};

export function LiveStaff() {
  const ws = useWorkspace();
  const [tab, setTab] = useState<"agents" | "all_staff">("agents");
  const [form, setForm] = useState<Row | null>(null);
  const [perfData, setPerfData] = useState<{
    agents: any[];
    totals: any;
  } | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<any | null>(null);
  const [agentBookings, setAgentBookings] = useState<any[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(false);

  const loadPerformance = async () => {
    if (ws.demo) {
      const demoAgents = (ws.raw.staff || [])
        .filter((s: any) => s.role === "booking_staff")
        .map((s: any) => ({
          id: s._id || s.id,
          name: s.name,
          email: s.email,
          phone: s.phone || "",
          role: "booking_staff",
          active: s.active ?? true,
          commissionType: s.commissionType || "Percent",
          commissionRate: s.commissionRate ?? 500,
          totalBookings: 6,
          confirmedBookings: 6,
          totalSalesPaise: 840000,
          commissionEarnedPaise: 42000,
          lastBookingAt: new Date().toISOString(),
        }));
      setPerfData({
        agents: demoAgents,
        totals: {
          totalAgents: demoAgents.length,
          activeAgents: demoAgents.filter((a) => a.active).length,
          totalBookings: 6,
          totalSalesPaise: 840000,
          commissionEarnedPaise: 42000,
        },
      });
      return;
    }
    try {
      const res = await api<{ agents: any[]; totals: any }>(
        "/operator/agents/performance",
      );
      setPerfData(res.data);
    } catch {
      // fallback if performance endpoint is unreachable
    }
  };

  useEffect(() => {
    void loadPerformance();
  }, [ws.raw.staff, ws.revision]);

  const openAgentBookings = async (agent: any) => {
    setSelectedAgent(agent);
    setLoadingBookings(true);
    setAgentBookings([]);
    if (ws.demo) {
      setAgentBookings(
        (ws.records.bookings || []).slice(0, 5).map((b, i) => ({
          id: b.id || `demo-${i}`,
          reference: b.pnr || `AB-${1000 + i}`,
          pnr: b.pnr || `AIB-${2000 + i}`,
          seats: [b.seat || "L1"],
          passengerName: b.passenger || "Passenger",
          passengersCount: 1,
          grossPaise: (Number(b.fare) || 1200) * 100,
          totalPaise: (Number(b.fare) || 1200) * 100,
          commissionPaise: Math.round(((Number(b.fare) || 1200) * 100 * 5) / 100),
          status: b.status || "Confirmed",
          paymentStatus: "Paid",
          createdAt: new Date().toISOString(),
        })),
      );
      setLoadingBookings(false);
      return;
    }
    try {
      const res = await api<{ agent: any; bookings: any[] }>(
        `/operator/agents/${agent.id}/bookings`,
      );
      setAgentBookings(res.data.bookings || []);
    } catch (e) {
      ws.notify((e as Error).message);
    } finally {
      setLoadingBookings(false);
    }
  };

  if (!ws.user.permissions.includes("staff:write"))
    return (
      <Panel>
        <div className="empty">
          Only operator administrators can manage staff and agent access.
        </div>
      </Panel>
    );

  const rawStaffList = ws.raw.staff || [];
  const agentsList = perfData?.agents || rawStaffList
    .filter((s: any) => s.role === "booking_staff")
    .map((s: any) => ({
      id: String(s._id || s.id),
      name: s.name,
      email: s.email,
      phone: s.phone || "",
      role: "booking_staff",
      active: s.active !== false,
      commissionType: s.commissionType || "Percent",
      commissionRate: s.commissionRate ?? 500,
      totalBookings: 0,
      confirmedBookings: 0,
      totalSalesPaise: 0,
      commissionEarnedPaise: 0,
    }));

  const statItems = [
    [
      String(perfData?.totals?.totalAgents ?? agentsList.length),
      "Total Agents",
    ],
    [
      String(perfData?.totals?.totalBookings ?? 0),
      "Agent Bookings",
    ],
    [
      `₹${((perfData?.totals?.totalSalesPaise ?? 0) / 100).toLocaleString("en-IN")}`,
      "Agent Sales",
    ],
    [
      `₹${((perfData?.totals?.commissionEarnedPaise ?? 0) / 100).toLocaleString("en-IN")}`,
      "Commission Payable",
    ],
  ];

  const agentRows: Row[] = agentsList.map((a: any) => {
    const rateDisplay =
      a.commissionType === "Fixed"
        ? `₹${((a.commissionRate || 0) / 100).toFixed(0)} / booking`
        : `${((a.commissionRate || 0) / 100).toFixed(1)}% on fare`;
    return {
      id: a.id,
      name: a.name,
      email: a.email,
      strategy: rateDisplay,
      bookings: String(a.totalBookings || 0),
      confirmed: String(a.confirmedBookings || 0),
      sales: `₹${((a.totalSalesPaise || 0) / 100).toLocaleString("en-IN")}`,
      commission: `₹${((a.commissionEarnedPaise || 0) / 100).toLocaleString("en-IN")}`,
      status: a.active ? "Active" : "Inactive",
      rawAgent: JSON.stringify(a),
    };
  });

  const staffRows: Row[] = rawStaffList.map((r: any) => {
    const item = normalize("staff", r);
    return {
      ...item,
      role: ROLE_LABELS[item.role] || item.role,
      rawRole: item.role,
      rawItem: JSON.stringify(r),
    };
  });

  return (
    <>
      <div className="section-heading">
        <div>
          <h3>Agent & Staff Management</h3>
          <p className="muted" style={{ fontSize: "13px", marginTop: "2px" }}>
            Manage booking agents, configure commission rates, and track ticket
            sales performance.
          </p>
        </div>
        <button
          className="btn primary"
          onClick={() =>
            setForm({
              role: "booking_staff",
              commissionType: "Percent",
              commissionRate: "5",
              status: "Active",
            })
          }
        >
          <Plus size={15} />
          Add Agent / Staff
        </button>
      </div>

      <MiniStats items={statItems} />

      <div className="tabs" style={{ marginTop: "16px", marginBottom: "16px" }}>
        <button
          className={tab === "agents" ? "selected" : ""}
          onClick={() => setTab("agents")}
        >
          <Users size={14} style={{ marginRight: "6px", verticalAlign: "middle" }} />
          Agent Records & Commission
        </button>
        <button
          className={tab === "all_staff" ? "selected" : ""}
          onClick={() => setTab("all_staff")}
        >
          All Staff Access
        </button>
      </div>

      {tab === "agents" ? (
        <DataTable
          rows={agentRows}
          columns={[
            ["name", "Agent Name"],
            ["email", "Email"],
            ["strategy", "Commission Strategy"],
            ["bookings", "Total Bookings"],
            ["confirmed", "Confirmed"],
            ["sales", "Total Sales"],
            ["commission", "Commission Earned"],
            ["status", "Status"],
          ]}
          title="agents"
          actionLabel="View bookings"
          onView={(r) => {
            const raw = r.rawAgent ? JSON.parse(r.rawAgent) : r;
            void openAgentBookings(raw);
          }}
          onEdit={(r) => {
            const raw = r.rawAgent ? JSON.parse(r.rawAgent) : r;
            setForm({
              id: raw.id,
              name: raw.name,
              email: raw.email,
              role: "booking_staff",
              commissionType: raw.commissionType || "Percent",
              commissionRate: String((raw.commissionRate || 500) / 100),
              status: raw.active ? "Active" : "Inactive",
            });
          }}
          emptyTitle="No booking agents added yet"
          emptyDescription="Click 'Add Agent / Staff' to create a booking agent account with configured commission."
        />
      ) : (
        <DataTable
          rows={staffRows}
          columns={[
            ["name", "Name"],
            ["email", "Email"],
            ["role", "Role"],
            ["status", "Status"],
          ]}
          title="staff"
          onEdit={(r) => {
            const raw = r.rawItem ? JSON.parse(r.rawItem) : r;
            setForm({
              id: String(raw._id || raw.id),
              name: raw.name,
              email: raw.email,
              role: raw.role,
              commissionType: raw.commissionType || "Percent",
              commissionRate: String((raw.commissionRate || 500) / 100),
              status: raw.active !== false ? "Active" : "Inactive",
            });
          }}
        />
      )}

      {selectedAgent && (
        <Overlay
          drawer
          title={`Agent Booking Records · ${selectedAgent.name}`}
          onClose={() => setSelectedAgent(null)}
        >
          <div style={{ padding: "16px 20px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "14px 18px",
                background: "var(--surface-sunken, #f8fafc)",
                borderRadius: "8px",
                marginBottom: "20px",
                border: "1px solid var(--border-subtle, #e2e8f0)",
              }}
            >
              <div>
                <strong style={{ fontSize: "16px" }}>{selectedAgent.name}</strong>
                <div className="muted" style={{ fontSize: "13px" }}>
                  {selectedAgent.email}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: "13px" }}>
                  <strong>Commission Rule: </strong>
                  {selectedAgent.commissionType === "Fixed"
                    ? `₹${((selectedAgent.commissionRate || 0) / 100).toFixed(0)} Fixed per booking`
                    : `${((selectedAgent.commissionRate || 0) / 100).toFixed(1)}% on ticket fare`}
                </div>
                <div className="muted" style={{ fontSize: "12px", marginTop: "2px" }}>
                  Status: {selectedAgent.active ? "Active Agent" : "Inactive"}
                </div>
              </div>
            </div>

            {loadingBookings ? (
              <div className="empty" role="status">
                Loading agent booking records…
              </div>
            ) : agentBookings.length === 0 ? (
              <div className="empty">
                <FileText size={32} style={{ opacity: 0.5, marginBottom: "8px" }} />
                <h3>No bookings recorded yet</h3>
                <p>
                  Bookings created by {selectedAgent.name} in the Booking Counter
                  will be tracked and listed here automatically with calculated commission.
                </p>
              </div>
            ) : (
              <DataTable
                rows={agentBookings.map((b) => ({
                  id: b.id,
                  pnr: b.pnr || "Pending",
                  date: b.createdAt
                    ? new Date(b.createdAt).toLocaleDateString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })
                    : "",
                  passenger: b.passengerName,
                  seats: Array.isArray(b.seats)
                    ? b.seats.join(", ")
                    : String(b.seats || ""),
                  fare: String((b.grossPaise || 0) / 100),
                  commission: `₹${((b.commissionPaise || 0) / 100).toFixed(2)}`,
                  status: b.status,
                }))}
                columns={[
                  ["pnr", "PNR"],
                  ["date", "Booking Date"],
                  ["passenger", "Passenger"],
                  ["seats", "Seats"],
                  ["fare", "Ticket Fare"],
                  ["commission", "Commission"],
                  ["status", "Status"],
                ]}
                title="agent bookings"
              />
            )}
          </div>
        </Overlay>
      )}

      {form && (
        <RecordForm
          title={
            form.id
              ? form.role === "booking_staff"
                ? "Edit Agent & Commission"
                : "Edit staff access"
              : "Add Agent / Staff"
          }
          fields={
            form.id
              ? form.role === "booking_staff"
                ? ["name", "role", "commissionType", "commissionRate", "status"]
                : ["name", "role", "status"]
              : [
                  "name",
                  "email",
                  "password",
                  "role",
                  "commissionType",
                  "commissionRate",
                ]
          }
          record={form}
          onClose={() => setForm(null)}
          onSave={async (values) => {
            const rawRate = Number(values.commissionRate || 0);
            const commType = values.commissionType || "Percent";
            const commRate = Math.round(rawRate * 100);

            const payload: any = form.id
              ? {
                  name: values.name,
                  role: values.role === "Agent" ? "booking_staff" : values.role,
                  active: values.status === "Active",
                  commissionType: commType,
                  commissionRate: commRate,
                }
              : {
                  name: values.name,
                  email: values.email,
                  password: values.password,
                  role:
                    values.role === "Agent"
                      ? "booking_staff"
                      : values.role || "booking_staff",
                  commissionType: commType,
                  commissionRate: commRate,
                };

            await api("/operator/staff" + (form.id ? "/" + form.id : ""), {
              method: form.id ? "PATCH" : "POST",
              body: JSON.stringify(payload),
            });
            setForm(null);
            await ws.refresh();
            await loadPerformance();
            ws.notify("Agent / staff access saved");
          }}
        />
      )}
    </>
  );
}
