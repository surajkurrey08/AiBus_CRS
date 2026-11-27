const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const object = (
  properties: Record<string, any>,
  required = Object.keys(properties),
) => ({ type: "object", additionalProperties: false, properties, required });
const string = { type: "string" },
  integer = { type: "integer", minimum: 0 },
  timestamp = { type: "string", format: "date-time" },
  identifier = { type: "string", pattern: "^[a-z]+_[A-Za-z0-9_-]{16,100}$" },
  money = {
    type: "integer",
    minimum: 0,
    description: "Integer INR paise, never floating-point rupees",
  };
const response = (schema: any) => ({
  description: "Authoritative response; X-Request-ID correlates sanitized logs",
  headers: { "X-Request-ID": { schema: string } },
  content: {
    "application/json": {
      schema: {
        type: "object",
        required: ["data"],
        properties: {
          data: schema,
          success: { type: "boolean", description: "City list compatibility flag; present on GET /cities." },
          meta: {
            type: "object",
            description: "List paging: page, limit, total",
          },
        },
      },
    },
  },
});
const errorResponses = Object.fromEntries(
  [400, 401, 402, 403, 404, 409, 410, 413, 429, 501, 502, 503].map((code) => [
    String(code),
    {
      description:
        "See error.code; never infer payment or booking success after a timeout",
      content: { "application/json": { schema: ref("Error") } },
    },
  ]),
);
const pathId = { name: "id", in: "path", required: true, schema: identifier },
  idem = {
    name: "Idempotency-Key",
    in: "header",
    required: true,
    schema: {
      type: "string",
      minLength: 16,
      maxLength: 100,
      pattern: "^[A-Za-z0-9_.:-]+$",
    },
  },
  pages = [
    {
      name: "page",
      in: "query",
      schema: { type: "integer", minimum: 1, maximum: 10000, default: 1 },
    },
    {
      name: "limit",
      in: "query",
      schema: { type: "integer", minimum: 1, maximum: 100, default: 25 },
    },
  ];
function operation(
  operationId: string,
  description: string,
  scope: string,
  schema: any,
  options: {
    body?: any;
    parameters?: any[];
    status?: number;
    unavailable?: boolean;
  } = {},
) {
  return {
    operationId,
    summary: description,
    description: `Required scope: ${scope || "Authenticated partner"}. Isolated non-production integration-test environment only. Production funding/ticket issuance disabled. ${options.unavailable ? "UNAVAILABLE: no approved business contract." : ""}`,
    security: [{ PartnerToken: [] }],
    parameters: options.parameters || [],
    ...(options.body
      ? {
          requestBody: {
            required: true,
            content: { "application/json": { schema: options.body } },
          },
        }
      : {}),
    responses: {
      ...errorResponses,
      ...(options.unavailable
        ? {}
        : { [options.status || 200]: response(schema) }),
    },
  };
}
export const publicApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "AIBUS Public Booking API",
    version: "1.0.0-test",
    description:
      "Outward-facing AIBUS integration-test API. Uses CRS inventory, pricing, booking, cancellation and refund workflows in a dedicated non-production database. Payments and refunds use Razorpay Test Mode only; no real money or production tickets are issued. Partner access requires explicit inventory grants. Holds last at most 5 minutes; quotes at most 2 minutes and never beyond the hold. Idempotency keys are partner-global and content-bound. A cancellation request requires operator review; test refunds are handled by the existing refund worker. Rescheduling and partner wallets return 501.",
  },
  servers: [
    {
      url: "/api/v1/public",
      description: "This host's isolated sandbox API",
    },
  ],
  paths: {
    "/auth/token": {
      post: {
        ...operation(
          "authenticate",
          "1. Exchange sandbox credential for a short-lived scoped token",
          "",
          ref("Token"),
          { body: object({}) },
        ),
        security: [{ PartnerCredential: [] }],
      },
    },
    "/capabilities": {
      get: operation(
        "capabilities",
        "Inspect supported and unavailable capabilities",
        "",
        object({
          version: { enum: ["1"] },
          environment: { enum: ["sandbox"] },
          inventory: { type: "boolean" },
          holds: { type: "boolean" },
          funding: string,
          paymentMode: { enum: ["razorpay_test", "unavailable"] },
          livePayments: { enum: [false] },
          liveRefunds: { enum: [false] },
          testRefunds: { type: "boolean" },
          liveTicketIssuance: { enum: [false] },
          productionCredentials: { enum: [false] },
          reschedule: { type: "boolean" },
          partnerWallet: { type: "boolean" },
          cancellation: string,
          webhooks: string,
        }),
      ),
    },
    "/cities": {
      get: operation(
        "cities",
        "2. Authorized source and destination cities",
        "inventory:read",
        { type: "array", items: ref("City") },
        { parameters: pages },
      ),
    },
    "/trips": {
      get: operation(
        "trips",
        "3. Authorized dated trip search",
        "inventory:read",
        { type: "array", items: ref("Trip") },
        {
          parameters: [
            ...pages,
            ...["from", "to"].map((name) => ({
              name,
              in: "query",
              required: true,
              schema: identifier,
            })),
            {
              name: "journeyDate",
              in: "query",
              required: true,
              schema: { type: "string", format: "date" },
            },
          ],
        },
      ),
    },
    "/trips/{id}": {
      get: operation(
        "tripDetails",
        "4. Bus, operator, timing and route details",
        "inventory:read",
        ref("Trip"),
        { parameters: [pathId] },
      ),
    },
    "/trips/{id}/seats": {
      get: operation(
        "seatLayout",
        "5. Current seat layout and base fares",
        "inventory:read",
        object({
          tripId: identifier,
          seats: { type: "array", items: ref("Seat") },
          currency: { enum: ["INR"] },
        }),
        { parameters: [pathId] },
      ),
    },
    "/trips/{id}/stops": {
      get: operation(
        "stops",
        "6. Configured boarding and dropping points",
        "inventory:read",
        object({
          boarding: { type: "array", items: ref("Stop") },
          dropping: { type: "array", items: ref("Stop") },
          timeZone: { enum: ["Asia/Kolkata"] },
        }),
        { parameters: [pathId] },
      ),
    },
    "/trips/{id}/quotes": {
      post: operation(
        "fareRecheck",
        "7. Server-authoritative quote; repeat with holdId before booking",
        "inventory:read",
        ref("Quote"),
        {
          parameters: [pathId],
          body: object({ seats: ref("Seats"), holdId: identifier }, ["seats"]),
        },
      ),
    },
    "/trips/{id}/cancellation-policy": {
      get: operation(
        "cancellationPolicy",
        "8. Operator policy and conditional eligibility",
        "inventory:read",
        {
          type: "object",
          properties: {
            configured: { type: "boolean" },
            version: { ...integer, nullable: true },
            rules: {
              type: "array",
              items: object({
                hoursBefore: integer,
                refundPercent: { type: "number", minimum: 0, maximum: 100 },
              }),
            },
            partialSupported: { enum: [false] },
          },
        },
        { parameters: [pathId] },
      ),
    },
    "/trips/{id}/holds": {
      post: operation(
        "seatHold",
        "9. Idempotent central inventory hold",
        "holds:write",
        object({
          id: identifier,
          tripId: identifier,
          seats: ref("Seats"),
          expiresAt: timestamp,
          baseFarePaise: money,
          currency: { enum: ["INR"] },
          environment: { enum: ["sandbox"] },
        }),
        {
          parameters: [pathId, idem],
          body: object({ seats: ref("Seats") }),
          status: 201,
        },
      ),
    },
    "/bookings": {
      post: operation(
        "pendingBooking",
        "10a. Create an idempotent pending booking, without claiming payment",
        "bookings:write",
        ref("Booking"),
        {
          parameters: [idem],
          status: 201,
          body: object(
            {
              tripId: identifier,
              holdId: identifier,
              quoteId: identifier,
              partnerReference: {
                type: "string",
                minLength: 1,
                maxLength: 80,
                pattern: "^[A-Za-z0-9_.:-]+$",
              },
              passengers: {
                type: "array",
                minItems: 1,
                maxItems: 6,
                items: ref("Passenger"),
              },
              contact: object(
                { phone: string, email: { type: "string", format: "email" } },
                [],
              ),
            },
            ["tripId", "holdId", "quoteId", "partnerReference", "passengers"],
          ),
        },
      ),
    },
    "/bookings/{id}/payment": {
      post: operation(
        "startTestPayment",
        "10b. Create or reuse an authoritative Razorpay Test Mode order",
        "bookings:write",
        object({
          provider: { enum: ["razorpay"] },
          mode: { enum: ["test"] },
          keyId: string,
          orderId: string,
          amountPaise: money,
          currency: { enum: ["INR"] },
          reference: string,
          expiresAt: timestamp,
        }),
        {
          parameters: [pathId, idem],
          body: object({}),
        },
      ),
    },
    "/bookings/{id}/payment/verify": {
      post: operation(
        "verifyTestPayment",
        "10c. Verify Razorpay signature and provider payment before confirming",
        "bookings:write",
        ref("Booking"),
        {
          parameters: [pathId, idem],
          body: object({
            razorpay_order_id: {
              type: "string",
              pattern: "^order_[A-Za-z0-9]+$",
            },
            razorpay_payment_id: {
              type: "string",
              pattern: "^pay_[A-Za-z0-9]+$",
            },
            razorpay_signature: {
              type: "string",
              pattern: "^[a-fA-F0-9]{64}$",
            },
          }),
        },
      ),
    },
    "/bookings/{id}/payment/reconcile": {
      post: operation(
        "reconcileTestPayment",
        "10d. Recover authoritative payment state after a lost response",
        "bookings:write",
        ref("Booking"),
        {
          parameters: [pathId, idem],
          body: object({}),
        },
      ),
    },
    "/bookings/{id}": {
      get: operation(
        "bookingStatus",
        "11. Own partner booking status",
        "bookings:read",
        ref("Booking"),
        { parameters: [pathId] },
      ),
    },
    "/bookings/{id}/ticket": {
      get: operation(
        "ticket",
        "12. Own ticket and PNR; names and seats only",
        "tickets:read",
        object({
          bookingId: identifier,
          pnr: string,
          status: { enum: ["valid", "cancelled"] },
          issuedAt: timestamp,
          passengers: {
            type: "array",
            items: object(
              {
                name: string,
                seat: string,
                boarding: string,
                dropping: string,
              },
              ["name", "seat"],
            ),
          },
          environment: { enum: ["sandbox"] },
        }),
        { parameters: [pathId] },
      ),
    },
    "/bookings/{id}/cancellations": {
      post: operation(
        "requestCancellation",
        "13. Request policy-validated full-booking cancellation",
        "cancellations:write",
        ref("Booking"),
        {
          parameters: [pathId, idem],
          body: object({
            quoteId: identifier,
            reason: { type: "string", minLength: 5, maxLength: 200 },
          }),
        },
      ),
    },
    "/bookings/{id}/cancellation-quotes": {
      post: operation(
        "cancellationCharges",
        "14. Accounting-policy-dependent cancellation quote",
        "cancellations:write",
        object({
          id: identifier,
          expiresAt: timestamp,
          refundPaise: money,
          retainedPaise: money,
          currency: { enum: ["INR"] },
          partialSupported: { enum: [false] },
        }),
        { parameters: [pathId], body: object({}) },
      ),
    },
    "/bookings/{id}/refund": {
      get: operation(
        "refundStatus",
        "15. Existing operator-reviewed test refund lifecycle; status only",
        "refunds:read",
        {
          type: "object",
          properties: {
            bookingStatus: ref("BookingStatus"),
            paymentStatus: ref("PaymentStatus"),
            refund: { type: "object", nullable: true },
            intents: {
              type: "array",
              items: object({
                status: {
                  enum: [
                    "Ready",
                    "Submitting",
                    "Pending",
                    "Processed",
                    "Failed",
                    "Uncertain",
                    "Manual review",
                  ],
                },
                amountPaise: money,
                processedAt: { ...timestamp, nullable: true },
              }),
            },
            liveRefunds: { enum: [false] },
            testRefunds: {
              type: "boolean",
              description:
                "Test-provider refunds are processed only after operator review and only when isolated test finance mode is enabled.",
            },
            partialSupported: { enum: [false] },
          },
        },
        { parameters: [pathId] },
      ),
    },
    "/reschedule": {
      post: operation(
        "rescheduleUnavailable",
        "16. Rescheduling unavailable",
        "",
        ref("Error"),
        { status: 501, unavailable: true },
      ),
    },
    "/wallet": {
      get: operation(
        "walletUnavailable",
        "17. Partner wallet unavailable; never an agency wallet",
        "",
        ref("Error"),
        { status: 501, unavailable: true },
      ),
    },
    "/webhook-deliveries": {
      get: operation(
        "webhookDeliveries",
        "18. Signed sandbox notification delivery history",
        "webhooks:read",
        {
          type: "array",
          items: object(
            {
              status: {
                enum: ["Pending", "Delivering", "Delivered", "Manual review"],
              },
              attempts: integer,
              lastCode: string,
              createdAt: timestamp,
              updatedAt: timestamp,
            },
            ["status", "attempts"],
          ),
        },
        { parameters: pages },
      ),
    },
  },
  components: {
    securitySchemes: {
      PartnerCredential: {
        type: "apiKey",
        in: "header",
        name: "Authorization",
        description:
          "Bearer ap_sandbox_cred_<opaque-id>.<secret>. Backend server only; exchange at /auth/token. Secret hashes stored, raw secret returned only through trusted CLI provisioning.",
      },
      PartnerToken: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description:
          "45-minute token. Credential revocation, expiry, rotation and current partner scopes checked on every request.",
      },
    },
    schemas: {
      Error: object({
        error: object({ code: string, message: string, requestId: string }),
      }),
      Token: object({
        accessToken: string,
        tokenType: { enum: ["Bearer"] },
        expiresIn: { enum: [2700] },
        environment: { enum: ["sandbox"] },
        scopes: { type: "array", items: string },
      }),
      City: object({ id: identifier, name: string, CityId: identifier, City: string, CityKey: { type: "string", nullable: true }, State: { type: "string", nullable: true }, CatalogCityId: { type: "string", nullable: true } }, ["id", "name"]),
      Seats: {
        type: "array",
        minItems: 1,
        maxItems: 6,
        uniqueItems: true,
        items: { type: "string", minLength: 1, maxLength: 12 },
      },
      Seat: object({
        number: string,
        deck: { enum: ["lower", "upper"] },
        row: integer,
        column: integer,
        category: { enum: ["seater", "sleeper"] },
        baseFarePaise: money,
        state: { enum: ["available", "held", "booked", "blocked", "quota"] },
        ownedHold: { type: "boolean" },
      }),
      Stop: object({
        name: string,
        time: { ...string, nullable: true },
        address: { ...string, nullable: true },
      }),
      Passenger: object(
        {
          name: { type: "string", minLength: 1, maxLength: 100 },
          seat: { type: "string", minLength: 1, maxLength: 12 },
          age: { type: "integer", minimum: 0, maximum: 120 },
          gender: { enum: ["female", "male", "other", "unspecified"] },
          phone: string,
          email: { type: "string", format: "email" },
          boarding: string,
          dropping: string,
        },
        ["name", "seat"],
      ),
      Trip: object({
        id: identifier,
        operator: string,
        bus: object({
          type: string,
          amenities: { type: "array", items: string },
        }),
        route: object({ id: identifier, from: ref("City"), to: ref("City") }),
        journeyDate: { type: "string", format: "date" },
        departureAt: timestamp,
        arrivalAt: { ...timestamp, nullable: true },
        availableSeats: integer,
        seatCount: integer,
        currency: { enum: ["INR"] },
        environment: { enum: ["sandbox"] },
      }),
      Quote: object({
        id: identifier,
        holdId: { ...identifier, nullable: true },
        expiresAt: timestamp,
        seatFares: {
          type: "array",
          items: object({ number: string, basePaise: money }),
        },
        grossPaise: money,
        discountPaise: money,
        taxPaise: money,
        chargePaise: money,
        totalPaise: money,
        currency: { enum: ["INR"] },
        requirements: object({
          age: { type: "boolean" },
          gender: { type: "boolean" },
          mobile: { type: "boolean" },
          gstEnabled: { type: "boolean" },
        }),
        binding: string,
      }),
      BookingStatus: {
        enum: [
          "Pending payment",
          "Confirmed",
          "Failed",
          "Cancelled",
          "Reconciliation required",
        ],
      },
      PaymentStatus: {
        enum: ["Pending", "Paid", "Failed", "Refund pending", "Refunded"],
      },
      Booking: object({
        id: identifier,
        partnerReference: string,
        status: ref("BookingStatus"),
        paymentStatus: ref("PaymentStatus"),
        pnr: { ...string, nullable: true },
        seats: ref("Seats"),
        totalPaise: money,
        currency: { enum: ["INR"] },
        paymentMode: {
          type: "string",
          enum: ["razorpay_test"],
          nullable: true,
        },
        cancellationStatus: string,
        environment: { enum: ["sandbox"] },
      }),
      Webhook: object({
        id: identifier,
        type: { enum: ["booking.status"] },
        environment: { enum: ["sandbox"] },
        bookingId: identifier,
        status: ref("BookingStatus"),
        paymentStatus: ref("PaymentStatus"),
        cancellationStatus: string,
        occurredAt: timestamp,
      }),
    },
  },
};
