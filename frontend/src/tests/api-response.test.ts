// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readApiResponse } from "../api/response.ts";
describe("API response diagnostics", () => {
  it("explains an unavailable Node upstream instead of an invalid JSON error", async () => {
    await expect(
      readApiResponse(new Response("", { status: 500 })),
    ).rejects.toMatchObject({ code: "BACKEND_UNAVAILABLE", status: 500 });
    await expect(
      readApiResponse(new Response("Bad gateway", { status: 502 })),
    ).rejects.toMatchObject({ code: "BACKEND_UNAVAILABLE" });
  });
  it("rejects an HTML SPA page even if it returns HTTP 200", async () => {
    await expect(
      readApiResponse(
        new Response("<html>App</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      ),
    ).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      message: expect.stringContaining("proxy"),
    });
  });
  it("preserves meaningful backend auth errors", async () => {
    await expect(
      readApiResponse(
        new Response(
          JSON.stringify({
            error: {
              code: "INVALID_CREDENTIALS",
              message: "Invalid email or password",
            },
          }),
          { status: 401 },
        ),
      ),
    ).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
      message: "Invalid email or password",
    });
  });
  it("requires a successful data envelope", async () => {
    await expect(
      readApiResponse(new Response(JSON.stringify({ status: "ok" }))),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(
      await readApiResponse(
        new Response(JSON.stringify({ data: { id: "operator-1" } })),
      ),
    ).toEqual({ data: { id: "operator-1" } });
  });
});
