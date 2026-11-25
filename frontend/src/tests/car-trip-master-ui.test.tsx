// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { CarTripMaster } from "../features/car-trip-master/CarTripMaster";

const mockWorkspace = {
  demo: false,
  revision: 0,
  user: {
    permissions: ["read", "routes:write", "fleet:write"],
  },
  records: {
    routes: [],
  },
  notify: vi.fn(),
  refresh: vi.fn(),
};

vi.mock("../context/WorkspaceContext", () => ({
  useWorkspace: () => mockWorkspace,
}));

vi.mock("../api/client", () => ({
  api: vi.fn(),
}));

import { api } from "../api/client";

describe("CarTripMaster Component UI & Scheduling Modal", () => {
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute("open");
    };
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders Car Trip Master header, refresh and schedule buttons", async () => {
    (api as any).mockImplementation((url: string) => {
      if (url.includes("/operator/trips?limit=100")) {
        return Promise.resolve({ data: [] });
      }
      if (url.includes("/operator/cars")) {
        return Promise.resolve({
          data: [
            {
              _id: "6740a1b2c3d4e5f678901234",
              registrationNumber: "CG-04-MG-2001",
              make: "Maruti",
              model: "Dzire",
              vehicleCategory: "4-Passenger Sedan",
              bookablePassengerCapacity: 4,
              totalPhysicalSeats: 5,
              status: "Active",
            },
          ],
        });
      }
      if (url.includes("/operator/routes")) {
        return Promise.resolve({
          data: [
            {
              _id: "6740b2c3d4e5f67890123456",
              source: "Raipur",
              destination: "Bilaspur",
              distanceKm: 120,
              status: "Active",
            },
          ],
        });
      }
      if (url.includes("/operator/area-master/cities")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });

    render(<CarTripMaster />);

    expect(screen.getByText("Car Trip Master")).toBeDefined();
    expect(screen.getByText("Schedule Car Trip")).toBeDefined();

    // Click "Schedule Car Trip" button to open modal
    const scheduleBtns = screen.getAllByRole("button", { name: /Schedule Car Trip/i });
    fireEvent.click(scheduleBtns[0]);

    // Modal title should appear
    await waitFor(() => {
      expect(screen.getByText("Schedule Scheduled Car Trip")).toBeDefined();
    });

    // Check that the car dropdown has loaded the vehicle
    await waitFor(() => {
      expect(screen.getByText(/CG-04-MG-2001/)).toBeDefined();
    });

    // Check that the route dropdown has loaded the route
    await waitFor(() => {
      expect(screen.getByText(/Raipur → Bilaspur/)).toBeDefined();
    });
  });

  it("submits valid car scheduling payload with carId, routeId, journeyDate when form is submitted", async () => {
    (api as any).mockImplementation((url: string, opts?: any) => {
      if (url.includes("/operator/trips") && opts?.method === "POST") {
        return Promise.resolve({
          data: {
            _id: "trip-new-123",
            tripNumber: "CAR-TRIP-20261125-2001",
            status: "Scheduled",
          },
        });
      }
      if (url.includes("/operator/cars")) {
        return Promise.resolve({
          data: [
            {
              _id: "6740a1b2c3d4e5f678901234",
              registrationNumber: "CG-04-MG-2001",
              make: "Maruti",
              model: "Dzire",
              vehicleCategory: "4-Passenger Sedan",
              bookablePassengerCapacity: 4,
              totalPhysicalSeats: 5,
              status: "Active",
            },
          ],
        });
      }
      if (url.includes("/operator/routes")) {
        return Promise.resolve({
          data: [
            {
              _id: "6740b2c3d4e5f67890123456",
              source: "Raipur",
              destination: "Bilaspur",
              distanceKm: 120,
              status: "Active",
            },
          ],
        });
      }
      return Promise.resolve({ data: [] });
    });

    render(<CarTripMaster />);

    const scheduleBtns = screen.getAllByRole("button", { name: /Schedule Car Trip/i });
    fireEvent.click(scheduleBtns[0]);

    await waitFor(() => {
      expect(screen.getByText("Schedule Scheduled Car Trip")).toBeDefined();
    });

    // Click submit button
    const submitBtn = screen.getByRole("button", { name: /^Schedule Trip$/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        "/operator/trips",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("6740a1b2c3d4e5f678901234"),
        })
      );
    });
  });
});
