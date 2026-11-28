export type Identity = { id: string; name: string; role: "vehicle_owner" };
type Session = { accessToken: string; user: Identity };
let token = "";
let refreshing: Promise<Identity> | undefined;

class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<{ data: T }> {
  const headers = new Headers(options.headers);
  headers.set("X-Aibus-Client", "owner");
  if (options.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    headers,
    credentials: "same-origin",
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || !("data" in Object(body)))
    throw new RequestError(
      body?.error?.message || "The owner service is unavailable. Try again.",
      response.status,
    );
  return body;
}

function session({ data }: { data: Session }) {
  if (data.user.role !== "vehicle_owner")
    throw new Error("Use a Vehicle Owner account.");
  token = data.accessToken;
  return data.user;
}

export async function login(email: string, password: string) {
  return session(
    await request<Session>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  );
}

export function refresh() {
  refreshing ??= request<Session>("/auth/refresh", { method: "POST" })
    .then(session)
    .finally(() => {
      refreshing = undefined;
    });
  return refreshing;
}

export async function logout() {
  await request("/auth/logout", { method: "POST" });
  token = "";
}

export async function api<T>(path: string, options?: RequestInit) {
  try {
    return await request<T>(path, options);
  } catch (error) {
    if (
      !(error instanceof RequestError) ||
      error.status !== 401 ||
      options?.signal?.aborted
    )
      throw error;
    await refresh();
    return request<T>(path, options);
  }
}
