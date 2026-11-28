// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { AreaMaster } from "../features/area/AreaMaster";
import { RouteStopAssignment } from "../features/area/components/RouteStopAssignment";
vi.mock("../api/client", () => ({ api: vi.fn() }));
const ws = vi.hoisted(() => ({
  demo: false,
  revision: 0,
  user: { permissions: ["read", "routes:write"] },
  raw: {},
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
  vi.mocked(api).mockImplementation(async (_path, options) =>
    options?.method
      ? { data: { _id: "city-1" } }
      : { data: [], meta: { page: 1, limit: 100, total: 0, pages: 1 } },
  );
});
afterEach(cleanup);
it("creates a city from Area Master and refreshes the saved master data", async () => {
  const user = userEvent.setup();
  render(<AreaMaster />);
  const create = screen.getByRole("button", { name: "Create city" });
  await waitFor(() =>
    expect((create as HTMLButtonElement).disabled).toBe(false),
  );
  await user.click(create);
  const dialog = within(screen.getByRole("dialog"));
  await user.type(dialog.getByLabelText("City name"), "Pune");
  await user.type(dialog.getByLabelText("State / region"), "Maharashtra");
  await user.click(dialog.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(ws.refresh).toHaveBeenCalled());
  expect(api).toHaveBeenCalledWith("/operator/area-master/cities", {
    method: "POST",
    body: JSON.stringify({
      name: "Pune",
      state: "Maharashtra",
      country: "India",
      status: "Active",
    }),
  });
});
it("saves pickup order, city mapping and stop times for an existing route", async () => {
  const cities = [
    { _id: "pune", name: "Pune", state: "Maharashtra", status: "Active" },
    { _id: "mumbai", name: "Mumbai", state: "Maharashtra", status: "Active" },
  ];
  const locations = [
    {
      _id: "wakad",
      cityId: "pune",
      name: "Wakad",
      usage: "Pickup",
      status: "Active",
    },
    {
      _id: "hinjewadi",
      cityId: "pune",
      name: "Hinjewadi",
      usage: "Both",
      status: "Active",
    },
    {
      _id: "dadar",
      cityId: "mumbai",
      name: "Dadar",
      usage: "Drop",
      status: "Active",
    },
  ];
  const route = {
    _id: "route-1",
    source: "Pune",
    destination: "Mumbai",
    boarding: [{ name: "Wakad" }],
    dropping: [{ name: "Dadar" }],
    __v: 0,
  };
  vi.mocked(api).mockResolvedValue({ data: route });
  const saved = vi.fn(),
    user = userEvent.setup();
  render(
    <RouteStopAssignment
      routes={[route]}
      cities={cities}
      locations={locations}
      canWrite
      onSaved={saved}
    />,
  );
  await user.selectOptions(
    screen.getByLabelText("Route to configure"),
    "route-1",
  );
  await user.click(await screen.findByRole("checkbox", { name: "Hinjewadi" }));
  await user.click(
    screen.getByRole("button", { name: "Move Hinjewadi pickup earlier" }),
  );
  fireEvent.change(screen.getByLabelText("Pickup time for Hinjewadi"), {
    target: { value: "19:30" },
  });
  await user.click(screen.getByRole("button", { name: "Save route stops" }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  const call = vi
    .mocked(api)
    .mock.calls.find(([, options]) => options?.method === "PUT")!;
  expect(JSON.parse(call[1]!.body as string)).toEqual({
    sourceCityId: "pune",
    destinationCityId: "mumbai",
    boarding: [
      { locationId: "hinjewadi", time: "19:30" },
      { locationId: "wakad" },
    ],
    dropping: [{ locationId: "dadar" }],
    expectedVersion: 0,
  });
});

it("creates a route like Pune to Nashik from Route Master", async () => {
  const user = userEvent.setup();
  render(<AreaMaster defaultTab="routes" />);
  const create = screen.getByRole("button", { name: "Create route" });
  await waitFor(() =>
    expect((create as HTMLButtonElement).disabled).toBe(false),
  );
  await user.click(create);
  const dialog = within(screen.getByRole("dialog"));
  await user.clear(dialog.getByLabelText("From / Origin city"));
  await user.type(dialog.getByLabelText("From / Origin city"), "Pune");
  await user.clear(dialog.getByLabelText("To / Destination city"));
  await user.type(dialog.getByLabelText("To / Destination city"), "Nashik");
  await user.click(dialog.getByRole("button", { name: "Save route" }));
  await waitFor(() => expect(ws.refresh).toHaveBeenCalled());
  const postCall = vi
    .mocked(api)
    .mock.calls.find(
      ([path, options]) =>
        path === "/operator/routes" && options?.method === "POST",
    );
  expect(postCall).toBeDefined();
  const body = JSON.parse(postCall![1]!.body as string);
  expect(body.source).toBe("Pune");
  expect(body.destination).toBe("Nashik");
});

it("creates a route with highway note and comma-separated intermediate via cities", async () => {
  const user = userEvent.setup();
  render(<AreaMaster defaultTab="routes" />);
  const create = screen.getByRole("button", { name: "Create route" });
  await waitFor(() =>
    expect((create as HTMLButtonElement).disabled).toBe(false),
  );
  await user.click(create);
  const dialog = within(screen.getByRole("dialog"));
  await user.type(dialog.getByLabelText("From / Origin city"), "Pune");
  await user.type(dialog.getByLabelText("To / Destination city"), "Nashik");
  await user.type(dialog.getByLabelText("Distance in km"), "210");
  await user.type(dialog.getByLabelText("Highway / Via Route Note"), "Via NH-60");
  await user.type(
    dialog.getByLabelText("Quick add via cities"),
    "Moshi, Chakan, Rajgurunagar",
  );
  await user.click(dialog.getByRole("button", { name: "Add stops" }));
  await user.click(dialog.getByRole("button", { name: "Save route" }));
  await waitFor(() => expect(ws.refresh).toHaveBeenCalled());
  const postCall = vi
    .mocked(api)
    .mock.calls.find(
      ([path, options]) =>
        path === "/operator/routes" && options?.method === "POST",
    );
  const body = JSON.parse(postCall![1]!.body as string);
  expect(body.viaLabel).toBe("Via NH-60");
  expect(body.viaStops.map((s: any) => s.city)).toEqual([
    "Moshi",
    "Chakan",
    "Rajgurunagar",
  ]);
  expect(body.viaStops[0].distanceKm).toBeGreaterThan(0);
});
