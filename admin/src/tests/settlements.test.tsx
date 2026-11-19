// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FinanceReviewForm } from "../features/finance/FinanceReviewForm";
import { AdminSettlements } from "../features/finance/AdminSettlements";
import { api } from "../api/client";
vi.mock("../api/client", () => ({ api: vi.fn() }));
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("requires review and preserves payout operation identity after an uncertain response", async () => {
  const save = vi
      .fn()
      .mockRejectedValueOnce(
        Error("Outcome uncertain; verify original operation"),
      )
      .mockResolvedValue(undefined),
    close = vi.fn();
  render(
    <FinanceReviewForm
      title="Authorize test payout"
      description="Isolated evidence only"
      fields={[{ name: "reason", label: "Review reason" }]}
      onSave={save}
      onClose={close}
    />,
  );
  await userEvent.type(
    screen.getByLabelText("Review reason"),
    "Independent payout approval",
  );
  await userEvent.click(screen.getByRole("button", { name: "Review action" }));
  expect(save).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "Confirm reviewed action" }),
  );
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    expect.stringContaining("Outcome uncertain"),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Confirm reviewed action" }),
  );
  expect(save.mock.calls[0][1]).toBe(save.mock.calls[1][1]);
  expect(close).toHaveBeenCalledTimes(1);
});
it("hides settlement and payout mutations from finance readers", async () => {
  vi.mocked(api).mockImplementation(async (path) => ({
    data: path.endsWith("/reports") ? { testModeAvailable: true } : [],
    meta: { page: 1, limit: 25, total: 0, pages: 0 },
  }));
  render(
    <AdminSettlements
      user={{
        id: "reader",
        name: "Reader",
        email: "r@test",
        role: "super_admin",
        operatorId: null,
        permissions: ["platform:finance:read"],
      }}
    />,
  );
  expect(
    await screen.findByText("No matching settlement batches."),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Prepare settlement" }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Authorize test payout" }),
  ).toBeNull();
});
