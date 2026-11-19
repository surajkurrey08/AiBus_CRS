import { FinanceReports } from "./FinanceReports";
import { SettlementHistory } from "./SettlementHistory";
import { useState } from "react";
import { MasterSectionLayout } from "../../components/navigation/MasterSectionLayout";
import { FinanceWorkspace } from "./FinanceWorkspace";
import { RefundManagement } from "./RefundManagement";
export function FinanceHub() {
  const [section, setSection] = useState("wallet");
  return (
    <MasterSectionLayout
      label="Finance"
      sections={[
        {
          id: "earnings",
          label: "Earnings overview",
          group: "Financial records",
        },
        {
          id: "commissions",
          label: "Agency commissions",
          group: "Financial records",
        },
        {
          id: "settlements",
          label: "Settlement history",
          group: "Financial records",
        },
        {
          id: "reports",
          label: "Financial reports",
          group: "Financial records",
        },
        { id: "wallet", label: "Wallet & credit", group: "Agency finance" },
        { id: "refunds", label: "Refund management", group: "Recovery" },
      ]}
      selected={section}
      onSelect={setSection}
    >
      {section === "wallet" ? (
        <FinanceWorkspace />
      ) : section === "refunds" ? (
        <RefundManagement />
      ) : section === "settlements" ? (
        <SettlementHistory />
      ) : (
        <FinanceReports
          key={section}
          initial={
            section === "commissions"
              ? "commission-payable"
              : section === "earnings"
                ? "operator-revenue"
                : "daily-ticket-revenue"
          }
        />
      )}
    </MasterSectionLayout>
  );
}
