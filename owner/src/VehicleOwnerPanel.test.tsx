// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "./api";
import { VehicleOwnerPanel } from "./VehicleOwnerPanel";

vi.mock("./api", () => ({ api: vi.fn() }));
afterEach(cleanup);

it("shows assigned vehicles and occupancy and filters trips using an IST date range", async () => {
  vi.mocked(api).mockResolvedValue({
    data: {
      vehicles: [
        {
          id: "vehicle",
          registration: "MH05AS0001",
          name: "Force Traveller",
          category: "Mini Bus",
          capacity: 12,
          status: "Active",
        },
      ],
      trips: [
        {
          id: "trip",
          route: "Pune to Solapur",
          departureAt: "2031-12-09T02:30:00.000Z",
          status: "Scheduled",
          capacity: 12,
          bookedSeats: 3,
        },
      ],
      totalTrips: 1,
    },
  });
  render(
    <VehicleOwnerPanel
      user={{ id: "owner", name: "Owner A", role: "vehicle_owner" }}
      onSignOut={vi.fn()}
    />,
  );
  expect(
    screen.getByAltText("CRS — Central Reservation System"),
  ).toBeTruthy();
  expect(screen.queryByText(/\baibus\b/i)).toBeNull();
  expect(await screen.findByText("MH05AS0001")).toBeTruthy();
  expect(screen.getByText("3 / 12 booked")).toBeTruthy();
  expect(screen.getByText(/8:00.*IST/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("To"), {
    target: { value: "2031-12-31" },
  });
  fireEvent.change(screen.getByLabelText("From"), {
    target: { value: "2031-12-01" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply dates" }));
  await waitFor(() =>
    expect(api).toHaveBeenLastCalledWith(
      "/owner/overview?from=2031-12-01&to=2031-12-31&page=1",
      expect.anything(),
    ),
  );
});
