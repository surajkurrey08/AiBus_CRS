import { afterEach, expect, it, vi } from "vitest";
import * as M from "../src/models/index.js";
import { readPublishedCarInventory } from "../src/services/car-inventory-preview.service.js";

afterEach(() => vi.restoreAllMocks());

it("counts available passenger seats without exposing hold metadata", async () => {
  vi.spyOn(M.Trip, "findOne").mockImplementation(() => ({
    lean: async () => ({
      _id: "trip",
      carId: "car",
      routeId: "route",
      seats: [
        { number: "D", state: "available" },
        { number: "2L", state: "held", holdUntil: new Date(0), holdId: "private" },
        { number: "2M", state: "held", holdUntil: new Date("2099-01-01") },
        { number: "2R", state: "booked" },
      ],
    }),
  }) as any);
  vi.spyOn(M.Car, "findOne").mockReturnValue({
    select: () => ({ lean: async () => ({ vehicleCategory: "Custom Car" }) }),
  } as any);
  vi.spyOn(M.Route, "findOne").mockReturnValue({
    select: () => ({ lean: async () => ({ source: "Pune", destination: "Mumbai" }) }),
  } as any);
  vi.spyOn(M.Operator, "exists").mockResolvedValue({ _id: "operator" } as any);

  const inventory = await readPublishedCarInventory("operator", "trip");
  expect(inventory.availableSeatsCount).toBe(1);
  expect(inventory.seats.map((seat) => seat.state)).toEqual([
    "non_bookable", "available", "held", "booked",
  ]);
  expect(inventory.seats[1]).not.toHaveProperty("holdId");
  expect(M.Trip.findOne).toHaveBeenCalledWith(expect.objectContaining({
    operatorId: "operator", status: "Scheduled", departureAt: { $gt: expect.any(Date) },
  }));
});
