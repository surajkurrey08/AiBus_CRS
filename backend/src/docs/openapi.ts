const responses = {
  "200": {
    description: "Successful response",
    content: {
      "application/json": { schema: { $ref: "#/components/schemas/Envelope" } },
    },
  },
  "400": { description: "Invalid input" },
  "401": { description: "Missing, expired or revoked session" },
  "403": { description: "Insufficient permission or suspended operator" },
  "404": { description: "Record absent in the authenticated tenant" },
  "409": { description: "State, duplicate or idempotency conflict" },
  "429": { description: "Shared rate limit exceeded" },
  "503": { description: "Required provider or infrastructure unavailable" },
};
const body = (schema: unknown) => ({
  required: true,
  content: { "application/json": { schema } },
});
const object = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", additionalProperties: false, properties, required });
const str = { type: "string" },
  oid = { type: "string", pattern: "^[a-f0-9]{24}$" },
  paise = { type: "integer", minimum: 0 };
const paths: Record<string, any> = {};
function add(
  path: string,
  method: string,
  summary: string,
  options: Record<string, unknown> = {},
) {
  paths[path] ??= {};
  const ids = [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({
    in: "path",
    name: m[1],
    required: true,
    schema: oid,
  }));
  paths[path][method] = {
    summary,
    tags: [
      path.includes("/auth/")
        ? "Authentication"
        : path.includes("/platform/")
          ? "Platform"
          : "Operator",
    ],
    security: [{ bearerAuth: [] }],
    responses,
    ...(ids.length ? { parameters: ids } : {}),
    ...options,
  };
}
const resources = [
  "buses",
  "routes",
  "schedules",
  "trips",
  "bookings",
  "fares",
  "offers",
  "cancellations",
  "refunds",
  "settlements",
  "staff",
  "notifications",
  "audit-logs",
];
for (const resource of ["accounts", "journals"])
  add(
    `/api/v1/finance/${resource}`,
    "get",
    `Read authorized ledger ${resource}; no wallet or settlement access`,
    {
      tags: ["Finance"],
      parameters: [
        {
          in: "query",
          name: "page",
          schema: { type: "integer", minimum: 1, maximum: 100000, default: 1 },
        },
        {
          in: "query",
          name: "limit",
          schema: { type: "integer", minimum: 1, maximum: 100, default: 25 },
        },
      ],
      description:
        "Server-derived operator/agency scope. Super Admin requires explicit platform:finance:read. Agent journals expose only the agency's own lines. Historical payments are not backfilled. Other query fields are rejected.",
    },
  );
add(
  "/api/v1/finance/journals/{id}",
  "get",
  "Read an authorized posted journal",
  { tags: ["Finance"] },
);
for (const resource of resources)
  add(`/api/v1/operator/${resource}`, "get", `List tenant-owned ${resource}`, {
    parameters: [
      {
        in: "query",
        name: "page",
        schema: { type: "integer", default: 1, minimum: 1 },
      },
      {
        in: "query",
        name: "limit",
        schema: { type: "integer", minimum: 1, maximum: 100, default: 25 },
      },
      { in: "query", name: "search", schema: str },
      { in: "query", name: "status", schema: str },
      {
        in: "query",
        name: "journeyDate",
        schema: { type: "string", format: "date" },
      },
    ],
  });
const bus = object(
  {
    registration: str,
    name: str,
    type: {
      type: "string",
      enum: [
        "AC Sleeper",
        "Non-AC Sleeper",
        "AC Seater",
        "Non-AC Seater",
        "Semi Sleeper",
        "Mixed Seater/Sleeper",
      ],
    },
    capacity: { type: "integer", minimum: 1, maximum: 100 },
    status: { type: "string", enum: ["Active", "Inactive"] },
  },
  ["registration", "name", "type", "capacity"],
);
const stop = object({ name: str, time: str, address: str }, ["name"]);
const route = object(
  {
    source: str,
    destination: str,
    boarding: { type: "array", items: stop },
    dropping: { type: "array", items: stop },
    departure: str,
    arrival: str,
    durationMinutes: { type: "integer", minimum: 1 },
    distanceKm: { type: "number" },
    status: { type: "string", enum: ["Active", "Inactive"] },
  },
  [
    "source",
    "destination",
    "boarding",
    "dropping",
    "departure",
    "arrival",
    "durationMinutes",
  ],
);
const schemas: Record<string, any> = {
  buses: bus,
  routes: route,
  schedules: object(
    {
      routeId: oid,
      busId: oid,
      daysOfWeek: {
        type: "array",
        items: { type: "integer", minimum: 0, maximum: 6 },
      },
      specialDates: {
        type: "array",
        items: { type: "string", format: "date" },
      },
      startDate: str,
      endDate: str,
      status: str,
    },
    ["routeId", "busId", "startDate", "endDate"],
  ),
  trips: object(
    {
      routeId: oid,
      busId: oid,
      scheduleId: oid,
      crewIds: { type: "array", items: oid, maxItems: 10, uniqueItems: true },
      journeyDate: { type: "string", format: "date" },
      departureAt: { type: "string", format: "date-time" },
      arrivalAt: { type: "string", format: "date-time" },
      seatSideFares: object(
        {
          doublePaise: { ...paise, minimum: 1 },
          singlePaise: { ...paise, minimum: 1 },
        },
        ["doublePaise", "singlePaise"],
      ),
    },
    ["routeId", "busId", "journeyDate", "departureAt"],
  ),
  fares: object(
    {
      routeId: oid,
      basePaise: paise,
      weekendPaise: paise,
      singlePaise: paise,
      singleWeekendPaise: paise,
      specialDates: {
        type: "array",
        items: object({ date: str, amountPaise: paise }),
      },
      seatFares: {
        type: "array",
        items: object({ number: str, amountPaise: paise }),
      },
    },
    ["routeId", "basePaise"],
  ),
  offers: object(
    {
      code: str,
      name: str,
      percent: { type: "integer", minimum: 1, maximum: 100 },
      routeIds: { type: "array", items: oid },
      startDate: str,
      endDate: str,
      status: str,
    },
    ["code", "name", "percent", "startDate", "endDate"],
  ),
  staff: object({
    name: str,
    email: { type: "string", format: "email" },
    password: { type: "string", minLength: 12 },
    role: { type: "string", enum: ["manager", "booking_staff", "read_only"] },
  }),
};
for (const resource of [
  "buses",
  "routes",
  "schedules",
  "trips",
  "fares",
  "offers",
  "staff",
])
  add(`/api/v1/operator/${resource}`, "post", `Create ${resource}`, {
    requestBody: body(schemas[resource]),
    responses: { ...responses, "201": { description: "Created" } },
  });
for (const resource of [
  "buses",
  "routes",
  "schedules",
  "fares",
  "offers",
  "staff",
]) {
  add(`/api/v1/operator/${resource}/{id}`, "patch", `Update ${resource}`, {
    requestBody: body(
      resource === "fares"
        ? schemas.fares
        : { ...schemas[resource], required: [] },
    ),
  });
  if (["buses", "routes", "schedules"].includes(resource))
    add(`/api/v1/operator/${resource}/{id}`, "get", `Get ${resource}`);
}
add(
  "/api/v1/operator/bookings",
  "post",
  "Create pending booking from a valid owned hold; no PNR until confirmation",
  {
    parameters: [
      {
        in: "header",
        name: "Idempotency-Key",
        required: true,
        schema: { type: "string", minLength: 16, maxLength: 100 },
      },
    ],
    requestBody: body(
      object({
        tripId: oid,
        holdId: { type: "string", format: "uuid" },
        passengers: {
          type: "array",
          minItems: 1,
          maxItems: 6,
          items: object({ name: str, phone: str, seat: str, boarding: str }, [
            "name",
            "seat",
          ]),
        },
      }),
    ),
  },
);
for (const path of ["seats", "manifest"])
  add(`/api/v1/operator/trips/{id}/${path}`, "get", `Fetch trip ${path}`);
for (const path of ["holds", "block", "unblock"])
  add(
    `/api/v1/operator/trips/{id}/${path}`,
    "post",
    `${path} selected seats atomically`,
    {
      requestBody: body(
        object({
          seats: {
            type: "array",
            minItems: 1,
            maxItems: 6,
            uniqueItems: true,
            items: str,
          },
        }),
      ),
    },
  );
add(
  "/api/v1/operator/trips/{id}/holds/{holdId}",
  "delete",
  "Release the authenticated user’s hold",
);
add("/api/v1/operator/trips/{id}/cancel", "post", "Cancel empty future trip");
for (const suffix of ["", "/ticket"])
  add(
    `/api/v1/operator/bookings/{id}${suffix}`,
    "get",
    suffix ? "Retrieve authoritative confirmed e-ticket" : "Retrieve booking",
  );
add(
  "/api/v1/operator/bookings/{id}/check-in",
  "patch",
  "Update passenger check-in",
  { requestBody: body(object({ seat: str, checkedIn: { type: "boolean" } })) },
);
add(
  "/api/v1/operator/bookings/{id}/cancellation",
  "post",
  "Request cancellation using recorded operator policy",
  { requestBody: body(object({ reason: str })) },
);
add(
  "/api/v1/operator/bookings/{id}/payment",
  "post",
  "Create or reuse a server-priced Razorpay Test Mode order for an active pending booking",
);
add(
  "/api/v1/operator/bookings/{id}/payment/verify",
  "post",
  "Verify Checkout HMAC and authoritative captured payment before confirming seats",
  {
    requestBody: body(
      object({
        razorpay_order_id: str,
        razorpay_payment_id: str,
        razorpay_signature: str,
      }),
    ),
  },
);
add(
  "/api/v1/operator/bookings/{id}/payment/reconcile",
  "post",
  "Fetch Razorpay payment status for the stored order; reconcile a missed callback",
);
add(
  "/api/v1/webhooks/razorpay",
  "post",
  "Raw-body HMAC-verified Razorpay payment.captured callback",
  {
    security: [],
    parameters: [
      {
        in: "header",
        name: "x-razorpay-signature",
        required: true,
        schema: str,
      },
    ],
    requestBody: body({ type: "object" }),
  },
);
add(
  "/api/v1/operator/refunds/{id}/process",
  "post",
  "Unavailable until reservation cancellation and payment refund adapters exist",
);
for (const name of [
  "dashboard",
  "reports/revenue",
  "reports/occupancy",
  "reports/route-performance",
  "reports/bus-performance",
  "reports/cancellations",
  "reports/revenue.csv",
])
  add(`/api/v1/operator/${name}`, "get", `Retrieve ${name}`, {
    parameters: [
      { in: "query", name: "from", schema: { type: "string", format: "date" } },
      { in: "query", name: "to", schema: { type: "string", format: "date" } },
    ],
  });
for (const name of [
  "profile",
  "preferences",
  "integrations",
  "cancellation-policy",
])
  add(`/api/v1/operator/${name}`, "get", `Read ${name}`);
add("/api/v1/operator/profile", "patch", "Update company profile", {
  requestBody: body(
    object({ company: str, email: str, phone: str, address: str }),
  ),
});
add(
  "/api/v1/operator/preferences",
  "patch",
  "Update current user notification preferences",
  {
    requestBody: body({
      type: "object",
      additionalProperties: { type: "boolean" },
    }),
  },
);
add(
  "/api/v1/operator/cancellation-policy",
  "put",
  "Configure operator cancellation policy",
  {
    requestBody: body(
      object({
        rules: {
          type: "array",
          items: object({
            hoursBefore: { type: "number" },
            refundPercent: { type: "number", minimum: 0, maximum: 100 },
          }),
        },
      }),
    ),
  },
);
add(
  "/api/v1/operator/buses/{id}/layout",
  "get",
  "Read configured data-driven bus layout",
);
add(
  "/api/v1/operator/buses/{id}/layout",
  "put",
  "Set layout; capacity and unique positions validated",
  {
    requestBody: body(
      object({
        name: str,
        seats: {
          type: "array",
          items: object({
            number: str,
            deck: { type: "string", enum: ["lower", "upper"] },
            row: { type: "integer" },
            column: { type: "integer" },
            category: { type: "string", enum: ["sleeper", "seater"] },
            farePaise: paise,
          }),
        },
      }),
    ),
  },
);
add("/api/v1/operator/buses/{id}/images", "post", "Upload private bus image", {
  requestBody: {
    required: true,
    content: {
      "multipart/form-data": {
        schema: object({ image: { type: "string", format: "binary" } }),
      },
    },
  },
});
add(
  "/api/v1/operator/buses/{id}/images/{image}",
  "get",
  "Retrieve tenant-authorized image",
);
add("/api/v1/operator/fares/{id}/history", "get", "Read audited price changes");
add(
  "/api/v1/operator/notifications/{id}/read",
  "patch",
  "Mark notification read",
);
add("/api/v1/auth/register", "post", "Register operator pending approval", {
  security: [],
  requestBody: body(
    object({
      company: str,
      name: str,
      email: str,
      password: { type: "string", minLength: 12 },
      phone: str,
      address: str,
    }),
  ),
});
add(
  "/api/v1/auth/login",
  "post",
  "Login; HttpOnly rotating refresh cookie and memory access token",
  { security: [], requestBody: body(object({ email: str, password: str })) },
);
for (const name of ["refresh", "logout"])
  add(`/api/v1/auth/${name}`, "post", `${name} HttpOnly cookie session`, {
    security: [{ refreshCookie: [] }],
  });
add(
  "/api/v1/auth/forgot-password",
  "post",
  "Email a single-use password reset",
  { security: [], requestBody: body(object({ email: str })) },
);
add(
  "/api/v1/auth/reset-password",
  "post",
  "Reset password and revoke sessions",
  {
    security: [],
    requestBody: body(
      object({ token: str, password: { type: "string", minLength: 12 } }),
    ),
  },
);
add("/api/v1/auth/me", "get", "Read current authenticated identity");
add("/api/v1/platform/operators", "get", "Super-admin-only registration queue");
add("/api/v1/platform/overview", "get", "Platform operator and fleet counts");
add(
  "/api/v1/platform/operators/{id}",
  "get",
  "Company details and fleet counts for platform administrators",
);
add(
  "/api/v1/platform/operators/{id}/status",
  "patch",
  "Super-admin approval/suspension",
  {
    requestBody: body(
      object(
        {
          status: {
            type: "string",
            enum: ["pending", "approved", "suspended", "rejected"],
          },
          salesBlocked: { type: "boolean" },
          version: { type: "integer", minimum: 0 },
          reason: { type: "string", minLength: 5, maxLength: 240 },
          password: { type: "string", writeOnly: true, maxLength: 128 },
        },
        ["version", "reason", "password"],
      ),
    ),
  },
);
const counterPassenger = object(
  {
    name: str,
    seat: str,
    phone: str,
    email: { type: "string", format: "email" },
    age: { type: "integer", minimum: 0, maximum: 120 },
    gender: {
      type: "string",
      enum: ["female", "male", "other", "unspecified"],
    },
    boarding: str,
    dropping: str,
  },
  ["name", "seat"],
);
const counterContact = object(
  { phone: str, email: { type: "string", format: "email" } },
  ["phone"],
);
const quoteOptions = {
  seats: {
    type: "array",
    items: str,
    minItems: 1,
    maxItems: 6,
    uniqueItems: true,
  },
  holdId: { type: "string", format: "uuid" },
  promoCode: str,
  operatorDiscountPaise: paise,
};
add(
  "/api/v1/operator/counter/trips",
  "get",
  "Search authorized trips with bus details and authoritative availability",
  {
    parameters: [
      { in: "query", name: "from", schema: str },
      { in: "query", name: "to", schema: str },
      {
        in: "query",
        name: "journeyDate",
        required: true,
        schema: { type: "string", format: "date" },
      },
      { in: "query", name: "page", schema: { type: "integer", minimum: 1 } },
      {
        in: "query",
        name: "limit",
        schema: { type: "integer", minimum: 1, maximum: 50 },
      },
    ],
  },
);
add(
  "/api/v1/operator/counter/trips/{id}/bookings",
  "get",
  "Paginated trip bookings and source-wise counts; personal information is permission restricted",
  {
    parameters: [
      { in: "path", name: "id", required: true, schema: oid },
      {
        in: "query",
        name: "source",
        schema: {
          type: "string",
          enum: ["operator", "customer", "agent", "external"],
        },
      },
      { in: "query", name: "page", schema: { type: "integer", minimum: 1 } },
      { in: "query", name: "limit", schema: { type: "integer", maximum: 50 } },
    ],
  },
);
add(
  "/api/v1/operator/pricing-policy",
  "get",
  "Read explicit operator tax, charge and passenger requirements",
);
add(
  "/api/v1/operator/pricing-policy",
  "put",
  "Versioned operator pricing policy; no default tax rate",
  {
    requestBody: body(
      object({
        taxBasisPoints: { type: "integer", minimum: 0, maximum: 10000 },
        chargePaise: paise,
        chargesTaxable: { type: "boolean" },
        operatorDiscountMaxPaise: paise,
        requireAge: { type: "boolean" },
        requireGender: { type: "boolean" },
        requireMobile: { type: "boolean" },
        gstEnabled: { type: "boolean" },
        expectedVersion: { type: "integer", minimum: 0 },
      }),
    ),
  },
);
add(
  "/api/v1/operator/trips/{id}/quote",
  "post",
  "Expiring server-calculated quote, optionally bound to an owned hold",
  { requestBody: body(object(quoteOptions, ["seats"])) },
);
add(
  "/api/v1/operator/trips/{id}/booking-status",
  "patch",
  "Stop/resume new holds and bookings without cancelling existing tickets",
  {
    requestBody: body(
      object({
        open: { type: "boolean" },
        expectedVersion: { type: "integer", minimum: 0 },
      }),
    ),
  },
);
add(
  "/api/v1/operator/trips/{id}/quota",
  "post",
  "Atomically allocate or release named quota seats",
  {
    requestBody: body(
      object(
        {
          seats: quoteOptions.seats,
          action: { type: "string", enum: ["assign", "release"] },
          label: str,
        },
        ["seats", "action"],
      ),
    ),
  },
);
add(
  "/api/v1/operator/bookings/{id}/passengers",
  "patch",
  "Modify passenger/contact details with optimistic version protection; seats/money cannot change",
  {
    requestBody: body(
      object(
        {
          passengers: {
            type: "array",
            items: counterPassenger,
            minItems: 1,
            maxItems: 6,
          },
          contact: counterContact,
          gst: object({ number: str, company: str, address: str }),
          expectedVersion: { type: "integer", minimum: 0 },
        },
        ["passengers", "expectedVersion"],
      ),
    ),
  },
);
add(
  "/api/v1/operator/bookings/{id}/cancel-pending",
  "post",
  "Idempotently cancel only an unpaid pending booking and release its matching seats",
  { requestBody: body(object({ reason: str })) },
);
add(
  "/api/v1/operator/bookings/{id}/payments",
  "get",
  "Finance-authorized recorded payment metadata",
);
add(
  "/api/v1/operator/bookings/{id}/ticket.html",
  "get",
  "Printable/downloadable HTML ticket, only for authoritative confirmed bookings",
  {
    responses: {
      ...responses,
      "200": {
        description: "Confirmed e-ticket",
        content: { "text/html": { schema: { type: "string" } } },
      },
    },
  },
);
paths["/api/v1/operator/bookings"].post.requestBody = body(
  object(
    {
      tripId: oid,
      holdId: { type: "string", format: "uuid" },
      quoteId: oid,
      passengers: {
        type: "array",
        items: counterPassenger,
        minItems: 1,
        maxItems: 6,
      },
      contact: counterContact,
      gst: object({ number: str, company: str, address: str }),
      promoCode: str,
      operatorDiscountPaise: paise,
    },
    ["tripId", "holdId", "passengers"],
  ),
);

const masterSchemas: Record<string, unknown> = {
  coaches: object(
    {
      name: str,
      type: str,
      arrangement: { type: "string", enum: ["2+1", "2+2"] },
      decks: { type: "integer", minimum: 1, maximum: 2 },
      amenities: { type: "array", items: str },
      status: str,
    },
    ["name", "type", "arrangement", "decks"],
  ),
  owners: object(
    { name: str, phone: str, email: str, address: str, status: str },
    ["name", "phone"],
  ),
  crew: object(
    {
      name: str,
      phone: str,
      role: { type: "string", enum: ["Driver", "Conductor", "Pickup staff"] },
      licenceNumber: str,
      licenceExpiry: { type: "string", format: "date" },
      pickupPoint: str,
      status: str,
    },
    ["name", "phone", "role"],
  ),
  charts: object(
    {
      name: str,
      status: str,
      seats: {
        type: "array",
        minItems: 1,
        maxItems: 100,
        items: object({
          number: str,
          deck: { type: "string", enum: ["lower", "upper"] },
          row: { type: "integer" },
          column: { type: "integer" },
          category: { type: "string", enum: ["seater", "sleeper"] },
          farePaise: paise,
        }),
      },
    },
    ["name", "seats"],
  ),
  documents: object(
    {
      busId: oid,
      kind: {
        type: "string",
        enum: [
          "Registration",
          "Insurance",
          "Permit",
          "Fitness",
          "PUC",
          "Service",
        ],
      },
      reference: str,
      issuedOn: { type: "string", format: "date" },
      expiresOn: { type: "string", format: "date" },
      notes: str,
    },
    ["busId", "kind", "reference"],
  ),
  gps: object({ busId: oid, provider: str, deviceId: str, status: str }, [
    "busId",
    "provider",
    "deviceId",
  ]),
};
for (const [resource, schema] of Object.entries(masterSchemas)) {
  const path = "/api/v1/operator/bus-master/" + resource;
  add(path, "get", "Search and paginate " + resource);
  add(path, "post", "Create " + resource, { requestBody: body(schema) });
  add(path + "/{id}", "get", "Read company-owned " + resource);
  add(path + "/{id}", "patch", "Save complete " + resource + " fields", {
    requestBody: body(schema),
  });
}
add(
  "/api/v1/operator/bus-master/buses/{id}/assignments",
  "patch",
  "Link bus owner and coach",
  {
    requestBody: body(
      object(
        {
          ownerId: { ...oid, nullable: true },
          coachTypeId: { ...oid, nullable: true },
        },
        [],
      ),
    ),
  },
);
add(
  "/api/v1/operator/bus-master/buses/{id}/chart",
  "post",
  "Apply a matching-capacity seat chart to future trips",
  { requestBody: body(object({ templateId: oid })) },
);
add(
  "/api/v1/operator/bus-master/gps/{id}/status",
  "get",
  "Read device mapping and provider telemetry availability",
);
add(
  "/api/v1/operator/bus-master/trips/{id}/crew",
  "patch",
  "Assign crew with overlap and licence checks",
  {
    requestBody: body(
      object({
        crewIds: { type: "array", items: oid, maxItems: 10, uniqueItems: true },
      }),
    ),
  },
);

const areaCoordinates = {
  latitude: { type: "number", minimum: -90, maximum: 90 },
  longitude: { type: "number", minimum: -180, maximum: 180 },
};
const areaSchemas: Record<string, unknown> = {
  cities: object({ name: str, state: str, country: str, status: str }, [
    "name",
    "state",
  ]),
  locations: object(
    {
      cityId: oid,
      name: str,
      usage: { type: "string", enum: ["Pickup", "Drop", "Both"] },
      address: str,
      landmarkId: oid,
      phone: str,
      ...areaCoordinates,
      status: str,
    },
    ["cityId", "name", "usage"],
  ),
  pois: object(
    {
      cityId: oid,
      name: str,
      category: {
        type: "string",
        enum: ["Bus stand", "Railway station", "Landmark", "Other"],
      },
      address: str,
      ...areaCoordinates,
      status: str,
    },
    ["cityId", "name", "category"],
  ),
};
for (const [resource, schema] of Object.entries(areaSchemas)) {
  const path = "/api/v1/operator/area-master/" + resource;
  add(path, "get", "Search and paginate " + resource);
  add(path, "post", "Create " + resource, { requestBody: body(schema) });
  add(path + "/{id}", "get", "Read company-owned " + resource);
  add(path + "/{id}", "patch", "Save complete " + resource + " fields", {
    requestBody: body(schema),
  });
}
const areaStop = object({ locationId: oid, time: str }, ["locationId"]);
add(
  "/api/v1/operator/area-master/routes/{id}/stops",
  "put",
  "Assign ordered pickup and drop points to a route",
  {
    requestBody: body(
      object({
        sourceCityId: oid,
        destinationCityId: oid,
        boarding: { type: "array", minItems: 1, maxItems: 40, items: areaStop },
        dropping: { type: "array", minItems: 1, maxItems: 40, items: areaStop },
        expectedVersion: { type: "integer", minimum: 0 },
      }),
    ),
  },
);

const tripMasterPrefix = "/api/v1/operator/trip-master";
const tmStatus = { type: "string", enum: ["Active", "Inactive"] };
const tmSchemas: Record<string, unknown> = {
  services: object(
    {
      name: str,
      code: str,
      routeId: oid,
      busId: oid,
      departure: { type: "string", example: "21:30" },
      daysOfWeek: {
        type: "array",
        items: { type: "integer", minimum: 0, maximum: 6 },
        minItems: 1,
        maxItems: 7,
        uniqueItems: true,
      },
      crewIds: { type: "array", items: oid, maxItems: 10 },
      doublePaise: paise,
      singlePaise: paise,
      status: tmStatus,
    },
    [
      "name",
      "code",
      "routeId",
      "busId",
      "departure",
      "daysOfWeek",
      "doublePaise",
      "singlePaise",
    ],
  ),
  tablets: object({ name: str, serialNumber: str, status: tmStatus }, [
    "name",
    "serialNumber",
  ]),
  partners: object(
    {
      name: str,
      kind: { type: "string", enum: ["Agent", "Branch"] },
      phone: str,
      email: { type: "string", format: "email" },
      status: tmStatus,
    },
    ["name", "kind", "phone"],
  ),
  commissions: object(
    {
      partnerId: oid,
      serviceId: oid,
      tripId: oid,
      basis: {
        type: "string",
        enum: ["Base fare", "Grand total"],
        description: "Base fare is after discounts, before taxes and charges",
      },
      kind: { type: "string", enum: ["Percent", "Fixed"] },
      basisPoints: { type: "integer", minimum: 0, maximum: 10000 },
      fixedPaise: paise,
      status: tmStatus,
    },
    ["partnerId", "kind"],
  ),
  links: object(
    {
      fromTripId: oid,
      toTripId: oid,
      kind: { type: "string", enum: ["Related", "Connection"] },
      transferMinutes: { type: "integer", minimum: 0, maximum: 1440 },
      notes: str,
      status: tmStatus,
    },
    ["fromTripId", "toTripId", "kind"],
  ),
};
for (const [resource, schema] of Object.entries(tmSchemas)) {
  const path = tripMasterPrefix + "/" + resource;
  add(path, "get", "List tenant-owned " + resource);
  add(path, "post", "Create " + resource, { requestBody: body(schema) });
  add(path + "/{id}", "get", "Read " + resource);
  add(
    path + "/{id}",
    "patch",
    "Replace complete editable " + resource + " fields",
    { requestBody: body(schema) },
  );
}
const tmDates = {
  from: { type: "string", format: "date" },
  to: { type: "string", format: "date" },
};
const tmBatch = object({
  ...tmDates,
  serviceIds: {
    type: "array",
    items: oid,
    minItems: 1,
    maxItems: 20,
    uniqueItems: true,
  },
});
for (const action of ["preview", "create"])
  add(
    tripMasterPrefix + "/scheduling/" + action,
    "post",
    action === "preview"
      ? "Preview up to 100 service journeys and conflicts"
      : "Atomically schedule ready journeys; existing service/day trips are skipped",
    { requestBody: body(tmBatch) },
  );
add(
  tripMasterPrefix + "/availability",
  "get",
  "Service availability for an explicit journey date",
  {
    parameters: [
      {
        in: "query",
        name: "journeyDate",
        required: true,
        schema: { type: "string", format: "date" },
      },
      {
        in: "query",
        name: "serviceIds",
        schema: {
          type: "string",
          description: "Optional comma-separated service IDs; at most 20",
        },
      },
    ],
  },
);
add(
  tripMasterPrefix + "/trips/{id}/tracker",
  "get",
  "Read operational timeline and GPS integration state",
);
const tmKey = {
  in: "header",
  name: "Idempotency-Key",
  required: true,
  schema: { type: "string", minLength: 16, maxLength: 100 },
};
add(
  tripMasterPrefix + "/trips/{id}/operations",
  "post",
  "Record next stage with actual time and optimistic version",
  {
    parameters: [
      { in: "path", name: "id", required: true, schema: oid },
      tmKey,
    ],
    requestBody: body(
      object(
        {
          stage: {
            type: "string",
            enum: ["Boarding", "Departed", "Arrived", "Completed"],
          },
          at: { type: "string", format: "date-time" },
          expectedVersion: { type: "integer", minimum: 0 },
          odometerKm: { type: "number", minimum: 0 },
          fuelConsumedMillilitres: { type: "integer", minimum: 1 },
        },
        ["stage", "at", "expectedVersion"],
      ),
    ),
  },
);
const tmRecords: Record<string, unknown> = {
  fuel: object(
    {
      tripId: oid,
      litresMillilitres: { type: "integer", minimum: 1, maximum: 1000000 },
      amountPaise: paise,
      at: { type: "string", format: "date-time" },
      odometerKm: { type: "number" },
      pump: str,
      receipt: str,
    },
    ["tripId", "litresMillilitres", "amountPaise", "at"],
  ),
  stops: object(
    {
      tripId: oid,
      kind: { type: "string", enum: ["Pickup", "Drop", "POI", "Other"] },
      locationId: oid,
      poiId: oid,
      name: str,
      arrivedAt: { type: "string", format: "date-time" },
      departedAt: { type: "string", format: "date-time" },
      notes: str,
    },
    ["tripId", "kind", "arrivedAt", "departedAt"],
  ),
};
for (const [resource, schema] of Object.entries(tmRecords)) {
  add(tripMasterPrefix + "/" + resource, "get", "List recorded " + resource);
  add(
    tripMasterPrefix + "/" + resource,
    "post",
    "Record " + resource + " idempotently",
    { parameters: [tmKey], requestBody: body(schema) },
  );
}
add(
  tripMasterPrefix + "/fuel/{id}/void",
  "post",
  "Void a fuel expense with an audited reason",
  { requestBody: body(object({ reason: str })) },
);
add(
  tripMasterPrefix + "/tablet-assignments",
  "get",
  "List tablet assignment history",
);
add(
  tripMasterPrefix + "/tablet-assignments",
  "post",
  "Assign an available tablet to a scheduled or ongoing trip",
  {
    requestBody: body(
      object({ tabletId: oid, tripId: oid, crewId: oid }, [
        "tabletId",
        "tripId",
      ]),
    ),
  },
);
add(
  tripMasterPrefix + "/tablet-assignments/{id}/release",
  "post",
  "Release a tablet assignment idempotently",
);
add(
  tripMasterPrefix + "/reports",
  "get",
  "Actual delays, mileage, stops, fuel and pickup/drop analysis; financial fields require finance permission",
  {
    parameters: Object.entries(tmDates).map(([name, schema]) => ({
      in: "query",
      name,
      required: true,
      schema,
    })),
  },
);

// Phase 5 read-only platform monitoring; operator masters remain operator-owned.
for (const resource of [
  "buses",
  "trips",
  "routes",
  "agencies",
  "bookings",
  "alerts",
  "audit",
  "admin-users",
  "settings",
  "capabilities",
])
  add(
    "/api/v1/platform/" + resource,
    "get",
    "Phase 5 authorized platform " + resource,
    {
      description:
        "Explicit platform permission required; passenger and financial evidence require separate grants. Server pagination and scope filters apply. See backend/PLATFORM-ADMIN.md.",
    },
  );
for (const resource of [
  "buses",
  "trips",
  "routes",
  "agencies",
  "bookings",
  "alerts",
  "audit",
])
  add(
    "/api/v1/platform/" + resource + ".csv",
    "get",
    "Authorized bounded platform CSV",
    {
      description:
        "Requires complete from/to dates, the matching read grant, and sanitized scope filters; passenger data is excluded.",
    },
  );
for (const report of [
  "operator-performance",
  "agency-performance",
  "booking-source",
  "route-bookings",
  "bus-occupancy",
  "confirmed-cancelled",
  "payment-status",
  "operational-alerts",
])
  add(
    "/api/v1/platform/reports/" + report,
    "get",
    "Operational report " + report,
  );
add(
  "/api/v1/platform/admin-users",
  "post",
  "Create functional admin staff; bootstrap Super Admin creation forbidden",
  {
    description:
      "Requires platform:staff:write, current password re-verification, business reason, stable Idempotency-Key and a role-constrained permission set. Full strict request schema in PLATFORM-ADMIN.md.",
  },
);
add(
  "/api/v1/platform/admin-users/{id}",
  "patch",
  "Versioned staff access change with session revocation",
);
add(
  "/api/v1/platform/admin-users/{id}/revoke-sessions",
  "post",
  "Revoke staff sessions after password verification; self/bootstrap protected",
);
add(
  "/api/v1/platform/operators/{id}/documents",
  "post",
  "Record an external company evidence reference; not a file upload vault",
);
add(
  "/api/v1/platform/operators/{operatorId}/documents/{id}/review",
  "post",
  "Versioned manual document reference review; approval is separate",
);
add(
  "/api/v1/platform/settings",
  "put",
  "Versioned controlled profile and template drafts; no secret or live integration settings",
);
export const openapi = {
  openapi: "3.0.3",
  info: {
    title: "Aibus Operator API",
    version: "1.0.0",
    description:
      "Operator-scoped API. Money is integer paise. No external or payment provider configured. Mutations reject unknown fields, including client-supplied operatorId. Cookie auth mutations require the configured Origin.",
  },
  servers: [{ url: "/" }],
  paths,
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      refreshCookie: { type: "apiKey", in: "cookie", name: "aibus_refresh" },
    },
    schemas: {
      Envelope: {
        type: "object",
        properties: {
          data: {},
          meta: {
            type: "object",
            properties: {
              page: { type: "integer" },
              limit: { type: "integer" },
              total: { type: "integer" },
            },
          },
        },
      },
      Error: {
        type: "object",
        properties: {
          error: {
            type: "object",
            properties: { code: str, message: str, requestId: str },
          },
        },
      },
    },
  },
};
