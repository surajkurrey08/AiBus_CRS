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
vi.mock("../api/client", () => ({ api: vi.fn(async (path: string) => ({ data: path.includes("vehicle-layouts") ? [
  { _id: "mini", name: "Traveller", vehicleType: "Mini Bus", seats: Array(13).fill({}) },
  { _id: "bus", name: "Coach", vehicleType: "Bus", seats: Array(41).fill({}) },
] : [] })) }));

beforeEach(() => {
  vi.clearAllMocks();
  ws.demo = true;
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
  expect(screen.getByText("Vehicle Fleet")).toBeTruthy();
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
  await user.click(screen.getByRole("button", { name: "All Vehicles" }));
  expect(screen.getByText("Maruti Suzuki Dzire")).toBeTruthy();

  // Open Add Vehicle
  await user.click(screen.getByRole("button", { name: "Add Vehicle" }));
  expect(screen.getByRole("heading", { name: "Add New Vehicle" })).toBeTruthy();

  // Verify strict physical capacity invariant notice
  expect(screen.getByText(/Strict Physical Capacity Invariant/)).toBeTruthy();
  await user.click(screen.getByRole("radio", { name: "Mini Bus" }));
  expect(screen.getByLabelText("Mini Bus Make")).toBeTruthy();
  expect(screen.getByText(/Create a Mini Bus template/)).toBeTruthy();
  expect(screen.queryByLabelText("Car Category")).toBeNull();
  await user.click(screen.getByRole("radio", { name: "Bus" }));
  expect(screen.getByLabelText("Bus Model", { exact: true })).toBeTruthy();
  expect(screen.getByText(/Create a Bus template/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Save Bus" })).toBeTruthy();
});

it("filters saved layouts by vehicle type and displays their passenger capacity", async () => {
  ws.demo = false;
  const user = userEvent.setup();
  render(<CarMaster />);
  await user.click(screen.getByRole("button", { name: "Add Vehicle" }));
  await user.click(screen.getByRole("radio", { name: "Mini Bus" }));
  expect(await screen.findByRole("option", { name: "Traveller (12 passengers)" })).toBeTruthy();
  expect(screen.queryByRole("option", { name: /Coach/ })).toBeNull();
  await user.selectOptions(screen.getByLabelText(/Seat layout/), "mini");
  expect(screen.getByText("12 passenger seats + 1 driver seat")).toBeTruthy();
  await user.click(screen.getByRole("radio", { name: "Bus" }));
  expect(screen.getByRole("option", { name: "Coach (40 passengers)" })).toBeTruthy();
  expect(screen.queryByText("12 passenger seats + 1 driver seat")).toBeNull();
});
