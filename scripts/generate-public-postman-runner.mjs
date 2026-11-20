import fs from "node:fs";
const root = "integrations/public-api/";
const original = JSON.parse(fs.readFileSync(root + "postman.v1.json", "utf8"));
const byName = Object.fromEntries(original.item.map(item => [item.name, item]));
const event = (listen, code) => ({ listen, script: { type: "text/javascript", exec: code.trim().split("\n") } });
const success = (codes = [200]) => `
const accepted = ${JSON.stringify(codes)};
pm.test("Expected HTTP status", () => pm.expect(accepted).to.include(pm.response.code));
if (!accepted.includes(pm.response.code)) {
  pm.execution.setNextRequest(null);
  throw new Error("Request failed; inspect error.code and requestId before retrying.");
}
const payload = pm.response.json();
const data = payload.data;
pm.test("Response has data", () => pm.expect(data).not.to.equal(undefined));
function ensure(condition, message) { if (!condition) { pm.execution.setNextRequest(null); throw new Error(message); } }
`;
const prelude = `
(function () {
  function stop(message) { console.warn(message); pm.execution.setNextRequest(null); pm.execution.skipRequest(); }
  const base = String(pm.environment.get("baseUrl") || "").replace(/\\/$/, "");
  if (!base || String(pm.environment.get("sandboxMode")) !== "true") { stop("Select the isolated sandbox environment; do not run booking tests against production."); return; }
  if (/^https?:\\/\\/api\\.bookmybus\\.pro(?:[:/]|$)/i.test(base)) { stop("Production public bookings are disabled. Use a separately provisioned sandbox URL."); return; }
  if (!pm.environment.get("apiCredential")) { stop("Set your complete sandbox API credential locally, not an Admin login token."); return; }
  if (pm.info.requestName.startsWith("01 ")) return;
  const expires = Number(pm.environment.get("accessTokenExpiresAt"));
  if (!pm.environment.get("accessToken") || !Number.isFinite(expires) || expires <= Date.now()) { stop("Run 01 Token exchange again; preserve existing request keys and booking IDs when retrying."); return; }
})();
`;
const mutation = `
if (String(pm.environment.get("allowSandboxWrites")) !== "true" || pm.environment.get("verifiedSandboxBase") !== String(pm.environment.get("baseUrl") || "").replace(/\\/$/, "")) {
  console.warn("Enable sandbox writes explicitly and run 02 Capabilities first. No booking request was sent.");
  pm.execution.setNextRequest(null); pm.execution.skipRequest();
}
`;
const required = (...keys) => `
for (const key of ${JSON.stringify(keys)}) {
  if (!pm.environment.get(key)) { console.warn("Missing " + key + "; complete the preceding integration step first."); pm.execution.setNextRequest(null); pm.execution.skipRequest(); break; }
}
`;
function item(source, name, options = {}) {
  const result = structuredClone(byName[source]);
  result.name = name;
  result.protocolProfileBehavior = { disableCookies: true };
  if (options.url) result.request.url = options.url;
  if (options.body !== undefined) result.request.body = { mode: "raw", raw: JSON.stringify(options.body, null, 2), options: { raw: { language: "json" } } };
  result.event = [event("prerequest", prelude + (options.pre || "") + (options.write ? mutation : "")), event("test", success(options.codes) + (options.test || ""))];
  return result;
}
const quoteTest = `ensure(data.id, "Quote ID missing"); pm.environment.set("quoteId", data.id); pm.environment.set("quoteExpiresAt", data.expiresAt);`;
const workflow = [
  item("authenticate", "01 Token exchange", { test: `
ensure(data.accessToken && data.expiresIn > 0, "Token exchange did not return an access token.");
pm.environment.set("accessToken", data.accessToken);
pm.environment.set("accessTokenExpiresAt", Date.now() + data.expiresIn * 1000 - 5000);
if (!pm.environment.get("testRunId")) pm.environment.set("testRunId", pm.variables.replaceIn("{{$guid}}"));
const run = pm.environment.get("testRunId");
ensure(/^[A-Za-z0-9_.:-]{16,60}$/.test(run), "testRunId must be 16–60 letters, digits or . _ : -");
if (pm.environment.get("contextRunId") !== run) {
  if (pm.environment.get("bookingId")) pm.environment.set("previousBookingId", pm.environment.get("bookingId"));
  for (const key of ["tripId", "seatNumber", "holdId", "quoteId", "bookingId", "cancellationQuoteId", "pnr", "razorpayOrderId", "razorpayPaymentId", "razorpaySignature", "verifiedSandboxBase"]) pm.environment.unset(key);
  pm.environment.set("contextRunId", run);
}
for (const [variable, suffix] of [["holdKey","hold"],["bookingKey","booking"],["paymentKey","payment"],["verifyKey","verify"],["reconcileKey","reconcile"],["cancelKey","cancel"],["partnerReference","reference"]]) pm.environment.set(variable, "postman-" + run + "-" + suffix);
` }),
  item("capabilities", "02 Capabilities", { test: `ensure(data.environment === "sandbox" && data.liveTicketIssuance === false, "Server is not the supported isolated sandbox."); pm.environment.set("verifiedSandboxBase", String(pm.environment.get("baseUrl")).replace(/\\/$/, ""));` }),
  item("cities", "03 Cities — capture source and destination IDs", { url: "{{baseUrl}}/cities?page=1&limit=100", test: `
ensure(Array.isArray(data), "Expected a city list.");
for (const [idKey, nameKey] of [["fromCityId","fromCityName"],["toCityId","toCityName"]]) {
  const supplied = pm.environment.get(idKey);
  if (supplied) { ensure(/^city_[A-Za-z0-9_-]{16,100}$/.test(supplied), idKey + " must be a returned public city ID."); continue; }
  ensure(!payload.meta || payload.meta.total <= data.length, "More city pages exist. Select the exact fromCityId and toCityId manually before running the collection.");
  const name = String(pm.environment.get(nameKey) || "").trim().toLowerCase();
  const matches = data.filter(c => String(c.name || c.City).trim().toLowerCase() === name);
  ensure(matches.length === 1, "Choose an exact authorized " + idKey + " manually from the Cities response (name missing or ambiguous).");
  pm.environment.set(idKey, matches[0].id);
}
` }),
  item("trips", "04 Search trips — capture a sellable trip ID", { pre: required("fromCityId", "toCityId", "journeyDate"), test: `
ensure(Array.isArray(data), "Expected trips array.");
const trip = data.find(t => t.availableSeats > 0);
ensure(trip, "No available authorized trip for these exact city IDs and date. Update the environment and search again.");
pm.environment.set("tripId", trip.id);
` }),
  item("tripDetails", "05 Trip details", { pre: required("tripId") }),
  item("seatLayout", "06 Seats — choose one available seat", { pre: required("tripId"), test: `
ensure(Array.isArray(data.seats), "Expected seat layout.");
const seat = data.seats.find(s => s.state === "available");
ensure(seat, "No available seat. Booked, blocked, quota and held seats are not selected.");
pm.environment.set("seatNumber", seat.number);
` }),
  item("stops", "07 Boarding and dropping points", { pre: required("tripId") }),
  item("cancellationPolicy", "08 Cancellation policy", { pre: required("tripId") }),
  item("fareRecheck", "09 Initial quote — before hold", { body: { seats: ["{{seatNumber}}"] }, pre: required("tripId", "seatNumber"), write: true, test: `ensure(data.id, "Initial quote is missing."); pm.environment.set("initialQuoteId", data.id);` }),
  item("seatHold", "10 Hold selected seat", { codes: [201], body: { seats: ["{{seatNumber}}"] }, pre: required("tripId", "seatNumber", "holdKey"), write: true, test: `ensure(data.id, "Hold ID missing"); pm.environment.set("holdId", data.id); pm.environment.set("holdExpiresAt", data.expiresAt);` }),
  item("fareRecheck", "11 Hold-bound quote — required for booking", { body: { seats: ["{{seatNumber}}"], holdId: "{{holdId}}" }, pre: required("tripId", "seatNumber", "holdId"), write: true, test: `ensure(data.holdId === pm.environment.get("holdId"), "Quote is not bound to this hold.");` + quoteTest }),
  item("pendingBooking", "12 Create pending booking", { codes: [201], body: { tripId: "{{tripId}}", holdId: "{{holdId}}", quoteId: "{{quoteId}}", partnerReference: "{{partnerReference}}", passengers: [{ name: "Postman Sandbox Passenger", seat: "{{seatNumber}}", age: 25, gender: "male" }], contact: { phone: "9999999999", email: "postman@example.invalid" } }, pre: required("tripId", "holdId", "quoteId", "partnerReference", "seatNumber", "bookingKey"), write: true, test: `ensure(data.id, "Booking ID missing"); pm.environment.set("bookingId", data.id);` }),
  item("startTestPayment", "13 Create Razorpay Test Mode order", { pre: required("bookingId", "paymentKey"), write: true, test: `ensure(data.mode === "test" && data.orderId && data.amountPaise > 0, "Test payment order missing."); pm.environment.set("razorpayOrderId", data.orderId); pm.environment.set("razorpayKeyId", data.keyId);` }),
  item("verifyTestPayment", "14 Verify test checkout response — enter provider values first", { body: { razorpay_order_id: "{{razorpayOrderId}}", razorpay_payment_id: "{{razorpayPaymentId}}", razorpay_signature: "{{razorpaySignature}}" }, pre: required("bookingId", "razorpayOrderId", "razorpayPaymentId", "razorpaySignature", "verifyKey"), write: true, test: `ensure(["Confirmed", "Pending payment", "Reconciliation required"].includes(data.status), "Unexpected booking state."); if (data.pnr) pm.environment.set("pnr", data.pnr);` }),
  item("bookingStatus", "15 Booking status", { pre: required("bookingId") }),
  item("ticket", "16 Ticket and PNR", { pre: required("bookingId"), test: `ensure(data.pnr && data.status === "valid", "Confirmed test ticket/PNR missing"); pm.environment.set("pnr", data.pnr);` }),
  item("cancellationCharges", "17 Cancellation quote", { body: {}, pre: required("bookingId"), write: true, test: `ensure(data.id, "Cancellation quote ID missing"); pm.environment.set("cancellationQuoteId", data.id);` }),
  item("requestCancellation", "18 Request cancellation — operator review required", { pre: required("bookingId", "cancellationQuoteId", "cancelKey"), write: true }),
  item("refundStatus", "19 Test refund status — pending is not refunded", { pre: required("bookingId") }),
  item("webhookDeliveries", "20 Webhook delivery history — may be empty"),
];
// Existing request keys belong in HTTP headers, never URL query parameters.
for (const [name, variable] of [["10 Hold selected seat","holdKey"],["12 Create pending booking","bookingKey"],["13 Create Razorpay Test Mode order","paymentKey"],["14 Verify test checkout response — enter provider values first","verifyKey"],["18 Request cancellation — operator review required","cancelKey"]]) {
  const request = workflow.find(item => item.name === name).request;
  request.header = request.header.filter(h => h.key.toLowerCase() !== "idempotency-key");
  request.header.push({ key: "Idempotency-Key", value: `{{${variable}}}` });
}
const unsupported = ["rescheduleUnavailable", "walletUnavailable"].map((source, n) => {
  const result = item(source, `${20+n} ${n ? "Partner wallet" : "Reschedule"} — expected unavailable`, { codes: [501], test: `pm.test("Documented unavailable capability", () => pm.expect(payload.error.code).to.equal("CAPABILITY_UNAVAILABLE"));` });
  // Unavailable responses use error rather than data.
  result.event[1] = event("test", `pm.test("HTTP 501 expected", () => pm.expect(pm.response.code).to.equal(501)); const payload = pm.response.json(); pm.test("Documented unavailable capability", () => pm.expect(payload.error.code).to.equal("CAPABILITY_UNAVAILABLE"));`);
  return result;
});
const paymentRecovery = [
  item("reconcileTestPayment", "Reconcile uncertain Razorpay Test payment", { pre: required("bookingId", "reconcileKey"), write: true }),
];
const diagnostics = [
  { name: "Live backend readiness", protocolProfileBehavior: { disableCookies: true }, request: { method: "GET", header: [], url: "{{liveOrigin}}/health/ready" }, event: [event("test", `pm.test("Backend ready", () => { pm.expect(pm.response.code).to.equal(200); pm.expect(pm.response.json().data.status).to.equal("ready"); });`)] },
  { name: "Live OpenAPI document — contracts do not enable production sales", protocolProfileBehavior: { disableCookies: true }, request: { method: "GET", header: [], url: "{{liveOrigin}}/api/v1/public/openapi.json" }, event: [event("test", `pm.test("OpenAPI available", () => { pm.expect(pm.response.code).to.equal(200); pm.expect(pm.response.json().openapi).to.equal("3.0.3"); });`)] },
];
const collection = { info: { name: "AIBUS — guided public integration tests", schema: original.info.schema, description: "Use only an isolated non-production API, partner credential and authorized test inventory. The booking flow uses Razorpay Test Mode; no real money is collected. Run the test order step, complete Razorpay Checkout in your integration, then enter its payment ID/signature before verification. Cancellation requires operator review; test refunds use the existing worker." }, item: [{ name: "00 Live diagnostics — read only", item: diagnostics }, { name: "01 Test booking flow — integrate Razorpay Checkout", item: workflow }, { name: "02 Payment recovery — uncertain response only", item: paymentRecovery }, { name: "03 Unsupported capabilities — expect 501", item: unsupported }] };
fs.writeFileSync(root + "postman.runner.v1.json", JSON.stringify(collection, null, 2) + "\n");
function environment(name, sandbox) {
  const values = { liveOrigin: "https://api.bookmybus.pro", baseUrl: sandbox ? "http://127.0.0.1:4001/api/v1/public" : "https://api.bookmybus.pro/api/v1/public", sandboxMode: String(sandbox), allowSandboxWrites: "false", apiCredential: "", accessToken: "", razorpayOrderId: "", razorpayPaymentId: "", razorpaySignature: "", fromCityName: "Pune", toCityName: "Mumbai", fromCityId: "", toCityId: "", journeyDate: "", testRunId: "" };
  return { name, values: Object.entries(values).map(([key, value]) => ({ key, value, type: ["apiCredential", "accessToken"].includes(key) ? "secret" : "default", enabled: true })), _postman_variable_scope: "environment" };
}
fs.writeFileSync(root + "postman.live.environment.json", JSON.stringify(environment("AIBUS live — diagnostics only", false), null, 2) + "\n");
fs.writeFileSync(root + "postman.sandbox.environment.json", JSON.stringify(environment("AIBUS isolated sandbox", true), null, 2) + "\n");
console.log("Generated guided collection and two blank-secret environments. No API requests were sent.");
