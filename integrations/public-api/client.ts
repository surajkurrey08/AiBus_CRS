/** Server-side integration example. Never bundle credentials into a browser application. */
export class PublicApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public requestId?: string,
  ) {
    super(code);
  }
}
export class AibusPublicClient {
  #credential: string;
  #token = "";
  #expiresAt = 0;
  #authenticating?: Promise<void>;
  constructor(
    private baseUrl: string,
    credential: string,
    options: { allowInsecureLocalhost?: boolean } = {},
  ) {
    if (typeof window !== "undefined")
      throw Error(
        "AIBUS partner credentials must remain on your backend server",
      );
    const url = new URL(baseUrl);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" &&
        !(
          options.allowInsecureLocalhost &&
          url.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
        ))
    )
      throw Error("Use HTTPS or explicitly authorized loopback test transport");
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.#credential = credential;
  }
  async #authenticate() {
    if (this.#token && this.#expiresAt > Date.now() + 10000) return;
    if (!this.#authenticating)
      this.#authenticating = (async () => {
        const response = await fetch(this.baseUrl + "/auth/token", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + this.#credential,
            "Content-Type": "application/json",
          },
          body: "{}",
          signal: AbortSignal.timeout(12000),
          redirect: "error",
        });
        const body = await response.json();
        if (!response.ok)
          throw new PublicApiError(
            response.status,
            body.error?.code || "AUTH_FAILED",
            body.error?.requestId,
          );
        this.#token = body.data.accessToken;
        this.#expiresAt = Date.now() + body.data.expiresIn * 1000;
      })().finally(() => {
        this.#authenticating = undefined;
      });
    return this.#authenticating;
  }
  async request<T>(
    path: string,
    options: {
      method?: "GET" | "POST";
      body?: unknown;
      idempotencyKey?: string;
    } = {},
    retry = true,
  ): Promise<{
    data: T;
    meta?: { page: number; limit: number; total: number };
  }> {
    if (!/^\/[a-zA-Z0-9]/.test(path) || path.includes("#"))
      throw Error("Use a relative documented API path");
    await this.#authenticate();
    const response = await fetch(this.baseUrl + path, {
      method: options.method || "GET",
      headers: {
        Authorization: "Bearer " + this.#token,
        "Content-Type": "application/json",
        ...(options.idempotencyKey
          ? { "Idempotency-Key": options.idempotencyKey }
          : {}),
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
      signal: AbortSignal.timeout(12000),
      redirect: "error",
    });
    if (response.status === 401 && retry) {
      this.#token = "";
      return this.request<T>(path, options, false);
    }
    const body = await response.json();
    if (!response.ok)
      throw new PublicApiError(
        response.status,
        body.error?.code || "REQUEST_FAILED",
        body.error?.requestId,
      );
    return body;
  }
}
