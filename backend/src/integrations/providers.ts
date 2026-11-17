import { AppError, fail } from "../utils/core.js";
export type Capability =
  | "cities"
  | "search"
  | "layout"
  | "availability"
  | "fares"
  | "hold"
  | "book"
  | "status"
  | "cancel"
  | "refundStatus"
  | "webhooks";
export interface ProviderBooking {
  externalId: string;
  status: "pending" | "confirmed" | "failed" | "cancelled";
  pnr?: string;
  totalPaise: number;
}
export interface ProviderAdapter {
  readonly id: string;
  readonly capabilities: ReadonlySet<Capability>;
  getBookingStatus(
    externalId: string,
    signal: AbortSignal,
  ): Promise<ProviderBooking>;
  hold?(
    tripId: string,
    seats: string[],
    key: string,
  ): Promise<{ externalId: string; expiresAt: string }>;
  confirm?(holdId: string, key: string): Promise<ProviderBooking>;
  cancel?(
    externalId: string,
    key: string,
  ): Promise<{ status: "pending" | "cancelled" }>;
}
export class UnconfiguredProvider implements ProviderAdapter {
  readonly id = "unconfigured";
  readonly capabilities = new Set<Capability>();
  async getBookingStatus(): Promise<ProviderBooking> {
    return fail(
      503,
      "PROVIDER_UNAVAILABLE",
      "External booking API has not been supplied or configured",
    );
  }
}
export const provider: ProviderAdapter = new UnconfiguredProvider();
export function requireCapability(capability: Capability) {
  if (!provider.capabilities.has(capability))
    fail(
      503,
      "CAPABILITY_UNAVAILABLE",
      `External provider capability '${capability}' is unavailable until an adapter is configured`,
    );
}
// GET-only retry helper. Mutations must use provider-supported idempotency keys;
// uncertain outcomes must reconcile instead of being blindly retried.
export async function safeProviderRead<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  attempts = 3,
): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await operation(AbortSignal.timeout(8000));
    } catch (error) {
      const status = error instanceof AppError ? error.status : 503;
      if (i === attempts - 1 || status < 500) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** i));
    }
  }
  throw new AppError(503, "PROVIDER_UNAVAILABLE", "Provider request failed");
}
