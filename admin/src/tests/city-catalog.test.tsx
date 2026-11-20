// @vitest-environment jsdom
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CityCatalog } from "../features/platform/CityCatalog";
import { api } from "../api/client";
vi.mock("../api/client", () => ({
  api: vi.fn(),
  downloadPlatformCsv: vi.fn(),
}));
const user = {
  id: "root",
  name: "Admin",
  email: "admin@test",
  role: "super_admin",
  operatorId: null,
  permissions: ["platform:settings:read", "platform:settings:write"],
};
const batch = {
  id: "abc",
  source: "cities.json",
  counts: { ready: 1, invalid: 1 },
  total: 2,
  cursor: 0,
  inserted: 0,
  skipped: 0,
  status: "Preview",
  rows: [
    { row: 1, name: "Pune", state: "Maharashtra", status: "ready" },
    { row: 2, status: "invalid", reason: "Missing city" },
  ],
};
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  vi.mocked(api).mockImplementation(async (path) =>
    path.includes("/imports/")
      ? { data: batch }
      : { data: [], meta: { page: 1, limit: 25, total: 0, pages: 1 } },
  );
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("keeps import and add controls unavailable for read-only admins", async () => {
  render(
    <CityCatalog user={{ ...user, permissions: ["platform:settings:read"] }} />,
  );
  expect(screen.queryByRole("button", { name: "Add city" })).toBeNull();
  expect(screen.queryByLabelText("Import city JSON")).toBeNull();
  await waitFor(() => expect(api).toHaveBeenCalled());
});
it("previews the uploaded file without calling commit and shows rejected rows", async () => {
  render(<CityCatalog user={user} />);
  const file = new File(["fixture"], "cities.json", {
    type: "application/json",
  });
  file.text = async () =>
    JSON.stringify({
      success: true,
      data: [{ CityId: 1, City: "Pune", State: "Maharashtra" }],
    });
  fireEvent.change(screen.getByLabelText("Import city JSON"), {
    target: { files: [file] },
  });
  expect(await screen.findByText("Missing city")).toBeTruthy();
  expect(
    vi.mocked(api).mock.calls.some(([path]) => path.endsWith("/commit")),
  ).toBe(false);
  expect(api).toHaveBeenCalledWith(
    "/platform/city-catalog/imports/preview",
    expect.objectContaining({ method: "POST" }),
  );
});
it("requires a deliberate reviewed password action before creating a catalog city", async () => {
  const ui = userEvent.setup();
  render(<CityCatalog user={user} />);
  await ui.click(screen.getByRole("button", { name: "Add city" }));
  expect(
    screen.getByLabelText(/Your current password/).getAttribute("type"),
  ).toBe("password");
  expect(screen.getByText(/permanent AIBUS ID/)).toBeTruthy();
  expect(
    vi.mocked(api).mock.calls.some(([, options]) => options?.method === "POST"),
  ).toBe(false);
});
