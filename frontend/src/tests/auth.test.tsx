// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authState, logout } from "../api/client.ts";
import { App } from "../app/App.tsx";
import { RecordForm } from "../components/index.ts";
import {
  WorkspaceProvider,
  useWorkspace,
} from "../context/WorkspaceContext.tsx";
function RefreshProbe() {
  const ws = useWorkspace();
  return (
    <>
      <button onClick={() => void ws.refresh()}>Refresh records</button>
      <RecordForm
        title="Add route"
        fields={["source", "destination"]}
        onSave={() => {}}
        onClose={() => {}}
      />
    </>
  );
}
vi.mock("socket.io-client", () => ({
  io: () => ({ on: () => {}, close: () => {} }),
}));
const identity = {
  id: "staff-1",
  name: "Actual Operator",
  email: "operator@example.test",
  role: "read_only",
  operatorId: "123456789012345678901234",
  permissions: ["read"],
};
const reply = (data: unknown, status = 200) =>
  new Response(
    JSON.stringify(
      status === 200
        ? { data, meta: { total: 0, pages: 1 } }
        : {
            error: { code: "UNAUTHENTICATED", message: "Sign in to continue" },
          },
    ),
    { status, headers: { "content-type": "application/json" } },
  );
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function () {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function () {
      this.removeAttribute("open");
    },
  });
  localStorage.clear();
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, options: RequestInit) => {
      if (path.includes("/auth/refresh")) return reply(null, 401);
      if (path.includes("/auth/login"))
        return reply({ accessToken: "test-memory-token", user: identity });
      if (path.includes("/auth/logout")) return reply({ loggedOut: true });
      if (path.includes("/operator/profile"))
        return reply({
          company: "Actual Travels",
          email: "office@example.test",
          phone: "1234567890",
          address: "Hyderabad",
        });
      if (path.includes("/operator/dashboard"))
        return reply({ totalBookings: 0, activeBuses: 0 });
      return reply([]);
    }),
  );
});
afterEach(async () => {
  await logout().catch(() => {});
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("live API workspace", () => {
  it("lets an operator admin create an owner login without opening Vehicles", async () => {
    const user = userEvent.setup();
    const defaultFetch = vi.mocked(fetch).getMockImplementation()!;
    const owner = { id: "owner-1", name: "Owner A", loginEmail: "owner@example.test" };
    let owners: typeof owner[] = [];
    vi.mocked(fetch).mockImplementation(async (path, options) => {
      if (String(path).includes("/auth/login")) return reply({
        accessToken: "test-memory-token",
        user: { ...identity, role: "operator_admin", permissions: ["read", "fleet:write"] },
      });
      if (String(path).includes("/operator/vehicle-owners")) {
        if (options?.method === "POST") {
          expect(JSON.parse(String(options.body))).toEqual({
            name: owner.name, email: owner.loginEmail, password: "SecureOwner123!",
          });
          owners = [owner];
          return reply(owner);
        }
        return reply(owners);
      }
      return defaultFetch(path, options!);
    });
    render(<App />);
    await user.type(await screen.findByLabelText("Email"), identity.email);
    await user.type(screen.getByLabelText("Password"), "private-test-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await user.click(await screen.findByRole("button", { name: "Owners" }));
    expect(await screen.findByRole("link", { name: "Owner sign-in" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Create owner" }));
    await user.type(screen.getByLabelText("Owner name"), owner.name);
    await user.type(screen.getByLabelText("Owner login email"), owner.loginEmail);
    const password = screen.getByLabelText("Initial password");
    await user.type(password, "Abc1234!");
    await user.click(screen.getByRole("button", { name: "Create owner login" }));
    expect(await screen.findByText("Password must include at least 4 lowercase letters.")).toBeTruthy();
    expect(vi.mocked(fetch).mock.calls.some(([path, options]) =>
      String(path).includes("/operator/vehicle-owners") && options?.method === "POST",
    )).toBe(false);
    await user.clear(password);
    await user.type(password, "SecureOwner123!");
    await user.click(screen.getByRole("button", { name: "Create owner login" }));
    expect(await screen.findByRole("cell", { name: owner.loginEmail })).toBeTruthy();
    expect(screen.queryByLabelText("Initial password")).toBeNull();
  });

  it.each(["agent", "booking_staff"])(
    "hides master and inventory navigation for %s and displays Agent",
    async (role) => {
      const user = userEvent.setup();
      const defaultFetch = vi.mocked(fetch).getMockImplementation()!;
      vi.mocked(fetch).mockImplementation(
        async (path: any, options?: RequestInit) =>
          String(path).includes("/auth/login")
            ? reply({
                accessToken: "test-memory-token",
                user: {
                  ...identity,
                  role,
                  permissions: [
                    "read",
                    "bookings:write",
                    "manifest:read",
                    "finance:read",
                    "staff:write",
                    "offers:write",
                  ],
                },
              })
            : defaultFetch(path, options!),
      );
      render(<App />);
      await screen.findByRole("button", { name: "Sign in" });
      await user.type(screen.getByLabelText("Email"), "agent@example.test");
      await user.type(
        screen.getByLabelText("Password"),
        "private-test-password",
      );
      await user.click(screen.getByRole("button", { name: "Sign in" }));
      const navigation = await screen.findByRole("navigation", {
        name: "Workspace navigation",
      });
      for (const name of [
        "Vehicle Master",
        "Route Master",
        "Trip Master",
        "Seat Layout Designer",
        "Seat Availability",
        "Agents",
        "Owners",
        "Finance",
        "Reports",
        "Settings",
      ])
        expect(within(navigation).queryByRole("button", { name })).toBeNull();
      expect(
        within(navigation).getByRole("button", { name: "Booking Counter" }),
      ).toBeTruthy();
      expect(
        within(navigation).getByRole("button", { name: "Passenger Manifest" }),
      ).toBeTruthy();
      expect(
        within(navigation)
          .getAllByRole("button")
          .map((button) => button.getAttribute("aria-label")),
      ).toEqual(["Bookings", "Booking Counter", "Passenger Manifest"]);
      expect(
        screen.getByRole("heading", { name: "Booking history" }),
      ).toBeTruthy();
      expect(screen.queryByText("Your operations, at a glance.")).toBeNull();
      expect(screen.queryByText("Active cars")).toBeNull();
      await user.click(
        screen.getByRole("button", { name: /Actual Operator.*Agent/ }),
      );
      expect(
        screen.queryByRole("button", { name: /Manage account/ }),
      ).toBeNull();
      expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
      expect(
        vi
          .mocked(fetch)
          .mock.calls.some(([path]) =>
            String(path).includes("/operator/reports/revenue"),
          ),
      ).toBe(false);
      expect(screen.getByText("Agent", { selector: "small" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Manage seats/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /Manage fleet/ })).toBeNull();
      expect(authState().user?.role).toBe(role);
    },
  );
  it("authenticates live operator with pricing permissions and accesses Trip Master", async () => {
    const user = userEvent.setup();
    const defaultFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(
      async (path: any, options?: RequestInit) => {
        const url = String(path);
        if (url.includes("/auth/login"))
          return reply({
            accessToken: "test-memory-token",
            user: {
              ...identity,
              role: "operator_admin",
              permissions: ["read", "pricing:write"],
            },
          });
        return defaultFetch(path, options!);
      },
    );
    render(<App />);
    await screen.findByRole("button", { name: "Sign in" });
    await user.type(screen.getByLabelText("Email"), "operator@example.test");
    await user.type(screen.getByLabelText("Password"), "a-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    const nav = screen.getByRole("navigation", {
      name: "Workspace navigation",
    });
    const tripMasterBtn = within(nav).getByRole("button", {
      name: "Trip Master",
    });
    await user.click(tripMasterBtn);
    expect(screen.getByText("Car Trip Master")).toBeTruthy();
    expect(authState().accessToken).toBe("test-memory-token");
  });
  it("opens the complete counter workflow from New booking for live operators", async () => {
    const user = userEvent.setup();
    const defaultFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (...args) =>
      String(args[0]).includes("/auth/login")
        ? reply({
            accessToken: "test-memory-token",
            user: {
              ...identity,
              role: "operator_admin",
              permissions: ["read", "bookings:write"],
            },
          })
        : defaultFetch(...args),
    );
    render(<App />);
    await screen.findByRole("button", { name: "Sign in" });
    await user.type(screen.getByLabelText("Email"), "operator@example.test");
    await user.type(screen.getByLabelText("Password"), "a-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await user.click(
      await screen.findByRole("button", { name: "New booking" }),
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(
      /Booking [Cc]ounter/,
    );
    expect(screen.getByRole("button", { name: "Search trips" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "New booking" })).toBeNull();
  });
  it("retains an open route form during refresh when the operator has no routes", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider>
        <RefreshProbe />
      </WorkspaceProvider>,
    );
    await screen.findByRole("button", { name: "Sign in" });
    await user.type(screen.getByLabelText("Email"), "operator@example.test");
    await user.type(screen.getByLabelText("Password"), "a-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByLabelText("From city");
    await waitFor(() =>
      expect(screen.queryByText("Updating operator records…")).toBeNull(),
    );
    await user.type(screen.getByLabelText("From city"), "Pune");
    const originalFetch = vi.mocked(fetch).getMockImplementation()!;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(fetch).mockImplementation(async (...args) => {
      if (String(args[0]).includes("/operator/routes?")) await pending;
      return originalFetch(...args);
    });
    await user.click(screen.getByRole("button", { name: "Refresh records" }));
    expect(screen.getByText("Updating operator records…")).toBeTruthy();
    expect((screen.getByLabelText("From city") as HTMLInputElement).value).toBe(
      "Pune",
    );
    await user.type(screen.getByLabelText("To city"), "Mumbai");
    release();
    await waitFor(() =>
      expect(screen.queryByText("Updating operator records…")).toBeNull(),
    );
    expect((screen.getByLabelText("From city") as HTMLInputElement).value).toBe(
      "Pune",
    );
    expect((screen.getByLabelText("To city") as HTMLInputElement).value).toBe(
      "Mumbai",
    );
  });
  it("requires login by default, loads server records and hides unauthorized actions", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: "Sign in" });
    expect(screen.queryByText("Aarav Sharma")).toBeNull();
    await user.type(screen.getByLabelText("Email"), "operator@example.test");
    await user.type(screen.getByLabelText("Password"), "a-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByRole("heading", {
      name: "Your operations, at a glance.",
    });
    expect(screen.getAllByText("Actual Travels").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "New booking" })).toBeNull();
    const nav = screen.getByRole("navigation", {
      name: "Workspace navigation",
    });
    await user.click(within(nav).getByRole("button", { name: "Vehicle Master" }));
    expect(screen.queryByRole("button", { name: "Add Vehicle" })).toBeNull();
    expect(authState().accessToken).toBe("test-memory-token");
    expect(localStorage.length).toBe(0);
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(
          ([path, options]) =>
            String(path).includes("/operator/cars") &&
            new Headers(options?.headers).get("Authorization") ===
              "Bearer test-memory-token",
        ),
    ).toBe(true);
  });
  it("shows backend validation failure without logging in or using sample data", async () => {
    vi.mocked(fetch).mockImplementation(async (path) =>
      String(path).includes("/auth/login")
        ? reply(null, 401)
        : reply(null, 401),
    );
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: "Sign in" });
    await user.type(screen.getByLabelText("Email"), "wrong@example.test");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Sign in to continue",
      ),
    );
    expect(screen.queryByText("Aarav Sharma")).toBeNull();
    expect(authState().accessToken).toBe("");
  });
});
