// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CarTripMaster } from "../features/car-trip-master/CarTripMaster";

const ws = vi.hoisted(() => ({
  demo: true,
  revision: 0,
  user: { permissions: ["read", "routes:write", "pricing:write"] },
  records: { routes: [] },
  raw: { trips: [] },
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

it("renders scheduled car trips with One-Way and Round-Trip badges and fare display", async () => {
  render(<CarTripMaster />);
  expect(screen.getByText("Car Trip Master")).toBeTruthy();
  expect(screen.getByText("CAR-TRIP-PUN-MUM-001")).toBeTruthy();
  expect(screen.getAllByText("One Way").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Round Trip").length).toBeGreaterThan(0);
  expect(screen.getByText("₹450")).toBeTruthy();
  expect(screen.getByText("₹650")).toBeTruthy();
  expect(screen.getByText("3 / 4 Seats")).toBeTruthy();
  expect(screen.getByText("6 / 7 Seats")).toBeTruthy();
});

it("opens schedule car trip modal with One Way and Round Trip options", async () => {
  const user = userEvent.setup();
  render(<CarTripMaster />);

  await user.click(screen.getByRole("button", { name: "Schedule Car Trip" }));
  expect(screen.getByRole("heading", { name: "Schedule Vehicle Trip" })).toBeTruthy();
  expect(screen.getByText(/Bus-Style Individual Seat Booking Rules/)).toBeTruthy();
  expect(screen.getByText("One Way Trip")).toBeTruthy();
  expect(screen.getAllByText("Round Trip").length).toBeGreaterThan(0);
});
