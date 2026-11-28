import {
  api,
  ApiError,
  authState,
  refreshSession,
} from "../../../api/client.ts";
import type { InventorySeat } from "../../../components/seats/SeatMap.tsx";
export interface CounterTrip {
  id: string;
  routeId: string;
  busId: string;
  route: string;
  source: string;
  destination: string;
  boarding: { name: string; time?: string; address?: string }[];
  dropping: { name: string; time?: string; address?: string }[];
  viaLabel?: string;
  viaStops?: { city: string; distanceKm: number; durationMinutes: number }[];
  distanceKm?: number | null;
  durationMinutes?: number | null;
  segmentFares?: {
    fromCity: string;
    toCity: string;
    distanceKm?: number;
    farePaise: number;
    seatFares?: Record<string, number>;
  }[];
  matchedSegment?: {
    fromCity: string;
    toCity: string;
    farePaise?: number;
  };
  busName: string;
  registration: string;
  busType: string;
  amenities?: string[];
  tripType?: string;
  journeyDate: string;
  departureAt: string;
  arrivalAt?: string;
  bookingOpen: boolean;
  version: number;
  inventoryOwner: "internal" | "external";
  totalSeats: number | null;
  availableSeats: number | null;
  bookedSeats: number | null;
  blockedSeats: number | null;
  quotaSeats: number | null;
  baseFarePaise: number | null;
  capabilities: {
    inventory: boolean;
    quote: boolean;
    confirmation: boolean;
    payment: boolean;
  };
}
export interface PricingPolicy {
  taxBasisPoints: number;
  chargePaise: number;
  chargesTaxable: boolean;
  operatorDiscountMaxPaise: number;
  requireAge: boolean;
  requireGender: boolean;
  requireMobile: boolean;
  gstEnabled: boolean;
  version: number;
}
export interface CounterPricing {
  currency: string;
  seatFares: { number: string; basePaise: number }[];
  grossPaise: number;
  discountPaise: number;
  taxablePaise: number;
  taxBasisPoints: number;
  taxPaise: number;
  chargePaise: number;
  chargesTaxable: boolean;
  totalPaise: number;
  policyVersion: number;
  requirements: {
    age: boolean;
    gender: boolean;
    mobile: boolean;
    gstEnabled: boolean;
  };
}
export interface CounterQuote {
  quoteId: string;
  holdId?: string;
  expiresAt: string;
  pricing: CounterPricing;
}
export interface CounterHold {
  holdId: string;
  expiresAt: string;
  amountPaise: number;
  seats: string[];
}
export interface CounterPassenger {
  name: string;
  seat: string;
  phone?: string;
  email?: string;
  age?: number;
  gender?: "male" | "female" | "other" | "unspecified";
  boarding?: string;
  dropping?: string;
}
export interface CounterBooking {
  id: string;
  reference: string;
  pnr: string | null;
  status: string;
  paymentStatus: string;
  source: string;
  totalPaise: number;
  version: number;
  passengers: CounterPassenger[];
  contact?: { phone: string; email?: string };
  gst?: { number: string; company: string; address: string };
}
export const counterApi = {
  search: (
    q: { from: string; to: string; journeyDate: string; page?: number },
    signal?: AbortSignal,
  ) =>
    api<CounterTrip[]>(
      "/operator/counter/trips?" +
        new URLSearchParams({ ...q, page: String(q.page || 1), limit: "10" }),
      { signal },
    ),
  seats: (id: string, signal?: AbortSignal) =>
    api<{ tripId: string; seats: InventorySeat[]; inventoryOwner: string }>(
      `/operator/trips/${id}/seats`,
      { signal },
    ),
  quote: (
    id: string,
    body: {
      seats: string[];
      holdId?: string;
      promoCode?: string;
      operatorDiscountPaise?: number;
      fromCity?: string;
      toCity?: string;
    },
    signal?: AbortSignal,
  ) =>
    api<CounterQuote>(`/operator/trips/${id}/quote`, {
      method: "POST",
      body: JSON.stringify(body),
      signal,
    }),
  hold: (id: string, seats: string[], segment?: { fromCity?: string; toCity?: string }) =>
    api<CounterHold>(`/operator/trips/${id}/holds`, {
      method: "POST",
      body: JSON.stringify({
        seats,
        ...(segment?.fromCity && segment?.toCity
          ? { fromCity: segment.fromCity, toCity: segment.toCity }
          : {}),
      }),
    }),
  release: (id: string, holdId: string) =>
    api(`/operator/trips/${id}/holds/${holdId}`, { method: "DELETE" }),
  bookings: (id: string, source: string, page: number, signal?: AbortSignal) =>
    api<{ bookings: CounterBooking[]; sourceCounts: Record<string, number> }>(
      `/operator/counter/trips/${id}/bookings?${new URLSearchParams({ page: String(page), limit: "6", ...(source ? { source } : {}) })}`,
      { signal },
    ),
  policy: () => api<PricingPolicy | null>("/operator/pricing-policy"),
  cities: (signal?: AbortSignal) =>
    api<{ cities: string[]; destinationsByOrigin: Record<string, string[]> }>(
      "/operator/counter/cities",
      { signal },
    ),
  confirmDirect: (id: string) =>
    api<{ status: string; paymentStatus: string; pnr?: string; reference: string }>(
      `/operator/bookings/${id}/confirm-direct`,
      { method: "POST" },
    ),
};
export async function ticketHtml(id: string, retry = true): Promise<string> {
  const response = await fetch(`/api/v1/operator/bookings/${id}/ticket.html`, {
    headers: { Authorization: `Bearer ${authState().accessToken}` },
    credentials: "include",
  });
  if (response.status === 401 && retry) {
    await refreshSession();
    return ticketHtml(id, false);
  }
  if (!response.ok) {
    const body = await response.json();
    throw new ApiError(
      response.status,
      body.error?.code || "TICKET_UNAVAILABLE",
      body.error?.message || "Ticket unavailable",
    );
  }
  return response.text();
}
