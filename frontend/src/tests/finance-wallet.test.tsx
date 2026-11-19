// @vitest-environment jsdom
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  FinanceActionForm,
  inputPaise,
} from "../features/finance/FinanceActionForm";
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);
it("parses INR as exact integer paise and rejects fractions or unsafe amounts", () => {
  expect(inputPaise("2500.05")).toBe(250005);
  expect(inputPaise("0")).toBe(0);
  for (const value of ["1.001", "-1", "1e5", "9007199254740991", ""])
    expect(() => inputPaise(value)).toThrow();
});
it("requires explicit review, retains failed drafts and retries the same operation identity", async () => {
  const save = vi
    .fn()
    .mockRejectedValueOnce(
      Error("Network outcome uncertain; check status before changing details"),
    )
    .mockResolvedValue(undefined);
  const close = vi.fn(),
    user = userEvent.setup();
  render(
    <FinanceActionForm
      title="Authorize agency credit"
      description="Pune agency credit approval"
      fields={[
        { name: "limit", label: "Credit limit · INR", money: true },
        { name: "reason", label: "Reason" },
      ]}
      onSave={save}
      onClose={close}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Review action" }));
  expect(screen.getByRole("alert").textContent).toContain("required");
  await user.type(screen.getByLabelText("Credit limit · INR"), "2500.05");
  await user.type(screen.getByLabelText("Reason"), "Approved test facility");
  await user.click(screen.getByRole("button", { name: "Review action" }));
  expect(save).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Confirm action" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(close).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Confirm action" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(save.mock.calls[0]).toEqual(save.mock.calls[1]);
});
it("confirms discarding unsaved financial details", async () => {
  const close = vi.fn(),
    user = userEvent.setup();
  render(
    <FinanceActionForm
      title="Suspend wallet"
      description="Selected agency"
      fields={[{ name: "reason", label: "Reason" }]}
      onSave={vi.fn()}
      onClose={close}
    />,
  );
  await user.type(screen.getByLabelText("Reason"), "Review required");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(close).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Keep editing" }));
  expect((screen.getByLabelText("Reason") as HTMLInputElement).value).toBe(
    "Review required",
  );
});
