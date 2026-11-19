/** Framework-neutral integration adapter, not a dashboard. Tokens remain in memory. */
export type AgencyIdentity = {
    id: string;
    role: "agent";
    agentId: string;
    operatorId: string;
    permissions: string[];
};
export type Passenger = {
    name: string;
    seat: string;
    age?: number;
    gender?: string;
    phone?: string;
    email?: string;
    boarding?: string;
    dropping?: string;
};
export type BookingInput = {
    tripId: string;
    holdId: string;
    quoteId?: string;
    passengers: Passenger[];
    contact?: {
        phone?: string;
        email?: string;
    };
    gst?: {
        number?: string;
        company?: string;
        address?: string;
    };
    promoCode?: string;
};
export class AgencyApiError extends Error {
    constructor(public status: number, public code: string, message: string, public uncertain = false) {
        super(message);
    }
}
type Envelope<T> = {
    data: T;
    meta?: {
        page: number;
        limit: number;
        total: number;
        pages: number;
    };
};
export function createAgencyClient(baseUrl: string, transport: typeof fetch = fetch) {
    const base = new URL(baseUrl);
    if (!["http:", "https:"].includes(base.protocol) ||
        base.hostname.includes("*") ||
        base.username ||
        base.password ||
        base.search ||
        base.hash ||
        base.pathname !== "/")
        throw new Error("Use a trusted API HTTP(S) origin without path, credentials or query");
    if (base.protocol !== "https:" &&
        !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname))
        throw new Error("Non-local API hosts must use HTTPS");
    let token = "", identity: AgencyIdentity | null = null, refreshing: Promise<void> | null = null;
    const clear = () => {
        token = "";
        identity = null;
    };
    function acceptSession(value: {
        accessToken: string;
        user: AgencyIdentity;
    }) {
        if (!value?.accessToken ||
            value.user?.role !== "agent" ||
            !value.user.agentId ||
            !value.user.operatorId) {
            clear();
            throw new AgencyApiError(403, "AGENT_REQUIRED", "This login is not an operator-owned agency account");
        }
        token = value.accessToken;
        identity = value.user;
    }
    async function send<T>(path: string, method = "GET", payload?: unknown, headers: Record<string, string> = {}): Promise<Envelope<T>> {
        const requestToken = token;
        let response: Response;
        try {
            response = await transport(`${base.origin}/api/v1${path}`, {
                method,
                credentials: "include",
                headers: {
                    "Content-Type": "application/json",
                    "X-Aibus-Client": "agent",
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    ...headers
                },
                ...(payload === undefined ? {} : { body: JSON.stringify(payload) })
            });
        }
        catch {
            throw new AgencyApiError(0, "NETWORK_ERROR", method === "GET"
                ? "Cannot reach AIBUS"
                : "Request outcome is unknown. Check the existing booking before retrying.", method !== "GET");
        }
        const body = await response.json().catch(() => null);
        if (!response.ok) {
            if ((response.status === 401 && token === requestToken) ||
                [
                    "AGENT_INACTIVE",
                    "AGENT_LINK_INVALID",
                    "OPERATOR_NOT_APPROVED",
                ].includes(body?.error?.code))
                clear();
            throw new AgencyApiError(response.status, body?.error?.code || "API_ERROR", body?.error?.message || "AIBUS request failed", method !== "GET" &&
                (response.status >= 500 ||
                    body?.error?.code === "PAYMENT_ORDER_UNCERTAIN"));
        }
        if (!body || !("data" in body))
            throw new AgencyApiError(502, "INVALID_RESPONSE", "AIBUS returned an invalid response", method !== "GET");
        return body;
    }
    async function refresh() {
        if (!refreshing)
            refreshing = (async () => {
                try {
                    acceptSession((await send<{
                        accessToken: string;
                        user: AgencyIdentity;
                    }>("/auth/refresh", "POST")).data);
                }
                catch (error) {
                    clear();
                    throw error;
                }
                finally {
                    refreshing = null;
                }
            })();
        return refreshing;
    }
    async function request<T = any>(path: string, method = "GET", payload?: unknown, headers?: Record<string, string>): Promise<Envelope<T>> {
        // Capture one immutable JSON body for a possible authentication-only retry.
        const stable = payload === undefined ? undefined : JSON.parse(JSON.stringify(payload));
        if (!token)
            await refresh();
        const attemptToken = token;
        try {
            return await send<T>(path, method, stable, headers);
        }
        catch (error) {
            if (!(error instanceof AgencyApiError) || error.status !== 401)
                throw error;
            if (!token || token === attemptToken)
                await refresh();
            return send<T>(path, method, stable, headers);
        }
    }
    const query = (values: Record<string, string | number | undefined>) => {
        const q = new URLSearchParams();
        for (const [key, value] of Object.entries(values))
            if (value !== undefined)
                q.set(key, String(value));
        return q.size ? "?" + q.toString() : "";
    };
    const safeId = (id: string) => {
        if (!/^[a-f\d]{24}$/i.test(id))
            throw new Error("Invalid resource identifier");
        return id;
    };
    return {
        getIdentity: () => identity ? { ...identity, permissions: [...identity.permissions] } : null,
        async login(email: string, password: string) {
            clear();
            acceptSession((await send<{
                accessToken: string;
                user: AgencyIdentity;
            }>("/auth/login", "POST", { email, password })).data);
            return identity;
        },
        refresh,
        async logout() {
            try {
                await send("/auth/logout", "POST");
            }
            finally {
                clear();
            }
        },
        me: () => request("/agent/me"),
        dashboard: (date?: string) => request("/agent/dashboard" + query({ date })),
        cities: (search: string, page = 1) => request("/agent/cities" + query({ search, page })),
        searchTrips: (from: string, to: string, journeyDate: string, page = 1) => request("/agent/trips" + query({ from, to, journeyDate, page })),
        seats: (tripId: string) => request(`/agent/trips/${safeId(tripId)}/seats`),
        hold: (tripId: string, seats: string[]) => request(`/agent/trips/${safeId(tripId)}/holds`, "POST", { seats }),
        releaseHold: (tripId: string, holdId: string) => request(`/agent/trips/${safeId(tripId)}/holds/${encodeURIComponent(holdId)}`, "DELETE"),
        quote: (tripId: string, seats: string[], holdId?: string, promoCode?: string) => request(`/agent/trips/${safeId(tripId)}/quote`, "POST", {
            seats,
            holdId,
            promoCode
        }),
        createBooking: (input: BookingInput, idempotencyKey: string) => {
            if (idempotencyKey.length < 16 || idempotencyKey.length > 100)
                throw new Error("Retain a 16–100 character idempotency key for this booking attempt");
            return request("/agent/bookings", "POST", input, {
                "Idempotency-Key": idempotencyKey
            });
        },
        bookings: (filters: {
            page?: number;
            limit?: number;
            search?: string;
            status?: string;
            paymentStatus?: string;
            from?: string;
            to?: string;
        } = {}) => request("/agent/bookings" + query(filters)),
        booking: (id: string) => request(`/agent/bookings/${safeId(id)}`),
        startPayment: (id: string) => request(`/agent/bookings/${safeId(id)}/payment`, "POST"),
        verifyPayment: (id: string, proof: {
            razorpay_order_id: string;
            razorpay_payment_id: string;
            razorpay_signature: string;
        }) => request(`/agent/bookings/${safeId(id)}/payment/verify`, "POST", proof),
        reconcilePayment: (id: string) => request(`/agent/bookings/${safeId(id)}/payment/reconcile`, "POST"),
        ticket: (id: string) => request(`/agent/bookings/${safeId(id)}/ticket`),
        cancellationPolicy: (tripId: string) => request(`/agent/trips/${safeId(tripId)}/cancellation-policy`),
        requestCancellation: (id: string, reason: string) => request(`/agent/bookings/${safeId(id)}/cancellation`, "POST", { reason }),
        cancellationStatus: (id: string) => request(`/agent/bookings/${safeId(id)}/cancellation`),
        commissions: (from?: string, to?: string) => request("/agent/commissions" + query({ from, to })),
        settlementDetail: (id: string) => request(`/agent/finance/settlements/${safeId(id)}`),
        financeReport: (name: string, period: { from: string; to: string }) => request(`/agent/finance/reports/${encodeURIComponent(name)}?${new URLSearchParams(period)}`),
        cancellationQuote: (id: string, seats?: string[]) => request(`/agent/bookings/${safeId(id)}/cancellation-quote`, "POST", { seats }),
        refundStatus: (id: string) => request(`/agent/bookings/${safeId(id)}/refund-status`),
        settlements: () => request("/agent/settlements"),
        wallet: () => request("/agent/wallet"),
        walletHistory: (page = 1, limit = 25) => request("/agent/wallet/transactions" + query({ page, limit })),
        fundingStatus: (id: string) => request(`/agent/wallet/funding/${safeId(id)}`),
        requestFunding: (amountPaise: number, purpose: "Wallet" | "Credit repayment", idempotencyKey: string) => request("/agent/wallet/funding", "POST", { amountPaise, purpose }, { "Idempotency-Key": idempotencyKey }),
        creditHistory: (page = 1) => request("/agent/wallet/credit/history" + query({ page })),
        reserveBookingFunds: (bookingId: string, mode: "wallet" | "credit", idempotencyKey: string) => request("/agent/wallet/reservations", "POST", { bookingId: safeId(bookingId), mode }, { "Idempotency-Key": idempotencyKey }),
        fundingReservation: (id: string) => request(`/agent/wallet/reservations/${safeId(id)}`),
        confirmFundedBooking: (id: string) => request(`/agent/wallet/reservations/${safeId(id)}/confirm`, "POST", {}),
        releaseFundingReservation: (id: string) => request(`/agent/wallet/reservations/${safeId(id)}`, "DELETE")
    };
}
