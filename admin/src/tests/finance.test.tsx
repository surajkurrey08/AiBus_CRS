// @vitest-environment jsdom
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { AdminFinance } from "../features/finance/AdminFinance";
import { api } from "../api/client";
vi.mock("../api/client", () => ({ api: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const user = {
  id: "admin",
  name: "Admin",
  email: "a@test",
  role: "super_admin",
  operatorId: null,
  permissions: ["platform:finance:read"],
};
it("requires an explicit finance grant before loading any records", () => {
  render(<AdminFinance user={{ ...user, permissions: [] }} />);
  expect(screen.getByRole("alert").textContent).toContain(
    "Explicit platform finance",
  );
  expect(api).not.toHaveBeenCalled();
});
it("shows read-only exception evidence and supports a failed request retry", async () => {
  vi.mocked(api)
    .mockRejectedValueOnce(new Error("Unavailable"))
    .mockResolvedValue({
      data: [
        { _id: "case", operatorId: "op", kind: "Late capture", status: "Open" },
      ],
      meta: { total: 1, page: 1, pages: 1, limit: 25 },
    });
  render(<AdminFinance user={user} />);
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    expect.stringContaining("Unavailable"),
  );
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Late capture")).toBeTruthy();
  expect(screen.queryByText("Review acknowledgement")).toBeNull();
});
