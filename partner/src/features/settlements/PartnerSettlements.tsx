import { useEffect, useState } from "react";
import { api } from "../../api/client";
import {
  CheckCircle2,
  Clock,
  Calendar,
  RefreshCw,
  AlertCircle,
  IndianRupee,
} from "lucide-react";

interface SettlementItem {
  date: string;
  totalBookings: number;
  grossPaise: number;
  commissionPaise: number;
  netPayablePaise: number;
  status: "Pending" | "Cleared";
  clearedAt?: string;
}

export function PartnerSettlements() {
  const [loading, setLoading] = useState(false);
  const [settlements, setSettlements] = useState<SettlementItem[]>([]);
  const [todayStatus, setTodayStatus] = useState<string>("Pending");
  const [todayNetPaise, setTodayNetPaise] = useState<number>(0);
  const [error, setError] = useState("");

  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  async function loadSettlements() {
    setLoading(true);
    setError("");
    try {
      const res = await api<{
        settlements: SettlementItem[];
        todayStatus: string;
        todayNetPayablePaise: number;
      }>("/partner/settlements");
      setSettlements(res.data.settlements || []);
      setTodayStatus(res.data.todayStatus || "Pending");
      setTodayNetPaise(res.data.todayNetPayablePaise || 0);
    } catch (e: any) {
      setError(e.message || "Failed to load settlements");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSettlements();
  }, []);

  const totalGross =
    settlements.reduce((sum, s) => sum + s.grossPaise, 0) / 100;
  const totalCommission =
    settlements.reduce((sum, s) => sum + s.commissionPaise, 0) / 100;
  const totalNet =
    settlements.reduce((sum, s) => sum + s.netPayablePaise, 0) / 100;
  const totalBookings = settlements.reduce(
    (sum, s) => sum + s.totalBookings,
    0,
  );

  return (
    <div className="partner-settlements-page" style={{ padding: "16px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px",
        }}
      >
        <div>
          <h2
            style={{
              margin: "0 0 4px",
              fontSize: "18px",
              color: "var(--crs-ink)",
            }}
          >
            Daily Booking & Commission Report
          </h2>
          <p style={{ margin: 0, fontSize: "12px", color: "#64748b" }}>
            Date-wise breakdown of your bookings, commission deducted, and
            reconciliation review status with the operator.
          </p>
        </div>
        <button
          type="button"
          className="btn"
          disabled={loading}
          onClick={() => void loadSettlements()}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "12px",
          }}
        >
          <RefreshCw size={13} className={loading ? "spin" : ""} />
          Refresh Ledger
        </button>
      </div>

      {error && (
        <div
          className="counter-alert error"
          style={{ marginBottom: "14px" }}
          role="alert"
        >
          <AlertCircle size={15} />
          {error}
        </div>
      )}

      {/* Today's Clearance Highlight Banner */}
      <div
        style={{
          background: todayStatus === "Cleared" ? "#ecfdf5" : "#fffbeb",
          border: `1.5px solid ${todayStatus === "Cleared" ? "#10b981" : "#f59e0b"}`,
          borderRadius: "10px",
          padding: "14px 18px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "18px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {todayStatus === "Cleared" ? (
            <CheckCircle2 size={24} style={{ color: "#059669" }} />
          ) : (
            <Clock size={24} style={{ color: "#d97706" }} />
          )}
          <div>
            <strong
              style={{
                fontSize: "14px",
                color: todayStatus === "Cleared" ? "#065f46" : "#92400e",
              }}
            >
              {todayStatus === "Cleared"
                ? "Aaj ka payment clear ho gaya hai! (Today's settlement Cleared with Operator)"
                : "Aaj ka payment baki hai (Today's settlement Pending clearance)"}
            </strong>
            <div
              style={{
                fontSize: "12px",
                color: todayStatus === "Cleared" ? "#047857" : "#b45309",
                marginTop: "2px",
              }}
            >
              Date: {todayStr} ·{" "}
              {todayStatus === "Cleared"
                ? "Received by operator"
                : `₹${(todayNetPaise / 100).toLocaleString("en-IN")} payable to operator`}
            </div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              padding: "4px 12px",
              borderRadius: "16px",
              fontWeight: 700,
              fontSize: "12px",
              background: todayStatus === "Cleared" ? "#d1fae5" : "#fef3c7",
              color: todayStatus === "Cleared" ? "#065f46" : "#92400e",
            }}
          >
            {todayStatus === "Cleared"
              ? "STATUS: CLEARED ✓"
              : "STATUS: PENDING (DUE)"}
          </span>
        </div>
      </div>

      {/* KPI Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "10px",
          marginBottom: "18px",
        }}
      >
        <div
          style={{
            background: "#f8fafc",
            padding: "12px 14px",
            borderRadius: "8px",
            border: "1px solid #e2e8f0",
          }}
        >
          <span style={{ fontSize: "11px", color: "#64748b" }}>
            Total Bookings
          </span>
          <strong
            style={{ display: "block", fontSize: "20px", color: "#0f172a" }}
          >
            {totalBookings}
          </strong>
        </div>
        <div
          style={{
            background: "#f8fafc",
            padding: "12px 14px",
            borderRadius: "8px",
            border: "1px solid #e2e8f0",
          }}
        >
          <span style={{ fontSize: "11px", color: "#64748b" }}>
            Gross Collection
          </span>
          <strong
            style={{ display: "block", fontSize: "20px", color: "#0f172a" }}
          >
            ₹{totalGross.toLocaleString("en-IN")}
          </strong>
        </div>
        <div
          style={{
            background: "#f8fafc",
            padding: "12px 14px",
            borderRadius: "8px",
            border: "1px solid #e2e8f0",
          }}
        >
          <span style={{ fontSize: "11px", color: "#64748b" }}>
            Your Commission (Cut)
          </span>
          <strong
            style={{ display: "block", fontSize: "20px", color: "#059669" }}
          >
            + ₹{totalCommission.toLocaleString("en-IN")}
          </strong>
        </div>
        <div
          style={{
            background: "#eff6ff",
            padding: "12px 14px",
            borderRadius: "8px",
            border: "1px solid #bfdbfe",
          }}
        >
          <span style={{ fontSize: "11px", color: "#1e40af", fontWeight: 600 }}>
            Net Payable to Operator
          </span>
          <strong
            style={{ display: "block", fontSize: "20px", color: "#1d4ed8" }}
          >
            ₹{totalNet.toLocaleString("en-IN")}
          </strong>
        </div>
      </div>

      {/* Date-wise Table */}
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
              <th style={{ padding: "10px 14px" }}>Date</th>
              <th style={{ padding: "10px 12px" }}>Bookings Count</th>
              <th style={{ padding: "10px 12px" }}>Gross Collection</th>
              <th style={{ padding: "10px 12px" }}>Commission Deducted</th>
              <th style={{ padding: "10px 12px" }}>Net Payable to Operator</th>
              <th style={{ padding: "10px 14px", textAlign: "right" }}>
                Daily Review Status
              </th>
            </tr>
          </thead>
          <tbody>
            {!settlements.length && !loading ? (
              <tr>
                <td
                  colSpan={6}
                  style={{
                    padding: "24px",
                    textAlign: "center",
                    color: "#94a3b8",
                  }}
                >
                  No booking settlements recorded yet.
                </td>
              </tr>
            ) : (
              settlements.map((s) => {
                const isCleared = s.status === "Cleared";
                return (
                  <tr
                    key={s.date}
                    style={{ borderBottom: "1px solid #f1f5f9" }}
                  >
                    <td style={{ padding: "10px 14px" }}>
                      <strong style={{ color: "#0f172a" }}>{s.date}</strong>
                      {s.date === todayStr && (
                        <span
                          style={{
                            marginLeft: "6px",
                            fontSize: "10px",
                            background: "#e0f2fe",
                            color: "#0369a1",
                            padding: "1px 5px",
                            borderRadius: "3px",
                          }}
                        >
                          Today
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <strong>{s.totalBookings}</strong> bookings
                    </td>
                    <td style={{ padding: "10px 12px", color: "#334155" }}>
                      ₹{(s.grossPaise / 100).toLocaleString("en-IN")}
                    </td>
                    <td style={{ padding: "10px 12px", color: "#059669" }}>
                      - ₹{(s.commissionPaise / 100).toLocaleString("en-IN")}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <strong style={{ color: "#1d4ed8", fontSize: "13px" }}>
                        ₹{(s.netPayablePaise / 100).toLocaleString("en-IN")}
                      </strong>
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "right" }}>
                      {isCleared ? (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            background: "#dcfce7",
                            color: "#15803d",
                            padding: "3px 10px",
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
                            padding: "3px 10px",
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
