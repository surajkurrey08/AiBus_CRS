// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { RefundManagement } from "../features/finance/RefundManagement";
import { api } from "../api/client";
vi.mock("../api/client", () => ({ api: vi.fn() }));
const ws = vi.hoisted(() => ({
  user: { permissions: ["finance:read"] },
  notify: vi.fn(),
}));
vi.mock("../context/WorkspaceContext", () => ({ useWorkspace: () => ws }));
vi.mock("../components/index", () => ({
  Panel: ({ title, children }: any) => (
    <section>
      <h3>{title}</h3>
      {children}
    </section>
  ),
  DataTable: ({ title, onView, resourcePath }: any) => (
    <button
      onClick={() =>
        onView({ id: "request", bookingId: "booking", status: "Requested" })
      }
    >
      {title}
    </button>
  ),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("loads status instead of generating a cancellation quote for a read-only reviewer", async () => {
  vi.mocked(api).mockImplementation(async (path: string) => ({
    data: path.endsWith("refund-status")
      ? { bookingStatus: "Confirmed", paymentStatus: "Paid" }
      : {},
  }));
  render(<RefundManagement />);
  await userEvent.click(
    screen.getByRole("button", { name: "cancellation requests" }),
  );
  expect(await screen.findByText(/Booking: Confirmed/)).toBeTruthy();
  expect(
    vi
      .mocked(api)
      .mock.calls.some(([path]) => path.endsWith("cancellation-quote")),
  ).toBe(false);
  expect(
    screen.queryByRole("button", { name: "Accept full cancellation" }),
  ).toBeNull();
});
it("preserves a retry path when refund records cannot load", async () => {
  vi.mocked(api).mockRejectedValue(new Error("Refund API unavailable"));
  render(<RefundManagement />);
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    expect.stringContaining("Refund API unavailable"),
  );
  expect(
    screen.getByRole("button", { name: "Retry refund review" }),
  ).toBeTruthy();
});
