// Documentation examples are derived from the same compiled contract returned by the API.
export function schemaExample(schema: any, spec: any, depth = 0): any {
  if (!schema || depth > 12) return null;
  if (schema.$ref)
    return schemaExample(
      spec.components?.schemas?.[schema.$ref.split("/").pop()],
      spec,
      depth + 1,
    );
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum) return schema.enum[0];
  if (schema.type === "object" || schema.properties)
    return Object.fromEntries(
      Object.entries(schema.properties || {}).map(([name, value]) => [
        name,
        schemaExample(value, spec, depth + 1),
      ]),
    );
  if (schema.type === "array")
    return [schemaExample(schema.items, spec, depth + 1)];
  if (schema.type === "integer" || schema.type === "number")
    return schema.minimum || 0;
  if (schema.type === "boolean") return false;
  if (schema.format === "date") return "2030-11-20";
  if (schema.format === "date-time") return "2030-11-20T14:30:00Z";
  return "<replace-with-authorized-test-value>";
}

export function resolveSchema(schema: any, spec: any): any {
  return schema?.$ref
    ? spec.components?.schemas?.[schema.$ref.split("/").pop()] || {}
    : schema || {};
}
export function requestExample(op: any, spec: any) {
  const params: Record<string, string> = {},
    query: Record<string, string> = {};
  for (const p of op.parameters || []) {
    if (p.in === "path") params[p.name] = String(schemaExample(p.schema, spec));
    if (p.in === "query") query[p.name] = String(schemaExample(p.schema, spec));
  }
  return {
    params,
    query,
    body:
      schemaExample(
        op.requestBody?.content?.["application/json"]?.schema,
        spec,
      ) || {},
    ...((op.parameters || []).some((p: any) => p.name === "Idempotency-Key")
      ? { idempotencyKey: "replace-with-unique-request-key" }
      : {}),
  };
}
export function integrationExample(op: any, spec: any, language: string) {
  const sample = requestExample(op, spec);
  const query = new URLSearchParams(sample.query).toString();
  const path = op.path.replace(/\{([^}]+)\}/g, (_: string, key: string) =>
    encodeURIComponent(sample.params[key] || `<${key}>`),
  );
  const url = `https://YOUR-SANDBOX-HOST/api/v1/public${path}${query ? "?" + query : ""}`;
  const headers: Record<string, string> = {
    Authorization:
      op.operationId === "authenticate"
        ? "Bearer <SERVER_API_CREDENTIAL>"
        : "Bearer <SERVER_ACCESS_TOKEN>",
  };
  if (op.requestBody) headers["Content-Type"] = "application/json";
  if ("idempotencyKey" in sample)
    headers["Idempotency-Key"] = sample.idempotencyKey!;
  if (language === "javascript")
    return `// Run on your backend. Replace all sample values.\nconst response = await fetch(${JSON.stringify(url)}, ${JSON.stringify({ method: op.method, headers, ...(op.requestBody ? { body: JSON.stringify(sample.body) } : {}) }, null, 2)});\nconst result = await response.json();\nif (!response.ok) throw new Error(result.error?.message || "API request failed");`;
  const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
  return `# Run on your backend. Replace all sample values.\ncurl --request ${op.method} ${quote(url)}${Object.entries(
    headers,
  )
    .map(([k, v]) => ` \\\n  --header ${quote(k + ": " + v)}`)
    .join(
      "",
    )}${op.requestBody ? ` \\\n  --data ${quote(JSON.stringify(sample.body, null, 2))}` : ""}`;
}
export const sandboxScenarios = [
  {
    name: "Available bus",
    operation: "trips",
    steps:
      "Grant a future internal sandbox trip with an active bus and route. Search its exact cities and journey date; inspect returned trip IDs.",
  },
  {
    name: "Unavailable bus",
    operation: "trips",
    steps:
      "Search a date or city pair without a granted scheduled trip. Expect an empty result, never other operators’ inventory.",
  },
  {
    name: "Sold-out seats",
    operation: "seatLayout",
    steps:
      "Use a fixture whose seats are already held, booked or blocked. Read the seat states; holding those seats must return an inventory conflict.",
  },
  {
    name: "Fare changed",
    operation: "fareRecheck",
    steps:
      "Quote fixture seats, change the fixture fare through the Operator workspace, then try booking with the old quote. Expect a fare/quote conflict and no booking.",
  },
  {
    name: "Hold created",
    operation: "seatHold",
    steps:
      "Use a returned authorized trip ID, available seat numbers and a new idempotencyKey. Save the returned hold ID and expiration.",
  },
  {
    name: "Hold expired",
    operation: "seatHold",
    steps:
      "Wait until the fixture hold expires (at most five minutes), then retry its original key. Expect HOLD_EXPIRED; a replacement hold must remain untouched.",
  },
  {
    name: "Successful sandbox booking",
    operation: "pendingBooking",
    steps:
      "Hold seats, perform hold-bound fare recheck, create the pending booking with passengers, then confirm with authorization sandbox-allowance. Requires server-provisioned simulated allowance.",
  },
  {
    name: "Duplicate booking request",
    operation: "pendingBooking",
    steps:
      "Repeat exactly the same pending-booking payload and idempotencyKey. Expect the same owned reference. Changing content under that key must conflict.",
  },
  {
    name: "Booking failure",
    operation: "confirmSandboxBooking",
    steps:
      "Use an expired hold or a fixture with no simulated allowance. Confirmation must fail without a new ticket or a balance change.",
  },
  {
    name: "Ticket retrieval",
    operation: "ticket",
    steps:
      "Request an owned confirmed public booking ID. The portal requires passenger permission. Foreign references must return not found.",
  },
  {
    name: "Cancellation request",
    operation: "requestCancellation",
    steps:
      "Read cancellation charges/policy for an owned confirmed fixture booking. Submit its accepted cancellation request with a stable idempotencyKey.",
  },
  {
    name: "Refund pending",
    operation: "refundStatus",
    steps:
      "Read refund status after an accepted cancellation. Pending/requested does not mean provider-refunded. No live refund execution exists here.",
  },
  {
    name: "Webhook delivery failure",
    operation: "webhookDeliveries",
    steps:
      "Register an allowlisted sandbox HTTPS endpoint, queue a test, and use a failing test receiver. Observe bounded attempts and Manual review; retry adds at most five attempts once.",
  },
];
