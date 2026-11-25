import { useEffect, useState } from "react";
import { api } from "../../api/client";
import {
  CheckCircle2,
  Clock,
  Calendar,
  Check,
  AlertCircle,
  RefreshCw,
} from "lucide-react";

interface SettlementRow {
  _id: string;
  agentId: string;
  agentName: string;
  agencyEmail: string;
  agencyPhone: string;
  commissionRate: number;
  date: string;
  totalBookings: number;
  grossPaise: number;
  commissionPaise: number;
  netPayablePaise: number;
  status: "Pending" | "Cleared";
  clearedAt?: string;
  notes?: string;
}

export function AgentDailySettlement() {
  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const [date, setDate] = useState(todayStr);
  const [loading, setLoading] = useState(false);
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function loadData(targetDate: string) {
    setLoading(true);
    setError("");
    try {
      const res = await api<{ settlements: SettlementRow[]; date: string }>(
        `/operator/agents/settlements/daily?date=${targetDate}`,
      );
      setSettlements(res.data.settlements || []);
    } catch (e: any) {
      setError(e.message || "Failed to load agent settlements");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData(date);
  }, [date]);

  async function handleMarkCleared(settlementId: string, agentName: string) {
    if (
      !window.confirm(
        `Are you sure you want to mark this sales report as REVIEWED for ${agentName}?`,
      )
    ) {
      return;
    }
    setSettlingId(settlementId);
    setError("");
    setSuccess("");
    try {
      await api(`/operator/agents/settlements/${settlementId}/clear`, {
        method: "POST",
        body: JSON.stringify({
          notes: "Sales report reviewed; no funds transferred",
        }),
      });
      setSuccess(`Sales report marked as reviewed for ${agentName}.`);
      await loadData(date);
    } catch (e: any) {
      setError(e.message || "Failed to mark settlement as cleared");
    } finally {
      setSettlingId(null);
    }
  }

  const totalBookings = settlements.reduce(
    (sum, s) => sum + s.totalBookings,
    0,
  );
  const totalGross =
    settlements.reduce((sum, s) => sum + s.grossPaise, 0) / 100;
  const totalCommission =
    settlements.reduce((sum, s) => sum + s.commissionPaise, 0) / 100;
  const totalNet =
    settlements.reduce((sum, s) => sum + s.netPayablePaise, 0) / 100;
  const clearedCount = settlements.filter((s) => s.status === "Cleared").length;
  const pendingCount = settlements.filter(
    (s) => s.status === "Pending" && s.totalBookings > 0,
  ).length;

  return (
    <div className="agent-settlement-panel" style={{ marginTop: "16px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "12px",
        }}
      >
        <div>
          <h3
            style={{
              margin: "0 0 4px",
              fontSize: "16px",
              color: "var(--crs-ink)",
            }}
          >
            Agent Daily Bookings & Sales Reconciliation
          </h3>
          <p style={{ margin: 0, fontSize: "12px", color: "#64748b" }}>
            Track date-wise bookings, recorded commission, and daily sales
            reconciliation for each agent.
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "12px",
              fontWeight: 600,
            }}
          >
            <Calendar size={14} />
            Date:
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={{
                padding: "4px 8px",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
                fontSize: "12px",
              }}
            />
          </label>
          <button
            type="button"
            className="text-btn"
            disabled={loading}
            onClick={() => void loadData(date)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              fontSize: "12px",
            }}
          >
            <RefreshCw size={13} className={loading ? "spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div
          className="counter-alert error"
          style={{ marginBottom: "10px" }}
          role="alert"
        >
          <AlertCircle size={15} />
          {error}
        </div>
      )}

      {success && (
        <div
          className="counter-alert success"
          style={{ marginBottom: "10px" }}
          role="status"
        >
          <CheckCircle2 size={15} />
          {success}
        </div>
      )}

      {/* Summary KPI Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: "8px",
          marginBottom: "14px",
        }}
      >
        <div
          style={{
            background: "#f8fafc",
            padding: "10px 12px",
            borderRadius: "8px",
            border: "1px solid #e2e8f0",
          }}
        >
          <span style={{ fontSize: "11px", color: "#64748b" }}>
            Agent Bookings
          </span>
          <strong
            style={{ display: "block", fontSize: "18px", color: "#0f172a" }}
          >
            {totalBookings}
          </strong>
        </div>
        <div
          style={{
            background: "#f8fafc",
            padding: "10px 12px",
            borderRadius: "8px",
            border: "1px solid #e2e8f0",
          }}
        >
          <span style={{ fontSize: "11px", color: "#64748b" }}>
            Gross Collection
          </span>
          <strong
            style={{ display: "block", fontSize: "18px", color: "#0f172a" }}
          >
            ₹{totalGross.toLocaleString("en-IN")}
          </strong>
        </div>
        <div
          style={{
            background: "#f8fafc",
            padding: "10px 12px",
            borderRadius: "8px",
            border: "1px solid #e2e8f0",
          }}
        >
          <span style={{ fontSize: "11px", color: "#64748b" }}>
            Agent Commission Cut
          </span>
          <strong
            style={{ display: "block", fontSize: "18px", color: "#059669" }}
          >
            - ₹{totalCommission.toLocaleString("en-IN")}
          </strong>
        </div>
        <div
          style={{
            background: "#eff6ff",
            padding: "10px 12px",
            borderRadius: "8px",
            border: "1px solid #bfdbfe",
          }}
        >
          <span style={{ fontSize: "11px", color: "#1e40af", fontWeight: 600 }}>
            Net To Receive (Operator)
          </span>
          <strong
            style={{ display: "block", fontSize: "18px", color: "#1d4ed8" }}
          >
            ₹{totalNet.toLocaleString("en-IN")}
          </strong>
        </div>
        <div
          style={{
            background: "#f8fafc",
            padding: "10px 12px",
            borderRadius: "8px",
            border: "1px solid #e2e8f0",
          }}
        >
          <span style={{ fontSize: "11px", color: "#64748b" }}>
            Review Status
          </span>
          <div
            style={{
              display: "flex",
              gap: "6px",
              marginTop: "2px",
              alignItems: "center",
            }}
          >
            <span
              style={{ fontSize: "12px", color: "#059669", fontWeight: 700 }}
            >
              {clearedCount} Reviewed
            </span>
            <span style={{ fontSize: "11px", color: "#94a3b8" }}>·</span>
            <span
              style={{
                fontSize: "12px",
                color: pendingCount > 0 ? "#d97706" : "#64748b",
                fontWeight: 700,
              }}
            >
              {pendingCount} Pending
            </span>
          </div>
        </div>
      </div>

      {/* Settlements Table */}
      <div
        style={{
          border: "1px solid #e2e8f0",
          borderRadius: "8px",
          overflow: "hidden",
          background: "#ffffff",
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "12px",
            textAlign: "left",
          }}
        >
          <thead>
            <tr
              style={{
                background: "#f8fafc",
                borderBottom: "1px solid #e2e8f0",
                color: "#475569",
              }}
            >
              <th style={{ padding: "8px 12px" }}>Agent / Agency</th>
              <th style={{ padding: "8px 10px" }}>Date</th>
              <th style={{ padding: "8px 10px" }}>Bookings</th>
              <th style={{ padding: "8px 10px" }}>Gross Fare</th>
              <th style={{ padding: "8px 10px" }}>Commission</th>
              <th style={{ padding: "8px 10px" }}>Net Payable to Operator</th>
              <th style={{ padding: "8px 10px" }}>Daily Review Status</th>
              <th style={{ padding: "8px 12px", textAlign: "right" }}>
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {!settlements.length && !loading ? (
              <tr>
                <td
                  colSpan={8}
                  style={{
                    padding: "20px",
                    textAlign: "center",
                    color: "#94a3b8",
                  }}
                >
                  No agent bookings or settlements recorded for {date}.
                </td>
              </tr>
            ) : (
              settlements.map((s) => {
                const isCleared = s.status === "Cleared";
                return (
                  <tr
                    key={s._id || s.agentId}
                    style={{ borderBottom: "1px solid #f1f5f9" }}
                  >
                    <td style={{ padding: "8px 12px" }}>
                      <strong style={{ color: "#0f172a" }}>
                        {s.agentName}
                      </strong>
                      <div style={{ fontSize: "10.5px", color: "#64748b" }}>
                        {s.agencyPhone !== "—" ? s.agencyPhone : s.agencyEmail}
                      </div>
                    </td>
                    <td style={{ padding: "8px 10px", color: "#475569" }}>
                      {s.date}
                    </td>
                    <td style={{ padding: "8px 10px" }}>
                      <strong>{s.totalBookings}</strong> seats
                    </td>
                    <td style={{ padding: "8px 10px", color: "#334155" }}>
                      ₹{(s.grossPaise / 100).toLocaleString("en-IN")}
                    </td>
                    <td style={{ padding: "8px 10px", color: "#059669" }}>
                      - ₹{(s.commissionPaise / 100).toLocaleString("en-IN")}
                      <span
                        style={{
                          fontSize: "10px",
                          color: "#64748b",
                          marginLeft: "4px",
                        }}
                      >
                        ({(s.commissionRate / 100).toFixed(1)}%)
                      </span>
                    </td>
                    <td style={{ padding: "8px 10px" }}>
                      <strong style={{ color: "#1d4ed8", fontSize: "13px" }}>
                        ₹{(s.netPayablePaise / 100).toLocaleString("en-IN")}
                      </strong>
                    </td>
                    <td style={{ padding: "8px 10px" }}>
                      {isCleared ? (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            background: "#dcfce7",
                            color: "#15803d",
                            padding: "2px 8px",
                            borderRadius: "12px",
                            fontSize: "11px",
                            fontWeight: 600,
                          }}
                        >
                          <CheckCircle2 size={12} />
                          Reviewed ✓
                        </span>
                      ) : (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            background: "#fef3c7",
                            color: "#b45309",
                            padding: "2px 8px",
                            borderRadius: "12px",
                            fontSize: "11px",
                            fontWeight: 600,
                          }}
                        >
                          <Clock size={12} />
                          Pending (Due)
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "8px 12px", textAlign: "right" }}>
                      {isCleared ? (
                        <span style={{ fontSize: "11px", color: "#64748b" }}>
                          Settled
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="btn primary"
                          disabled={
                            settlingId === s._id || s.totalBookings === 0
                          }
                          onClick={() =>
                            void handleMarkCleared(s._id, s.agentName)
                          }
                          style={{
                            padding: "3px 8px",
                            fontSize: "11px",
                            minHeight: "26px",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                          }}
                        >
                          <Check size={12} />
                          {settlingId === s._id
                            ? "Saving review…"
                            : "Mark reviewed"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
