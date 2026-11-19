import { ApiError } from "./ApiError.ts";
import { readApiResponse } from "./response.ts";
export { ApiError } from "./ApiError.ts";
export type Identity = {
  id: string;
  userId?: string;
  name: string;
  email: string;
  role: string;
  operatorId: string | null;
  agentId?: string;
  permissions: string[];
};
let accessToken = "",
  identity: Identity | null = null,
  refreshing: Promise<void> | null = null;
const listeners = new Set<() => void>();
export const authState = () => ({ accessToken, user: identity });
export const subscribeAuth = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
function session(value: { accessToken: string; user: Identity }) {
  accessToken = value.accessToken;
  identity = value.user;
  listeners.forEach((fn) => fn());
}
export async function refreshSession() {
  if (!refreshing)
    refreshing = (async () => {
      const res = await fetch("/api/v1/auth/refresh", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const body = await readApiResponse(res);
      session(body.data);
    })()
      .catch((error) => {
        accessToken = "";
        identity = null;
        listeners.forEach((fn) => fn());
        throw error;
      })
      .finally(() => {
        refreshing = null;
      });
  return refreshing;
}
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
  retry = true,
): Promise<{
  data: T;
  meta?: { page: number; limit: number; total: number; pages: number };
}> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      ...options,
      headers,
      credentials: "include",
    });
  } catch {
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      "Cannot reach the operator API. Check your connection and try again.",
    );
  }
  if (res.status === 401 && retry && !path.startsWith("/auth/")) {
    await refreshSession();
    return api(path, options, false);
  }
  const result = await readApiResponse(res);
  return result;
}
export async function login(email: string, password: string) {
  const result = await api<{ accessToken: string; user: Identity }>(
    "/auth/login",
    { method: "POST", body: JSON.stringify({ email, password }) },
  );
  session(result.data);
}
export async function logout() {
  try {
    await api("/auth/logout", { method: "POST" });
  } finally {
    accessToken = "";
    identity = null;
    listeners.forEach((fn) => fn());
  }
}
export const can = (permission: string) =>
  identity?.permissions.includes(permission) || false;
export async function downloadFinanceStatement(
  agentId: string,
  from: string,
  to: string,
  retry = true,
): Promise<void> {
  const response = await fetch(
    `/api/v1/operator/finance/wallets/${encodeURIComponent(agentId)}/statement.csv?${new URLSearchParams({ from, to })}`,
    {
      credentials: "include",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (response.status === 401 && retry) {
    await refreshSession();
    return downloadFinanceStatement(agentId, from, to, false);
  }
  if (!response.ok) {
    const body = await readApiResponse(response);
    throw Error(body.error?.message || "Statement download failed");
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = "aibus-agency-statement.csv";
  link.click();
  URL.revokeObjectURL(url);
}
export async function downloadRevenue(
  from: string,
  to: string,
  retry = true,
): Promise<void> {
  const response = await fetch(
    `/api/v1/operator/reports/revenue.csv?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      credentials: "include",
    },
  );
  if (response.status === 401 && retry) {
    await refreshSession();
    return downloadRevenue(from, to, false);
  }
  if (!response.ok) {
    const body = await response.json();
    throw new Error(body.error?.message || "Report export failed");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "aibus-revenue.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export async function downloadFinancialReport(name: string, query: Record<string, string>, retry = true, channel: "finance" | "operations" = "finance"): Promise<void> {
 const response = await fetch('/api/v1/operator/' + channel + '/reports/' + encodeURIComponent(name) + '.csv?' + new URLSearchParams(query), { credentials: 'include', headers: { Authorization: 'Bearer ' + accessToken } });
 if (response.status === 401 && retry) { await refreshSession(); return downloadFinancialReport(name, query, false, channel); }
 if (!response.ok) { const body = await readApiResponse(response); throw Error(body.error?.message || 'Financial export failed'); }
 const url = URL.createObjectURL(await response.blob()), link = document.createElement('a'); link.href = url; link.download = 'aibus-finance.csv'; link.click(); URL.revokeObjectURL(url);
}
