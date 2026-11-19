import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { publicApiSpec as spec } from "../../../backend/src/docs/public-api.openapi";
import { requestExample, integrationExample } from "./developer/contracts";
import { DeveloperWorkspace } from "./developer/DeveloperWorkspace";
import { InventoryAccess, credentialStatus } from "./workspace/ApiAccess";
import { api, post } from "../api/client";
vi.mock("../api/client", () => ({ api: vi.fn(), post: vi.fn() }));
beforeEach(() => vi.mocked(api).mockResolvedValue({ data: spec }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const operation = (path: string, method: string) => ({
  ...(spec.paths as any)[path][method],
  path,
  method: method.toUpperCase(),
});
it("builds complete server examples from real query, body and idempotency contracts", () => {
  const trips = operation("/trips", "get");
  expect(requestExample(trips, spec).query).toMatchObject({
    page: "1",
    limit: "25",
    journeyDate: "2030-11-20",
  });
  expect(integrationExample(trips, spec, "curl")).toContain(
    "journeyDate=2030-11-20",
  );
  const hold = operation("/trips/{id}/holds", "post");
  expect(integrationExample(hold, spec, "curl")).toContain("Idempotency-Key:");
  expect(integrationExample(hold, spec, "javascript")).toContain('"body":');
  expect(requestExample(hold, spec).body.seats).toHaveLength(1);
  expect(
    integrationExample(operation("/auth/token", "post"), spec, "curl"),
  ).toContain("Bearer <SERVER_API_CREDENTIAL>");
});
it("shows readable endpoint contracts and a recoverable empty endpoint search", async () => {
  render(<DeveloperWorkspace playground={false} />);
  await userEvent.click(
    await screen.findByRole("button", { name: /Authorized dated trip search/ }),
  );
  expect(
    screen.getByRole("heading", { name: "Parameters & headers" }),
  ).toBeTruthy();
  expect(screen.getByText("journeyDate", { selector: "td code" })).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Download OpenAPI JSON" }),
  ).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "JavaScript" }));
  expect(
    screen.getByText(/const response = await fetch/, { selector: "pre" })
      .textContent,
  ).toContain("journeyDate=2030-11-20");
  await userEvent.type(
    screen.getByLabelText("Find endpoint"),
    "no-such-endpoint",
  );
  expect(screen.getByText("No matching endpoints.")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(
    screen.getByRole("button", { name: /Authorized dated trip search/ }),
  ).toBeTruthy();
});
it("keeps per-endpoint drafts and displays actual failed HTTP responses", async () => {
  vi.mocked(post).mockResolvedValue({
    data: {
      status: 403,
      durationMs: 4,
      requestId: "test-request",
      response: { error: { code: "SCOPE_REQUIRED", message: "Scope missing" } },
    },
  });
  render(<DeveloperWorkspace playground />);
  const area = await screen.findByLabelText("Sandbox request JSON");
  await userEvent.clear(area);
  await userEvent.paste(
    '{"params":{},"query":{},"body":{},"idempotencyKey":"keep-this-test-key"}',
  );
  await userEvent.click(
    screen.getByRole("button", { name: /Authorized dated trip search/ }),
  );
  expect(
    (screen.getByLabelText("Sandbox request JSON") as HTMLTextAreaElement)
      .value,
  ).toContain("journeyDate");
  await userEvent.click(
    screen.getByRole("button", {
      name: /Inspect supported and unavailable capabilities/,
    }),
  );
  expect(
    (screen.getByLabelText("Sandbox request JSON") as HTMLTextAreaElement)
      .value,
  ).toContain("keep-this-test-key");
  await userEvent.click(
    screen.getByRole("button", { name: "Run sandbox request" }),
  );
  expect(await screen.findByText("HTTP 403")).toBeTruthy();
  expect(screen.getByText(/SCOPE_REQUIRED/, { selector: "pre" })).toBeTruthy();
  expect(vi.mocked(post).mock.calls[0][1]).toMatchObject({
    operationId: "capabilities",
    idempotencyKey: "keep-this-test-key",
  });
});
it("rejects a JSON array locally and preserves the draft after a network error", async () => {
  render(<DeveloperWorkspace playground />);
  const area = await screen.findByLabelText("Sandbox request JSON");
  await userEvent.clear(area);
  await userEvent.paste("[]");
  await userEvent.click(
    screen.getByRole("button", { name: "Run sandbox request" }),
  );
  expect(screen.getByRole("alert").textContent).toContain("valid JSON");
  expect(post).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(area);
  await userEvent.clear(area);
  await userEvent.paste('{"query":{},"params":{},"body":{}}');
  vi.mocked(post).mockRejectedValueOnce(
    Error("Sandbox could not be reached. Retry this request."),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Run sandbox request" }),
  );
  expect((await screen.findByRole("alert")).textContent).toContain(
    "could not be reached",
  );
  expect((area as HTMLTextAreaElement).value).toContain('"query"');
});
it("distinguishes expired and revoked credentials without exposing secrets", () => {
  expect(credentialStatus({ expiresAt: "2099-01-01" })).toBe("Active");
  expect(credentialStatus({ expiresAt: "2000-01-01" })).toBe("Expired");
  expect(
    credentialStatus({ expiresAt: "2099-01-01", revokedAt: "2026-01-01" }),
  ).toBe("Revoked");
});
it("explains missing grants without implying credential creation gives inventory access", async () => {
  vi.mocked(api).mockResolvedValue({ data: { grants: [], trips: [] } });
  render(<InventoryAccess />);
  expect(await screen.findByText("No inventory granted yet")).toBeTruthy();
  expect(
    screen.getByText(
      /Generating a credential will not grant access automatically/,
    ),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Refresh inventory" }),
  ).toBeTruthy();
  const before = vi.mocked(api).mock.calls.length;
  await userEvent.click(screen.getByRole("button", { name: /^Refresh$/ }));
  await screen.findByText("No inventory granted yet");
  expect(vi.mocked(api).mock.calls.length).toBeGreaterThan(before);
});
