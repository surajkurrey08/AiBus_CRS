import { useState } from "react";
import type { Identity } from "../../api/client";
import { AdminFinance } from "./AdminFinance";
import { AdminReports } from "./AdminReports";
import { AdminSettlements } from "./AdminSettlements";
import "./finance.css";
const sections = [
  { id: "overview", label: "Finance overview" },
  { id: "settlements", label: "Operator settlements" },
  { id: "commissions", label: "Agency commissions" },
  { id: "wallet", label: "Wallet & credit" },
  { id: "refunds", label: "Refund management" },
  { id: "reconciliation", label: "Payment reconciliation" },
  { id: "payouts", label: "Payout records" },
  { id: "reports", label: "Financial reports" },
  { id: "audit", label: "Audit logs" },
];
export function AdminFinanceHub({ user }: { user: Identity }) {
  const [section, setSection] = useState("overview");
  if (!user.permissions.includes("platform:finance:read"))
    return <p role="alert">Explicit platform financial access is required.</p>;
  return (
    <div className="admin-finance-hub">
      <nav aria-label="Finance sections">
        {sections.map((s) => (
          <button
            className={`btn ${s.id === section ? "primary" : ""}`}
            aria-current={s.id === section ? "page" : undefined}
            onClick={() => setSection(s.id)}
            key={s.id}
          >
            {s.label}
          </button>
        ))}
      </nav>
      <div>
        {section === "refunds" ? (
          <AdminFinance user={user} />
        ) : section === "settlements" ? (
          <AdminSettlements user={user} />
        ) : (
          <AdminReports
            key={section}
            audit={section === "audit"}
            initial={
              section === "commissions"
                ? "commission-payable"
                : section === "wallet"
                  ? "wallet-balances"
                  : section === "payouts"
                    ? "operator-settlements"
                    : section === "reconciliation"
                      ? "payment-exceptions"
                      : "daily-ticket-revenue"
            }
          />
        )}
      </div>
    </div>
  );
}
