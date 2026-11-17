// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
  it("saves double and single weekday/weekend prices from the Fares tab as integer paise", async () => {
    const user = userEvent.setup();
    const defaultFetch = vi.mocked(fetch).getMockImplementation()!;
    let saved: any;
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
        if (url.includes("/operator/routes"))
          return reply([
            {
              _id: "route-1",
              source: "Pune",
              destination: "Bhopal",
              boarding: [],
              dropping: [],
              durationMinutes: 600,
            },
          ]);
        if (url.includes("/operator/fares") && options?.method === "POST") {
          saved = JSON.parse(options.body as string);
          return reply({ _id: "fare-1", ...saved });
        }
        return defaultFetch(path, options!);
      },
    );
    render(<App />);
    await screen.findByRole("button", { name: "Sign in" });
    await user.type(screen.getByLabelText("Email"), "operator@example.test");
    await user.type(screen.getByLabelText("Password"), "a-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await user.click(
      await screen.findByRole("button", { name: "Fare & pricing" }),
    );
    await user.click(screen.getByRole("button", { name: "Add fare" }));
    await user.type(screen.getByLabelText("Route"), "Pune → Bhopal");
    await user.type(
      screen.getByLabelText("Double-side weekday fare · INR per person"),
      "2200",
    );
    await user.type(
      screen.getByLabelText("Single-side weekday fare · INR per person"),
      "2500.50",
    );
    await user.type(
      screen.getByLabelText("Double-side weekend fare · INR per person"),
      "2300",
    );
    await user.type(
      screen.getByLabelText("Single-side weekend fare · INR per person"),
      "2700",
    );
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(saved).toMatchObject({
        routeId: "route-1",
        basePaise: 220000,
        singlePaise: 250050,
        weekendPaise: 230000,
        singleWeekendPaise: 270000,
      }),
    );
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
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Booking counter",
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
    await user.click(screen.getByRole("button", { name: "Master" }));
    await user.click(screen.getByRole("button", { name: "Bus Master" }));
    expect(screen.queryByRole("button", { name: "Add bus" })).toBeNull();
    expect(authState().accessToken).toBe("test-memory-token");
    expect(localStorage.length).toBe(0);
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(
          ([path, options]) =>
            String(path).includes("/operator/buses") &&
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
