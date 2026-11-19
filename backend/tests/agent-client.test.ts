import { afterEach, expect, it, vi } from "vitest";
import {
  AgencyApiError,
  createAgencyClient,
} from "../../integrations/agent-dashboard/client.js";
const user = {
  id: "1".repeat(24),
  agentId: "2".repeat(24),
  operatorId: "3".repeat(24),
  role: "agent",
  permissions: ["bookings:write"],
};
const session = (token = "memory-token") => ({ accessToken: token, user });
const reply = (data: any, status = 200) =>
  new Response(JSON.stringify(status < 400 ? { data } : { error: data }), {
    status,
  });
afterEach(() => vi.restoreAllMocks());
it("uses isolated agent auth, credentials and memory-only identity", async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(reply(session()));
  const client = createAgencyClient("http://127.0.0.1:4000", transport);
  await client.login("agent@test.com", "private-password");
  const [url, options] = transport.mock.calls[0];
  expect(url).toBe("http://127.0.0.1:4000/api/v1/auth/login");
  expect(options).toMatchObject({
    credentials: "include",
    method: "POST",
    headers: { "X-Aibus-Client": "agent" },
  });
  expect(client.getIdentity()).toMatchObject({ agentId: user.agentId });
  expect(JSON.stringify(client.getIdentity())).not.toContain("memory-token");
});
it("shares one refresh for concurrent requests and clears invalid sessions", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url) =>
      String(url).endsWith("/auth/refresh")
        ? reply(session())
        : reply({ id: user.agentId }),
    );
  const client = createAgencyClient("http://127.0.0.1:4000", transport);
  await Promise.all([client.me(), client.me(), client.me()]);
  expect(
    transport.mock.calls.filter(([url]) =>
      String(url).endsWith("/auth/refresh"),
    ),
  ).toHaveLength(1);
  transport.mockImplementation(async () =>
    reply({ code: "SESSION_REVOKED", message: "Sign in again" }, 401),
  );
  await expect(client.me()).rejects.toMatchObject({ code: "SESSION_REVOKED" });
  expect(client.getIdentity()).toBeNull();
});
it("preserves the exact booking body and key across authentication-only retry", async () => {
  const input = {
    tripId: "4".repeat(24),
    holdId: "hold",
    passengers: [{ name: "Original", seat: "L1" }],
  };
  let bookings = 0;
  const transport = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    if (String(url).endsWith("/auth/login")) return reply(session("old"));
    if (String(url).endsWith("/auth/refresh")) return reply(session("new"));
    if (++bookings === 1) {
      input.passengers[0].name = "Changed after submission";
      return reply({ code: "SESSION_REVOKED", message: "Expired" }, 401);
    }
    return reply({ id: "booking" });
  });
  const client = createAgencyClient("http://127.0.0.1:4000", transport);
  await client.login("a@test.com", "secret");
  await client.createBooking(input, "retained-booking-key-123");
  const calls = transport.mock.calls.filter(([url]) =>
    String(url).endsWith("/agent/bookings"),
  );
  expect(calls).toHaveLength(2);
  expect(calls[0][1]!.body).toBe(calls[1][1]!.body);
  expect(String(calls[1][1]!.body)).toContain("Original");
  expect(calls[1][1]!.headers).toMatchObject({
    "Idempotency-Key": "retained-booking-key-123",
    Authorization: "Bearer new",
  });
});
it("does not automatically retry booking creation or charges after a timeout", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(reply(session()))
    .mockRejectedValue(new Error("timeout"));
  const client = createAgencyClient("http://127.0.0.1:4000", transport);
  await client.login("a@test.com", "secret");
  await expect(
    client.createBooking(
      {
        tripId: "4".repeat(24),
        holdId: "hold",
        passengers: [{ name: "A", seat: "L1" }],
      },
      "retained-booking-key-123",
    ),
  ).rejects.toMatchObject({ code: "NETWORK_ERROR", uncertain: true });
  expect(transport).toHaveBeenCalledTimes(2);
  await expect(client.startPayment("5".repeat(24))).rejects.toMatchObject({
    uncertain: true,
  });
  expect(transport).toHaveBeenCalledTimes(3);
});
it("labels server-side uncertain payment errors without inventing confirmation", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(reply(session()))
    .mockImplementation(async () =>
      reply(
        { code: "PAYMENT_ORDER_UNCERTAIN", message: "Check existing booking" },
        409,
      ),
    );
  const client = createAgencyClient("http://127.0.0.1:4000", transport);
  await client.login("a@test.com", "secret");
  await expect(client.startPayment("5".repeat(24))).rejects.toBeInstanceOf(
    AgencyApiError,
  );
  await expect(client.startPayment("5".repeat(24))).rejects.toMatchObject({
    uncertain: true,
  });
});
it("rejects non-agency sessions, unsafe API origins and clears identity on logout", async () => {
  expect(() => createAgencyClient("http://api.example.com")).toThrow("HTTPS");
  expect(() => createAgencyClient("https://*.example.com")).toThrow();
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      reply({ accessToken: "x", user: { ...user, role: "operator_admin" } }),
    );
  const client = createAgencyClient("http://127.0.0.1:4000", transport);
  await expect(
    client.login("operator@test.com", "secret"),
  ).rejects.toMatchObject({ code: "AGENT_REQUIRED" });
  transport
    .mockResolvedValueOnce(reply(session()))
    .mockResolvedValueOnce(reply({ loggedOut: true }));
  await client.login("a@test.com", "secret");
  await client.logout();
  expect(client.getIdentity()).toBeNull();
});
