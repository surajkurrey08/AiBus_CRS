import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App, OneTimeSecret, Load } from "./App";
import { api, authState, post } from "./api/client";
vi.mock("./api/client", () => ({
  api: vi.fn(),
  post: vi.fn(),
  authState: vi.fn(),
  subscribeAuth: () => () => {},
  refreshSession: async () => {},
  login: vi.fn(),
  logout: vi.fn(),
}));
const user = {
  id: "owner",
  name: "Partner Owner",
  email: "owner@test",
  role: "partner",
  operatorId: null,
  partnerRole: "Owner",
  permissions: [
    "partner:overview",
    "partner:credentials:read",
    "partner:credentials:write",
    "partner:docs",
    "partner:playground",
  ],
};
beforeEach(() => {
  vi.mocked(post).mockImplementation((path, body) =>
    api(path, { method: "POST", body: JSON.stringify(body) }),
  );
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  vi.mocked(authState).mockReturnValue({ user, accessToken: "session" });
  vi.mocked(api).mockImplementation(async (path) =>
    path === "/partner/overview"
      ? {
          data: {
            name: "Authorized Company",
            status: "Approved",
            sandboxAvailable: true,
            authorizedOperators: 0,
            authorizedTrips: 0,
            bookings: 0,
            usage: { total: 0, success: 0, failed: 0, latencyMs: 0 },
            webhooks: [],
            activity: [],
          },
        }
      : { data: [], meta: { page: 1, limit: 25, total: 0, pages: 0 } },
  );
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("renders real organization data with sandbox indicators and permission-filtered navigation", async () => {
  render(<App />);
  expect(await screen.findByText("Authorized Company")).toBeTruthy();
  expect(screen.getByText(/Production access unavailable/)).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Team & Permissions" }),
  ).toBeNull();
});
it("does not reveal a one-time secret until requested and clears its dialog", async () => {
  const close = vi.fn();
  const { unmount } = render(
    <OneTimeSecret value="test-new-private-secret" onClose={close} />,
  );
  expect(screen.queryByText("test-new-private-secret")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Show secret" }));
  expect(screen.getByText("test-new-private-secret")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Hide secret" }));
  expect(screen.queryByText("test-new-private-secret")).toBeNull();
  await userEvent.click(
    screen.getByRole("button", { name: "I have saved it" }),
  );
  expect(close).toHaveBeenCalledOnce();
  unmount();
  expect(screen.queryByText("test-new-private-secret")).toBeNull();
});
it("requires review and password before issuing a sandbox credential", async () => {
  render(<App />);
  await screen.findByText("Authorized Company");
  await userEvent.click(
    screen.getByRole("button", { name: "API Credentials" }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Generate credential" }),
  );
  await userEvent.type(
    screen.getByLabelText("Credential label"),
    "Backend service",
  );
  await userEvent.click(screen.getByLabelText("inventory:read"));
  await userEvent.type(screen.getByLabelText("Expiration date"), "2026-12-01");
  await userEvent.type(
    screen.getByLabelText("Reason"),
    "Reviewed integration access",
  );
  await userEvent.type(
    screen.getByLabelText("Current password"),
    "Current-test-password",
  );
  await userEvent.click(screen.getByRole("button", { name: /Review/ }));
  expect(
    vi
      .mocked(api)
      .mock.calls.some(
        ([p, o]) => p === "/partner/credentials" && o?.method === "POST",
      ),
  ).toBe(false);
  expect(
    screen.getByRole("button", { name: "Record reviewed change" }),
  ).toBeTruthy();
});
it("uses the compiled API contract and blocks malformed playground JSON", async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path === "/partner/documentation"
      ? {
          data: {
            paths: {
              "/capabilities": {
                get: {
                  operationId: "capabilities",
                  summary: "Sandbox capabilities",
                  responses: {},
                },
              },
            },
            components: { schemas: {} },
          },
        }
      : path === "/partner/overview"
        ? { data: { name: "Company", usage: {}, webhooks: [], activity: [] } }
        : { data: [] },
  );
  render(<App />);
  await screen.findByText("Company");
  await userEvent.click(screen.getByRole("button", { name: "API Playground" }));
  const area = await screen.findByLabelText("Sandbox request JSON");
  await userEvent.clear(area);
  await userEvent.type(area, "invalid JSON");
  await userEvent.click(
    screen.getByRole("button", { name: "Run sandbox request" }),
  );
  expect(screen.getByRole("alert").textContent).toContain("valid JSON");
  expect(document.activeElement).toBe(area);
  expect(
    vi
      .mocked(api)
      .mock.calls.some(
        ([p, o]) => p === "/partner/playground" && o?.method === "POST",
      ),
  ).toBe(false);
});
it("ignores a stale organization response after navigation", async () => {
  let resolve!: (v: any) => void;
  vi.mocked(api).mockImplementation(async (path) =>
    path === "/partner/old"
      ? new Promise((r) => (resolve = r))
      : { data: { name: "Current organization" } },
  );
  const { rerender } = render(
    <Load path="/partner/old">{(d) => <p>{d.name}</p>}</Load>,
  );
  rerender(<Load path="/partner/current">{(d) => <p>{d.name}</p>}</Load>);
  expect(await screen.findByText("Current organization")).toBeTruthy();
  resolve({ data: { name: "Stale organization" } });
  await waitFor(() =>
    expect(screen.queryByText("Stale organization")).toBeNull(),
  );
});
it("owns registration email validation without making a request", async () => {
  vi.mocked(authState).mockReturnValue({ user: null, accessToken: "" });
  render(<App />);
  await userEvent.click(
    await screen.findByRole("button", { name: "Register company" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Save application" }),
  );
  expect(screen.getByRole("alert").textContent).toContain("company name");
  expect(document.activeElement).toBe(screen.getByLabelText("Company name"));
  expect(
    vi.mocked(api).mock.calls.some(([p]) => p === "/partner/applications"),
  ).toBe(false);
});

it("keeps application input and focuses a visible server error after failed registration", async () => {
  vi.mocked(authState).mockReturnValue({ user: null, accessToken: "" });
  vi.mocked(post).mockRejectedValueOnce(
    Error("Application could not be submitted. Please retry."),
  );
  render(<App />);
  await userEvent.click(
    await screen.findByRole("button", { name: "Register company" }),
  );
  for (const [name, value] of [
    ["Company name", "Sandbox Travel"],
    ["Contact person", "Test Owner"],
    ["Business email", "owner@fixture.test"],
    ["Contact number", "9000000000"],
    ["Business address", "Pune test office"],
    ["Technical contact email", "tech@fixture.test"],
    ["Intended API usage", "Bus booking sandbox integration"],
    ["Owner password (8+ characters)", "Fixture-password-123!"],
  ])
    await userEvent.type(screen.getByLabelText(name, { exact: true }), value);
  await userEvent.click(
    screen.getByRole("button", { name: "Save application" }),
  );
  expect((await screen.findByRole("alert")).textContent).toContain(
    "could not be submitted",
  );
  expect(document.activeElement).toBe(screen.getByRole("alert"));
  expect(
    (screen.getByLabelText("Company name") as HTMLInputElement).value,
  ).toBe("Sandbox Travel");
  expect(vi.mocked(post).mock.calls[0][1]).toMatchObject({
    name: "Sandbox Travel",
    requestedEnvironment: "Sandbox",
    submit: true,
  });
});
it("masks passwords by default and toggles visibility deliberately", async () => {
  vi.mocked(authState).mockReturnValue({ user: null, accessToken: "" });
  render(<App />);
  const field = await screen.findByLabelText("Password", { exact: true });
  expect(field.getAttribute("type")).toBe("password");
  await userEvent.click(screen.getByRole("button", { name: "Show password" }));
  expect(field.getAttribute("type")).toBe("text");
  await userEvent.click(screen.getByRole("button", { name: "Hide password" }));
  expect(field.getAttribute("type")).toBe("password");
});
