// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CarMaster } from "../features/car-master/CarMaster";

const ws = vi.hoisted(() => ({
  demo: true,
  revision: 0,
  user: { permissions: ["read", "fleet:write", "routes:write"] },
  records: { buses: [] },
  raw: { cars: [] },
  refresh: vi.fn(async () => {}),
  notify: vi.fn(),
}));

vi.mock("../context/WorkspaceContext", () => ({ useWorkspace: () => ws }));

beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

afterEach(cleanup);

it("renders car master with 4-passenger sedan and 7-passenger MUV cars", async () => {
  render(<CarMaster />);
  expect(screen.getByText("Car Fleet Master")).toBeTruthy();
  expect(screen.getByText("DL-01-AB-1234")).toBeTruthy();
  expect(screen.getByText("Maruti Suzuki Dzire")).toBeTruthy();
  expect(screen.getAllByText("4-Passenger Sedan").length).toBeGreaterThan(0);
  expect(screen.getAllByText("7-Passenger MUV").length).toBeGreaterThan(0);
  expect(screen.getAllByText("5 (1 Driver + 4 Pax)").length).toBeGreaterThan(0);
  expect(screen.getAllByText("8 (1 Driver + 7 Pax)").length).toBeGreaterThan(0);
});

it("filters cars by category and opens add car modal with capacity validation", async () => {
  const user = userEvent.setup();
  render(<CarMaster />);

  // Filter by 7-Passenger MUV
  await user.click(screen.getByRole("button", { name: "7-Passenger MUV" }));
  expect(screen.getByText("Toyota Innova Crysta")).toBeTruthy();
  expect(screen.queryByText("Maruti Suzuki Dzire")).toBeNull();

  // Reset to All
  await user.click(screen.getByRole("button", { name: "All Cars" }));
  expect(screen.getByText("Maruti Suzuki Dzire")).toBeTruthy();

  // Open Add Car
  await user.click(screen.getByRole("button", { name: "Add Car" }));
  expect(screen.getByRole("heading", { name: "Add New Car" })).toBeTruthy();

  // Verify strict physical capacity invariant notice
  expect(screen.getByText(/Strict Physical Capacity Invariant/)).toBeTruthy();
});
