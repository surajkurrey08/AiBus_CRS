// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { FinanceReports } from "../features/finance/FinanceReports";
import { api, downloadFinancialReport } from "../api/client";
vi.mock("../api/client", () => ({
  api: vi.fn(),
  downloadFinancialReport: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("loads only a submitted report and displays server paise amounts as INR", async () => {
  vi.mocked(api).mockResolvedValue({
    data: {
      rows: [
        {
          id: "posted",
          grossTicketValuePaise: 145000,
          platformRevenuePaise: 0,
        },
      ],
      total: 1,
      coverage: "Posted ledger records only",
    },
  });
  render(<FinanceReports />);
  expect(api).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "Generate report" }),
  );
  expect(await screen.findByText("Posted ledger records only")).toBeTruthy();
  expect(screen.getByText("₹1,450.00")).toBeTruthy();
  expect(screen.getByText("₹0.00")).toBeTruthy();
  expect(vi.mocked(api).mock.calls[0][0]).toContain(
    "/operator/finance/reports/daily-ticket-revenue?",
  );
});
it("retains report evidence when export fails and offers API recovery", async () => {
  vi.mocked(api).mockResolvedValue({
    data: { rows: [], total: 0, coverage: "Recorded evidence" },
  });
  vi.mocked(downloadFinancialReport).mockRejectedValue(
    Error("Export unavailable"),
  );
  render(<FinanceReports />);
  await userEvent.click(
    screen.getByRole("button", { name: "Generate report" }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Download CSV for Excel" }),
  );
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    expect.stringContaining("Export unavailable"),
  );
  expect(screen.getByText("Recorded evidence")).toBeTruthy();
});
