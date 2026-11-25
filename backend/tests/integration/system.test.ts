import * as Settlements from "../../src/services/settlement.service.js";
import { financialReport, financialReportCsv, financialReconciliation } from "../../src/services/financial-report.service.js";
import { runLeasedJob } from "../../src/services/job-runner.service.js";
import { inspectTripIntegrity, persistIssues } from "../../src/services/operations-integrity.service.js";
import { testPayout } from "../../src/integrations/test-payout.js";
import * as RefundReview from "../../src/services/refund-review.service.js";
import * as RefundWorkflow from "../../src/services/refund-workflow.service.js";
import { requestCancellation } from "../../src/services/cancellation.service.js";
﻿import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterEach, vi } from "vitest";
import mongoose from "mongoose";
import request from "supertest";
import { createServer } from "node:http";
import { io as connectSocket } from "socket.io-client";
import { randomUUID, createHmac } from "node:crypto";
import { createApp } from "../../src/app.js";
import { readConfig } from "../../src/config/env.js";
import * as M from "../../src/models/index.js";
import { hashPassword } from "../../src/modules/auth/index.js";
import {
  createHold,
  createBooking,
  confirmDirectBooking,
  applyVerifiedPayment,
} from "../../src/services/inventory.service.js";
import {
  reconcileExpiredHolds,
  reconcileExternalBookings,
  publishOutbox,
} from "../../src/jobs/booking.jobs.js";
import { attachRealtime } from "../../src/realtime/socket.js";
import {
  rolePermissions,
  AppError,
  type Principal,
} from "../../src/utils/core.js";
import { safeProviderRead } from "../../src/integrations/providers.js";
import { issueQuote, priceTrip } from "../../src/services/pricing.service.js";
import { migrateAgentUser } from "../../src/services/agent-migration.service.js";
import * as AgencyFinance from "../../src/services/agency-finance.service.js";
import {
  walletStatement,
  csvDocument,
} from "../../src/services/finance-export.service.js";
import {
  postJournal,
  postJournalInTransaction,
  reverseJournal,
  type JournalInput,
} from "../../src/services/ledger.service.js";
import {
  verifyLedger,
  assessHistoricalFinance,
} from "../../src/services/ledger-integrity.service.js";
let mongo: MongoMemoryReplSet;
const config = readConfig({
  NODE_ENV: "test",
  MONGODB_URI: "mongodb://127.0.0.1/test",
  JWT_SECRET: "x".repeat(64),
  WEB_ORIGIN: "http://127.0.0.1:5173",
});
const app = createApp(config, { check: async () => true });
const paymentConfig = {
  ...config,
  RAZORPAY_KEY_ID: "rzp_test_fixture",
  RAZORPAY_KEY_SECRET: "fixture-key-secret-not-real",
  RAZORPAY_WEBHOOK_SECRET: "fixture-webhook-secret-not-real",
};
const paymentApp = createApp(paymentConfig, { check: async () => true });
const agentOrigin = "http://127.0.0.1:5175";
const dashboardConfig = { ...paymentConfig, AGENT_WEB_ORIGIN: agentOrigin };
const dashboardApp = createApp(dashboardConfig, { check: async () => true });
const walletConfig = { ...config, FINANCE_TEST_MODE: true };
const walletApp = createApp(walletConfig, { check: async () => true });
const refundConfig = { ...paymentConfig, FINANCE_TEST_MODE: true };
const refundApp = createApp(refundConfig, { check: async () => true });
afterEach(() => vi.restoreAllMocks());
let a: Principal,
  b: Principal,
  tokenA: string,
  tokenB: string,
  readerToken: string,
  tripId: string,
  busId: string,
  routeId: string;
const password = "Aibus-test-password-2026!";
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    binary: { version: "7.0.14" },
  });
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});
beforeEach(async () => {
  for (const model of Object.values(mongoose.models))
    // Raw deletes are confined to this disposable MongoMemoryReplSet fixture.
    if (
      [
        "LedgerAccount",
        "JournalEntry",
        "FinancialOperation",
        "CreditLimitHistory",
        "TestFundingEvidence",
        "CancellationQuote",
        "RefundAttempt", "SettlementLine", "SettlementApproval", "TestSettlementReceipt", "TestPayoutRecord", "PayoutAttempt", "SettlementReconciliation",
      ].includes(model.modelName)
    )
      await model.collection.deleteMany({});
    else await model.deleteMany({});
  const hash = await hashPassword(password);
  const oa = await M.Operator.create({
      company: "Operator A",
      email: "a@example.test",
      status: "approved",
    }),
    ob = await M.Operator.create({
      company: "Operator B",
      email: "b@example.test",
      status: "approved",
    });
  const ua = await M.User.create({
      operatorId: oa._id,
      name: "Admin A",
      email: "a@example.test",
      passwordHash: hash,
      role: "operator_admin",
    }),
    ub = await M.User.create({
      operatorId: ob._id,
      name: "Admin B",
      email: "b@example.test",
      passwordHash: hash,
      role: "operator_admin",
    });
  await M.User.create({
    operatorId: oa._id,
    name: "Reader",
    email: "reader@example.test",
    passwordHash: hash,
    role: "read_only",
  });
  const la = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "a@example.test", password }),
    lb = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "b@example.test", password }),
    lr = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "reader@example.test", password });
  tokenA = la.body.data.accessToken;
  tokenB = lb.body.data.accessToken;
  readerToken = lr.body.data.accessToken;
  a = {
    userId: String(ua._id),
    operatorId: String(oa._id),
    role: "operator_admin",
    sessionId: "test",
    permissions: rolePermissions.operator_admin,
  };
  b = { ...a, userId: String(ub._id), operatorId: String(ob._id) };
  await M.PricingPolicy.create({
    operatorId: oa._id,
    taxBasisPoints: 0,
    chargePaise: 0,
    chargesTaxable: false,
    operatorDiscountMaxPaise: 0,
    requireAge: false,
    requireGender: false,
    requireMobile: false,
    gstEnabled: false,
    version: 1,
  });
  const bus = await M.Bus.create({
    operatorId: oa._id,
    registration: "TS 09 AA 1000",
    name: "Aibus",
    type: "AC Sleeper",
    capacity: 3,
  });
  busId = String(bus._id);
  const route = await M.Route.create({
    operatorId: oa._id,
    source: "Hyderabad",
    destination: "Bangalore",
    boarding: [{ name: "Miyapur" }],
    dropping: [{ name: "Hebbal" }],
    departure: "21:30",
    arrival: "06:30",
    durationMinutes: 540,
  });
  routeId = String(route._id);
  const trip = await M.Trip.create({
    operatorId: oa._id,
    busId,
    routeId,
    journeyDate: "2030-11-13",
    departureAt: new Date("2030-11-13T21:30:00+05:30"),
    seats: ["L1", "L2", "L3"].map((number, i) => ({
      number,
      deck: "lower",
      row: 0,
      column: i,
      category: "sleeper",
      farePaise: 145000,
      state: "available",
    })),
  });
  tripId = String(trip._id);
});
const get = (path: string, token = tokenA) =>
  request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${token}`);
const post = (path: string, data: unknown, token = tokenA) =>
  request(app)
    .post(`/api/v1${path}`)
    .set("Authorization", `Bearer ${token}`)
    .send(data);
describe("counter cash confirmation safety", () => {
  it("reads agency reports without writes and audits an idempotent report review", async () => {
    const agent=await M.SalesPartner.create({operatorId:a.operatorId,name:"Report agency",kind:"Agent"});
    const path="/operator/agents/settlements/daily?date=2030-11-13";
    const report=await get(path);
    expect(report.status).toBe(200);
    expect(report.body.data.settlements[0].reportOnly).toBe(true);
    expect(await M.DailyAgentSettlement.countDocuments()).toBe(0);
    const identifier=String(agent._id)+":2030-11-13";
    expect((await post(`/operator/agents/settlements/${identifier}/clear`,{},tokenB)).status).toBe(404);
    const reviewed=await post(`/operator/agents/settlements/${identifier}/clear`,{notes:"Reviewed sales report"});
    expect(reviewed.status).toBe(200);
    expect((await post(`/operator/agents/settlements/${identifier}/clear`,{})).status).toBe(200);
    expect(await M.Audit.countDocuments({action:"agent.daily_report.reviewed"})).toBe(1);
    expect(await M.JournalEntry.countDocuments()).toBe(0);
  });
  async function pending() {
    const hold: any = await createHold(a, tripId, ["L1"]);
    const booking: any = await createBooking(
      a,
      {
        tripId,
        holdId: hold.holdId,
        passengers: [{ name: "Cash passenger", seat: "L1" }],
      },
      randomUUID(),
      "operator",
    );
    expect(booking.status).toBe("Pending payment");
    expect(booking.paymentStatus).toBe("Pending");
    return { hold, booking };
  }
  it("records counter cash and one balanced ledger journal exactly once", async () => {
    const { booking } = await pending();
    const first = await confirmDirectBooking(a, String(booking._id));
    const second = await confirmDirectBooking(a, String(booking._id));
    expect(first.status).toBe("Confirmed");
    expect(second.pnr).toBe(first.pnr);
    expect(await M.Ticket.countDocuments({ bookingId: booking._id })).toBe(1);
    expect(
      await M.Payment.countDocuments({
        bookingId: booking._id,
        providerId: "counter_cash",
      }),
    ).toBe(1);
    expect(
      await M.JournalEntry.countDocuments({ bookingId: booking._id }),
    ).toBe(1);
    const trip: any = await M.Trip.findById(tripId).lean();
    expect(trip.seats.find((s: any) => s.number === "L1").state).toBe("booked");
  });
  it("cannot steal an expired booking's replacement hold or record cash", async () => {
    const { hold, booking } = await pending();
    await M.Hold.updateOne(
      { holdId: hold.holdId },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    await M.Trip.updateOne(
      { _id: tripId },
      { $set: { "seats.$[s].holdUntil": new Date(Date.now() - 1000) } },
      { arrayFilters: [{ "s.number": "L1" }] },
    );
    const replacement: any = await createHold(a, tripId, ["L1"]);
    await expect(
      confirmDirectBooking(a, String(booking._id)),
    ).rejects.toMatchObject({ code: "HOLD_EXPIRED" });
    const trip: any = await M.Trip.findById(tripId).lean();
    expect(trip.seats[0].holdId).toBe(replacement.holdId);
    expect(trip.seats[0].state).toBe("held");
    expect(await M.Payment.countDocuments({ bookingId: booking._id })).toBe(0);
    expect(await M.Ticket.countDocuments({ bookingId: booking._id })).toBe(0);
  });
  it("denies another operator and agent cash confirmation", async () => {
    const { booking } = await pending();
    await expect(
      confirmDirectBooking(b, String(booking._id)),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      confirmDirectBooking(
        { ...a, role: "agent", agentId: String(new mongoose.Types.ObjectId()) },
        String(booking._id),
      ),
    ).rejects.toMatchObject({ code: "OPERATOR_REQUIRED" });
  });
});

describe("cancellation refund and recovery", () => {
  async function accounting() {
    await M.Policy.create({ operatorId: a.operatorId, rules: [{ hoursBefore: 24, refundPercent: 80 }, { hoursBefore: 0, refundPercent: 20 }] });
    await RefundWorkflow.configureCancellationAccounting(a, { enabled: true, refundBasis: "Discounted base fare", taxTreatment: "Proportional refund", chargeTreatment: "Non-refundable", commissionTreatment: "Reverse all", allowExceptionRefunds: true, version: 0, reason: "Approved isolated refund accounting fixture" });
  }
  async function paid(seats = ["L1"]) {
    const hold: any = await createHold(a, tripId, seats);
    const booking: any = await createBooking(a, { tripId, holdId: hold.holdId, passengers: seats.map(seat => ({ name: "Refund passenger", seat })) }, randomUUID());
    const event = { verified: true as const, providerId: "razorpay_test", externalId: `pay_${randomUUID().replaceAll("-", "")}`, eventId: randomUUID(), operatorId: a.operatorId!, bookingId: String(booking._id), amountPaise: booking.totalPaise, currency: "INR" as const, status: "captured" as const };
    await applyVerifiedPayment(event); return { booking, event };
  }
  async function accepted(booking: any) {
    const cancellation: any = await requestCancellation(a, String(booking._id), "Passenger requests cancellation");
    const quote: any = await RefundWorkflow.quoteCancellation(a, String(booking._id));
    await RefundWorkflow.reviewCancellation(refundConfig, a, String(cancellation._id), "Accept", String(quote._id), "Approved exact current cancellation quote");
    const intent: any = await M.RefundIntent.findOne({ bookingId: booking._id }).lean();
    return { cancellation, quote, intent };
  }
  function provider(intent: any, paymentId: string, options = { status: "processed", timeout: false }) {
    let created = false;
    const evidence = () => ({ id: "rfnd_fixture", payment_id: paymentId, amount: intent.amountPaise, currency: "INR", receipt: intent.requestBody.receipt, notes: intent.requestBody.notes, status: options.status });
    const transport = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const path = String(url);
      if (path.includes("/refunds?")) return new Response(JSON.stringify({ items: created ? [evidence()] : [] }));
      if (path.endsWith(`/payments/${paymentId}`)) { const payment: any = await M.Payment.findById(intent.paymentId).lean(); return new Response(JSON.stringify({ id: paymentId, currency: "INR", status: "captured", amount: payment.amountPaise, amount_refunded: 0 })); }
      if (path.endsWith(`/payments/${paymentId}/refund`) && init?.method === "POST") { created = true; if (options.timeout) throw Error("fixture timeout after gateway accepted refund"); return new Response(JSON.stringify(evidence())); }
      if (path.endsWith("/refunds/rfnd_fixture")) return new Response(JSON.stringify(evidence()));
      throw Error(`Unexpected isolated provider path ${path}`);
    });
    return { transport, evidence, options };
  }
  it("fails closed for missing accounting policy, unknown percentage precision and unsupported partial scope", async () => {
    const { booking } = await paid(["L1", "L2"]);
    await expect(RefundWorkflow.quoteCancellation(a, String(booking._id))).rejects.toMatchObject({ code: "CANCELLATION_ACCOUNTING_REQUIRED" });
    await accounting();
    await expect(RefundWorkflow.quoteCancellation(a, String(booking._id), ["L1"])).rejects.toMatchObject({ code: "PARTIAL_CANCELLATION_UNSUPPORTED" });
    await expect(RefundWorkflow.quoteCancellation(a, String(booking._id), ["L1", "L1", "L2"])).rejects.toMatchObject({ code: "INVALID_CANCELLATION_SCOPE" });
    expect(() => RefundWorkflow.percentBasisPoints(80.001)).toThrow();
    expect(RefundWorkflow.percentBasisPoints(80.25)).toBe(8025n);
    const quote: any = await RefundWorkflow.quoteCancellation(a, String(booking._id), ["L2", "L1"]);
    expect(quote.refundPaise).toBe(232000);
  });
  it("quotes explicit tax and non-refundable charges with integer-paise rounding", async () => {
    await accounting();
    await M.PricingPolicy.updateOne({ operatorId: a.operatorId }, { $set: { taxBasisPoints: 500, chargePaise: 1000 }, $inc: { version: 1 } });
    const { booking } = await paid();
    const quote: any = await RefundWorkflow.quoteCancellation(a, String(booking._id));
    expect(quote).toMatchObject({ originalPaise: 153250, baseRefundPaise: 116000, taxRefundPaise: 5800, chargeRefundPaise: 0, refundPaise: 121800, retainedPaise: 31450 });
    expect(await M.RefundIntent.countDocuments()).toBe(0);
  });
  it("accepts a full cancellation once, invalidates the ticket and reallocates liabilities without claiming a refund", async () => {
    await accounting(); const { booking } = await paid();
    const cancellation: any = await requestCancellation(a, String(booking._id), "Full cancellation fixture");
    const quote: any = await RefundWorkflow.quoteCancellation(a, String(booking._id));
    await Promise.all([RefundWorkflow.reviewCancellation(refundConfig, a, String(cancellation._id), "Accept", String(quote._id), "Approved exact current cancellation quote"), RefundWorkflow.reviewCancellation(refundConfig, a, String(cancellation._id), "Accept", String(quote._id), "Approved exact current cancellation quote")]);
    expect(await M.Booking.findById(booking._id).lean()).toMatchObject({ status: "Cancelled", paymentStatus: "Refund pending" });
    expect((await M.Trip.findById(tripId))!.seats[0].state).toBe("available");
    expect(await M.Ticket.findOne({ bookingId: booking._id }).lean()).toMatchObject({ status: "cancelled" });
    expect(await M.JournalEntry.countDocuments({ kind: "Cancellation adjustment" })).toBe(1);
    expect(await M.RefundIntent.countDocuments()).toBe(1);
    expect(await M.Refund.findOne().lean()).toMatchObject({ status: "Requested", amountPaise: 116000 });
    expect(await verifyLedger(a.operatorId!)).toMatchObject({ consistent: true });
  });
  it("rejects stale quotes, changed policies, departed trips and missing explicit quotes", async () => {
    await accounting(); const { booking } = await paid();
    const cancellation: any = await requestCancellation(a, String(booking._id), "Cancellation quote expiry fixture");
    const quote: any = await RefundWorkflow.quoteCancellation(a, String(booking._id));
    await expect(RefundWorkflow.reviewCancellation(refundConfig, a, String(cancellation._id), "Accept", undefined, "Quote required explicitly")).rejects.toMatchObject({ code: "QUOTE_REQUIRED" });
    await M.Policy.updateOne({ operatorId: a.operatorId }, { $inc: { version: 1 } });
    await expect(RefundWorkflow.reviewCancellation(refundConfig, a, String(cancellation._id), "Accept", String(quote._id), "Must revalidate policy")).rejects.toMatchObject({ code: "POLICY_CONFLICT" });
    const fresh: any = await RefundWorkflow.quoteCancellation(a, String(booking._id));
    await M.CancellationQuote.collection.updateOne({ _id: fresh._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(RefundWorkflow.reviewCancellation(refundConfig, a, String(cancellation._id), "Accept", String(fresh._id), "Expired quotes cannot execute")).rejects.toMatchObject({ code: "CANCELLATION_QUOTE_EXPIRED" });
    await M.Trip.updateOne({ _id: tripId }, { $set: { departureAt: new Date(Date.now() - 1000) } });
    await expect(RefundWorkflow.quoteCancellation(a, String(booking._id))).rejects.toMatchObject({ code: "DEPARTED" });
    expect(await M.Booking.findById(booking._id).lean()).toMatchObject({ status: "Confirmed", paymentStatus: "Paid" });
  });
  it("preserves replacement ownership and historical accounting rather than inventing a backfill", async () => {
    await accounting(); const { booking } = await paid();
    const cancellation: any = await requestCancellation(a, String(booking._id), "Ownership safety fixture");
    const quote: any = await RefundWorkflow.quoteCancellation(a, String(booking._id));
    await M.Trip.updateOne({ _id: tripId }, { $set: { "seats.0.state": "held", "seats.0.bookingId": new mongoose.Types.ObjectId(), "seats.0.holdId": "replacement-fixture" } });
    await expect(RefundWorkflow.reviewCancellation(refundConfig, a, String(cancellation._id), "Accept", String(quote._id), "Must preserve replacement")).rejects.toMatchObject({ code: "CANCELLATION_INVENTORY_CONFLICT" });
    expect((await M.Trip.findById(tripId))!.seats[0].holdId).toBe("replacement-fixture");
    await M.JournalEntry.collection.deleteMany({ bookingId: booking._id });
    await expect(RefundWorkflow.reviewCancellation(refundConfig, a, String(cancellation._id), "Accept", String(quote._id), "Never infer historical postings")).rejects.toMatchObject({ code: "LEDGER_HISTORY_REQUIRED" });
    expect(await M.Payment.countDocuments()).toBe(1); expect(await M.RefundIntent.countDocuments()).toBe(0);
  });
  it("rejects cancellation without changing booking, ticket, inventory or posted journals", async () => {
    await accounting(); const { booking } = await paid();
    const cancellation: any = await requestCancellation(a, String(booking._id), "Cancellation rejection fixture");
    await RefundWorkflow.reviewCancellation(refundConfig, a, String(cancellation._id), "Reject", undefined, "Rejected after authorized review");
    expect((await M.Booking.findById(booking._id))!.status).toBe("Confirmed");
    expect((await M.Ticket.findOne())!.status).toBe("valid");
    expect(await M.JournalEntry.countDocuments()).toBe(1);
  });
  it("completes a verified gateway refund once, validates idempotency headers and preserves replayed booking state", async () => {
    await accounting(); const { booking, event } = await paid(), { intent } = await accepted(booking);
    const mock = provider(intent, event.externalId);
    await Promise.all([RefundWorkflow.processRefundIntent(refundConfig, String(intent._id)), RefundWorkflow.processRefundIntent(refundConfig, String(intent._id))]);
    const posts = mock.transport.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(1);
    expect((posts[0][1]!.headers as Record<string, string>)["X-Refund-Idempotency"]).toBe(intent.idempotencyKey);
    expect(await M.Refund.findOne().lean()).toMatchObject({ status: "Refunded", amountPaise: 116000 });
    expect(await M.Payment.findOne().lean()).toMatchObject({ refundedPaise: 116000, status: "captured" });
    expect(await M.JournalEntry.countDocuments({ kind: "Refund" })).toBe(1);
    await applyVerifiedPayment({ ...event, eventId: randomUUID() });
    expect(await M.Booking.findById(booking._id).lean()).toMatchObject({ status: "Cancelled", paymentStatus: "Refunded" });
    expect(await verifyLedger(a.operatorId!)).toMatchObject({ consistent: true });
  });
  it("does not mark submitted or pending gateway refunds completed", async () => {
    await accounting(); const { booking, event } = await paid(), { intent } = await accepted(booking);
    const mock = provider(intent, event.externalId, { status: "pending", timeout: false });
    expect(await RefundWorkflow.processRefundIntent(refundConfig, String(intent._id))).toMatchObject({ status: "pending" });
    expect((await M.Refund.findOne())!.status).toBe("Provider pending"); expect(await M.JournalEntry.countDocuments({ kind: "Refund" })).toBe(0);
    mock.options.status = "processed";
    await RefundWorkflow.processRefundIntent(refundConfig, String(intent._id));
    expect(mock.transport.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect((await M.Refund.findOne())!.status).toBe("Refunded");
  });
  it("reconciles refund timeouts by the original receipt before any repeat request", async () => {
    await accounting(); const { booking, event } = await paid(), { intent } = await accepted(booking);
    const mock = provider(intent, event.externalId, { status: "processed", timeout: true });
    expect(await RefundWorkflow.processRefundIntent(refundConfig, String(intent._id))).toMatchObject({ status: "Uncertain" });
    expect((await M.Refund.findOne())!.status).toBe("Requested");
    await RefundWorkflow.processRefundIntent(refundConfig, String(intent._id));
    expect(mock.transport.mock.calls.some(([url]) => String(url).includes("/refunds?"))).toBe(true);
    expect(mock.transport.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(await M.RefundIntent.findById(intent._id).lean()).toMatchObject({ status: "Processed", totalAttempts: 2 });
  });
  it("retains failed refund exceptions and recovers only after authenticated status verification", async () => {
    await accounting(); const { booking, event } = await paid(), { intent } = await accepted(booking);
    const mock = provider(intent, event.externalId, { status: "failed", timeout: false });
    await RefundWorkflow.processRefundIntent(refundConfig, String(intent._id));
    expect((await M.Refund.findOne())!.status).toBe("Failed"); expect(await M.FinanceException.countDocuments({ status: "Open" })).toBe(1);
    mock.options.status = "processed";
    const raw = JSON.stringify({ event: "refund.processed", payload: { refund: { entity: mock.evidence() } } });
    const signature = createHmac("sha256", paymentConfig.RAZORPAY_WEBHOOK_SECRET).update(raw).digest("hex");
    expect((await request(refundApp).post("/api/v1/webhooks/razorpay").set("Content-Type", "application/json").send(raw)).status).toBe(400);
    for (let i = 0; i < 2; i++) expect((await request(refundApp).post("/api/v1/webhooks/razorpay").set("Content-Type", "application/json").set("x-razorpay-signature", signature).send(raw)).status).toBe(200);
    expect(await M.JournalEntry.countDocuments({ kind: "Refund" })).toBe(1);
    expect((await M.Refund.findOne())!.status).toBe("Refunded");
  });
  it("retains a durable verified-refund recovery path if journal posting aborts", async () => {
    await accounting(); const { booking, event } = await paid(), { intent } = await accepted(booking);
    provider(intent, event.externalId);
    vi.spyOn(M.Refund, "updateOne").mockRejectedValueOnce(Error("fixture posting failure"));
    expect(await RefundWorkflow.processRefundIntent(refundConfig, String(intent._id))).toMatchObject({ status: "Uncertain" });
    expect(await M.JournalEntry.countDocuments({ kind: "Refund" })).toBe(0);
    expect((await M.Payment.findOne())!.refundedPaise).toBe(0);
    await RefundWorkflow.processRefundIntent(refundConfig, String(intent._id));
    expect(await M.JournalEntry.countDocuments({ kind: "Refund" })).toBe(1);
    expect(await verifyLedger(a.operatorId!)).toMatchObject({ consistent: true });
  });
  it("enforces cross-operator and agent review boundaries and rejects arbitrary refund amounts", async () => {
    await accounting(); const { booking } = await paid(), { cancellation, intent } = await accepted(booking);
    const access = await request(refundApp).get(`/api/v1/operator/finance/refund-intents/${intent._id}`).set("Authorization", `Bearer ${tokenB}`);
    expect(access.status).toBe(404);
    await expect(RefundWorkflow.reviewCancellation(refundConfig, b, String(cancellation._id), "Reject", undefined, "Foreign operator cannot review")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await request(refundApp).post(`/api/v1/operator/finance/refund-intents/${intent._id}/process`).set("Authorization", `Bearer ${tokenA}`).send({ amountPaise: 1, processed: true })).status).toBe(400);
    expect((await request(refundApp).get("/api/v1/platform/finance/exceptions").set("Authorization", `Bearer ${tokenA}`)).status).toBe(403);
    expect((await request(refundApp).get("/api/v1/operator/finance/exceptions").set("Authorization", `Bearer ${readerToken}`)).status).toBe(403);
  });
  it("records additional captures in suspense without duplicating tickets or changing the first booking", async () => {
    const { booking, event } = await paid();
    const second = { ...event, eventId: randomUUID(), externalId: "pay_secondcapture" };
    await applyVerifiedPayment(second); await applyVerifiedPayment({ ...second, eventId: randomUUID() });
    expect(await M.Payment.countDocuments({ bookingId: booking._id })).toBe(2);
    expect(await M.JournalEntry.countDocuments({ kind: "Payment exception" })).toBe(1);
    expect(await M.FinanceException.countDocuments({ kind: "Duplicate capture" })).toBe(1);
    expect(await M.Ticket.countDocuments()).toBe(1);
    expect((await M.Booking.findById(booking._id))!.status).toBe("Confirmed");
    expect(await verifyLedger(a.operatorId!)).toMatchObject({ consistent: true });
  });
  it("never processes refunds when finance test mode is disabled", async () => {
    await accounting(); const { booking } = await paid(), { intent } = await accepted(booking);
    const transport = vi.spyOn(globalThis, "fetch");
    await expect(RefundWorkflow.processRefundIntent(config, String(intent._id))).rejects.toMatchObject({ code: "FINANCE_DISABLED" });
    expect(transport).not.toHaveBeenCalled();
    expect(await RefundWorkflow.reconcileRefundIntents(config)).toMatchObject({ disabled: true });
  });
  async function agencyPaid(mode: "wallet" | "credit") {
    const agency = await M.SalesPartner.create({ operatorId: a.operatorId, name: "Refund agency", kind: "Agent", permissions: ["wallet", "credit", "book", "bookings", "tickets", "cancel", "commissions"], commissionRate: 500 });
    const hash = await M.User.findById(a.userId).select("+passwordHash").lean();
    const user = await M.User.create({ operatorId: a.operatorId, salesPartnerId: agency._id, role: "agent", name: "Refund agency user", email: `${randomUUID()}@refund.test`, passwordHash: hash!.passwordHash });
    const actor: Principal = { ...a, role: "agent", userId: String(user._id), agentId: String(agency._id), permissions: ["bookings:write"] };
    await AgencyFinance.createWallet(a, String(agency._id));
    await AgencyFinance.configureFinancePolicy(a, { walletEnabled: true, creditEnabled: true, testOperationsEnabled: true, custodyOwner: "Operator", version: 0, reason: "Isolated source reversal fixture" });
    if (mode === "wallet") {
      const intent: any = await AgencyFinance.requestFunding(actor, undefined, 300000, "Wallet", randomUUID());
      await AgencyFinance.reviewFunding(walletConfig, a, actor.agentId!, String(intent._id), "Verify test evidence", "Verified test funding");
      await AgencyFinance.reviewFunding(walletConfig, a, actor.agentId!, String(intent._id), "Confirm", "Post verified test funding");
    } else await AgencyFinance.configureCredit(a, actor.agentId!, 300000, "Active", randomUUID(), "Authorized isolated test exposure");
    const hold: any = await createHold(actor, tripId, ["L1"]);
    const booking: any = await createBooking(actor, { tripId, holdId: hold.holdId, passengers: [{ name: "Source reversal passenger", seat: "L1" }] }, randomUUID());
    const reserved: any = await AgencyFinance.reserveBookingFunds(walletConfig, actor, String(booking._id), mode, randomUUID());
    await AgencyFinance.confirmFundedBooking(walletConfig, actor, String(reserved._id));
    return { actor, booking };
  }
  it.each(["wallet", "credit"] as const)("refunds the original %s source once and reverses the agency commission", async mode => {
    await accounting(); const { actor, booking } = await agencyPaid(mode), { intent } = await accepted(booking);
    const transport = vi.spyOn(globalThis, "fetch");
    await Promise.all([RefundWorkflow.processRefundIntent(refundConfig, String(intent._id)), RefundWorkflow.processRefundIntent(refundConfig, String(intent._id))]);
    expect(transport).not.toHaveBeenCalled();
    const wallet = await AgencyFinance.walletView(actor);
    expect(wallet.postedPaise).toBe(mode === "wallet" ? 271000 : 0);
    expect(wallet.creditOutstandingPaise).toBe(mode === "credit" ? 29000 : 0);
    const account: any = await M.LedgerAccount.findOne({ operatorId: a.operatorId, code: "agent-commission-payable", ownerId: actor.agentId }).lean();
    const balance: any = await M.AccountBalanceProjection.findOne({ accountId: account._id }).lean();
    expect(balance.creditPaise).toBe(7250); expect(balance.debitPaise).toBe(7250);
    expect(await M.JournalEntry.countDocuments({ kind: "Refund" })).toBe(1);
    expect(await verifyLedger(a.operatorId!)).toMatchObject({ consistent: true });
  });
  it("does not convert repaid credit into wallet cash during a refund", async () => {
    await accounting(); const { actor, booking } = await agencyPaid("credit");
    const repayment: any = await AgencyFinance.requestFunding(actor, undefined, 145000, "Credit repayment", randomUUID());
    await AgencyFinance.reviewFunding(walletConfig, a, actor.agentId!, String(repayment._id), "Verify test evidence", "Verified test repayment");
    await AgencyFinance.reviewFunding(walletConfig, a, actor.agentId!, String(repayment._id), "Confirm", "Post verified test repayment");
    const { intent } = await accepted(booking);
    expect(await RefundWorkflow.processRefundIntent(refundConfig, String(intent._id))).toMatchObject({ status: "Manual review", code: "CREDIT_REFUND_REVIEW" });
    expect(await AgencyFinance.walletView(actor)).toMatchObject({ postedPaise: 0, creditOutstandingPaise: 0 });
    expect(await M.JournalEntry.countDocuments({ kind: "Refund" })).toBe(0);
  });
  it("refunds an explicitly approved duplicate-capture exception without cancelling the valid ticket", async () => {
    await accounting(); const { booking, event } = await paid();
    await applyVerifiedPayment({ ...event, eventId: randomUUID(), externalId: "pay_duplicateexception" });
    const issue: any = await M.FinanceException.findOne({ kind: "Duplicate capture" }).lean();
    await RefundReview.approveExceptionRefund(refundConfig, a, String(issue._id), "Approved full duplicate capture test refund");
    const intent: any = await M.RefundIntent.findOne({ purpose: "Payment exception" }).lean();
    provider(intent, "pay_duplicateexception");
    await RefundWorkflow.processRefundIntent(refundConfig, String(intent._id));
    expect((await M.Ticket.findOne())!.status).toBe("valid");
    expect(await M.Booking.findById(booking._id).lean()).toMatchObject({ status: "Confirmed", paymentStatus: "Paid" });
    expect(await M.FinanceException.findById(issue._id).lean()).toMatchObject({ status: "Resolved" });
    expect(await verifyLedger(a.operatorId!)).toMatchObject({ consistent: true });
  });
  it("requires verified evidence to close exceptions and records authorized retry budgets", async () => {
    await accounting(); const { booking, event } = await paid(), { intent } = await accepted(booking);
    const mock = provider(intent, event.externalId, { status: "pending", timeout: false });
    await RefundWorkflow.processRefundIntent(refundConfig, String(intent._id));
    const issue: any = await RefundWorkflow.recordFinanceException({ operatorId: a.operatorId!, bookingId: String(booking._id), paymentId: String(intent.paymentId), intentId: String(intent._id), kind: "Refund review", resourceKey: String(intent._id), code: "FIXTURE_REVIEW" });
    await expect(RefundReview.reviewFinanceException(a, String(issue._id), "Resolve verified refund", "A click is not financial proof")).rejects.toMatchObject({ code: "VERIFIED_EVIDENCE_REQUIRED" });
    await M.RefundIntent.updateOne({ _id: intent._id }, { $set: { attempts: 5, status: "Manual review", leaseUntil: new Date(0) } });
    await RefundReview.authorizeRefundRecheck(a, String(intent._id), "Authorized bounded provider status recheck");
    expect(await M.RefundIntent.findById(intent._id).lean()).toMatchObject({ status: "Uncertain", attempts: 0, reviewCycles: 1 });
    mock.options.status = "processed"; await RefundWorkflow.processRefundIntent(refundConfig, String(intent._id));
    expect(mock.transport.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
  it("requires explicit Super Admin refund review grants in addition to financial read access", async () => {
    await accounting(); const { booking } = await paid();
    const cancellation: any = await requestCancellation(a, String(booking._id), "Privileged review fixture");
    const hash = await M.User.findById(a.userId).select("+passwordHash").lean();
    const user = await M.User.create({ name: "Finance admin", email: "refund-admin@fixture.test", role: "super_admin", passwordHash: hash!.passwordHash, platformFinanceRead: true });
    const login = await request(refundApp).post("/api/v1/auth/login").set("X-Aibus-Client", "admin").send({ email: user.email, password });
    const call = () => request(refundApp).post(`/api/v1/platform/finance/cancellations/${cancellation._id}/review`).set("Authorization", `Bearer ${login.body.data.accessToken}`).send({ action: "Reject", reason: "Authorized platform review fixture" });
    expect((await call()).status).toBe(403);
    await M.User.updateOne({ _id: user._id }, { $set: { platformFinanceActions: ["refunds:review"] } });
    expect((await call()).status).toBe(200);
    expect((await M.Booking.findById(booking._id))!.status).toBe("Confirmed");
  });
});

describe("agency wallet and credit", () => {
  const wpost = (
    path: string,
    body: unknown,
    token: string,
    key = randomUUID(),
  ) =>
    request(walletApp)
      .post(`/api/v1${path}`)
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", key)
      .send(body);
  async function setup() {
    const agency = await M.SalesPartner.create({
      operatorId: a.operatorId,
      name: "Wallet agency",
      kind: "Agent",
      commissionRate: 500,
      permissions: [
        "wallet",
        "credit",
        "book",
        "bookings",
        "tickets",
        "commissions",
      ],
    });
    const hash = await M.User.findById(a.userId).select("+passwordHash").lean();
    const user = await M.User.create({
      operatorId: a.operatorId,
      salesPartnerId: agency._id,
      role: "agent",
      name: "Wallet agent",
      email: `${randomUUID()}@wallet.test`,
      passwordHash: hash!.passwordHash,
    });
    const login = await request(walletApp)
      .post("/api/v1/auth/login")
      .set("X-Aibus-Client", "agent")
      .send({ email: user.email, password });
    expect(login.status).toBe(200);
    const actor: Principal = {
      ...a,
      userId: String(user._id),
      role: "agent",
      agentId: String(agency._id),
      permissions: ["bookings:write"],
    };
    await AgencyFinance.createWallet(a, String(agency._id));
    await AgencyFinance.configureFinancePolicy(a, {
      walletEnabled: true,
      creditEnabled: true,
      testOperationsEnabled: true,
      custodyOwner: "Operator",
      version: 0,
      reason: "Approved isolated test fixture policy",
    });
    return {
      id: String(agency._id),
      actor,
      token: login.body.data.accessToken,
    };
  }
  async function fund(
    agent: Awaited<ReturnType<typeof setup>>,
    amount = 300000,
    purpose: "Wallet" | "Credit repayment" = "Wallet",
  ) {
    const intent: any = await AgencyFinance.requestFunding(
      agent.actor,
      undefined,
      amount,
      purpose,
      randomUUID(),
    );
    await AgencyFinance.reviewFunding(
      walletConfig,
      a,
      agent.id,
      String(intent._id),
      "Verify test evidence",
      "Isolated test provider evidence",
    );
    await AgencyFinance.reviewFunding(
      walletConfig,
      a,
      agent.id,
      String(intent._id),
      "Confirm",
      "Confirm verified isolated evidence",
    );
    return intent;
  }
  async function book(agent: Awaited<ReturnType<typeof setup>>, seat = "L1") {
    const hold: any = await createHold(agent.actor, tripId, [seat]);
    return createBooking(
      agent.actor,
      {
        tripId,
        holdId: hold.holdId,
        passengers: [{ name: "Wallet passenger", seat }],
      },
      randomUUID(),
    ) as Promise<any>;
  }
  it("defaults to disabled policies and rejects finance test mode in production", async () => {
    expect(await AgencyFinance.financePolicy(a.operatorId!)).toMatchObject({
      walletEnabled: false,
      creditEnabled: false,
      custodyOwner: "Unconfigured",
    });
    expect(() => AgencyFinance.testFinance(config)).toThrow();
    expect(() =>
      readConfig({
        NODE_ENV: "production",
        FINANCE_TEST_MODE: "true",
        MONGODB_URI: "mongodb://u:p@localhost/test",
        JWT_SECRET: "x".repeat(64),
        WEB_ORIGIN: "https://operator.test",
        REDIS_URL: "rediss://:p@localhost:6379",
      }),
    ).toThrow("cannot run in production");
  });
  it("requires verified server test evidence and posts funding once with balanced journals", async () => {
    const agent = await setup(),
      key = randomUUID();
    const intent: any = await AgencyFinance.requestFunding(
      agent.actor,
      undefined,
      200000,
      "Wallet",
      key,
    );
    expect(
      String(
        (
          (await AgencyFinance.requestFunding(
            agent.actor,
            undefined,
            200000,
            "Wallet",
            key,
          )) as any
        )._id,
      ),
    ).toBe(String(intent._id));
    await expect(
      AgencyFinance.requestFunding(
        agent.actor,
        undefined,
        200001,
        "Wallet",
        key,
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(
      AgencyFinance.reviewFunding(
        walletConfig,
        a,
        agent.id,
        String(intent._id),
        "Confirm",
        "Unverified claim rejected",
      ),
    ).rejects.toMatchObject({ code: "EVIDENCE_REQUIRED" });
    expect((await AgencyFinance.walletView(agent.actor)).postedPaise).toBe(0);
    await AgencyFinance.reviewFunding(
      walletConfig,
      a,
      agent.id,
      String(intent._id),
      "Verify test evidence",
      "Test provider verification",
    );
    await Promise.all([
      AgencyFinance.reviewFunding(
        walletConfig,
        a,
        agent.id,
        String(intent._id),
        "Confirm",
        "Confirm verified test funding",
      ),
      AgencyFinance.reviewFunding(
        walletConfig,
        a,
        agent.id,
        String(intent._id),
        "Confirm",
        "Confirm verified test funding",
      ),
    ]);
    expect((await AgencyFinance.walletView(agent.actor)).postedPaise).toBe(
      200000,
    );
    expect(
      await M.JournalEntry.countDocuments({ kind: "Wallet funding" }),
    ).toBe(1);
    expect(await verifyLedger(a.operatorId!)).toMatchObject({
      consistent: true,
    });
  });
  it("rejects live funding, invalid amounts and client evidence claims", async () => {
    const agent = await setup();
    const intent: any = await AgencyFinance.requestFunding(
      agent.actor,
      undefined,
      100,
      "Wallet",
      randomUUID(),
    );
    await expect(
      AgencyFinance.reviewFunding(
        config,
        a,
        agent.id,
        String(intent._id),
        "Verify test evidence",
        "No live funding permitted",
      ),
    ).rejects.toMatchObject({ code: "FINANCE_DISABLED" });
    for (const value of [-1, 0, 0.1, Number.MAX_SAFE_INTEGER + 1])
      await expect(
        AgencyFinance.requestFunding(
          agent.actor,
          undefined,
          value,
          "Wallet",
          randomUUID(),
        ),
      ).rejects.toBeDefined();
    expect(
      (
        await wpost(
          "/agent/wallet/funding",
          {
            amountPaise: 100,
            purpose: "Wallet",
            verified: true,
            transferId: "fake",
          },
          agent.token,
        )
      ).status,
    ).toBe(400);
  });
  it("isolates wallets and funding status across agencies and operators", async () => {
    const agent = await setup();
    expect(
      (
        await request(walletApp)
          .get(`/api/v1/operator/finance/wallets/${agent.id}`)
          .set("Authorization", `Bearer ${tokenB}`)
      ).status,
    ).toBe(404);
    expect(
      (
        await request(walletApp)
          .get(`/api/v1/operator/finance/wallets/${agent.id}`)
          .set("Authorization", `Bearer ${agent.token}`)
      ).status,
    ).toBe(403);
    const another = await M.SalesPartner.create({
      operatorId: a.operatorId,
      name: "Other wallet",
      kind: "Agent",
    });
    await AgencyFinance.createWallet(a, String(another._id));
    const intent: any = await AgencyFinance.requestFunding(
      a,
      String(another._id),
      100,
      "Wallet",
      randomUUID(),
    );
    expect(
      (
        await request(walletApp)
          .get(`/api/v1/agent/wallet/funding/${intent._id}`)
          .set("Authorization", `Bearer ${agent.token}`)
      ).status,
    ).toBe(404);
    expect(
      (
        await request(walletApp)
          .get(`/api/v1/agent/wallet?agentId=${another._id}`)
          .set("Authorization", `Bearer ${agent.token}`)
      ).status,
    ).toBe(400);
  });
  it("prevents concurrent prepaid overspend and duplicate reservations", async () => {
    const agent = await setup();
    await fund(agent, 200000);
    const first = await book(agent),
      second = await book(agent, "L2");
    const results = await Promise.allSettled([
      AgencyFinance.reserveBookingFunds(
        walletConfig,
        agent.actor,
        String(first._id),
        "wallet",
        randomUUID(),
      ),
      AgencyFinance.reserveBookingFunds(
        walletConfig,
        agent.actor,
        String(second._id),
        "wallet",
        randomUUID(),
      ),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await AgencyFinance.walletView(agent.actor)).reservedPaise).toBe(
      145000,
    );
    expect((await AgencyFinance.walletView(agent.actor)).availablePaise).toBe(
      55000,
    );
    expect(await M.WalletReservation.countDocuments()).toBe(1);
  });
  it("confirms wallet bookings atomically, preserves commission and never moves it into prepaid funds", async () => {
    const agent = await setup();
    await fund(agent, 300000);
    const booking = await book(agent),
      key = randomUUID();
    const reserved: any = await AgencyFinance.reserveBookingFunds(
      walletConfig,
      agent.actor,
      String(booking._id),
      "wallet",
      key,
    );
    expect(
      String(
        (
          (await AgencyFinance.reserveBookingFunds(
            walletConfig,
            agent.actor,
            String(booking._id),
            "wallet",
            key,
          )) as any
        )._id,
      ),
    ).toBe(String(reserved._id));
    const results: any[] = await Promise.all([
      AgencyFinance.confirmFundedBooking(
        walletConfig,
        agent.actor,
        String(reserved._id),
      ),
      AgencyFinance.confirmFundedBooking(
        walletConfig,
        agent.actor,
        String(reserved._id),
      ),
    ]);
    expect(results.every((b) => b.status === "Confirmed")).toBe(true);
    expect(results[0].commissionPaise).toBe(7250);
    expect(await AgencyFinance.walletView(agent.actor)).toMatchObject({
      postedPaise: 155000,
      reservedPaise: 0,
      availablePaise: 155000,
    });
    expect(await M.Ticket.countDocuments()).toBe(1);
    expect(await M.Payment.countDocuments()).toBe(1);
    expect(
      await M.JournalEntry.countDocuments({ bookingId: booking._id }),
    ).toBe(1);
    expect(await verifyLedger(a.operatorId!)).toMatchObject({
      consistent: true,
    });
  });
  it("keeps credit limits separate from cash and enforces exposure under concurrent bookings", async () => {
    const agent = await setup();
    await AgencyFinance.configureCredit(
      a,
      agent.id,
      200000,
      "Active",
      randomUUID(),
      "Approved fixture exposure",
    );
    expect((await AgencyFinance.walletView(agent.actor)).postedPaise).toBe(0);
    expect(await M.JournalEntry.countDocuments()).toBe(0);
    const first = await book(agent),
      second = await book(agent, "L2");
    const results = await Promise.allSettled([
      AgencyFinance.reserveBookingFunds(
        walletConfig,
        agent.actor,
        String(first._id),
        "credit",
        randomUUID(),
      ),
      AgencyFinance.reserveBookingFunds(
        walletConfig,
        agent.actor,
        String(second._id),
        "credit",
        randomUUID(),
      ),
    ]);
    const successful = results.find(
      (r) => r.status === "fulfilled",
    ) as PromiseFulfilledResult<any>;
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await AgencyFinance.confirmFundedBooking(
      walletConfig,
      agent.actor,
      String(successful.value._id),
    );
    expect(await AgencyFinance.walletView(agent.actor)).toMatchObject({
      creditOutstandingPaise: 145000,
      creditAvailablePaise: 55000,
      postedPaise: 0,
    });
    await expect(
      AgencyFinance.configureCredit(
        a,
        agent.id,
        100000,
        "Active",
        randomUUID(),
        "Cannot undercut exposure",
      ),
    ).rejects.toMatchObject({ code: "CREDIT_IN_USE" });
  });
  it("posts verified repayments against credit, never cash wallet deposits", async () => {
    const agent = await setup();
    await AgencyFinance.configureCredit(
      a,
      agent.id,
      200000,
      "Active",
      randomUUID(),
      "Approved fixture credit",
    );
    const booking = await book(agent),
      reserved: any = await AgencyFinance.reserveBookingFunds(
        walletConfig,
        agent.actor,
        String(booking._id),
        "credit",
        randomUUID(),
      );
    await AgencyFinance.confirmFundedBooking(
      walletConfig,
      agent.actor,
      String(reserved._id),
    );
    await fund(agent, 45000, "Credit repayment");
    expect(await AgencyFinance.walletView(agent.actor)).toMatchObject({
      creditOutstandingPaise: 100000,
      creditAvailablePaise: 100000,
      postedPaise: 0,
    });
    await expect(fund(agent, 100001, "Credit repayment")).rejects.toMatchObject(
      { code: "REPAYMENT_EXCESS" },
    );
    expect(await verifyLedger(a.operatorId!)).toMatchObject({
      consistent: true,
    });
  });
  it("blocks suspended wallets, revoked grants and disabled credit", async () => {
    const agent = await setup();
    await fund(agent);
    const booking = await book(agent);
    await AgencyFinance.setWalletStatus(
      a,
      agent.id,
      "Suspended",
      "Operator fixture suspension",
    );
    await expect(
      AgencyFinance.reserveBookingFunds(
        walletConfig,
        agent.actor,
        String(booking._id),
        "wallet",
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "WALLET_SUSPENDED" });
    await AgencyFinance.setWalletStatus(
      a,
      agent.id,
      "Active",
      "Operator fixture restoration",
    );
    await expect(
      AgencyFinance.reserveBookingFunds(
        walletConfig,
        agent.actor,
        String(booking._id),
        "credit",
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "CREDIT_SUSPENDED" });
    await M.SalesPartner.updateOne(
      { _id: agent.id },
      { $pull: { permissions: "wallet" } },
    );
    await expect(AgencyFinance.walletView(agent.actor)).rejects.toMatchObject({
      code: "AGENT_FORBIDDEN",
    });
  });
  it("expires funds once and cannot debit after seat ownership is replaced", async () => {
    const agent = await setup();
    await fund(agent);
    const booking = await book(agent);
    const reservation: any = await AgencyFinance.reserveBookingFunds(
      walletConfig,
      agent.actor,
      String(booking._id),
      "wallet",
      randomUUID(),
    );
    const expired = new Date(Date.now() - 1000);
    await M.Hold.updateOne(
      { holdId: booking.holdId },
      { $set: { expiresAt: expired } },
    );
    await M.Trip.updateOne(
      { _id: tripId },
      { $set: { "seats.0.holdUntil": expired } },
    );
    const replacement: any = await createHold(a, tripId, ["L1"]);
    await expect(
      AgencyFinance.confirmFundedBooking(
        walletConfig,
        agent.actor,
        String(reservation._id),
      ),
    ).rejects.toMatchObject({ code: "HOLD_EXPIRED" });
    expect((await AgencyFinance.walletView(agent.actor)).postedPaise).toBe(
      300000,
    );
    await M.WalletReservation.updateOne(
      { _id: reservation._id },
      { $set: { expiresAt: expired } },
    );
    await Promise.all([
      AgencyFinance.expireFundingReservations(),
      AgencyFinance.expireFundingReservations(),
    ]);
    expect((await AgencyFinance.walletView(agent.actor)).reservedPaise).toBe(0);
    expect((await M.Trip.findById(tripId))!.seats[0]).toMatchObject({
      state: "held",
      holdId: replacement.holdId,
    });
    expect(await M.Payment.countDocuments()).toBe(0);
  });
  it("rejects mixed gateway and agency funding and preserves money on transaction rollback", async () => {
    const agent = await setup();
    await fund(agent);
    const booking = await book(agent);
    await M.Booking.updateOne(
      { _id: booking._id },
      { $set: { fundingMethod: "gateway" } },
    );
    await expect(
      AgencyFinance.reserveBookingFunds(
        walletConfig,
        agent.actor,
        String(booking._id),
        "wallet",
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "FUNDING_CONFLICT" });
    const other = await book(agent, "L2"),
      reservation: any = await AgencyFinance.reserveBookingFunds(
        walletConfig,
        agent.actor,
        String(other._id),
        "wallet",
        randomUUID(),
      );
    vi.spyOn(M.Ticket, "create").mockRejectedValueOnce(
      Error("fixture ticket failure"),
    );
    await expect(
      AgencyFinance.confirmFundedBooking(
        walletConfig,
        agent.actor,
        String(reservation._id),
      ),
    ).rejects.toThrow("fixture ticket failure");
    expect(await AgencyFinance.walletView(agent.actor)).toMatchObject({
      postedPaise: 300000,
      reservedPaise: 145000,
    });
    expect(await M.Payment.countDocuments()).toBe(0);
    expect(await M.JournalEntry.countDocuments({ bookingId: other._id })).toBe(
      0,
    );
    vi.restoreAllMocks();
    await AgencyFinance.confirmFundedBooking(
      walletConfig,
      agent.actor,
      String(reservation._id),
    );
    expect((await AgencyFinance.walletView(agent.actor)).postedPaise).toBe(
      155000,
    );
  });
  it("keeps credit authorization history immutable and rejects conflicting repeat keys", async () => {
    const agent = await setup(),
      key = randomUUID();
    await AgencyFinance.configureCredit(
      a,
      agent.id,
      100000,
      "Active",
      key,
      "Approved test facility",
    );
    await AgencyFinance.configureCredit(
      a,
      agent.id,
      100000,
      "Active",
      key,
      "Approved test facility",
    );
    expect(await M.CreditLimitHistory.countDocuments()).toBe(1);
    await expect(
      AgencyFinance.configureCredit(
        a,
        agent.id,
        100001,
        "Active",
        key,
        "Approved test facility",
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(
      M.CreditLimitHistory.updateOne({}, { $set: { afterPaise: 1 } }),
    ).rejects.toMatchObject({ code: "LEDGER_IMMUTABLE" });
  });
  it("reports real wallet exposure and exports only authorized agency statement lines", async () => {
    const agent = await setup();
    await fund(agent, 300000);
    expect(await AgencyFinance.walletOverview(a)).toMatchObject({
      prepaidLiabilityPaise: 300000,
      walletCount: 1,
      creditExposurePaise: 0,
    });
    expect(await AgencyFinance.walletOverview(b)).toMatchObject({
      prepaidLiabilityPaise: 0,
      walletCount: 0,
    });
    const statement = await walletStatement(
      agent.actor,
      undefined,
      "2020-01-01",
      "2040-01-01",
    );
    expect(statement).toContain("agency-prepaid");
    expect(statement).not.toContain("test-funds-clearing");
    await expect(
      walletStatement(b, agent.id, "2020-01-01", "2040-01-01"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(csvDocument([["=HYPERLINK(1)", "+unsafe", "safe"]])).toContain(
      "'=HYPERLINK",
    );
  });
});

describe("financial ledger foundation", () => {
  function journal(
    amount = 10000,
    key = randomUUID(),
    operatorId = a.operatorId!,
  ): JournalInput {
    return {
      operatorId,
      idempotencyKey: key,
      currency: "INR",
      kind: "Payment exception",
      reason: "Isolated fixture validated capture",
      lines: [
        {
          account: {
            ownerType: "Platform",
            ownerId: "aibus",
            code: "payment-clearing",
          },
          debitPaise: amount,
          creditPaise: 0,
        },
        {
          account: {
            ownerType: "Platform",
            ownerId: "aibus",
            code: "payment-exceptions",
          },
          debitPaise: 0,
          creditPaise: amount,
        },
      ],
    };
  }
  async function pending(actor = a, seat = "L1") {
    const hold: any = await createHold(actor, tripId, [seat]);
    return createBooking(
      actor,
      {
        tripId,
        holdId: hold.holdId,
        passengers: [{ name: "Finance passenger", seat }],
      },
      randomUUID(),
    ) as Promise<any>;
  }
  const event = (booking: any) => ({
    verified: true as const,
    providerId: "ledger-fixture",
    eventId: randomUUID(),
    externalId: randomUUID(),
    operatorId: a.operatorId!,
    bookingId: String(booking._id),
    amountPaise: booking.totalPaise,
    currency: "INR" as const,
    status: "captured" as const,
  });
  async function agency() {
    const partner = await M.SalesPartner.create({
      operatorId: a.operatorId,
      name: "Finance agency",
      kind: "Agent",
      commissionRate: 500,
    });
    const email = randomUUID() + "@ledger.test";
    const user = await M.User.create({
      operatorId: a.operatorId,
      salesPartnerId: partner._id,
      name: "Finance agent",
      role: "agent",
      email,
      passwordHash: await hashPassword(password),
    });
    const login = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Aibus-Client", "agent")
      .send({ email, password });
    expect(login.status).toBe(200);
    return {
      partner,
      token: login.body.data.accessToken,
      actor: {
        ...a,
        userId: String(user._id),
        role: "agent" as const,
        agentId: String(partner._id),
        permissions: ["bookings:write" as const],
      },
    };
  }
  it("posts balanced journals, atomic projections and non-expiring audit records", async () => {
    const posted = await postJournal(journal());
    expect(posted.totalPaise).toBe(10000);
    expect(await M.FinancialOperation.countDocuments()).toBe(1);
    expect(await M.AccountBalanceProjection.countDocuments()).toBe(2);
    expect(await verifyLedger(a.operatorId!)).toMatchObject({
      consistent: true,
      journals: 1,
    });
    expect(
      await M.Audit.findOne({ action: "ledger.posted" }).lean(),
    ).toMatchObject({ expiresAt: null });
  });
  it("rejects unbalanced journals and invalid line sides before any writes", async () => {
    const bad = journal();
    bad.lines[1].creditPaise--;
    await expect(postJournal(bad)).rejects.toMatchObject({
      code: "LEDGER_UNBALANCED",
    });
    const double = journal();
    double.lines[0].creditPaise = 1;
    await expect(postJournal(double)).rejects.toMatchObject({
      code: "LEDGER_LINE",
    });
    expect(await M.LedgerAccount.countDocuments()).toBe(0);
  });
  it("deduplicates concurrent operation keys with payload identity", async () => {
    const input = journal();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => postJournal(input)),
    );
    expect(new Set(results.map((r) => String(r._id))).size).toBe(1);
    const replay = await postJournal({
      ...input,
      lines: [...input.lines].reverse(),
    });
    expect(String(replay._id)).toBe(String(results[0]._id));
    await expect(
      postJournal({ ...input, reason: "Conflicting allocation" }),
    ).rejects.toMatchObject({ code: "LEDGER_IDEMPOTENCY_CONFLICT" });
    expect(await M.JournalEntry.countDocuments()).toBe(1);
    expect(await verifyLedger(a.operatorId!)).toMatchObject({
      consistent: true,
    });
  });
  it("serializes different concurrent postings to the same accounts without lost balances", async () => {
    await Promise.all(
      Array.from({ length: 4 }, () => postJournal(journal(100))),
    );
    const clearing = await M.LedgerAccount.findOne({
      code: "payment-clearing",
    }).lean();
    expect(
      await M.AccountBalanceProjection.findOne({
        accountId: clearing!._id,
      }).lean(),
    ).toMatchObject({ debitPaise: 400, creditPaise: 0, version: 4 });
    expect(await verifyLedger(a.operatorId!)).toMatchObject({
      consistent: true,
      journals: 4,
    });
  });
  it("rejects invalid currency, fractions, negatives, NaN and unsafe integers", async () => {
    await expect(
      postJournal({ ...journal(), currency: "USD" }),
    ).rejects.toMatchObject({ code: "LEDGER_CURRENCY" });
    for (const amount of [
      0,
      -1,
      0.1,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ])
      await expect(postJournal(journal(amount))).rejects.toBeDefined();
    const foreign = journal();
    foreign.lines[1].account = {
      ownerType: "Operator",
      ownerId: b.operatorId!,
      code: "operator-payable",
    };
    await expect(postJournal(foreign)).rejects.toMatchObject({
      code: "LEDGER_OWNER",
    });
    const partner = journal();
    partner.lines[1].account = {
      ownerType: "ApiPartner",
      ownerId: b.operatorId!,
      code: "partner-wallet",
    };
    await expect(postJournal(partner)).rejects.toMatchObject({
      code: "LEDGER_ACCOUNT",
    });
    expect(await M.JournalEntry.countDocuments()).toBe(0);
  });
  it("fails closed when required capture uniqueness is not installed", async () => {
    // Index change is restricted to this process's disposable memory replica set.
    await M.JournalEntry.collection.dropIndex("paymentId_1");
    try {
      await expect(postJournal(journal())).rejects.toMatchObject({
        code: "LEDGER_NOT_READY",
      });
      expect(await M.JournalEntry.countDocuments()).toBe(0);
    } finally {
      await M.JournalEntry.createIndexes();
    }
  });
  it("protects accumulated integer limits and rolls back overflow atomically", async () => {
    await postJournal(journal(Number.MAX_SAFE_INTEGER));
    await expect(postJournal(journal(1))).rejects.toMatchObject({
      code: "LEDGER_OVERFLOW",
    });
    expect(await M.JournalEntry.countDocuments()).toBe(1);
    expect(await M.FinancialOperation.countDocuments()).toBe(1);
    expect(await verifyLedger(a.operatorId!)).toMatchObject({
      consistent: true,
    });
  });
  it("rolls back journals, accounts, operations, projections and audit with the caller transaction", async () => {
    await expect(
      mongoose.connection.transaction(async (session) => {
        await postJournalInTransaction(journal(), session);
        throw Error("abort fixture");
      }),
    ).rejects.toThrow("abort fixture");
    for (const model of [
      M.JournalEntry,
      M.LedgerAccount,
      M.FinancialOperation,
      M.AccountBalanceProjection,
    ])
      expect(await model.countDocuments()).toBe(0);
    expect(await M.Audit.countDocuments({ action: "ledger.posted" })).toBe(0);
    const session = await mongoose.startSession();
    try {
      await expect(
        postJournalInTransaction(journal(), session),
      ).rejects.toMatchObject({ code: "LEDGER_TRANSACTION_REQUIRED" });
    } finally {
      await session.endSession();
    }
  });
  it("reverses by an immutable inverse entry, preserves references and prevents a second reversal", async () => {
    const original = await postJournal(journal());
    const key = randomUUID();
    const reversed = await reverseJournal(
      a.operatorId!,
      String(original._id),
      key,
      "Approved fixture correction",
      a.userId,
    );
    const replay = await reverseJournal(
      a.operatorId!,
      String(original._id),
      key,
      "Approved fixture correction",
      a.userId,
    );
    expect(String(replay._id)).toBe(String(reversed._id));
    expect(String(reversed.reversalOf)).toBe(String(original._id));
    expect(await M.JournalEntry.findById(original._id).lean()).toMatchObject({
      totalPaise: 10000,
      kind: "Payment exception",
    });
    await expect(
      reverseJournal(
        a.operatorId!,
        String(original._id),
        randomUUID(),
        "Second correction",
        a.userId,
      ),
    ).rejects.toBeDefined();
    await expect(
      reverseJournal(
        b.operatorId!,
        String(original._id),
        randomUUID(),
        "Foreign correction",
        b.userId,
      ),
    ).rejects.toMatchObject({ code: "LEDGER_REVERSAL" });
    const projections = await M.AccountBalanceProjection.find().lean();
    expect(projections.every((p) => p.debitPaise === p.creditPaise)).toBe(true);
    expect(await verifyLedger(a.operatorId!)).toMatchObject({
      consistent: true,
      journals: 2,
    });
  });
  it("rejects updates, deletes, bulk writes and document saves of posted financial history", async () => {
    const posted = await postJournal(journal());
    await expect(
      M.JournalEntry.updateOne(
        { _id: posted._id },
        { $set: { reason: "rewrite" } },
      ),
    ).rejects.toMatchObject({ code: "LEDGER_IMMUTABLE" });
    await expect(M.JournalEntry.deleteMany({})).rejects.toMatchObject({
      code: "LEDGER_IMMUTABLE",
    });
    await expect(
      M.JournalEntry.bulkWrite([
        { deleteOne: { filter: { _id: posted._id } } },
      ]),
    ).rejects.toMatchObject({ code: "LEDGER_IMMUTABLE" });
    const doc = await M.JournalEntry.findById(posted._id);
    doc!.set("reason", "rewrite");
    await expect(doc!.save()).rejects.toMatchObject({
      code: "LEDGER_IMMUTABLE",
    });
    await expect(
      M.LedgerAccount.updateMany({}, { $set: { ownerId: "foreign" } }),
    ).rejects.toMatchObject({ code: "LEDGER_IMMUTABLE" });
  });
  it("posts a new captured booking once across confirmation and reconciliation event retries", async () => {
    const booking = await pending();
    expect(await M.JournalEntry.countDocuments()).toBe(0);
    const capture = event(booking);
    await Promise.all([
      applyVerifiedPayment(capture),
      applyVerifiedPayment(capture),
    ]);
    await applyVerifiedPayment({ ...capture, eventId: randomUUID() });
    expect(await M.JournalEntry.countDocuments()).toBe(1);
    expect(await M.Payment.countDocuments()).toBe(1);
    expect(await M.Ticket.countDocuments()).toBe(1);
    expect(await M.JournalEntry.findOne().lean()).toMatchObject({
      kind: "Booking captured",
      totalPaise: 145000,
    });
    expect(await verifyLedger(a.operatorId!)).toMatchObject({
      consistent: true,
    });
  });
  it("rolls back booking confirmation when ledger audit fails and safely retries the same payment", async () => {
    const booking = await pending(),
      capture = event(booking);
    vi.spyOn(M.Audit, "create").mockRejectedValueOnce(
      Error("fixture audit failure"),
    );
    await expect(applyVerifiedPayment(capture)).rejects.toThrow(
      "fixture audit failure",
    );
    expect(await M.Payment.countDocuments()).toBe(0);
    expect(await M.Ticket.countDocuments()).toBe(0);
    expect((await M.Booking.findById(booking._id))!.status).toBe(
      "Pending payment",
    );
    expect(await M.JournalEntry.countDocuments()).toBe(0);
    vi.restoreAllMocks();
    await applyVerifiedPayment(capture);
    expect(await M.Ticket.countDocuments()).toBe(1);
    expect(await M.JournalEntry.countDocuments()).toBe(1);
  });
  it("enforces database capture uniqueness even if a trusted caller changes the operation key", async () => {
    const booking = await pending();
    await applyVerifiedPayment(event(booking));
    const payment = await M.Payment.findOne().lean();
    const duplicate = {
      ...journal(145000),
      bookingId: String(booking._id),
      paymentId: String(payment!._id),
    };
    await expect(postJournal(duplicate)).rejects.toMatchObject({ code: 11000 });
    expect(await M.JournalEntry.countDocuments()).toBe(1);
    expect(await M.FinancialOperation.countDocuments()).toBe(1);
    expect(
      await M.LedgerAccount.countDocuments({ code: "payment-exceptions" }),
    ).toBe(0);
    expect(await verifyLedger(a.operatorId!)).toMatchObject({
      consistent: true,
    });
  });
  it("records late capture in suspense without touching the replacement hold or earning commission", async () => {
    const booking = await pending();
    const expired = new Date(Date.now() - 1000);
    await M.Hold.updateOne(
      { holdId: booking.holdId },
      { $set: { expiresAt: expired } },
    );
    await M.Trip.updateOne(
      { _id: tripId },
      { $set: { "seats.0.holdUntil": expired } },
    );
    const replacement: any = await createHold(a, tripId, ["L1"]);
    const capture = event(booking);
    await applyVerifiedPayment(capture);
    await applyVerifiedPayment({ ...capture, eventId: randomUUID() });
    expect(await M.JournalEntry.findOne().lean()).toMatchObject({
      kind: "Payment exception",
      totalPaise: 145000,
    });
    expect(
      await M.LedgerAccount.countDocuments({
        code: "agent-commission-payable",
      }),
    ).toBe(0);
    expect((await M.Trip.findById(tripId))!.seats[0]).toMatchObject({
      state: "held",
      holdId: replacement.holdId,
    });
    expect(await M.Ticket.countDocuments()).toBe(0);
  });
  it("does not journal pending or failed payments", async () => {
    const booking = await pending();
    expect(await M.JournalEntry.countDocuments()).toBe(0);
    await applyVerifiedPayment({ ...event(booking), status: "failed" });
    expect(await M.JournalEntry.countDocuments()).toBe(0);
    expect(await M.FinancialOperation.countDocuments()).toBe(0);
  });
  it("enforces HTTP operator and agency financial ownership with redacted agency journal lines", async () => {
    const first = await agency(),
      second = await agency();
    const booking = await pending(first.actor);
    await applyVerifiedPayment(event(booking));
    const journalRow = await M.JournalEntry.findOne().lean();
    const agentAccount = await M.LedgerAccount.findOne({
      code: "agent-commission-payable",
    }).lean();
    expect(agentAccount).toMatchObject({
      ownerType: "Agent",
      ownerId: String(first.partner._id),
    });
    expect(
      await M.AccountBalanceProjection.findOne({
        accountId: agentAccount!._id,
      }).lean(),
    ).toMatchObject({ creditPaise: 7250 });
    const operatorAccount = await M.LedgerAccount.findOne({
      code: "operator-payable",
    }).lean();
    expect(
      await M.AccountBalanceProjection.findOne({
        accountId: operatorAccount!._id,
      }).lean(),
    ).toMatchObject({ creditPaise: 137750 });
    expect(
      (await get("/finance/accounts", first.token)).body.data.accounts,
    ).toHaveLength(1);
    const mine = (
      await get(`/finance/journals/${journalRow!._id}`, first.token)
    ).body.data;
    expect(mine.partialView).toBe(true);
    expect(mine.lines).toHaveLength(1);
    expect(mine.totalPaise).toBeUndefined();
    expect(mine.paymentId).toBeUndefined();
    expect(
      (await get(`/finance/journals/${journalRow!._id}`, second.token)).status,
    ).toBe(404);
    expect(
      (await get(`/finance/journals/${journalRow!._id}`, tokenB)).status,
    ).toBe(404);
    expect(
      (await get("/finance/accounts", tokenB)).body.data.accounts,
    ).toHaveLength(0);
    expect(
      (await get("/finance/accounts", tokenA)).body.data.accounts,
    ).toHaveLength(3);
    expect((await get("/finance/accounts", readerToken)).status).toBe(403);
    expect(
      (await get(`/finance/accounts?operatorId=${b.operatorId}`, tokenA))
        .status,
    ).toBe(400);
    await M.SalesPartner.updateOne(
      { _id: first.partner._id },
      { $pull: { permissions: "commissions" } },
    );
    expect((await get("/finance/accounts", first.token)).status).toBe(403);
  });
  it("rejects foreign agency account ownership and requires explicit Super Admin finance access", async () => {
    const foreign = await M.SalesPartner.create({
      operatorId: b.operatorId,
      kind: "Agent",
      name: "Foreign agency",
    });
    const input = journal();
    input.lines[1].account = {
      ownerType: "Agent",
      ownerId: String(foreign._id),
      code: "agent-commission-payable",
    };
    await expect(postJournal(input)).rejects.toMatchObject({
      code: "LEDGER_OWNER",
    });
    const admin = await M.User.create({
      name: "Finance reviewer",
      email: "finance-admin@fixture.test",
      role: "super_admin",
      passwordHash: await hashPassword(password),
    });
    const login = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Aibus-Client", "admin")
      .send({ email: admin.email, password });
    const token = login.body.data.accessToken;
    expect((await get("/finance/accounts", token)).status).toBe(403);
    await M.User.updateOne(
      { _id: admin._id },
      { $set: { platformFinanceRead: true } },
    );
    await postJournal(journal());
    expect((await get("/finance/accounts", token)).status).toBe(200);
    await M.User.updateOne(
      { _id: admin._id },
      { $set: { platformFinanceRead: false } },
    );
    expect((await get("/finance/accounts", token)).status).toBe(403);
  });
  it("detects projection corruption without repairing history and assesses legacy records read-only", async () => {
    const booking = await pending(),
      capture = event(booking);
    await applyVerifiedPayment(capture);
    await M.AccountBalanceProjection.updateOne(
      { debitPaise: 145000 },
      { $set: { debitPaise: 1 } },
    );
    expect((await verifyLedger(a.operatorId!)).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "PROJECTION_MISMATCH" }),
      ]),
    );
    const before = await M.JournalEntry.countDocuments();
    const report = await assessHistoricalFinance(a.operatorId!, 1);
    expect(report).toMatchObject({
      readOnly: true,
      historicalWritesEnabled: false,
      settlementInferred: false,
    });
    expect(await M.JournalEntry.countDocuments()).toBe(before);
    // Simulate pre-ledger history in the isolated fixture only.
    await M.JournalEntry.collection.deleteMany({});
    await M.FinancialOperation.collection.deleteMany({});
    const legacyReport = await assessHistoricalFinance(a.operatorId!);
    expect(legacyReport.rows[0].classification).toContain("Candidate only");
    await applyVerifiedPayment({ ...capture, eventId: randomUUID() });
    expect(await M.JournalEntry.countDocuments()).toBe(0);
    expect(await M.Booking.countDocuments()).toBe(1);
  });
});

describe("agent dashboard integration contract", () => {
  async function loginAgent(extra: any = {}) {
    const agency = (
      await post("/operator/agents", {
        name: "Dashboard agency",
        commissionRate: 500,
        ...extra,
      })
    ).body.data;
    const email = randomUUID() + "@dashboard.test";
    const user = (
      await post(`/operator/agents/${agency.id}/users`, {
        name: "Dashboard agent",
        email,
        password,
      })
    ).body.data;
    const login = await request(dashboardApp)
      .post("/api/v1/auth/login")
      .set("Origin", agentOrigin)
      .set("X-Aibus-Client", "agent")
      .send({ email, password });
    expect(login.status).toBe(200);
    const cookie = (login.headers["set-cookie"] as unknown as string[]).find(
      (c) => c.startsWith("aibus_agent_refresh="),
    )!;
    return {
      agency,
      user,
      email,
      login,
      cookie: cookie.split(";")[0],
      token: login.body.data.accessToken,
    };
  }
  const read = (path: string, token: string) =>
    request(dashboardApp)
      .get(`/api/v1/agent${path}`)
      .set("Authorization", `Bearer ${token}`)
      .set("Origin", agentOrigin);
  const write = (path: string, data: unknown, token: string) =>
    request(dashboardApp)
      .post(`/api/v1/agent${path}`)
      .set("Authorization", `Bearer ${token}`)
      .set("Origin", agentOrigin)
      .send(data);
  async function pending(
    actor: Awaited<ReturnType<typeof loginAgent>>,
    seat = "L1",
  ) {
    const hold = await write(
      `/trips/${tripId}/holds`,
      { seats: [seat] },
      actor.token,
    );
    expect(hold.status).toBe(201);
    const quote = await write(
      `/trips/${tripId}/quote`,
      { seats: [seat], holdId: hold.body.data.holdId },
      actor.token,
    );
    expect(quote.status).toBe(201);
    const payload = {
      tripId,
      holdId: hold.body.data.holdId,
      quoteId: quote.body.data.quoteId,
      passengers: [
        {
          name: "Agency Passenger",
          seat,
          boarding: "Miyapur",
          dropping: "Hebbal",
        },
      ],
    };
    const key = randomUUID();
    const create = () =>
      request(dashboardApp)
        .post("/api/v1/agent/bookings")
        .set("Authorization", `Bearer ${actor.token}`)
        .set("Origin", agentOrigin)
        .set("Idempotency-Key", key)
        .send(payload);
    const booking = await create();
    expect(booking.status).toBe(201);
    return { booking: booking.body.data, create };
  }
  it("isolates agent refresh cookies, validates portal identity, rotates and revokes sessions", async () => {
    const actor = await loginAgent();
    expect(String(actor.login.headers["set-cookie"])).toContain("HttpOnly");
    expect(String(actor.login.headers["set-cookie"])).toContain(
      "SameSite=Strict",
    );
    expect(String(actor.login.headers["set-cookie"])).not.toContain(
      "aibus_refresh=",
    );
    expect(
      (
        await request(dashboardApp)
          .post("/api/v1/auth/login")
          .set("X-Aibus-Client", "agent")
          .send({ email: "a@example.test", password })
      ).status,
    ).toBe(403);
    const fresh = await request(dashboardApp)
      .post("/api/v1/auth/refresh")
      .set("Origin", agentOrigin)
      .set("X-Aibus-Client", "agent")
      .set("Cookie", actor.cookie)
      .send({});
    expect(fresh.status).toBe(200);
    expect(fresh.body.data.user.agentId).toBe(actor.agency.id);
    const replay = await request(dashboardApp)
      .post("/api/v1/auth/refresh")
      .set("Origin", agentOrigin)
      .set("X-Aibus-Client", "agent")
      .set("Cookie", actor.cookie)
      .send({});
    expect(replay.status).toBe(401);
    expect((await read("/me", fresh.body.data.accessToken)).status).toBe(401);
  });
  it("does not let one portal refresh or log out another portal's session", async () => {
    const actor = await loginAgent();
    const op = await request(dashboardApp)
      .post("/api/v1/auth/login")
      .send({ email: "a@example.test", password });
    const opCookie = (op.headers["set-cookie"] as unknown as string[])[0].split(
      ";",
    )[0];
    const stolen = "aibus_agent_refresh=" + opCookie.split("=")[1];
    expect(
      (
        await request(dashboardApp)
          .post("/api/v1/auth/refresh")
          .set("Origin", agentOrigin)
          .set("X-Aibus-Client", "agent")
          .set("Cookie", stolen)
          .send({})
      ).body.error.code,
    ).toBe("SESSION_CLIENT_MISMATCH");
    await request(dashboardApp)
      .post("/api/v1/auth/logout")
      .set("Origin", agentOrigin)
      .set("X-Aibus-Client", "agent")
      .set("Cookie", stolen)
      .send({});
    expect(
      (await get("/operator/profile", op.body.data.accessToken)).status,
    ).toBe(200);
    await request(dashboardApp)
      .post("/api/v1/auth/logout")
      .set("Origin", agentOrigin)
      .set("X-Aibus-Client", "agent")
      .set("Cookie", actor.cookie)
      .send({});
    expect((await read("/me", actor.token)).status).toBe(401);
  });
  it("requires approved origins and CSRF context and refuses wildcard/non-HTTPS production configuration", async () => {
    const actor = await loginAgent();
    const preflight = await request(dashboardApp)
      .options("/api/v1/agent/bookings")
      .set("Origin", agentOrigin)
      .set("Access-Control-Request-Method", "POST")
      .set(
        "Access-Control-Request-Headers",
        "authorization,idempotency-key,x-aibus-client",
      );
    expect(preflight.headers["access-control-allow-origin"]).toBe(agentOrigin);
    expect(preflight.headers["access-control-allow-credentials"]).toBe("true");
    expect(
      (
        await request(dashboardApp)
          .post("/api/v1/auth/refresh")
          .set("Cookie", actor.cookie)
          .set("X-Aibus-Client", "agent")
          .send({})
      ).status,
    ).toBe(403);
    expect(
      (
        await request(dashboardApp)
          .post("/api/v1/auth/refresh")
          .set("Cookie", actor.cookie)
          .set("Origin", "https://unapproved.test")
          .set("X-Aibus-Client", "agent")
          .send({})
      ).status,
    ).toBe(403);
    expect(
      (
        await request(dashboardApp)
          .post("/api/v1/auth/refresh")
          .set("Cookie", actor.cookie)
          .set("Origin", agentOrigin)
          .set("Sec-Fetch-Site", "cross-site")
          .set("X-Aibus-Client", "agent")
          .send({})
      ).status,
    ).toBe(403);
    for (const value of [
      "https://*.test",
      "https://agent.test/path",
      "https://user:password@agent.test",
    ])
      expect(() =>
        readConfig({
          NODE_ENV: "test",
          MONGODB_URI: config.MONGODB_URI,
          JWT_SECRET: config.JWT_SECRET,
          AGENT_WEB_ORIGIN: value,
        }),
      ).toThrow();
    expect(() =>
      readConfig({
        NODE_ENV: "production",
        MONGODB_URI: "mongodb://test:fixture@localhost/aibus",
        REDIS_URL: "rediss://:fixture@localhost:6379",
        JWT_SECRET: config.JWT_SECRET,
        WEB_ORIGIN: "https://operator.aibus.test",
        AGENT_WEB_ORIGIN: "http://agent.aibus.test",
      }),
    ).toThrow("HTTPS");
  });
  it("serves authorized cities, date-specific inventory and policy without leaking other agencies or finance", async () => {
    const actor = await loginAgent({
      permissions: ["search", "inventory", "bookings"],
    });
    const cities = await read("/cities?search=bang", actor.token);
    expect(cities.status).toBe(200);
    expect(cities.body.data.map((c: any) => c.name)).toEqual(["Bangalore"]);
    expect(
      (await read("/cities?operatorId=" + b.operatorId, actor.token)).status,
    ).toBe(400);
    const trips = await read(
      "/trips?from=Hyderabad&to=Bangalore&journeyDate=2030-11-13",
      actor.token,
    );
    expect(trips.body.data).toHaveLength(1);
    expect(
      (
        await read(
          "/trips?from=Hyderabad&to=Bangalore&journeyDate=2030-11-14",
          actor.token,
        )
      ).body.data,
    ).toEqual([]);
    const dashboard = await read("/dashboard?date=2030-11-13", actor.token);
    expect(dashboard.body.data).toMatchObject({
      authorizedTrips: 1,
      totalBookings: 0,
      wallet: { available: false },
      settlements: { available: false },
    });
    expect(dashboard.body.data.commissionEarnedPaise).toBeUndefined();
    expect((await read("/commissions", actor.token)).status).toBe(403);
    expect(
      (await read(`/trips/${tripId}/cancellation-policy`, actor.token)).body
        .data,
    ).toMatchObject({ available: false, refundExecutionAvailable: false });
  });
  it("runs the API booking/payment/ticket/history/cancellation contract idempotently with mock Razorpay", async () => {
    const actor = await loginAgent(),
      other = await loginAgent();
    const { booking, create } = await pending(actor);
    expect((await create()).body.data.reference).toBe(booking.reference);
    expect((await read("/commissions", actor.token)).body.data).toMatchObject({
      pendingCommissionPaise: 7250,
      commissionEarnedPaise: 0,
    });
    const orderId = "order_agentfixture",
      paymentId = "pay_agentfixture";
    const transport = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url, options) => {
        if (String(url).endsWith("/orders") && options?.method === "POST")
          return new Response(
            JSON.stringify({
              id: orderId,
              amount: booking.totalPaise,
              currency: "INR",
              receipt: `aibus_${booking.id}`,
              partial_payment: false,
            }),
          );
        if (String(url).endsWith(`/payments/${paymentId}`))
          return new Response(
            JSON.stringify({
              id: paymentId,
              order_id: orderId,
              amount: booking.totalPaise,
              currency: "INR",
              status: "captured",
              captured: true,
              amount_refunded: 0,
            }),
          );
        throw new Error("Unexpected mock provider request");
      });
    const order = await write(
      `/bookings/${booking.id}/payment`,
      {},
      actor.token,
    );
    expect(order.status).toBe(200);
    expect(JSON.stringify(order.body)).not.toContain(
      paymentConfig.RAZORPAY_KEY_SECRET,
    );
    const proof = {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: createHmac(
        "sha256",
        paymentConfig.RAZORPAY_KEY_SECRET,
      )
        .update(`${orderId}|${paymentId}`)
        .digest("hex"),
    };
    const verified = await Promise.all([
      write(`/bookings/${booking.id}/payment/verify`, proof, actor.token),
      write(`/bookings/${booking.id}/payment/verify`, proof, actor.token),
    ]);
    expect(
      verified.every(
        (r) => r.status === 200 && r.body.data.status === "Confirmed",
      ),
    ).toBe(true);
    expect(await M.Ticket.countDocuments({ bookingId: booking.id })).toBe(1);
    expect(
      transport.mock.calls.filter(
        ([url, init]) =>
          String(url).endsWith("/orders") && init?.method === "POST",
      ),
    ).toHaveLength(1);
    const ticket = await read(`/bookings/${booking.id}/ticket`, actor.token);
    expect(ticket.body.data.journey).toMatchObject({
      source: "Hyderabad",
      destination: "Bangalore",
      registration: "TS09AA1000",
    });
    const pnr = ticket.body.data.booking.pnr;
    expect(
      (
        await read(
          `/bookings?search=${encodeURIComponent(pnr)}&status=Confirmed`,
          actor.token,
        )
      ).body.data,
    ).toHaveLength(1);
    expect(
      (await read(`/bookings?search=${encodeURIComponent(pnr)}`, other.token))
        .body.data,
    ).toEqual([]);
    expect(
      (await read(`/bookings/${booking.id}/cancellation`, other.token)).status,
    ).toBe(404);
    await M.Policy.create({
      operatorId: a.operatorId,
      rules: [{ hoursBefore: 0, refundPercent: 80 }],
    });
    expect(
      (
        await write(
          `/bookings/${booking.id}/cancellation`,
          { reason: "Passenger requested" },
          actor.token,
        )
      ).status,
    ).toBe(201);
    expect(
      (await read(`/bookings/${booking.id}/cancellation`, actor.token)).body
        .data,
    ).toMatchObject({
      cancellation: { status: "Requested" },
      refund: { status: "Requested", completed: false },
      refundExecutionAvailable: false,
    });
    expect(
      (await read("/bookings?agentId=" + other.agency.id, actor.token)).status,
    ).toBe(400);
  });
  it("reports commission eligibility by IST booking day without treating cancelled/refunded snapshots as earned money", async () => {
    const actor = await loginAgent(),
      { booking } = await pending(actor);
    const original: any = await M.Booking.findById(booking.id).lean();
    for (const [status, paymentStatus, createdAt] of [
      ["Confirmed", "Paid", "2026-11-17T18:45:00Z"],
      ["Pending payment", "Pending", "2026-11-17T18:50:00Z"],
      ["Cancelled", "Paid", "2026-11-17T19:00:00Z"],
      ["Confirmed", "Refunded", "2026-11-17T19:30:00Z"],
      ["Confirmed", "Paid", "2026-11-17T18:00:00Z"],
    ]) {
      const { _id, updatedAt, __v, ...copy } = original;
      await M.Booking.create({
        ...copy,
        reference: randomUUID(),
        idempotencyKey: randomUUID(),
        status,
        paymentStatus,
        createdAt: new Date(createdAt),
      });
    }
    // Exclude the newly created template booking from the fixed historical period.
    await M.Booking.collection.updateOne(
      { _id: original._id },
      { $set: { createdAt: new Date("2026-11-16T12:00:00Z") } },
    );
    const report = await read(
      "/commissions?from=2026-11-18&to=2026-11-18",
      actor.token,
    );
    expect(report.body.data).toMatchObject({
      totalBookings: 4,
      totalSalesPaise: 145000,
      commissionEarnedPaise: 7250,
      pendingCommissionPaise: 7250,
      excludedCancelledCommissionPaise: 7250,
      excludedRefundedCommissionPaise: 7250,
    });
    expect(report.body.data.dateWise).toHaveLength(1);
    expect(report.body.data.dateWise[0].date).toBe("2026-11-18");
    expect(
      (await read("/bookings?from=2026-11-18&to=2026-11-18", actor.token)).body
        .meta.total,
    ).toBe(4);
    expect(
      (await read("/bookings?from=2026-11-19&to=2026-11-18", actor.token))
        .status,
    ).toBe(400);
  });
});
describe("operator-owned agents and RBAC", () => {
  async function agency(extra: any = {}) {
    const created = await post("/operator/agents", {
      name: "Agency " + randomUUID(),
      commissionType: "Percent",
      commissionRate: 500,
      ...extra,
    });
    expect(created.status).toBe(201);
    const agent = created.body.data;
    const email = randomUUID() + "@agency.test";
    const linked = await post(`/operator/agents/${agent.id}/users`, {
      name: "Agency user",
      email,
      password,
    });
    expect(linked.status).toBe(201);
    expect(JSON.stringify(linked.body)).not.toContain("passwordHash");
    const login = await post("/auth/login", { email, password });
    expect(login.status).toBe(200);
    return {
      agent,
      userId: linked.body.data.id,
      email,
      token: login.body.data.accessToken,
      identity: login.body.data.user,
    };
  }
  async function pending(token: string, seat = "L1", key = randomUUID()) {
    const hold = await post(
      `/agent/trips/${tripId}/holds`,
      { seats: [seat] },
      token,
    );
    expect(hold.status).toBe(201);
    const booking = await request(app)
      .post("/api/v1/agent/bookings")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", key)
      .send({
        tripId,
        holdId: hold.body.data.holdId,
        passengers: [{ name: "Passenger", seat }],
      });
    expect(booking.status).toBe(201);
    return booking.body.data;
  }
  async function confirm(booking: any) {
    await applyVerifiedPayment({
      verified: true,
      providerId: "agency-fixture",
      eventId: randomUUID(),
      externalId: `pay-${booking.id}`,
      operatorId: a.operatorId!,
      bookingId: booking.id,
      amountPaise: booking.totalPaise,
      currency: "INR",
      status: "captured",
    });
  }
  it("creates canonical agencies, isolates operators and prevents linking another operator's user", async () => {
    const x = await agency();
    expect(x.identity).toMatchObject({
      role: "agent",
      agentId: x.agent.id,
      operatorId: a.operatorId,
    });
    expect((await get(`/operator/agents/${x.agent.id}`, tokenB)).status).toBe(
      404,
    );
    expect(
      (
        await request(app)
          .patch(`/api/v1/operator/agents/${x.agent.id}`)
          .set("Authorization", `Bearer ${tokenB}`)
          .send({ name: "Stolen" })
      ).status,
    ).toBe(404);
    expect(
      (await post(`/operator/agents/${x.agent.id}/users`, { userId: b.userId }))
        .status,
    ).toBe(409);
    expect(
      (await post(`/operator/agents/${x.agent.id}/users`, { userId: a.userId }))
        .status,
    ).toBe(409);
    expect(
      await M.SalesPartner.countDocuments({
        operatorId: a.operatorId,
        kind: "Agent",
      }),
    ).toBe(1);
  });
  it("books owned inventory with server-derived agency attribution and exposes only agency-owned tickets", async () => {
    const x = await agency(),
      booking = await pending(x.token);
    expect(booking).toMatchObject({
      source: "agent",
      agentId: x.agent.id,
      createdByUserId: x.userId,
    });
    const saved: any = await M.Booking.findById(booking.id).lean();
    expect(saved.commissionPaise).toBe(7250);
    expect((await get(`/operator/bookings/${booking.id}`)).status).toBe(200);
    expect(
      (await get(`/agent/bookings/${booking.id}/ticket`, x.token)).status,
    ).toBe(409);
    await confirm(booking);
    expect(
      (await get(`/agent/bookings/${booking.id}/ticket`, x.token)).status,
    ).toBe(200);
    expect((await get("/agent/bookings", x.token)).body.data).toHaveLength(1);
    expect(
      JSON.stringify((await get(`/agent/trips/${tripId}/seats`, x.token)).body),
    ).not.toContain("holdUserId");
  });
  it("denies another agency's bookings, tickets, cancellations, payments and idempotency replay", async () => {
    const x = await agency(),
      y = await agency(),
      booking = await pending(x.token);
    for (const suffix of ["", "/ticket"])
      expect(
        (await get(`/agent/bookings/${booking.id}${suffix}`, y.token)).status,
      ).toBe(404);
    expect((await get("/agent/bookings", y.token)).body.data).toEqual([]);
    expect(
      (
        await post(
          `/agent/bookings/${booking.id}/cancellation`,
          { reason: "Wrong agency" },
          y.token,
        )
      ).status,
    ).toBe(404);
    expect(
      (await post(`/agent/bookings/${booking.id}/payment`, {}, y.token)).status,
    ).toBe(503);
    const payment = await request(paymentApp)
      .post(`/api/v1/agent/bookings/${booking.id}/payment`)
      .set("Authorization", `Bearer ${y.token}`)
      .send({});
    expect(payment.status).toBe(404);
    const old: any = await M.Booking.findById(booking.id).lean();
    await expect(
      createBooking(
        { ...a, ...y.identity, userId: y.userId, sessionId: "test" },
        {
          tripId,
          holdId: old.holdId,
          passengers: [{ name: "Passenger", seat: "L1" }],
        },
        old.idempotencyKey,
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    // A concurrent insertion can occur after the initial idempotency lookup.
    // Recovery must apply the same agency boundary as the normal lookup.
    vi.spyOn(M.Booking, "findOne").mockImplementationOnce(
      () => ({ lean: async () => null }) as any,
    );
    await expect(
      createBooking(
        { ...a, ...y.identity, userId: y.userId, sessionId: "test" },
        {
          tripId,
          holdId: old.holdId,
          passengers: [{ name: "Passenger", seat: "L1" }],
        },
        old.idempotencyKey,
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
  it("enforces authorized bus scope and rejects other operator inventory", async () => {
    const x = await agency({ allowedBusIds: [busId] });
    expect(
      (
        await get(
          "/agent/trips?from=Hyderabad&to=Bangalore&journeyDate=2030-11-13",
          x.token,
        )
      ).body.data,
    ).toHaveLength(1);
    const other = await M.Bus.create({
      operatorId: a.operatorId,
      registration: "MH12BB1234",
      name: "Restricted",
      type: "AC Sleeper",
      capacity: 1,
    });
    const trip = await M.Trip.create({
      operatorId: a.operatorId,
      routeId,
      busId: other._id,
      journeyDate: "2030-11-13",
      departureAt: new Date("2030-11-13T15:00:00Z"),
      seats: [],
    });
    expect((await get(`/agent/trips/${trip._id}/seats`, x.token)).status).toBe(
      404,
    );
    expect(
      (await post(`/agent/trips/${trip._id}/holds`, { seats: ["L1"] }, x.token))
        .status,
    ).toBe(404);
    const foreign = await M.Trip.create({
      operatorId: b.operatorId,
      routeId,
      busId: new mongoose.Types.ObjectId(),
      journeyDate: "2030-11-13",
      departureAt: new Date("2030-11-13T15:00:00Z"),
      seats: [],
    });
    expect(
      (await get(`/agent/trips/${foreign._id}/seats`, x.token)).status,
    ).toBe(404);
  });
  it("rejects spoofed tenant, agency and source fields and all operator/admin management access", async () => {
    const x = await agency();
    for (const fields of [
      { operatorId: b.operatorId },
      { agentId: new mongoose.Types.ObjectId().toString() },
      { source: "operator" },
    ]) {
      const r = await request(app)
        .post("/api/v1/agent/bookings")
        .set("Authorization", `Bearer ${x.token}`)
        .set("Idempotency-Key", randomUUID())
        .send({
          tripId,
          holdId: randomUUID(),
          passengers: [{ name: "X", seat: "L1" }],
          ...fields,
        });
      expect(r.status).toBe(400);
    }
    for (const path of [
      "/operator/buses",
      "/operator/agents",
      "/operator/staff",
      "/operator/agents/performance",
      "/operator/trip-master/partners",
      "/platform/operators",
    ])
      expect((await get(path, x.token)).status).toBe(403);
    expect((await post("/operator/buses", {}, x.token)).status).toBe(403);
  });
  it("deactivation blocks existing sessions, login and booking with a previously created hold", async () => {
    const x = await agency();
    const hold = await post(
      `/agent/trips/${tripId}/holds`,
      { seats: ["L1"] },
      x.token,
    );
    expect(hold.status).toBe(201);
    expect(
      (
        await request(app)
          .patch(`/api/v1/operator/agents/${x.agent.id}`)
          .set("Authorization", `Bearer ${tokenA}`)
          .send({ status: "Inactive" })
      ).status,
    ).toBe(200);
    expect([401, 403]).toContain(
      (await post(`/agent/trips/${tripId}/holds`, { seats: ["L2"] }, x.token))
        .status,
    );
    expect(
      (await post("/auth/login", { email: x.email, password })).status,
    ).toBe(403);
    await expect(
      createBooking(
        { ...a, ...x.identity, userId: x.userId, sessionId: "test" },
        {
          tripId,
          holdId: hold.body.data.holdId,
          passengers: [{ name: "X", seat: "L1" }],
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(await M.Booking.countDocuments()).toBe(0);
  });
  it("honours permission changes without allowing agents to grant themselves privileges", async () => {
    const x = await agency();
    await request(app)
      .patch(`/api/v1/operator/agents/${x.agent.id}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ permissions: ["search"] });
    const login = await post("/auth/login", { email: x.email, password }),
      token = login.body.data.accessToken;
    expect(login.body.data.user.permissions).toEqual([]);
    expect((await get(`/agent/trips/${tripId}/seats`, token)).status).toBe(403);
    expect(
      (await post(`/agent/trips/${tripId}/holds`, { seats: ["L1"] }, token))
        .status,
    ).toBe(403);
    expect((await get("/agent/commissions", token)).status).toBe(403);
    expect(
      (await get("/agent/me", token)).body.data.commissionRate,
    ).toBeUndefined();
  });
  it("rejects invalid commission values for agencies and legacy staff", async () => {
    const x = await agency();
    for (const config of [
      { commissionType: "Percent", commissionRate: 10001 },
      { commissionType: "Percent", commissionRate: -1 },
      { commissionType: "Fixed", commissionRate: 1.5 },
    ])
      expect(
        (
          await request(app)
            .patch(`/api/v1/operator/agents/${x.agent.id}`)
            .set("Authorization", `Bearer ${tokenA}`)
            .send(config)
        ).status,
      ).toBe(400);
    expect(
      (
        await post("/operator/staff", {
          name: "Bad",
          email: "bad@test.com",
          password,
          role: "booking_staff",
          commissionType: "Percent",
          commissionRate: 10001,
        })
      ).status,
    ).toBe(400);
  });
  it("earns commission only on confirmed paid bookings and preserves historical snapshots", async () => {
    const x = await agency(),
      booking = await pending(x.token);
    expect(
      (await get("/agent/commissions", x.token)).body.data
        .commissionEarnedPaise,
    ).toBe(0);
    const base: any = await M.Booking.findById(booking.id).lean();
    for (const [status, paymentStatus] of [
      ["Confirmed", "Paid"],
      ["Confirmed", "Pending"],
      ["Cancelled", "Paid"],
      ["Confirmed", "Refunded"],
      ["Failed", "Failed"],
      ["Reconciliation required", "Paid"],
    ]) {
      const { _id, createdAt, updatedAt, __v, ...copy } = base;
      await M.Booking.create({
        ...copy,
        reference: randomUUID(),
        idempotencyKey: randomUUID(),
        status,
        paymentStatus,
      });
    }
    const report = await get("/operator/agents/performance");
    expect(report.body.data.agents[0]).toMatchObject({
      pendingBookings: 1,
      confirmedBookings: 3,
      cancelledBookings: 1,
      refundedBookings: 1,
      commissionEarnedPaise: 7250,
    });
    expect(
      (await get(`/operator/agents/${x.agent.id}/bookings`)).body.data.bookings,
    ).toHaveLength(7);
    await request(app)
      .patch(`/api/v1/operator/agents/${x.agent.id}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ commissionRate: 1000 });
    expect(
      (await M.Booking.findById(booking.id).lean())!.commissionSnapshot,
    ).toEqual(base.commissionSnapshot);
    expect(
      (await get("/operator/agents/performance", readerToken)).status,
    ).toBe(403);
    expect(
      (await get(`/operator/agents/${x.agent.id}/bookings`, readerToken))
        .status,
    ).toBe(403);
    expect(
      (await get("/operator/trip-master/partners", readerToken)).status,
    ).toBe(403);
    const redacted = await get(`/operator/bookings/${booking.id}`, readerToken);
    expect(redacted.body.data.commissionSnapshot).toBeUndefined();
    expect(redacted.body.data.commissionPaise).toBeUndefined();
  });
  it("requests only own permitted cancellations and does not expose operator settlements", async () => {
    const x = await agency(),
      booking = await pending(x.token);
    await confirm(booking);
    await M.Policy.create({
      operatorId: a.operatorId,
      rules: [{ hoursBefore: 0, refundPercent: 80 }],
    });
    expect(
      (
        await post(
          `/agent/bookings/${booking.id}/cancellation`,
          { reason: "Passenger requested" },
          x.token,
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await post(
          `/agent/bookings/${booking.id}/cancellation`,
          { reason: "Retry" },
          x.token,
        )
      ).status,
    ).toBe(201);
    expect(await M.Cancellation.countDocuments({ bookingId: booking.id })).toBe(
      1,
    );
    expect((await M.Booking.findById(booking.id))!.status).toBe("Confirmed");
    await M.Settlement.create({
      operatorId: a.operatorId,
      externalId: "private-operator",
      grossPaise: 999999,
    });
    const settlements = await get("/agent/settlements", x.token);
    expect(settlements.body.data).toMatchObject({
      available: true,
      settlements: [],
    });
    expect(JSON.stringify(settlements.body)).not.toContain("private-operator");
  });
  it("migrates explicitly selected legacy staff additively, reuses an existing agency and preserves direct customer attribution", async () => {
    const owner: any = await M.User.findById(a.userId).select("+passwordHash");
    const legacy = await M.User.create({
      operatorId: a.operatorId,
      name: "Legacy",
      email: "legacy@agent.test",
      passwordHash: owner.passwordHash,
      role: "booking_staff",
    });
    const existing = await M.SalesPartner.create({
      operatorId: a.operatorId,
      kind: "Agent",
      name: "Existing agency",
      email: "legacy@agent.test",
    });
    const auth: Principal = {
      ...a,
      userId: String(legacy._id),
      role: "booking_staff",
      permissions: rolePermissions.booking_staff,
    };
    const hold: any = await createHold(auth, tripId, ["L1"]);
    const direct: any = await createBooking(
      auth,
      {
        tripId,
        holdId: hold.holdId,
        passengers: [{ name: "Direct", seat: "L1" }],
      },
      randomUUID(),
      "customer",
    );
    const other: any = await createHold(auth, tripId, ["L2"]);
    const old: any = await createBooking(
      auth,
      {
        tripId,
        holdId: other.holdId,
        passengers: [{ name: "Old", seat: "L2" }],
      },
      randomUUID(),
    );
    const before: any = await M.Booking.findById(old._id).lean();
    expect(
      (await migrateAgentUser(a.operatorId!, String(legacy._id))).applied,
    ).toBe(false);
    expect((await M.User.findById(legacy._id))!.salesPartnerId).toBeUndefined();
    await migrateAgentUser(a.operatorId!, String(legacy._id), true);
    await migrateAgentUser(a.operatorId!, String(legacy._id), true);
    expect(
      await M.SalesPartner.countDocuments({
        operatorId: a.operatorId,
        kind: "Agent",
      }),
    ).toBe(1);
    expect(String((await M.User.findById(legacy._id))!.salesPartnerId)).toBe(
      String(existing._id),
    );
    const migrated: any = await M.Booking.findById(old._id).lean();
    expect(String(migrated.agentId)).toBe(String(existing._id));
    expect(migrated.reference).toBe(before.reference);
    expect(migrated.commissionSnapshot).toEqual(before.commissionSnapshot);
    expect((await M.Booking.findById(direct._id))!.agentId).toBeUndefined();
    expect(
      (await post("/auth/login", { email: legacy.email, password })).body.data
        .user.role,
    ).toBe("agent");
    expect(
      (await get(`/operator/agents/${legacy._id}/bookings`)).body.data.bookings,
    ).toHaveLength(1);
    const login = await post("/auth/login", { email: legacy.email, password });
    expect(
      (await get(`/agent/bookings/${direct._id}`, login.body.data.accessToken))
        .status,
    ).toBe(404);
  });
  it("permits explicitly authorized Super Admin agency reporting without exposing it to agents", async () => {
    const x = await agency(),
      booking = await pending(x.token);
    const owner: any = await M.User.findById(a.userId).select("+passwordHash");
    await M.User.create({
      name: "Platform",
      email: "platform-agents@test.com",
      role: "super_admin",
      passwordHash: owner.passwordHash,
    });
    const login = await post("/auth/login", {
      email: "platform-agents@test.com",
      password,
    });
    const path = `/platform/operators/${a.operatorId}/agents/${x.agent.id}/bookings`;
    expect((await get(path, login.body.data.accessToken)).body.data[0].id).toBe(
      booking.id,
    );
    expect((await get(path, x.token)).status).toBe(403);
    expect(
      (
        await get(
          `/platform/operators/${b.operatorId}/agents/${x.agent.id}/bookings`,
          login.body.data.accessToken,
        )
      ).status,
    ).toBe(404);
  });
});
describe("expired reservation ownership", () => {
  async function expiredBooking() {
    const hold: any = await createHold(a, tripId, ["L1"]);
    const booking: any = await createBooking(
      a,
      {
        tripId,
        holdId: hold.holdId,
        passengers: [{ name: "Customer A", seat: "L1" }],
      },
      randomUUID(),
    );
    const expiredAt = new Date(Date.now() - 1000);
    await M.Hold.updateOne(
      { holdId: hold.holdId },
      { $set: { expiresAt: expiredAt } },
    );
    await M.Trip.updateOne(
      { _id: tripId },
      { $set: { "seats.0.holdUntil": expiredAt } },
    );
    return booking;
  }
  async function customerB() {
    const owner = await M.User.findById(a.userId).select("+passwordHash");
    const user = await M.User.create({
      operatorId: a.operatorId,
      name: "Customer B",
      email: "replacement@example.test",
      role: "booking_staff",
      passwordHash: owner!.passwordHash,
    });
    return {
      ...a,
      userId: String(user._id),
      role: "booking_staff" as const,
      permissions: rolePermissions.booking_staff,
    };
  }
  const capture = (booking: any, eventId = randomUUID()) => ({
    verified: true as const,
    providerId: "sandbox-test",
    eventId,
    externalId: `pay-${booking._id}`,
    operatorId: a.operatorId!,
    bookingId: String(booking._id),
    amountPaise: booking.totalPaise,
    currency: "INR" as const,
    status: "captured" as const,
  });
  async function replacementSeat(hold: any, user: Principal) {
    const seat = (await M.Trip.findById(tripId).lean())!.seats[0];
    expect(seat.state).toBe("held");
    expect(seat.holdId).toBe(hold.holdId);
    expect(String(seat.holdUserId)).toBe(user.userId);
    expect(+new Date(seat.holdUntil!)).toBe(+new Date(hold.expiresAt));
    expect(seat.bookingId).toBeUndefined();
  }
  it("clears stale booking ownership when an expired seat is immediately re-held without cleanup", async () => {
    await expiredBooking();
    const user = await customerB();
    const hold: any = await createHold(user, tripId, ["L1"]);
    await replacementSeat(hold, user);
  });
  it("preserves a replacement hold and records late captured payment for reconciliation", async () => {
    const booking = await expiredBooking(),
      user = await customerB();
    const hold: any = await createHold(user, tripId, ["L1"]);
    const event = capture(booking);
    await Promise.all([
      applyVerifiedPayment(event),
      applyVerifiedPayment(event),
    ]);
    await replacementSeat(hold, user);
    const old = await M.Booking.findById(booking._id).lean();
    expect(old).toMatchObject({
      status: "Reconciliation required",
      paymentStatus: "Paid",
      reference: booking.reference,
    });
    expect(
      await M.Payment.countDocuments({
        bookingId: booking._id,
        status: "captured",
      }),
    ).toBe(1);
    expect(await M.Ticket.countDocuments()).toBe(0);
    await reconcileExpiredHolds();
    expect((await M.Booking.findById(booking._id))!.paymentStatus).toBe("Paid");
    await replacementSeat(hold, user);
    const next: any = await createBooking(
      user,
      {
        tripId,
        holdId: hold.holdId,
        passengers: [{ name: "Customer B", seat: "L1" }],
      },
      randomUUID(),
    );
    await applyVerifiedPayment(capture(next));
    expect((await M.Booking.findById(next._id))!.status).toBe("Confirmed");
    expect(await M.Ticket.countDocuments({ bookingId: next._id })).toBe(1);
  });
  it("cancels an expired booking without releasing a replacement hold, even with legacy stale ownership", async () => {
    const booking = await expiredBooking(),
      user = await customerB();
    const hold: any = await createHold(user, tripId, ["L1"]);
    // Emulate an already-reassigned seat written by the old application version.
    await M.Trip.updateOne(
      { _id: tripId },
      { $set: { "seats.0.bookingId": booking._id } },
    );
    expect(
      (
        await post(`/operator/bookings/${booking._id}/cancel-pending`, {
          reason: "Expired checkout",
        })
      ).status,
    ).toBe(200);
    const seat = (await M.Trip.findById(tripId).lean())!.seats[0];
    expect(seat).toMatchObject({ state: "held", holdId: hold.holdId });
    expect(String(seat.holdUserId)).toBe(user.userId);
    expect((await M.Hold.findOne({ holdId: hold.holdId }))!.status).toBe(
      "held",
    );
  });
  it("expires old hold records independently of replacement seat state and is safe to retry concurrently", async () => {
    const booking = await expiredBooking(),
      user = await customerB();
    const hold: any = await createHold(user, tripId, ["L1"]);
    await Promise.all([reconcileExpiredHolds(), reconcileExpiredHolds()]);
    expect((await M.Hold.findOne({ holdId: booking.holdId }))!.status).toBe(
      "expired",
    );
    expect((await M.Booking.findById(booking._id))!.status).toBe("Failed");
    await replacementSeat(hold, user);
    expect(await reconcileExpiredHolds()).toBe(0);
  });
  it("requires both consumed hold expiry and matching seat ownership before confirmation", async () => {
    const booking = await expiredBooking();
    // Inconsistent legacy seat data must not extend the expired hold record.
    await M.Trip.updateOne(
      { _id: tripId },
      { $set: { "seats.0.holdUntil": new Date(Date.now() + 60000) } },
    );
    await applyVerifiedPayment(capture(booking));
    expect((await M.Booking.findById(booking._id))!.status).toBe(
      "Reconciliation required",
    );
    expect(await M.Ticket.countDocuments()).toBe(0);
    expect(
      await M.Payment.countDocuments({
        bookingId: booking._id,
        status: "captured",
      }),
    ).toBe(1);
  });
  it.each(["holdId", "holdUserId", "bookingId", "holdUntil"])(
    "rejects confirmation when the current seat %s no longer matches the booking",
    async (field) => {
      const hold: any = await createHold(a, tripId, ["L1"]);
      const booking: any = await createBooking(
        a,
        {
          tripId,
          holdId: hold.holdId,
          passengers: [{ name: "Customer A", seat: "L1" }],
        },
        randomUUID(),
      );
      const value =
        field === "holdId"
          ? randomUUID()
          : field === "holdUntil"
            ? new Date(Date.now() - 1000)
            : new mongoose.Types.ObjectId();
      await M.Trip.updateOne(
        { _id: tripId },
        { $set: { [`seats.0.${field}`]: value } },
      );
      await applyVerifiedPayment(capture(booking));
      expect((await M.Booking.findById(booking._id))!.status).toBe(
        "Reconciliation required",
      );
      expect(await M.Ticket.countDocuments()).toBe(0);
      expect((await M.Trip.findById(tripId).lean())!.seats[0].state).toBe(
        "held",
      );
    },
  );
  it("does not expire a confirmed replacement booking while processing the previous hold", async () => {
    const old = await expiredBooking(),
      user = await customerB();
    const hold: any = await createHold(user, tripId, ["L1"]);
    const booking: any = await createBooking(
      user,
      {
        tripId,
        holdId: hold.holdId,
        passengers: [{ name: "Customer B", seat: "L1" }],
      },
      randomUUID(),
    );
    await applyVerifiedPayment(capture(booking));
    const confirmed = await M.Booking.findById(booking._id).lean();
    await Promise.all([reconcileExpiredHolds(), reconcileExpiredHolds()]);
    expect((await M.Booking.findById(old._id))!.status).toBe("Failed");
    expect((await M.Booking.findById(booking._id))!.pnr).toBe(confirmed!.pnr);
    expect((await M.Booking.findById(booking._id))!.status).toBe("Confirmed");
    const seat = (await M.Trip.findById(tripId).lean())!.seats[0];
    expect(seat.state).toBe("booked");
    expect(String(seat.bookingId)).toBe(String(booking._id));
    expect(await M.Ticket.countDocuments({ bookingId: booking._id })).toBe(1);
  });
  it("rejects a late capture against a replacement hold even when legacy bookingId is retained", async () => {
    const booking = await expiredBooking(),
      user = await customerB();
    const hold: any = await createHold(user, tripId, ["L1"]);
    await M.Trip.updateOne(
      { _id: tripId },
      { $set: { "seats.0.bookingId": booking._id } },
    );
    await applyVerifiedPayment(capture(booking));
    expect((await M.Booking.findById(booking._id))!.status).toBe(
      "Reconciliation required",
    );
    expect((await M.Trip.findById(tripId).lean())!.seats[0]).toMatchObject({
      state: "held",
      holdId: hold.holdId,
    });
    expect(await M.Ticket.countDocuments()).toBe(0);
  });
  it("does not let failed payment cleanup release a replacement hold with legacy booking ownership", async () => {
    const booking = await expiredBooking(),
      user = await customerB();
    const hold: any = await createHold(user, tripId, ["L1"]);
    await M.Trip.updateOne(
      { _id: tripId },
      { $set: { "seats.0.bookingId": booking._id } },
    );
    await applyVerifiedPayment({ ...capture(booking), status: "failed" });
    expect((await M.Trip.findById(tripId).lean())!.seats[0]).toMatchObject({
      state: "held",
      holdId: hold.holdId,
    });
  });
  it("allows only one replacement hold under concurrent requests before cleanup", async () => {
    const booking = await expiredBooking(),
      user = await customerB();
    const attempts = await Promise.allSettled([
      createHold(a, tripId, ["L1"]),
      createHold(user, tripId, ["L1"]),
    ]);
    expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await reconcileExpiredHolds();
    const seat = (await M.Trip.findById(tripId).lean())!.seats[0];
    expect(seat.state).toBe("held");
    expect(seat.holdId).not.toBe(booking.holdId);
    expect(seat.bookingId).toBeUndefined();
  });
});
describe("route seat-side fares", () => {
  it("uses Schedule form prices for both decks over route defaults without changing the route fares", async () => {
    await M.Bus.updateOne({ _id: busId }, { $set: { capacity: 6 } });
    await M.Layout.create({
      operatorId: a.operatorId,
      busId,
      name: "2+1 sleeper",
      seats: ["lower", "upper"].flatMap((deck) =>
        [0, 1, 3].map((column, i) => ({
          number: `${deck === "lower" ? "L" : "U"}${i + 1}`,
          deck,
          row: 0,
          column,
          category: "sleeper",
          farePaise: 0,
        })),
      ),
    });
    await post("/operator/fares", {
      routeId,
      basePaise: 100000,
      singlePaise: 120000,
      specialDates: [{ date: "2030-11-18", amountPaise: 150000 }],
      seatFares: [{ number: "L1", amountPaise: 180000 }],
    });
    const result = await post("/operator/trips", {
      busId,
      routeId,
      journeyDate: "2030-11-18",
      departureAt: "2030-11-18T21:30:00+05:30",
      seatSideFares: { doublePaise: 220000, singlePaise: 250050 },
    });
    expect(result.status).toBe(201);
    expect(result.body.data.seats.map((s: any) => s.farePaise)).toEqual([
      220000, 220000, 250050, 220000, 220000, 250050,
    ]);
    const stored = await M.Trip.findById(result.body.data._id).lean();
    expect(stored!.seatSideFares).toMatchObject({
      doublePaise: 220000,
      singlePaise: 250050,
    });
    const quote = await priceTrip(a, stored, ["L1", "U3"]);
    expect(quote.grossPaise).toBe(470050);
    expect((await M.Fare.findOne({ routeId }).lean())!.basePaise).toBe(100000);
  });
  it("rejects incomplete, nonpositive and fractional-paise Schedule prices", async () => {
    for (const seatSideFares of [
      { doublePaise: 220000 },
      { doublePaise: 0, singlePaise: 250000 },
      { doublePaise: 220000, singlePaise: 250000.5 },
    ]) {
      const result = await post("/operator/trips", {
        busId,
        routeId,
        journeyDate: "2030-11-18",
        departureAt: "2030-11-18T21:30:00+05:30",
        seatSideFares,
      });
      expect(result.status).toBe(400);
    }
    expect(await M.Trip.countDocuments()).toBe(1);
  });
  it("persists Fares-tab prices and snapshots double/single prices on both decks for weekdays and weekends", async () => {
    await M.Bus.updateOne({ _id: busId }, { $set: { capacity: 6 } });
    await M.Layout.create({
      operatorId: a.operatorId,
      busId,
      name: "2+1 sleeper",
      seats: ["lower", "upper"].flatMap((deck) =>
        [0, 1, 3].map((column, i) => ({
          number: `${deck === "lower" ? "L" : "U"}${i + 1}`,
          deck,
          row: 0,
          column,
          category: "sleeper",
          farePaise: 0,
        })),
      ),
    });
    const fare = await post("/operator/fares", {
      routeId,
      basePaise: 220000,
      singlePaise: 250000,
      weekendPaise: 230000,
      singleWeekendPaise: 270000,
    });
    expect(fare.status).toBe(200);
    expect(fare.body.data.singlePaise).toBe(250000);
    const weekday = await post("/operator/trips", {
      busId,
      routeId,
      journeyDate: "2030-11-18",
      departureAt: "2030-11-18T21:30:00+05:30",
    });
    expect(weekday.status).toBe(201);
    expect(weekday.body.data.seats.map((s: any) => s.farePaise)).toEqual([
      220000, 220000, 250000, 220000, 220000, 250000,
    ]);
    const quote = await priceTrip(a, weekday.body.data, ["L1", "U3"]);
    expect(quote.seatFares.map((s: any) => s.basePaise)).toEqual([
      220000, 250000,
    ]);
    const weekend = await post("/operator/trips", {
      busId,
      routeId,
      journeyDate: "2030-11-23",
      departureAt: "2030-11-23T21:30:00+05:30",
    });
    expect(weekend.status).toBe(201);
    expect(weekend.body.data.seats.map((s: any) => s.farePaise)).toEqual([
      230000, 230000, 270000, 230000, 230000, 270000,
    ]);
    const unchanged = await M.Trip.findById(tripId).lean();
    expect(unchanged!.seats.map((s: any) => s.farePaise)).toEqual([
      145000, 145000, 145000,
    ]);
  });
  it("does not schedule a layout with unset prices and points to Fares", async () => {
    await M.Layout.create({
      operatorId: a.operatorId,
      busId,
      name: "Unpriced",
      seats: [0, 1, 3].map((column, i) => ({
        number: `L${i + 1}`,
        deck: "lower",
        row: 0,
        column,
        category: "sleeper",
        farePaise: 0,
      })),
    });
    const result = await post("/operator/trips", {
      busId,
      routeId,
      journeyDate: "2030-11-18",
      departureAt: "2030-11-18T21:30:00+05:30",
    });
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("FARES_REQUIRED");
    expect(await M.Trip.countDocuments()).toBe(1);
  });
});

describe("Area Master", () => {
  async function createArea() {
    const source = await post("/operator/area-master/cities", {
      name: "Hyderabad",
      state: "Telangana",
    });
    const destination = await post("/operator/area-master/cities", {
      name: "Bangalore",
      state: "Karnataka",
    });
    expect(source.status).toBe(201);
    expect(destination.status).toBe(201);
    const first = await post("/operator/area-master/locations", {
      cityId: source.body.data._id,
      name: "Miyapur",
      usage: "Pickup",
      address: "Miyapur bus stop",
    });
    const second = await post("/operator/area-master/locations", {
      cityId: source.body.data._id,
      name: "Ameerpet",
      usage: "Both",
    });
    const drop = await post("/operator/area-master/locations", {
      cityId: destination.body.data._id,
      name: "Majestic",
      usage: "Drop",
    });
    expect(first.status).toBe(201);
    expect(drop.status).toBe(201);
    return {
      source: source.body.data,
      destination: destination.body.data,
      first: first.body.data,
      second: second.body.data,
      drop: drop.body.data,
    };
  }
  it("creates cities, locations and POI with duplicate, coordinate and tenant validation", async () => {
    const area = await createArea();
    expect(
      (
        await post("/operator/area-master/cities", {
          name: " hyderabad ",
          state: "telangana",
        })
      ).status,
    ).toBe(409);
    const poi = await post("/operator/area-master/pois", {
      cityId: area.source._id,
      name: "Metro station",
      category: "Railway station",
      latitude: 17.49,
      longitude: 78.39,
    });
    expect(poi.status).toBe(201);
    const linked = await post("/operator/area-master/locations", {
      cityId: area.source._id,
      name: "Metro pickup",
      usage: "Pickup",
      landmarkId: poi.body.data._id,
    });
    expect(linked.status).toBe(201);
    expect(
      (
        await post("/operator/area-master/locations", {
          cityId: area.destination._id,
          name: "Wrong city",
          usage: "Drop",
          landmarkId: poi.body.data._id,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post("/operator/area-master/pois", {
          cityId: area.source._id,
          name: "Incomplete",
          category: "Landmark",
          latitude: 1,
        })
      ).status,
    ).toBe(400);
    expect(
      (await get(`/operator/area-master/cities/${area.source._id}`, tokenB))
        .status,
    ).toBe(404);
    expect(
      (
        await post(
          "/operator/area-master/locations",
          { cityId: area.source._id, name: "Foreign", usage: "Pickup" },
          tokenB,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await post(
          "/operator/area-master/cities",
          { name: "Forbidden", state: "Region" },
          readerToken,
        )
      ).status,
    ).toBe(403);
  });
  it("assigns ordered route stops and uses active master locations in counter search and booking validation", async () => {
    const area = await createArea();
    const input = {
      sourceCityId: area.source._id,
      destinationCityId: area.destination._id,
      boarding: [
        { locationId: area.second._id, time: "20:00" },
        { locationId: area.first._id, time: "20:30" },
      ],
      dropping: [{ locationId: area.drop._id, time: "06:00" }],
      expectedVersion: 0,
    };
    const saved = await request(app)
      .put(`/api/v1/operator/area-master/routes/${routeId}/stops`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send(input);
    expect(saved.status).toBe(200);
    expect(saved.body.data.boarding.map((stop: any) => stop.name)).toEqual([
      "Ameerpet",
      "Miyapur",
    ]);
    expect(saved.body.data.boarding[0].time).toBe("20:00");
    const stale = await request(app)
      .put(`/api/v1/operator/area-master/routes/${routeId}/stops`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send(input);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("ROUTE_CHANGED");
    const searchPath =
      "/operator/counter/trips?from=Hyderabad&to=Bangalore&journeyDate=2030-11-13";
    expect(
      (await get(searchPath)).body.data[0].boarding.map(
        (stop: any) => stop.name,
      ),
    ).toEqual(["Ameerpet", "Miyapur"]);
    const changed = await request(app)
      .patch(`/api/v1/operator/area-master/locations/${area.second._id}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({
        cityId: area.source._id,
        name: "Ameerpet updated",
        usage: "Both",
        status: "Inactive",
      });
    expect(changed.status).toBe(200);
    expect(
      (await get(searchPath)).body.data[0].boarding.map(
        (stop: any) => stop.name,
      ),
    ).toEqual(["Miyapur"]);
    const hold: any = await createHold(a, tripId, ["L1"]);
    await expect(
      createBooking(
        a,
        {
          tripId,
          holdId: hold.holdId,
          passengers: [
            {
              name: "Passenger",
              seat: "L1",
              boarding: "Ameerpet",
              dropping: "Majestic",
            },
          ],
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "BOARDING_INVALID" });
  });
  it("rejects pickup/drop usage mismatches without changing the route", async () => {
    const area = await createArea();
    const badPickup = await post("/operator/area-master/locations", {
      cityId: area.source._id,
      name: "Drop only",
      usage: "Drop",
    });
    const result = await request(app)
      .put(`/api/v1/operator/area-master/routes/${routeId}/stops`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({
        sourceCityId: area.source._id,
        destinationCityId: area.destination._id,
        boarding: [{ locationId: badPickup.body.data._id }],
        dropping: [{ locationId: area.drop._id }],
        expectedVersion: 0,
      });
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe("STOP_ROUTE_MISMATCH");
    expect((await M.Route.findById(routeId).lean())!.boarding[0].name).toBe(
      "Miyapur",
    );
  });
});

describe("Bus Master", () => {
  it("manages tenant-owned owners, coaches, chart templates, vehicle records and GPS mappings", async () => {
    const owner = await post("/operator/bus-master/owners", {
      name: "Fleet Owner",
      phone: "9876543210",
    });
    const coach = await post("/operator/bus-master/coaches", {
      name: "Sleeper coach",
      type: "AC Sleeper",
      arrangement: "2+1",
      decks: 2,
      amenities: ["Charging"],
    });
    expect(owner.status).toBe(201);
    expect(coach.status).toBe(201);
    const assignment = await request(app)
      .patch(`/api/v1/operator/bus-master/buses/${busId}/assignments`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ ownerId: owner.body.data._id, coachTypeId: coach.body.data._id });
    expect(assignment.status).toBe(200);
    const template = await post("/operator/bus-master/charts", {
      name: "Three berth chart",
      seats: [0, 1, 3].map((column, i) => ({
        number: `L${i + 1}`,
        deck: "lower",
        row: 0,
        column,
        category: "sleeper",
        farePaise: 0,
      })),
    });
    expect(template.status).toBe(201);
    expect(
      (
        await post(`/operator/bus-master/buses/${busId}/chart`, {
          templateId: template.body.data._id,
        })
      ).status,
    ).toBe(200);
    expect((await M.Trip.findById(tripId).lean())!.seats[0].farePaise).toBe(
      145000,
    );
    const document = await post("/operator/bus-master/documents", {
      busId,
      kind: "Insurance",
      reference: "POL-123",
      issuedOn: "2029-01-01",
      expiresOn: "2030-01-01",
    });
    expect(document.status).toBe(201);
    expect(
      (
        await post("/operator/bus-master/documents", {
          busId,
          kind: "Insurance",
          reference: "BAD",
          issuedOn: "2031-01-01",
          expiresOn: "2030-01-01",
        })
      ).status,
    ).toBe(400);
    const gps = await post("/operator/bus-master/gps", {
      busId,
      provider: "Provider configured later",
      deviceId: "GPS-001",
    });
    expect(gps.status).toBe(201);
    expect(
      (await get(`/operator/bus-master/gps/${gps.body.data._id}/status`)).body
        .data,
    ).toMatchObject({
      telemetryStatus: "Not connected",
      lastReportedAt: null,
      latitude: null,
    });
    expect(
      (await get(`/operator/bus-master/owners/${owner.body.data._id}`, tokenB))
        .status,
    ).toBe(404);
    expect(
      (
        await post(
          "/operator/bus-master/owners",
          { name: "Forbidden", phone: "1234567890" },
          readerToken,
        )
      ).status,
    ).toBe(403);
    const foreignOwner = await post(
      "/operator/bus-master/owners",
      { name: "Other company", phone: "1234567890" },
      tokenB,
    );
    expect(
      (
        await request(app)
          .patch(`/api/v1/operator/bus-master/buses/${busId}/assignments`)
          .set("Authorization", `Bearer ${tokenA}`)
          .send({ ownerId: foreignOwner.body.data._id })
      ).status,
    ).toBe(404);
  });
  it("requires matching chart capacity and prevents concurrent overlapping crew assignments", async () => {
    const seats = [0, 1, 3].map((column, i) => ({
      number: `L${i + 1}`,
      deck: "lower",
      row: 0,
      column,
      category: "sleeper",
      farePaise: 145000,
    }));
    await M.Layout.create({
      operatorId: a.operatorId,
      busId,
      name: "Bus layout",
      seats,
    });
    const otherBus = await M.Bus.create({
      operatorId: a.operatorId,
      registration: "MH12ZZ9999",
      name: "Other bus",
      type: "AC Sleeper",
      capacity: 3,
    });
    await M.Layout.create({
      operatorId: a.operatorId,
      busId: otherBus._id,
      name: "Other layout",
      seats,
    });
    const driver = await post("/operator/bus-master/crew", {
      name: "Driver",
      phone: "9876543210",
      role: "Driver",
      licenceNumber: "DL-123",
      licenceExpiry: "2032-01-01",
    });
    expect(driver.status).toBe(201);
    const input = {
      routeId,
      journeyDate: "2030-11-18",
      departureAt: "2030-11-18T21:30:00+05:30",
      crewIds: [driver.body.data._id],
    };
    const attempts = await Promise.all([
      post("/operator/trips", { ...input, busId }),
      post("/operator/trips", { ...input, busId: String(otherBus._id) }),
    ]);
    expect(attempts.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(attempts.find((r) => r.status === 409)!.body.error.code).toBe(
      "CREW_SCHEDULE_CONFLICT",
    );
    const shortChart = await post("/operator/bus-master/charts", {
      name: "Wrong capacity",
      seats: [seats[0]],
    });
    expect(
      (
        await post(`/operator/bus-master/buses/${busId}/chart`, {
          templateId: shortChart.body.data._id,
        })
      ).status,
    ).toBe(409);
  });
  it("rejects an expired driver licence for a future trip", async () => {
    const driver = await post("/operator/bus-master/crew", {
      name: "Expired Driver",
      phone: "9876543210",
      role: "Driver",
      licenceNumber: "OLD-DL",
      licenceExpiry: "2029-01-01",
    });
    const result = await request(app)
      .patch(`/api/v1/operator/bus-master/trips/${tripId}/crew`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ crewIds: [driver.body.data._id] });
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("DRIVER_LICENCE_EXPIRED");
    const conductor = await post("/operator/bus-master/crew", {
      name: "Conductor",
      phone: "9876543210",
      role: "Conductor",
    });
    const saved = await request(app)
      .patch(`/api/v1/operator/bus-master/trips/${tripId}/crew`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ crewIds: [conductor.body.data._id] });
    expect(saved.status).toBe(200);
    expect(saved.body.data.crewIds).toEqual([conductor.body.data._id]);
  });
});

describe("platform admin panel", () => {
  it("returns searchable paginated operators, overview and company-only details to administrators", async () => {
    await M.User.create({
      name: "Platform",
      email: "platform@example.test",
      passwordHash: await hashPassword(password),
      role: "super_admin",
    });
    await M.Operator.create({
      company: "Pending Travels",
      email: "pending@example.test",
    });
    const login = await request(app)
      .post("/api/v1/auth/login")
      .set("Origin", "http://127.0.0.1:5174")
      .set("X-Aibus-Client", "admin")
      .send({ email: "platform@example.test", password });
    expect(login.status).toBe(200);
    const token = login.body.data.accessToken;
    const overview = await get("/platform/overview", token);
    expect(overview.body.data).toMatchObject({
      totalOperators: 3,
      operators: { approved: 2, pending: 1 },
      buses: 1,
      routes: 1,
      scheduledTrips: 1,
    });
    const filtered = await get(
      "/platform/operators?search=Operator%20A&status=approved",
      token,
    );
    expect(filtered.body.data).toHaveLength(1);
    expect(filtered.body.data[0].company).toBe("Operator A");
    const page = await get(
      "/platform/operators?status=approved&limit=1&page=2",
      token,
    );
    expect(page.body.meta).toMatchObject({ total: 2, pages: 2, page: 2 });
    expect(
      (await get("/platform/operators?search=%5B", token)).body.data,
    ).toHaveLength(0);
    const details = await get(`/platform/operators/${a.operatorId}`, token);
    expect(details.body.data.counts).toEqual({
      buses: 1,
      routes: 1,
      scheduledTrips: 1,
    });
    expect(details.body.data).not.toHaveProperty("passengers");
    expect((await get("/platform/overview")).status).toBe(403);
    expect((await get(`/platform/operators/${a.operatorId}`)).status).toBe(403);
  });
  it("keeps admin refresh cookies separate from operator sessions and rejects operator admin-panel login", async () => {
    await M.User.create({
      name: "Platform",
      email: "platform@example.test",
      passwordHash: await hashPassword(password),
      role: "super_admin",
    });
    const operatorLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "a@example.test", password });
    const adminLogin = await request(app)
      .post("/api/v1/auth/login")
      .set("Origin", "http://127.0.0.1:5174")
      .set("X-Aibus-Client", "admin")
      .send({ email: "platform@example.test", password });
    expect(adminLogin.status).toBe(200);
    expect(adminLogin.headers["set-cookie"][0]).toMatch(
      /^aibus_admin_refresh=/,
    );
    const cookies = [
      operatorLogin.headers["set-cookie"][0],
      adminLogin.headers["set-cookie"][0],
    ]
      .map((c: string) => c.split(";")[0])
      .join("; ");
    const adminRefresh = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Origin", "http://127.0.0.1:5174")
      .set("X-Aibus-Client", "admin")
      .set("Cookie", cookies);
    expect(adminRefresh.body.data.user.role).toBe("super_admin");
    const operatorRefresh = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Origin", config.WEB_ORIGIN)
      .set("Cookie", cookies);
    expect(operatorRefresh.body.data.user.role).toBe("operator_admin");
    const refused = await request(app)
      .post("/api/v1/auth/login")
      .set("Origin", "http://127.0.0.1:5174")
      .set("X-Aibus-Client", "admin")
      .send({ email: "a@example.test", password });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("ADMIN_REQUIRED");
  });
});

describe("authentication and isolation", () => {
  it("rejects anonymous resources, NoSQL input, forged tenant ownership and cross-operator reads", async () => {
    expect((await request(app).get("/api/v1/operator/buses")).status).toBe(401);
    expect(
      (
        await request(app)
          .post("/api/v1/auth/login")
          .send({ email: { $ne: null }, password })
      ).status,
    ).toBe(400);
    expect((await get(`/operator/buses/${busId}`, tokenB)).status).toBe(404);
    expect((await get("/operator/buses", tokenB)).body.meta.total).toBe(0);
    const result = await post("/operator/buses", {
      registration: "TS 10 AA 9999",
      name: "Other",
      type: "AC Sleeper",
      capacity: 3,
      operatorId: b.operatorId,
    });
    expect(result.status).toBe(400);
    expect((await get(`/operator/trips/${tripId}/seats`, tokenB)).status).toBe(
      404,
    );
  });
  it("denies write permissions and excludes passenger PII from read-only bookings", async () => {
    expect(
      (
        await post(
          "/operator/trips/" + tripId + "/block",
          { seats: ["L1"] },
          readerToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (await get(`/operator/trips/${tripId}/manifest`, readerToken)).status,
    ).toBe(403);
    expect((await get("/operator/settlements", readerToken)).status).toBe(403);
    expect((await get("/operator/staff", readerToken)).status).toBe(403);
    const hold: any = await createHold(a, tripId, ["L1"]);
    await createBooking(
      a,
      {
        tripId,
        holdId: hold.holdId,
        passengers: [
          { name: "Private Passenger", phone: "+919876543210", seat: "L1" },
        ],
      },
      randomUUID(),
    );
    const result = await get("/operator/bookings", readerToken);
    expect(JSON.stringify(result.body)).not.toContain("Private Passenger");
    expect(JSON.stringify(result.body)).not.toContain("9876543210");
  });
  it("rotates refresh tokens, detects replay and revokes related access sessions", async () => {
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "a@example.test", password });
    const cookie = login.headers["set-cookie"][0].split(";")[0];
    expect(login.headers["set-cookie"][0]).toContain("HttpOnly");
    const refreshed = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Origin", config.WEB_ORIGIN)
      .set("Cookie", cookie);
    expect(refreshed.status).toBe(200);
    expect((await get("/auth/me", login.body.data.accessToken)).status).toBe(
      401,
    );
    const replay = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Origin", config.WEB_ORIGIN)
      .set("Cookie", cookie);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe("TOKEN_REUSE");
    expect(
      (await get("/auth/me", refreshed.body.data.accessToken)).status,
    ).toBe(401);
  });
  it("rejects cross-site cookie mutations and suspended accounts", async () => {
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "a@example.test", password });
    const cookie = login.headers["set-cookie"][0].split(";")[0];
    expect(
      (
        await request(app)
          .post("/api/v1/auth/refresh")
          .set("Origin", "https://evil.example")
          .set("Cookie", cookie)
      ).status,
    ).toBe(403);
    await M.Operator.updateOne(
      { _id: a.operatorId },
      { $set: { status: "suspended" } },
    );
    expect((await get("/operator/buses")).status).toBe(403);
  });
  it("registers pending operators and only platform administrators can approve them", async () => {
    const registered = await request(app).post("/api/v1/auth/register").send({
      company: "New Travels",
      name: "New Admin",
      email: "new@example.test",
      password,
      phone: "+919876543210",
      address: "Hyderabad",
    });
    expect(registered.status).toBe(201);
    expect(
      (
        await request(app)
          .post("/api/v1/auth/login")
          .send({ email: "new@example.test", password })
      ).status,
    ).toBe(403);
    const pending = await M.Operator.findOne({ email: "new@example.test" });
    expect(
      (
        await request(app)
          .patch(`/api/v1/platform/operators/${pending!._id}/status`)
          .set("Authorization", `Bearer ${tokenA}`)
          .send({ status: "approved" })
      ).status,
    ).toBe(403);
    await M.User.create({
      name: "Platform",
      email: "platform@example.test",
      passwordHash: await hashPassword(password),
      role: "super_admin",
    });
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "platform@example.test", password });
    const approved = await request(app)
      .patch(`/api/v1/platform/operators/${pending!._id}/status`)
      .set("Authorization", `Bearer ${login.body.data.accessToken}`)
      .send({ status: "approved", version: pending!.__v, reason: "Verified operator approval fixture", password });
    expect(approved.status).toBe(200);
    expect(
      (
        await request(app)
          .post("/api/v1/auth/login")
          .send({ email: "new@example.test", password })
      ).status,
    ).toBe(200);
  });
  it("rejects expired and invalid JWTs and allows session logout", async () => {
    expect((await get("/operator/buses", "invalid")).status).toBe(401);
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "a@example.test", password });
    await request(app)
      .post("/api/v1/auth/logout")
      .set("Origin", config.WEB_ORIGIN)
      .set("Cookie", login.headers["set-cookie"][0].split(";")[0]);
    expect((await get("/auth/me", login.body.data.accessToken)).status).toBe(
      401,
    );
  });
});
describe("authoritative inventory and money transitions", () => {
  it("allows exactly one winner for simultaneous requests for the same seat", async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, () => createHold(a, tripId, ["L1"])),
    );
    expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await M.Hold.countDocuments({ operatorId: a.operatorId, status: "held" }),
    ).toBe(1);
  });
  it("blocks/release seats atomically and prevents holds by another tenant", async () => {
    expect(
      (await post(`/operator/trips/${tripId}/block`, { seats: ["L1"] })).status,
    ).toBe(200);
    expect(
      (await post(`/operator/trips/${tripId}/holds`, { seats: ["L1"] })).status,
    ).toBe(409);
    expect(
      (await post(`/operator/trips/${tripId}/unblock`, { seats: ["L1"] }))
        .status,
    ).toBe(200);
    expect(
      (await post(`/operator/trips/${tripId}/holds`, { seats: ["L1", "L1"] }))
        .status,
    ).toBe(400);
    await expect(createHold(b, tripId, ["L1"])).rejects.toMatchObject({
      status: 404,
    });
  });
  it("rejects reservation holds for an already booked seat", async () => {
    await M.Trip.updateOne(
      { _id: tripId },
      { $set: { "seats.0.state": "booked" } },
    );
    expect(
      (await post(`/operator/trips/${tripId}/holds`, { seats: ["L1"] })).status,
    ).toBe(409);
    expect(await M.Hold.countDocuments({ tripId, status: "held" })).toBe(0);
  });
  it("creates pending bookings idempotently and never issues a ticket before payment", async () => {
    const hold: any = await createHold(a, tripId, ["L1"]),
      input = {
        tripId,
        holdId: hold.holdId,
        passengers: [{ name: "Passenger", seat: "L1" }],
      },
      key = randomUUID();
    const first: any = await createBooking(a, input, key),
      duplicate: any = await createBooking(a, input, key);
    expect(String(first._id)).toBe(String(duplicate._id));
    expect(first.status).toBe("Pending payment");
    const pendingTrip = await M.Trip.findById(tripId).lean();
    expect(pendingTrip!.seats[0].state).toBe("held");
    expect(String(pendingTrip!.seats[0].bookingId)).toBe(String(first._id));
    expect(
      (await post(`/operator/trips/${tripId}/holds`, { seats: ["L1"] })).status,
    ).toBe(409);
    expect(first.pnr).toBeUndefined();
    expect((await get(`/operator/bookings/${first._id}/ticket`)).status).toBe(
      409,
    );
    await expect(
      createBooking(
        a,
        { ...input, passengers: [{ name: "Other", seat: "L1" }] },
        key,
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(
      (await post(`/operator/bookings/${first._id}/payment`, {})).status,
    ).toBe(503);
  });
  it("processes duplicate verified payment callbacks once and generates one valid ticket", async () => {
    const hold: any = await createHold(a, tripId, ["L1"]);
    const booking: any = await createBooking(
      a,
      {
        tripId,
        holdId: hold.holdId,
        passengers: [{ name: "Passenger", seat: "L1" }],
      },
      randomUUID(),
    );
    const event = {
      verified: true as const,
      providerId: "sandbox-test",
      eventId: "evt-1",
      externalId: "pay-1",
      operatorId: a.operatorId!,
      bookingId: String(booking._id),
      amountPaise: 145000,
      currency: "INR" as const,
      status: "captured" as const,
    };
    await Promise.all([
      applyVerifiedPayment(event),
      applyVerifiedPayment(event),
    ]);
    expect(await M.Payment.countDocuments()).toBe(1);
    expect(await M.Ticket.countDocuments()).toBe(1);
    const confirmed = await M.Booking.findById(booking._id).lean();
    expect(
      await M.JournalEntry.countDocuments({ bookingId: booking._id }),
    ).toBe(1);
    expect(confirmed!.status).toBe("Confirmed");
    await reconcileExpiredHolds();
    const lockedTrip = await M.Trip.findById(tripId).lean();
    expect(lockedTrip!.seats[0].state).toBe("booked");
    expect(String(lockedTrip!.seats[0].bookingId)).toBe(String(booking._id));
    expect(
      (await post(`/operator/trips/${tripId}/holds`, { seats: ["L1"] })).status,
    ).toBe(409);
    expect(confirmed!.pnr).toBeTruthy();
    expect((await get(`/operator/bookings/${booking._id}/ticket`)).status).toBe(
      200,
    );
    expect(
      (await get(`/operator/bookings/${booking._id}/ticket`, tokenB)).status,
    ).toBe(404);
    await expect(
      applyVerifiedPayment({ ...event, amountPaise: 1 }),
    ).rejects.toMatchObject({ code: "EVENT_CONFLICT" });
  });
  it("does not issue a ticket for late captured payment after the held seat expires", async () => {
    const hold: any = await createHold(a, tripId, ["L1"]);
    const booking: any = await createBooking(
      a,
      {
        tripId,
        holdId: hold.holdId,
        passengers: [{ name: "Passenger", seat: "L1" }],
      },
      randomUUID(),
    );
    await M.Trip.updateOne(
      { _id: tripId },
      { $set: { "seats.0.holdUntil": new Date(Date.now() - 1000) } },
    );
    await applyVerifiedPayment({
      verified: true,
      providerId: "sandbox-test",
      eventId: "late",
      externalId: "pay-late",
      operatorId: a.operatorId!,
      bookingId: String(booking._id),
      amountPaise: 145000,
      currency: "INR",
      status: "captured",
    });
    expect((await M.Booking.findById(booking._id))!.status).toBe(
      "Reconciliation required",
    );
    expect(await M.Ticket.countDocuments()).toBe(0);
  });
  it("rejects amount mismatch, external inventory and unsigned webhooks without side effects", async () => {
    const hold: any = await createHold(a, tripId, ["L1"]),
      booking: any = await createBooking(
        a,
        {
          tripId,
          holdId: hold.holdId,
          passengers: [{ name: "Passenger", seat: "L1" }],
        },
        randomUUID(),
      );
    await expect(
      applyVerifiedPayment({
        verified: true,
        providerId: "test",
        eventId: "wrong",
        externalId: "pay-wrong",
        operatorId: a.operatorId!,
        bookingId: String(booking._id),
        amountPaise: 1,
        currency: "INR",
        status: "captured",
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_MISMATCH" });
    expect(await M.Payment.countDocuments()).toBe(0);
    expect(
      (
        await request(app)
          .post("/api/v1/webhooks/fake")
          .send({ status: "captured" })
      ).status,
    ).toBe(503);
    await M.Trip.updateOne(
      { _id: tripId },
      { $set: { inventoryOwner: "external" } },
    );
    expect((await get(`/operator/trips/${tripId}/seats`)).status).toBe(503);
  });
  it("expires pending holds and reconciles bookings without making external calls", async () => {
    const hold: any = await createHold(a, tripId, ["L1"]),
      booking: any = await createBooking(
        a,
        {
          tripId,
          holdId: hold.holdId,
          passengers: [{ name: "Passenger", seat: "L1" }],
        },
        randomUUID(),
      );
    await M.Hold.updateOne(
      { holdId: hold.holdId },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    await M.Trip.updateOne(
      { _id: tripId },
      { $set: { "seats.0.holdUntil": new Date(Date.now() - 1000) } },
    );
    await reconcileExpiredHolds();
    expect((await M.Booking.findById(booking._id))!.status).toBe("Failed");
    expect((await M.Trip.findById(tripId))!.seats[0].state).toBe("available");
    expect(await reconcileExternalBookings()).toEqual({
      available: false,
      checked: 0,
    });
  });
  it("uses actual recorded settlement totals and integer-paise reports", async () => {
    const report = await get(
      "/operator/reports/revenue?from=2026-01-01&to=2026-12-31",
    );
    expect(report.status).toBe(200);
    expect(report.body.data.grossPaise).toBe(0);
    expect(report.body.data.settledPaise).toBe(0);
    expect((await get("/operator/settlements")).body.data).toEqual([]);
  });
});
describe("shared booking counter engine", () => {
  it("searches only owned trips with accurate availability and rejects injected search fields", async () => {
    const result = await get(
      "/operator/counter/trips?from=Hyderabad&to=Bangalore&journeyDate=2030-11-13",
    );
    expect(result.status).toBe(200);
    expect(result.body.data).toHaveLength(1);
    expect(result.body.data[0]).toMatchObject({
      id: tripId,
      totalSeats: 3,
      availableSeats: 3,
      baseFarePaise: 145000,
    });
    expect(
      (await get("/operator/counter/trips?journeyDate=2030-11-13", tokenB)).body
        .data,
    ).toEqual([]);
    expect(
      (
        await get(
          "/operator/counter/trips?journeyDate=2030-11-13&operatorId=" +
            a.operatorId,
        )
      ).status,
    ).toBe(400);
    expect(
      (await get(`/operator/counter/trips/${tripId}/bookings`, tokenB)).status,
    ).toBe(404);
  });
  it("requires an explicit tax policy and restricts changes to pricing-authorized staff", async () => {
    await M.PricingPolicy.deleteMany({ operatorId: a.operatorId });
    await expect(issueQuote(a, tripId, ["L1"], {})).rejects.toMatchObject({
      code: "PRICING_POLICY_REQUIRED",
    });
    const body = {
      taxBasisPoints: 500,
      chargePaise: 10000,
      chargesTaxable: true,
      operatorDiscountMaxPaise: 20000,
      requireAge: true,
      requireGender: true,
      requireMobile: true,
      gstEnabled: true,
      expectedVersion: 0,
    };
    expect(
      (
        await request(app)
          .put("/api/v1/operator/pricing-policy")
          .set("Authorization", `Bearer ${readerToken}`)
          .send(body)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .put("/api/v1/operator/pricing-policy")
          .set("Authorization", `Bearer ${tokenA}`)
          .send(body)
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .put("/api/v1/operator/pricing-policy")
          .set("Authorization", `Bearer ${tokenA}`)
          .send(body)
      ).status,
    ).toBe(409);
  });
  it("quotes server-side taxes/charges/discounts and rejects client totals and forged sources", async () => {
    await M.PricingPolicy.updateOne(
      { operatorId: a.operatorId },
      {
        $set: {
          taxBasisPoints: 500,
          chargePaise: 10000,
          chargesTaxable: true,
          operatorDiscountMaxPaise: 20000,
        },
      },
    );
    const quoted = await issueQuote(a, tripId, ["L1", "L2"], {
      operatorDiscountPaise: 10000,
    });
    expect(quoted.pricing).toMatchObject({
      grossPaise: 290000,
      discountPaise: 10000,
      taxPaise: 14500,
      chargePaise: 10000,
      totalPaise: 304500,
    });
    const noDiscountAuth = { ...a, permissions: rolePermissions.booking_staff };
    const trip = await M.Trip.findOne({
      _id: tripId,
      operatorId: a.operatorId,
    }).lean();
    await expect(
      priceTrip(noDiscountAuth, trip, ["L1"], { operatorDiscountPaise: 100 }),
    ).rejects.toMatchObject({ code: "DISCOUNT_FORBIDDEN" });
    const hold: any = await createHold(a, tripId, ["L1"]);
    const body = {
      tripId,
      holdId: hold.holdId,
      passengers: [{ name: "Passenger", seat: "L1" }],
      totalPaise: 1,
    };
    expect(
      (
        await post("/operator/bookings", body).set(
          "Idempotency-Key",
          randomUUID(),
        )
      ).status,
    ).toBe(400);
    delete (body as any).totalPaise;
    expect(
      (
        await post("/operator/bookings", { ...body, source: "customer" }).set(
          "Idempotency-Key",
          randomUUID(),
        )
      ).status,
    ).toBe(400);
  });
  it("binds quotes to hold, user and policy version without consuming invalid attempts", async () => {
    const hold: any = await createHold(a, tripId, ["L1"]);
    const quoted = await issueQuote(a, tripId, ["L1"], {}, hold.holdId);
    await M.PricingPolicy.updateOne(
      { operatorId: a.operatorId },
      { $inc: { version: 1 }, $set: { taxBasisPoints: 500 } },
    );
    await expect(
      createBooking(
        a,
        {
          tripId,
          holdId: hold.holdId,
          quoteId: quoted.quoteId,
          passengers: [{ name: "Passenger", seat: "L1" }],
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "REQUOTE_REQUIRED" });
    expect(
      (await M.Hold.findOne({ operatorId: a.operatorId, holdId: hold.holdId }))!
        .status,
    ).toBe("held");
    const fresh = await issueQuote(a, tripId, ["L1"], {}, hold.holdId);
    const booking: any = await createBooking(
      a,
      {
        tripId,
        holdId: hold.holdId,
        quoteId: fresh.quoteId,
        passengers: [
          {
            name: "Passenger",
            seat: "L1",
            boarding: "Miyapur",
            dropping: "Hebbal",
          },
        ],
      },
      randomUUID(),
    );
    expect(booking).toMatchObject({
      totalPaise: 152250,
      taxPaise: 7250,
      source: "operator",
      status: "Pending payment",
    });
    expect(booking.pnr).toBeUndefined();
    expect(
      (await M.Quote.findOne({ _id: fresh.quoteId, operatorId: a.operatorId }))!
        .status,
    ).toBe("consumed");
  });
  it("enforces seat-specific passenger requirements and valid trip stops", async () => {
    await M.PricingPolicy.updateOne(
      { operatorId: a.operatorId },
      { $set: { requireAge: true, requireGender: true, requireMobile: true } },
    );
    const hold: any = await createHold(a, tripId, ["L1"]);
    await expect(
      createBooking(
        a,
        {
          tripId,
          holdId: hold.holdId,
          passengers: [
            { name: "Passenger", seat: "L1", phone: "+919876543210" },
          ],
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "AGE_REQUIRED" });
    await expect(
      createBooking(
        a,
        {
          tripId,
          holdId: hold.holdId,
          passengers: [
            {
              name: "Passenger",
              seat: "L1",
              age: 30,
              gender: "female",
              phone: "+919876543210",
              boarding: "Not on this route",
            },
          ],
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "BOARDING_INVALID" });
    const created: any = await createBooking(
      a,
      {
        tripId,
        holdId: hold.holdId,
        contact: { phone: "+919876543210", email: "passenger@example.test" },
        passengers: [
          {
            name: "Passenger",
            seat: "L1",
            age: 30,
            gender: "female",
            boarding: "Miyapur",
            dropping: "Hebbal",
          },
        ],
      },
      randomUUID(),
    );
    expect(created.passengers[0]).toMatchObject({
      age: 30,
      gender: "female",
      seat: "L1",
      dropping: "Hebbal",
    });
  });
  it("reserves quotas atomically and requires release before booking", async () => {
    expect(
      (
        await post(
          `/operator/trips/${tripId}/quota`,
          { seats: ["L1"], action: "assign", label: "Crew allocation" },
          readerToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await post(`/operator/trips/${tripId}/quota`, {
          seats: ["L1"],
          action: "assign",
          label: "Crew allocation",
        })
      ).status,
    ).toBe(200);
    expect(
      (await get(`/operator/trips/${tripId}/seats`)).body.data.seats[0],
    ).toMatchObject({ state: "quota", quotaLabel: "Crew allocation" });
    await expect(createHold(a, tripId, ["L1"])).rejects.toMatchObject({
      code: "SEAT_UNAVAILABLE",
    });
    expect(
      (
        await post(`/operator/trips/${tripId}/quota`, {
          seats: ["L1"],
          action: "release",
        })
      ).status,
    ).toBe(200);
    expect(((await createHold(a, tripId, ["L1"])) as any).holdId).toBeTruthy();
  });
  it("stops new holds and bookings, but preserves already-created pending-payment confirmation", async () => {
    const hold: any = await createHold(a, tripId, ["L1"]);
    const booking: any = await createBooking(
      a,
      {
        tripId,
        holdId: hold.holdId,
        passengers: [{ name: "Passenger", seat: "L1" }],
      },
      randomUUID(),
    );
    const stopped = await request(app)
      .patch(`/api/v1/operator/trips/${tripId}/booking-status`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ open: false, expectedVersion: 0 });
    expect(stopped.status).toBe(200);
    await expect(createHold(a, tripId, ["L2"])).rejects.toMatchObject({
      code: "BOOKING_STOPPED",
    });
    await applyVerifiedPayment({
      verified: true,
      providerId: "test",
      externalId: "paid-before-stop",
      eventId: "evt-before-stop",
      operatorId: a.operatorId!,
      bookingId: String(booking._id),
      amountPaise: 145000,
      currency: "INR",
      status: "captured",
    });
    expect((await M.Booking.findById(booking._id))!.status).toBe("Confirmed");
    expect(
      (
        await request(app)
          .patch(`/api/v1/operator/trips/${tripId}/booking-status`)
          .set("Authorization", `Bearer ${tokenA}`)
          .send({ open: true, expectedVersion: 0 })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .patch(`/api/v1/operator/trips/${tripId}/booking-status`)
          .set("Authorization", `Bearer ${tokenA}`)
          .send({ open: true, expectedVersion: 1 })
      ).status,
    ).toBe(200);
  });
  it("cancels only unpaid pending bookings and reconciles a late capture without issuing a ticket", async () => {
    const hold: any = await createHold(a, tripId, ["L1"]);
    const booking: any = await createBooking(
      a,
      {
        tripId,
        holdId: hold.holdId,
        passengers: [{ name: "Passenger", seat: "L1" }],
      },
      randomUUID(),
    );
    expect(
      (
        await post(
          `/operator/bookings/${booking._id}/cancel-pending`,
          { reason: "Passenger changed plans" },
          tokenB,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await post(`/operator/bookings/${booking._id}/cancel-pending`, {
          reason: "Passenger changed plans",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await post(`/operator/bookings/${booking._id}/cancel-pending`, {
          reason: "Duplicate request",
        })
      ).status,
    ).toBe(200);
    expect((await M.Trip.findById(tripId))!.seats[0].state).toBe("available");
    await applyVerifiedPayment({
      verified: true,
      providerId: "test",
      externalId: "late-after-cancel",
      eventId: "late-after-cancel",
      operatorId: a.operatorId!,
      bookingId: String(booking._id),
      amountPaise: 145000,
      currency: "INR",
      status: "captured",
    });
    expect((await M.Booking.findById(booking._id))!.status).toBe(
      "Reconciliation required",
    );
    expect(await M.Ticket.countDocuments()).toBe(0);
  });
  it("modifies passengers with optimistic version checks while preserving booked seats and money", async () => {
    const hold: any = await createHold(a, tripId, ["L1"]);
    const booking: any = await createBooking(
      a,
      {
        tripId,
        holdId: hold.holdId,
        passengers: [{ name: "Passenger", seat: "L1" }],
      },
      randomUUID(),
    );
    const update = {
      expectedVersion: 0,
      passengers: [
        {
          name: "Updated Passenger",
          seat: "L1",
          boarding: "Miyapur",
          dropping: "Hebbal",
        },
      ],
    };
    const path = `/api/v1/operator/bookings/${booking._id}/passengers`;
    expect(
      (
        await request(app)
          .patch(path)
          .set("Authorization", `Bearer ${tokenB}`)
          .send(update)
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .patch(path)
          .set("Authorization", `Bearer ${tokenA}`)
          .send({ ...update, passengers: [{ name: "Other seat", seat: "L2" }] })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .patch(path)
          .set("Authorization", `Bearer ${tokenA}`)
          .send(update)
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .patch(path)
          .set("Authorization", `Bearer ${tokenA}`)
          .send(update)
      ).status,
    ).toBe(409);
    const saved = await M.Booking.findById(booking._id).lean();
    expect(saved!.totalPaise).toBe(145000);
    expect(saved!.passengers[0].name).toBe("Updated Passenger");
  });
  it("restricts financial metadata and ticket downloads; source counts reflect stored records only", async () => {
    const hold: any = await createHold(a, tripId, ["L1"]);
    const booking: any = await createBooking(
      a,
      {
        tripId,
        holdId: hold.holdId,
        passengers: [{ name: "Passenger", seat: "L1" }],
      },
      randomUUID(),
    );
    expect(
      (await get(`/operator/bookings/${booking._id}/payments`, readerToken))
        .status,
    ).toBe(403);
    expect(
      (await get(`/operator/bookings/${booking._id}/ticket.html`)).status,
    ).toBe(409);
    await applyVerifiedPayment({
      verified: true,
      providerId: "test",
      externalId: "counter-test-ticket",
      eventId: "counter-test-ticket",
      operatorId: a.operatorId!,
      bookingId: String(booking._id),
      amountPaise: 145000,
      currency: "INR",
      status: "captured",
    });
    const ticket = await get(`/operator/bookings/${booking._id}/ticket.html`);
    expect(ticket.status).toBe(200);
    expect(ticket.text).toContain("CONFIRMED E-TICKET");
    expect(ticket.text).toContain("Passenger");
    expect(
      (await get(`/operator/bookings/${booking._id}/ticket.html`, tokenB))
        .status,
    ).toBe(409);
    const records = await get(`/operator/counter/trips/${tripId}/bookings`);
    expect(records.body.data.sourceCounts).toEqual({
      operator: 1,
      customer: 0,
      agent: 0,
      external: 0,
    });
    const limited = await get(
      `/operator/counter/trips/${tripId}/bookings`,
      readerToken,
    );
    expect(JSON.stringify(limited.body)).not.toContain("Passenger");
    expect(
      (await get(`/operator/counter/trips/${tripId}/bookings?source=customer`))
        .body.data.bookings,
    ).toEqual([]);
  });
});
describe("trusted source attribution", () => {
  it("uses the shared holds and engine for a verified customer channel without accepting a frontend source claim", async () => {
    const hold: any = await createHold(a, tripId, ["L1"]),
      key = randomUUID(),
      input = {
        tripId,
        holdId: hold.holdId,
        passengers: [{ name: "Customer Passenger", seat: "L1" }],
      };
    const booking: any = await createBooking(a, input, key, "customer");
    expect(booking.source).toBe("customer");
    await expect(createHold(a, tripId, ["L1"])).rejects.toMatchObject({
      code: "SEAT_UNAVAILABLE",
    });
    const list = await get(
      `/operator/counter/trips/${tripId}/bookings?source=customer`,
    );
    expect(list.body.data.bookings).toHaveLength(1);
    expect(list.body.data.sourceCounts).toEqual({
      operator: 0,
      customer: 1,
      agent: 0,
      external: 0,
    });
    await expect(
      createBooking(a, input, key, "operator"),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
});
describe("provider failures and realtime", () => {
  it("retries only read failures and propagates provider errors", async () => {
    let calls = 0;
    const value = await safeProviderRead(async () => {
      calls++;
      if (calls < 2) throw new AppError(503, "UPSTREAM", "unavailable");
      return "ok";
    });
    expect(value).toBe("ok");
    expect(calls).toBe(2);
    calls = 0;
    await expect(
      safeProviderRead(async () => {
        calls++;
        throw new AppError(400, "BAD_REQUEST", "invalid");
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(calls).toBe(1);
  });
  it("rejects anonymous sockets and scopes invalidation events to authenticated operator rooms", async () => {
    const server = createServer(app),
      io = attachRealtime(server, config);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address() as { port: number },
      url = `http://127.0.0.1:${address.port}`;
    const ca = connectSocket(url, {
        auth: { token: tokenA },
        transports: ["websocket"],
      }),
      cb = connectSocket(url, {
        auth: { token: tokenB },
        transports: ["websocket"],
      });
    try {
      await Promise.all([
        new Promise<void>((resolve, reject) => {
          ca.on("connect", resolve);
          ca.on("connect_error", reject);
        }),
        new Promise<void>((resolve, reject) => {
          cb.on("connect", resolve);
          cb.on("connect_error", reject);
        }),
      ]);
      let leaked = false;
      cb.on("seat.availability.changed", () => {
        leaked = true;
      });
      const received = new Promise<any>((resolve) =>
        ca.once("seat.availability.changed", resolve),
      );
      await M.Outbox.create({
        operatorId: a.operatorId,
        event: "seat.availability.changed",
        resourceId: tripId,
      });
      await publishOutbox(io);
      expect((await received).resourceId).toBe(tripId);
      expect(leaked).toBe(false);
      const anonymous = connectSocket(url, {
        transports: ["websocket"],
        reconnection: false,
      });
      await new Promise<void>((resolve) =>
        anonymous.once("connect_error", () => {
          anonymous.close();
          resolve();
        }),
      );
    } finally {
      ca.close();
      cb.close();
      await new Promise<void>((resolve) => io.close(() => resolve()));
      server.close();
    }
  });
});

describe("Razorpay Test Mode adapter (mock provider transport)", () => {
  const orderId = "order_fixture123",
    paymentId = "pay_fixture123";
  const hmac = (value: string, secret = paymentConfig.RAZORPAY_KEY_SECRET) =>
    createHmac("sha256", secret).update(value).digest("hex");
  const paymentPost = (
    bookingId: string,
    suffix = "",
    body: any = {},
    token = tokenA,
  ) =>
    request(paymentApp)
      .post("/api/v1/operator/bookings/" + bookingId + "/payment" + suffix)
      .set("Authorization", "Bearer " + token)
      .send(body);
  async function pending() {
    const hold: any = await createHold(a, tripId, ["L1"]);
    return (await createBooking(
      a,
      {
        tripId,
        holdId: hold.holdId,
        passengers: [
          { name: "Sandbox Passenger", seat: "L1", phone: "9999999999" },
        ],
      },
      randomUUID(),
    )) as any;
  }
  function provider(
    booking: any,
    options: {
      status?: string;
      amount?: number;
      foreignOrder?: boolean;
      refunded?: number;
    } = {},
  ) {
    const order = {
      id: orderId,
      amount: booking.totalPaise,
      currency: "INR",
      receipt: "aibus_" + booking._id,
      partial_payment: false,
    };
    const payment = () => ({
      id: paymentId,
      order_id: options.foreignOrder ? "order_foreign" : orderId,
      amount: options.amount ?? booking.totalPaise,
      currency: "INR",
      status: options.status || "captured",
      captured: !options.status || options.status === "captured",
      amount_refunded: options.refunded || 0,
    });
    return vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url, init) => {
        const endpoint = String(url).replace("https://api.razorpay.com/v1", "");
        if (endpoint === "/orders" && init?.method === "POST") {
          expect(JSON.parse(String(init.body))).toMatchObject({
            amount: booking.totalPaise,
            currency: "INR",
            partial_payment: false,
          });
          return new Response(JSON.stringify(order));
        }
        if (endpoint.startsWith("/orders?"))
          return new Response(JSON.stringify({ items: [order] }));
        if (endpoint === "/orders/" + orderId + "/payments")
          return new Response(JSON.stringify({ items: [payment()] }));
        if (endpoint === "/payments/" + paymentId)
          return new Response(JSON.stringify(payment()));
        if (endpoint === "/payments/" + paymentId + "/capture") {
          options.status = "captured";
          return new Response(JSON.stringify(payment()));
        }
        throw Error("Unexpected provider endpoint " + endpoint);
      });
  }
  const proof = () => ({
    razorpay_order_id: orderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: hmac(orderId + "|" + paymentId),
  });
  it("creates at most one gateway order under concurrent checkout requests", async () => {
    const booking = await pending(),
      transport = provider(booking),
      id = String(booking._id);
    const results = await Promise.all([
      paymentPost(id),
      paymentPost(id),
      paymentPost(id),
    ]);
    expect(results.some((r) => r.status === 200)).toBe(true);
    expect(results.every((r) => [200, 409].includes(r.status))).toBe(true);
    expect(
      transport.mock.calls.filter(
        ([url, options]) =>
          String(url).endsWith("/orders") && options?.method === "POST",
      ),
    ).toHaveLength(1);
    expect(await M.PaymentOrder.countDocuments({ bookingId: id })).toBe(1);
  });
  it("never blindly retries an uncertain capture and can recover its eventual captured status", async () => {
    const booking = await pending(),
      options = { status: "authorized" },
      transport = provider(booking, options),
      id = String(booking._id);
    const original = transport.getMockImplementation()!;
    transport.mockImplementation(async (...args) => {
      if (String(args[0]).endsWith("/capture"))
        throw Error("capture response lost");
      return original(...args);
    });
    await paymentPost(id);
    expect((await paymentPost(id, "/verify", proof())).body.data.status).toBe(
      "Pending payment",
    );
    expect((await paymentPost(id, "/verify", proof())).body.data.status).toBe(
      "Pending payment",
    );
    expect(
      transport.mock.calls.filter(([url]) => String(url).endsWith("/capture")),
    ).toHaveLength(1);
    options.status = "captured";
    expect((await paymentPost(id, "/verify", proof())).body.data.status).toBe(
      "Confirmed",
    );
    expect(await M.Ticket.countDocuments({ bookingId: id })).toBe(1);
  });
  it("reconciles a capture timeout after replacement without retrying the charge or stealing the new hold", async () => {
    const booking = await pending(),
      options = { status: "authorized" };
    const transport = provider(booking, options),
      id = String(booking._id);
    const original = transport.getMockImplementation()!;
    transport.mockImplementation(async (...args) => {
      if (String(args[0]).endsWith("/capture"))
        throw Error("capture response timed out");
      return original(...args);
    });
    expect((await paymentPost(id)).status).toBe(200);
    expect((await paymentPost(id, "/verify", proof())).body.data.status).toBe(
      "Pending payment",
    );
    const expiresAt = new Date(Date.now() - 1000);
    await M.Hold.updateOne({ holdId: booking.holdId }, { $set: { expiresAt } });
    await M.Trip.updateOne(
      { _id: tripId },
      { $set: { "seats.0.holdUntil": expiresAt } },
    );
    const hold: any = await createHold(a, tripId, ["L1"]);
    options.status = "captured";
    const results = await Promise.all([
      paymentPost(id, "/verify", proof()),
      paymentPost(id, "/reconcile"),
    ]);
    expect(
      results.every(
        (r) =>
          r.status === 200 && r.body.data.status === "Reconciliation required",
      ),
    ).toBe(true);
    expect((await paymentPost(id, "/verify", proof())).body.data.status).toBe(
      "Reconciliation required",
    );
    expect(
      transport.mock.calls.filter(([url]) => String(url).endsWith("/capture")),
    ).toHaveLength(1);
    expect(
      transport.mock.calls.filter(
        ([url, init]) =>
          String(url).endsWith("/orders") && init?.method === "POST",
      ),
    ).toHaveLength(1);
    expect(
      await M.Payment.countDocuments({ bookingId: id, status: "captured" }),
    ).toBe(1);
    expect(await M.Ticket.countDocuments()).toBe(0);
    const seat = (await M.Trip.findById(tripId).lean())!.seats[0];
    expect(seat).toMatchObject({ state: "held", holdId: hold.holdId });
    expect(seat.bookingId).toBeUndefined();
  });
  it("uses the server amount, reuses one order, verifies capture and issues only one ticket across callback/webhook replay", async () => {
    const booking = await pending(),
      transport = provider(booking),
      id = String(booking._id);
    const start = await paymentPost(id);
    expect(start.status).toBe(200);
    expect(start.body.data).toMatchObject({
      mode: "test",
      amountPaise: 145000,
      orderId,
      keyId: "rzp_test_fixture",
    });
    expect(JSON.stringify(start.body)).not.toContain(
      paymentConfig.RAZORPAY_KEY_SECRET,
    );
    expect((await paymentPost(id)).status).toBe(200);
    expect(
      transport.mock.calls.filter(
        ([u, o]) => String(u).endsWith("/orders") && o?.method === "POST",
      ),
    ).toHaveLength(1);
    const verified = await paymentPost(id, "/verify", proof());
    expect(verified.status).toBe(200);
    expect(verified.body.data.status).toBe("Confirmed");
    expect((await paymentPost(id, "/verify", proof())).status).toBe(200);
    const raw = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: paymentId, order_id: orderId } } },
    });
    for (let i = 0; i < 2; i++)
      expect(
        (
          await request(paymentApp)
            .post("/api/v1/webhooks/razorpay")
            .set("Content-Type", "application/json")
            .set(
              "x-razorpay-signature",
              hmac(raw, paymentConfig.RAZORPAY_WEBHOOK_SECRET),
            )
            .send(raw)
        ).status,
      ).toBe(200);
    expect(await M.Ticket.countDocuments({ bookingId: id })).toBe(1);
    expect(
      await M.Payment.countDocuments({ bookingId: id, status: "captured" }),
    ).toBe(1);
    expect(await M.JournalEntry.countDocuments({ bookingId: id })).toBe(1);
    expect(await verifyLedger(a.operatorId!)).toMatchObject({
      consistent: true,
    });
    expect((await M.Trip.findById(tripId).lean())!.seats[0].state).toBe(
      "booked",
    );
    expect(
      (await get("/operator/trips/" + tripId + "/manifest")).body.data
        .passengers,
    ).toHaveLength(1);
  });
  it("rejects unauthenticated, cross-tenant and read-only payment access and forged signatures", async () => {
    const booking = await pending(),
      transport = provider(booking),
      id = String(booking._id);
    expect(
      (
        await request(paymentApp).post(
          "/api/v1/operator/bookings/" + id + "/payment",
        )
      ).status,
    ).toBe(401);
    expect((await paymentPost(id, "", {}, tokenB)).status).toBe(404);
    expect((await paymentPost(id, "", {}, readerToken)).status).toBe(403);
    expect(transport).not.toHaveBeenCalled();
    await paymentPost(id);
    expect(
      (
        await paymentPost(id, "/verify", {
          ...proof(),
          razorpay_signature: "0".repeat(64),
        })
      ).status,
    ).toBe(400);
    expect(
      (await paymentPost(id, "/verify", { ...proof(), amount: 1 })).status,
    ).toBe(400);
    expect(await M.Ticket.countDocuments()).toBe(0);
  });
  it("rejects wrong payment amounts, other orders and previously refunded payments", async () => {
    const booking = await pending(),
      options = { amount: 1, foreignOrder: false, refunded: 0 },
      id = String(booking._id);
    provider(booking, options);
    await paymentPost(id);
    expect((await paymentPost(id, "/verify", proof())).status).toBe(409);
    expect(await M.FinanceException.findOne({ bookingId: booking._id }).lean()).toMatchObject({ kind: "Captured evidence mismatch", observedAmountPaise: 1, observedCurrency: "INR", status: "Open" });
    options.amount = booking.totalPaise;
    options.foreignOrder = true;
    expect((await paymentPost(id, "/verify", proof())).status).toBe(409);
    options.foreignOrder = false;
    options.refunded = 100;
    expect((await paymentPost(id, "/verify", proof())).status).toBe(409);
    expect(await M.Ticket.countDocuments()).toBe(0);
    expect((await M.Booking.findById(id).lean())!.status).toBe(
      "Pending payment",
    );
  });
  it("captures an authorized payment once and confirms only after fetching captured status", async () => {
    const booking = await pending(),
      options = { status: "authorized" },
      transport = provider(booking, options),
      id = String(booking._id);
    await paymentPost(id);
    expect((await paymentPost(id, "/verify", proof())).body.data.status).toBe(
      "Confirmed",
    );
    await paymentPost(id, "/verify", proof());
    expect(
      transport.mock.calls.filter(([u]) => String(u).endsWith("/capture")),
    ).toHaveLength(1);
  });
  it("keeps failed attempts pending and can reconcile a later capture without a browser callback", async () => {
    const booking = await pending(),
      options = { status: "failed" },
      id = String(booking._id);
    provider(booking, options);
    await paymentPost(id);
    expect((await paymentPost(id, "/verify", proof())).body.data.status).toBe(
      "Pending payment",
    );
    expect((await M.Booking.findById(id).lean())!.status).toBe(
      "Pending payment",
    );
    options.status = "captured";
    expect((await paymentPost(id, "/reconcile")).body.data.status).toBe(
      "Confirmed",
    );
  });
  it("rejects expired payment starts and reconciles late capture without stealing a newly held seat", async () => {
    const booking = await pending(),
      id = String(booking._id),
      transport = provider(booking);
    await paymentPost(id);
    await M.Trip.updateOne(
      { _id: tripId },
      { $set: { "seats.0.holdUntil": new Date(Date.now() - 1000) } },
    );
    await M.Hold.updateOne(
      { holdId: booking.holdId },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    const replacement: any = await createHold(a, tripId, ["L1"]);
    expect((await paymentPost(id)).status).toBe(409);
    const result = await paymentPost(id, "/verify", proof());
    expect(result.status).toBe(200);
    expect(result.body.data.status).toBe("Reconciliation required");
    expect((await M.Trip.findById(tripId).lean())!.seats[0].holdId).toBe(
      replacement.holdId,
    );
    expect(await M.Ticket.countDocuments()).toBe(0);
    expect(
      transport.mock.calls.filter(
        ([u, o]) => String(u).endsWith("/orders") && o?.method === "POST",
      ),
    ).toHaveLength(1);
  });
  it("requires raw webhook HMAC and never trusts an unsigned status field", async () => {
    const booking = await pending(),
      id = String(booking._id);
    provider(booking);
    await paymentPost(id);
    const raw = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: paymentId, order_id: orderId } } },
    });
    expect(
      (
        await request(paymentApp)
          .post("/api/v1/webhooks/razorpay")
          .set("Content-Type", "application/json")
          .send(raw)
      ).status,
    ).toBe(400);
    expect(
      (
        await request(paymentApp)
          .post("/api/v1/webhooks/razorpay")
          .set("Content-Type", "application/json")
          .set(
            "x-razorpay-signature",
            hmac(raw, paymentConfig.RAZORPAY_WEBHOOK_SECRET),
          )
          .send(raw + " ")
      ).status,
    ).toBe(400);
    expect(await M.Ticket.countDocuments()).toBe(0);
  });
  it("recovers an uncertain order by receipt without issuing a second create request", async () => {
    const booking = await pending(),
      id = String(booking._id);
    let calls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      calls++;
      throw Error("connection interrupted after write");
    });
    expect((await paymentPost(id)).status).toBe(503);
    expect(calls).toBe(1);
    vi.restoreAllMocks();
    const transport = provider(booking);
    expect((await paymentPost(id)).status).toBe(200);
    expect(
      transport.mock.calls.every(([, options]) => options?.method === "GET"),
    ).toBe(true);
  });
});

describe("Trip Master", () => {
  async function serviceFixture() {
    await M.Layout.create({
      operatorId: a.operatorId,
      busId,
      name: "2+1",
      seats: [0, 1, 3].map((column, i) => ({
        number: `L${i + 1}`,
        deck: "lower",
        row: 0,
        column,
        category: "sleeper",
        farePaise: 0,
      })),
    });
    const response = await post("/operator/trip-master/services", {
      name: "Daily sleeper",
      code: "HYD-BLR",
      busId,
      routeId,
      departure: "21:30",
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      doublePaise: 220000,
      singlePaise: 250000,
      status: "Active",
    });
    expect(response.status).toBe(201);
    return response.body.data;
  }
  it("previews and schedules service trips with distinct side fares, safely skips retries, and isolates tenants", async () => {
    const service = await serviceFixture();
    const input = {
      serviceIds: [service._id],
      from: "2030-12-01",
      to: "2030-12-02",
    };
    const preview = await post(
      "/operator/trip-master/scheduling/preview",
      input,
    );
    expect(preview.body.data.map((r: any) => r.state)).toEqual([
      "Ready",
      "Ready",
    ]);
    const created = await post(
      "/operator/trip-master/scheduling/create",
      input,
    );
    expect(created.status).toBe(201);
    expect(created.body.data.created).toBe(2);
    const trip = await M.Trip.findById(created.body.data.tripIds[0]).lean();
    expect((trip!.seats as any[]).map((s) => s.farePaise)).toEqual([
      220000, 220000, 250000,
    ]);
    const again = await post("/operator/trip-master/scheduling/create", input);
    expect(again.body.data.created).toBe(0);
    expect(again.body.data.existing).toBe(2);
    expect(
      (await get(`/operator/trip-master/services/${service._id}`, tokenB))
        .status,
    ).toBe(404);
    expect(
      (
        await post(
          "/operator/trip-master/scheduling/create",
          input,
          readerToken,
        )
      ).status,
    ).toBe(403);
    const availability = await get(
      `/operator/trip-master/availability?journeyDate=2030-12-01&serviceIds=${service._id}`,
    );
    expect(availability.body.data[0].available).toBe(3);
  });
  it("rolls back an entire batch if one date conflicts", async () => {
    const service = await serviceFixture();
    const result = await post("/operator/trip-master/scheduling/create", {
      serviceIds: [service._id],
      from: "2030-11-12",
      to: "2030-11-14",
    });
    expect(result.status).toBe(409);
    expect(await M.Trip.countDocuments({ serviceId: service._id })).toBe(0);
  });
  it("records ordered operations idempotently and calculates actual delay and mileage without exposing expenses to readers", async () => {
    await M.Trip.updateOne(
      { _id: tripId },
      {
        $set: {
          departureAt: new Date(Date.now() - 3600000),
          arrivalAt: new Date(Date.now() - 1800000),
          journeyDate: "2026-11-15",
        },
      },
    );
    const base = "/operator/trip-master/trips/" + tripId;
    const body = {
      stage: "Boarding",
      at: new Date(Date.now() - 3500000).toISOString(),
      expectedVersion: 0,
    };
    const first = await request(app)
      .post(`/api/v1${base}/operations`)
      .set("Authorization", `Bearer ${tokenA}`)
      .set("Idempotency-Key", "boarding-fixture-0001")
      .send(body);
    expect(first.status).toBe(200);
    const repeated = await request(app)
      .post(`/api/v1${base}/operations`)
      .set("Authorization", `Bearer ${tokenA}`)
      .set("Idempotency-Key", "boarding-fixture-0001")
      .send(body);
    expect(repeated.status).toBe(200);
    expect(await M.TripOperation.countDocuments()).toBe(1);
    const wrong = await request(app)
      .post(`/api/v1${base}/operations`)
      .set("Authorization", `Bearer ${tokenA}`)
      .set("Idempotency-Key", randomUUID())
      .send({ ...body, stage: "Completed", expectedVersion: 1 });
    expect(wrong.status).toBe(409);
    for (const [stage, version, odometerKm, minutes] of [
      ["Departed", 1, 1000, 50],
      ["Arrived", 2, 1100, 20],
      ["Completed", 3, undefined, 10],
    ] as const) {
      const result = await request(app)
        .post(`/api/v1${base}/operations`)
        .set("Authorization", `Bearer ${tokenA}`)
        .set("Idempotency-Key", randomUUID())
        .send({
          stage,
          expectedVersion: version,
          at: new Date(Date.now() - minutes * 60000).toISOString(),
          ...(odometerKm !== undefined ? { odometerKm } : {}),
          ...(stage === "Arrived" ? { fuelConsumedMillilitres: 20000 } : {}),
        });
      expect(result.status, result.body.error?.message).toBe(200);
    }
    const report = await get(
      "/operator/trip-master/reports?from=2026-11-15&to=2026-11-15",
    );
    expect(report.body.data.rows[0].distanceKm).toBe(100);
    expect(report.body.data.rows[0].mileageKmPerLitre).toBe(5);
    expect(report.body.data.rows[0].departureDelayMinutes).toBe(10);
    const reader = await get(
      "/operator/trip-master/reports?from=2026-11-15&to=2026-11-15",
      readerToken,
    );
    expect(reader.body.data.summary.fuelExpensePaise).toBeUndefined();
    expect(reader.body.data.rows[0].fuelExpensePaise).toBeUndefined();
  });
  it("records fuel once across concurrent retries, voids it with an audit trail, and validates stop references", async () => {
    const key = randomUUID(),
      payload = {
        tripId,
        litresMillilitres: 50000,
        amountPaise: 500000,
        at: new Date().toISOString(),
      };
    const send = () =>
      request(app)
        .post("/api/v1/operator/trip-master/fuel")
        .set("Authorization", `Bearer ${tokenA}`)
        .set("Idempotency-Key", key)
        .send(payload);
    const results = await Promise.all([send(), send()]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(await M.TripFuel.countDocuments()).toBe(1);
    expect(
      (
        await post(
          `/operator/trip-master/fuel/${results[0].body.data._id}/void`,
          { reason: "Duplicate receipt" },
        )
      ).status,
    ).toBe(200);
    expect((await get("/operator/trip-master/fuel", readerToken)).status).toBe(
      403,
    );
    const stop = await request(app)
      .post("/api/v1/operator/trip-master/stops")
      .set("Authorization", `Bearer ${tokenA}`)
      .set("Idempotency-Key", randomUUID())
      .send({
        tripId,
        kind: "Other",
        name: "Rest stop",
        arrivedAt: new Date(Date.now() - 600000).toISOString(),
        departedAt: new Date(Date.now() - 300000).toISOString(),
      });
    expect(stop.status).toBe(201);
    const foreign = await request(app)
      .post("/api/v1/operator/trip-master/stops")
      .set("Authorization", `Bearer ${tokenB}`)
      .set("Idempotency-Key", randomUUID())
      .send({
        tripId,
        kind: "Other",
        name: "Rest stop",
        arrivedAt: new Date().toISOString(),
        departedAt: new Date().toISOString(),
      });
    expect(foreign.status).toBe(404);
  });
  it("prevents a tablet from being assigned to two trips and allows assignment after release", async () => {
    const tablet = await post("/operator/trip-master/tablets", {
      name: "Dispatch tablet",
      serialNumber: "TAB-01",
      status: "Active",
    });
    expect(tablet.status).toBe(201);
    const t2 = await M.Trip.create({
      operatorId: a.operatorId,
      busId,
      routeId,
      journeyDate: "2030-12-01",
      departureAt: new Date("2030-12-01T21:30:00+05:30"),
      seats: [],
    });
    const results = await Promise.all([
      post("/operator/trip-master/tablet-assignments", {
        tabletId: tablet.body.data._id,
        tripId,
      }),
      post("/operator/trip-master/tablet-assignments", {
        tabletId: tablet.body.data._id,
        tripId: String(t2._id),
      }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const assignment = results.find((r) => r.status === 201)!.body.data;
    expect(
      (
        await post(
          `/operator/trip-master/tablet-assignments/${assignment._id}/release`,
          {},
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await post("/operator/trip-master/tablet-assignments", {
          tabletId: tablet.body.data._id,
          tripId,
        })
      ).status,
    ).toBe(201);
  });
  it("snapshots server-calculated agent commission in bookings without changing passenger totals", async () => {
    const partner = await post("/operator/trip-master/partners", {
      name: "Travel agent",
      kind: "Agent",
      phone: "9876543210",
      status: "Active",
    });
    expect(partner.status).toBe(201);
    const rule = await post("/operator/trip-master/commissions", {
      partnerId: partner.body.data._id,
      tripId,
      basis: "Base fare",
      kind: "Percent",
      basisPoints: 1000,
      status: "Active",
    });
    expect(rule.status).toBe(201);
    const held = await createHold(a, tripId, ["L1"]);
    const booking: any = await createBooking(
      a,
      {
        tripId,
        holdId: held.holdId,
        passengers: [{ name: "Test passenger", seat: "L1" }],
        salesPartnerId: partner.body.data._id,
      },
      randomUUID(),
    );
    expect(booking.totalPaise).toBe(145000);
    expect(booking.commissionPaise).toBe(14500);
    expect(booking.commissionSnapshot.basis).toBe("Base fare");
    expect(
      (
        await post(
          "/operator/trip-master/commissions",
          {
            partnerId: partner.body.data._id,
            tripId,
            basis: "Base fare",
            kind: "Percent",
            basisPoints: 1000,
            status: "Active",
          },
          tokenB,
        )
      ).status,
    ).toBe(404);
  });
});

describe("Trip Master rule precedence and connections", () => {
  it("uses discounted base fare before tax and overrides service commission with the trip rule", async () => {
    const { partnerCommission } =
      await import("../../src/services/commission.service.js");
    const service = await M.BusService.create({
      operatorId: a.operatorId,
      name: "Service",
      code: "SVC",
      busId,
      routeId,
      departure: "21:30",
      daysOfWeek: [1],
      doublePaise: 100000,
      singlePaise: 120000,
      status: "Active",
    });
    await M.Trip.updateOne(
      { _id: tripId },
      { $set: { serviceId: service._id } },
    );
    const partner = await M.SalesPartner.create({
      operatorId: a.operatorId,
      name: "Branch",
      kind: "Branch",
      phone: "9876543210",
      status: "Active",
    });
    await M.CommissionRule.create({
      operatorId: a.operatorId,
      partnerId: partner._id,
      serviceId: service._id,
      basis: "Grand total",
      kind: "Fixed",
      fixedPaise: 5000,
      status: "Active",
    });
    const trip = await M.Trip.findById(tripId).lean();
    expect(
      (
        await partnerCommission(
          a,
          trip,
          { grossPaise: 145000, discountPaise: 20000, totalPaise: 131250 },
          String(partner._id),
        )
      ).commissionPaise,
    ).toBe(5000);
    await M.CommissionRule.create({
      operatorId: a.operatorId,
      partnerId: partner._id,
      tripId,
      basis: "Base fare",
      kind: "Percent",
      basisPoints: 1000,
      status: "Active",
    });
    expect(
      (
        await partnerCommission(
          a,
          trip,
          { grossPaise: 145000, discountPaise: 20000, totalPaise: 131250 },
          String(partner._id),
        )
      ).commissionPaise,
    ).toBe(12500);
  });
  it("validates connection cities and transfer times and rejects unowned linked trips", async () => {
    await M.Trip.updateOne(
      { _id: tripId },
      { $set: { arrivalAt: new Date("2030-11-14T06:30:00+05:30") } },
    );
    const route = await M.Route.create({
      operatorId: a.operatorId,
      source: "Bangalore",
      destination: "Chennai",
      departure: "07:30",
      arrival: "14:30",
      durationMinutes: 420,
    });
    const next = await M.Trip.create({
      operatorId: a.operatorId,
      routeId: route._id,
      busId,
      journeyDate: "2030-11-14",
      departureAt: new Date("2030-11-14T07:30:00+05:30"),
      arrivalAt: new Date("2030-11-14T14:30:00+05:30"),
      seats: [],
    });
    const payload = {
      fromTripId: tripId,
      toTripId: String(next._id),
      kind: "Connection",
      transferMinutes: 120,
      status: "Active",
    };
    expect((await post("/operator/trip-master/links", payload)).status).toBe(
      409,
    );
    expect(
      (
        await post("/operator/trip-master/links", {
          ...payload,
          transferMinutes: 45,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await post(
          "/operator/trip-master/links",
          { ...payload, transferMinutes: 45 },
          tokenB,
        )
      ).status,
    ).toBe(404);
  });
});

describe("settlement and financial reporting", () => {
  const grants: Principal["permissions"] = ["platform:finance:read", "settlements:prepare", "settlements:approve", "payouts:authorize"];
  function platform(): Principal { return { userId: String(new mongoose.Types.ObjectId()), role: "super_admin", operatorId: null, sessionId: "test", permissions: grants }; }
  const period = { from: "2020-01-01", to: "2040-12-31" };
  const query = { ...period, page: 1, limit: 25 };
  async function enable(maker: Principal) { return Settlements.configureSettlementPolicy(walletConfig, maker, a.operatorId!, { enabled: true, treatment: "Existing capture liabilities", funding: "Simulated gateway receipts", version: 0, reason: "Explicit isolated test settlement policy" }); }
  async function capture(commission = 0, mature = true) {
    const hold: any = await createHold(a, tripId, ["L1"]);
    const booking: any = await createBooking(a, { tripId, holdId: hold.holdId, passengers: [{ seat: "L1", name: "Settlement fixture" }] }, randomUUID());
    let agency: any;
    if (commission) { agency = await M.SalesPartner.create({ operatorId: a.operatorId, kind: "Agent", name: "Settlement agency" }); await M.Booking.updateOne({ _id: booking._id }, { $set: { agentId: agency._id, salesPartnerId: agency._id, commissionPaise: commission, commissionSnapshot: { partnerKind: "Agent" }, source: "agent" } }); }
    await applyVerifiedPayment({ verified: true, providerId: "razorpay_test", externalId: `pay_${randomUUID().replaceAll("-", "")}`, eventId: randomUUID(), operatorId: a.operatorId!, bookingId: String(booking._id), amountPaise: booking.totalPaise, currency: "INR", status: "captured" });
    if (mature) await M.Trip.updateOne({ _id: tripId }, { $set: { departureAt: new Date(Date.now() - 86400000), arrivalAt: new Date(Date.now() - 3600000) } });
    return { booking: await M.Booking.findById(booking._id).lean() as any, agency };
  }
  async function prepared(maker: Principal, kind: "Operator" | "Agency" = "Operator", agentId?: string) { return Settlements.prepareSettlement(walletConfig, maker, { operatorId: a.operatorId!, kind, ...(agentId ? { agentId } : {}), ...period, reason: "Prepare exact posted payable lines" }, randomUUID()); }
  async function approved(maker: Principal, checker: Principal) { const row: any = await prepared(maker); await Settlements.reviewSettlement(walletConfig, maker, String(row._id), "Submit", "Submit for independent finance review"); await Settlements.reviewSettlement(walletConfig, checker, String(row._id), "Approve", "Independent payable evidence approved"); return row; }
  it("fails closed for missing custody policies, disabled runtime and default admin permissions", async () => {
    const maker = platform(); await capture();
    await expect(prepared(maker)).rejects.toMatchObject({ code: "SETTLEMENT_POLICY_REQUIRED" });
    await expect(Settlements.configureSettlementPolicy(config, maker, a.operatorId!, { enabled: true, treatment: "Existing capture liabilities", funding: "Simulated gateway receipts", version: 0, reason: "Disabled test runtime fixture" })).rejects.toMatchObject({ code: "FINANCE_DISABLED" });
    await expect(prepared({ ...maker, permissions: ["platform:finance:read"] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(prepared(a)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("calculates operator and agency claims from separate immutable payable lines without duplicate settlement", async () => {
    const maker = platform(); const { booking, agency } = await capture(12500); await enable(maker);
    const operator: any = await prepared(maker), agent: any = await prepared(maker, "Agency", String(agency._id));
    expect(operator.netPaise).toBe(booking.totalPaise - 12500); expect(operator.grossPaise).toBe(booking.totalPaise); expect(operator.commissionPaise).toBe(12500); expect(agent.netPaise).toBe(12500);
    expect(await M.SettlementLine.countDocuments()).toBe(2);
    await expect(prepared(maker)).rejects.toMatchObject({ code: "NO_ELIGIBLE_PAYABLES" });
    const line: any = await M.SettlementLine.findOne(); await expect(M.SettlementLine.updateOne({ _id: line._id }, { $set: { amountPaise: 1 } })).rejects.toMatchObject({ code: "LEDGER_IMMUTABLE" });
  });
  it("deduplicates concurrent settlement keys and rejects changed content under the same key", async () => {
    const maker = platform(); await capture(); await enable(maker);
    const input = { operatorId: a.operatorId!, kind: "Operator" as const, ...period, reason: "Stable settlement content fixture" }, key = randomUUID();
    const rows: any[] = await Promise.all([Settlements.prepareSettlement(walletConfig, maker, input, key), Settlements.prepareSettlement(walletConfig, maker, input, key)]);
    expect(String(rows[0]._id)).toBe(String(rows[1]._id)); expect(await M.Settlement.countDocuments()).toBe(1);
    await expect(Settlements.prepareSettlement(walletConfig, maker, { ...input, reason: "Changed settlement content fixture" }, key)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
  it("gives at most one different-key claimant for concurrent payable allocation", async () => {
    const maker = platform(); await capture(); await enable(maker);
    const results = await Promise.allSettled([prepared(maker), prepared(maker)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1); expect(await M.SettlementLine.countDocuments()).toBe(1);
  });
  it("excludes pending, historical, immature and unapproved payment sources", async () => {
    const maker = platform(); await enable(maker); const { booking } = await capture(0, false);
    await expect(prepared(maker)).rejects.toMatchObject({ code: "NO_ELIGIBLE_PAYABLES" });
    await M.Trip.updateOne({ _id: tripId }, { $set: { departureAt: new Date(0), arrivalAt: new Date(1) } });
    await M.Payment.updateOne({ bookingId: booking._id }, { $set: { providerId: "agency-credit" } });
    await expect(prepared(maker)).rejects.toMatchObject({ code: "NO_ELIGIBLE_PAYABLES" });
    await M.Payment.updateOne({ bookingId: booking._id }, { $set: { providerId: "razorpay_test" } });
    await M.Booking.updateOne({ _id: booking._id }, { $set: { paymentStatus: "Pending" } });
    await expect(prepared(maker)).rejects.toMatchObject({ code: "NO_ELIGIBLE_PAYABLES" });
    expect(await M.SettlementLine.countDocuments()).toBe(0);
  });
  it("enforces independent approval and receipt evidence before authorizing payout", async () => {
    const maker = platform(), checker = platform(); await capture(); await enable(maker); const row: any = await prepared(maker), id = String(row._id);
    await Settlements.reviewSettlement(walletConfig, maker, id, "Submit", "Review maker settlement fixture");
    await expect(Settlements.reviewSettlement(walletConfig, maker, id, "Approve", "Self approval must be refused")).rejects.toMatchObject({ code: "MAKER_CHECKER" });
    await Settlements.reviewSettlement(walletConfig, checker, id, "Approve", "Independent review accepted fixture");
    await expect(Settlements.authorizePayout(walletConfig, maker, id, "Self authorization rejected fixture")).rejects.toMatchObject({ code: "MAKER_CHECKER" });
    await expect(Settlements.authorizePayout(walletConfig, checker, id, "Capture alone is insufficient evidence")).rejects.toMatchObject({ code: "VERIFIED_RECEIPT_REQUIRED" });
    expect((await M.Settlement.findById(id))!.workflowStatus).toBe("Approved");
  });
  it("posts verified simulated payouts once under concurrency and preserves balanced journals", async () => {
    const maker = platform(), checker = platform(); const { booking } = await capture(); await enable(maker); const row = await approved(maker, checker), id = String(row._id);
    await Settlements.recordTestSettlementReceipts(walletConfig, checker, id, "Explicit simulator receipt evidence");
    await Settlements.recordTestSettlementReceipts(walletConfig, checker, id, "Replay same simulator receipt fixture");
    const first: any = await Settlements.authorizePayout(walletConfig, checker, id, "Authorize verified test payout fixture");
    expect(String((await Settlements.authorizePayout(walletConfig, checker, id, "Replay approved payout fixture"))!._id)).toBe(String(first._id));
    await Promise.all([Settlements.processPayout(walletConfig, checker, id, "Dispatch same authorized test payout"), Settlements.processPayout(walletConfig, checker, id, "Dispatch same authorized test payout")]);
    await Settlements.processPayout(walletConfig, checker, id, "Replay completed payout fixture");
    expect(await M.TestPayoutRecord.countDocuments()).toBe(1); expect(await M.TestSettlementReceipt.countDocuments()).toBe(1); expect(await M.JournalEntry.countDocuments({ kind: "Settlement payout" })).toBe(1);
    expect((await M.Settlement.findById(id))!.workflowStatus).toBe("Paid"); expect((await verifyLedger(a.operatorId!)).consistent).toBe(true);
    expect((await M.Booking.findById(booking._id))!.status).toBe("Confirmed");
    const recon = await Settlements.reconcileSettlement(checker, id, "Read-only payout reconciliation fixture"); expect(recon.consistent).toBe(true); expect(recon.snapshot.bankVerified).toBe(false);
  });
  it("recovers a timeout after provider acceptance without submitting a second payout", async () => {
    const maker = platform(), checker = platform(); await capture(); await enable(maker); const row = await approved(maker, checker), id = String(row._id);
    await Settlements.recordTestSettlementReceipts(walletConfig, checker, id, "Simulated receipt before timeout fixture"); await Settlements.authorizePayout(walletConfig, checker, id, "Authorized test payout timeout fixture");
    const original = testPayout.submit.bind(testPayout), submit = vi.spyOn(testPayout, "submit").mockImplementationOnce(async (cfg, intent) => { await original(cfg, intent); throw Error("Timeout after simulator accepted"); });
    expect(await Settlements.processPayout(walletConfig, checker, id, "Dispatch timeout fixture test payout")).toMatchObject({ status: "Uncertain" });
    expect(await M.JournalEntry.countDocuments({ kind: "Settlement payout" })).toBe(0);
    expect(await Settlements.processPayout(walletConfig, checker, id, "Verify original uncertain test payout")).toMatchObject({ status: "Paid" });
    expect(submit).toHaveBeenCalledTimes(1); expect(await M.PayoutAttempt.countDocuments()).toBe(2);
  });
  it("retains partial payout evidence for manual review without topping up or marking Paid", async () => {
    const maker = platform(), checker = platform(); await capture(); await enable(maker); const row = await approved(maker, checker), id = String(row._id);
    await Settlements.recordTestSettlementReceipts(walletConfig, checker, id, "Partial payout simulator receipt fixture"); const intent: any = await Settlements.authorizePayout(walletConfig, checker, id, "Partial payout evidence fixture");
    await M.TestPayoutRecord.create({ operatorId: a.operatorId, intentId: intent._id, reference: "test_partial_fixture", amountPaise: intent.amountPaise - 1, currency: "INR", status: "processed" });
    const submit = vi.spyOn(testPayout, "submit"); const result = await Settlements.processPayout(walletConfig, checker, id, "Inspect partial verified evidence fixture");
    expect(result).toMatchObject({ status: "Manual review", code: "PAYOUT_EVIDENCE_MISMATCH" }); expect(submit).not.toHaveBeenCalled(); expect(await M.JournalEntry.countDocuments({ kind: "Settlement payout" })).toBe(0);
    expect((await M.Settlement.findById(id))!.workflowStatus).toBe("Reconciliation required");
  });
  it("blocks payout when the approved policy is disabled and never calls the provider", async () => {
    const maker = platform(), checker = platform(); await capture(); await enable(maker); const row = await approved(maker, checker), id = String(row._id);
    await Settlements.recordTestSettlementReceipts(walletConfig, checker, id, "Verified isolated receipt fixture"); await Settlements.authorizePayout(walletConfig, checker, id, "Authorize payout prior to suspension");
    await M.SettlementPolicy.updateOne({ operatorId: a.operatorId }, { $set: { enabled: false } }); const submit = vi.spyOn(testPayout, "submit");
    await expect(Settlements.processPayout(walletConfig, checker, id, "Policy suspended test dispatch")).rejects.toMatchObject({ code: "SETTLEMENT_POLICY_REQUIRED" }); expect(submit).not.toHaveBeenCalled();
  });
  it("enforces tenant ownership for details and report filters, denies agencies platform reports", async () => {
    const maker = platform(); await capture(); await enable(maker); const row: any = await prepared(maker);
    await expect(Settlements.settlementDetail(b, String(row._id))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(financialReport(b, "operator-revenue", { ...query, operatorId: a.operatorId! })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(financialReportCsv({ ...a, permissions: [] }, "operator-revenue", query)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(financialReport({ ...a, role: "agent", agentId: String(new mongoose.Types.ObjectId()) }, "wallet-balances", query)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await request(app).get("/api/v1/operator/finance/reports/operator-revenue?from=2020-01-01&to=2040-12-31").set("Authorization", `Bearer ${tokenB}`)).body.data.rows).toEqual([]);
  });

  it("settles only retained cancellation liabilities after verified refund and excludes reversed commissions", async () => {
    const maker = platform(), checker = platform(); const { booking } = await capture(12500, false);
    await M.Policy.create({ operatorId: a.operatorId, rules: [{ hoursBefore: 0, refundPercent: 80 }] });
    await RefundWorkflow.configureCancellationAccounting(a, { enabled: true, refundBasis: "Discounted base fare", taxTreatment: "Proportional refund", chargeTreatment: "Non-refundable", commissionTreatment: "Reverse all", allowExceptionRefunds: false, version: 0, reason: "Explicit cancellation accounting fixture" });
    const cancel: any = await requestCancellation(a, String(booking._id), "Refund prior to settlement fixture");
    const quote: any = await RefundWorkflow.quoteCancellation(a, String(booking._id));
    await RefundWorkflow.reviewCancellation(refundConfig, a, String(cancel._id), "Accept", String(quote._id), "Approved exact cancellation accounting");
    await M.Trip.updateOne({ _id: tripId }, { $set: { departureAt: new Date(0), arrivalAt: new Date(1) } }); await enable(maker);
    await expect(prepared(maker)).rejects.toMatchObject({ code: "NO_ELIGIBLE_PAYABLES" });
    const intent: any = await M.RefundIntent.findOne({ bookingId: booking._id }).lean();
    await M.Refund.updateOne({ bookingId: booking._id }, { $set: { status: "Refunded" } });
    // A refund row claim alone must not establish verified financial completion.
    await expect(prepared(maker)).rejects.toMatchObject({ code: "REFUND_NOT_VERIFIED" });
    await M.Refund.updateOne({ bookingId: booking._id }, { $set: { status: "Requested" } });
    const payment: any = await M.Payment.findById(intent.paymentId).lean();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => new Response(JSON.stringify(String(url).endsWith('/payments/' + payment.externalId) ? { id: payment.externalId, amount: payment.amountPaise, amount_refunded: 0, currency: "INR", status: "captured" } : String(url).includes('/refunds?') ? { items: [] } : { id: "rfnd_retainedfixture", payment_id: payment.externalId, amount: intent.amountPaise, currency: "INR", status: "processed", receipt: intent.requestBody.receipt, notes: intent.requestBody.notes })));
    await RefundWorkflow.processRefundIntent(refundConfig, String(intent._id));
    const row: any = await prepared(maker); expect(row.netPaise).toBe(29000); expect(row.grossPaise).toBe(145000); expect(row.refundPaise).toBe(116000); expect(row.commissionPaise).toBe(0); expect((await M.SettlementLine.findOne())!.kind).toBe("Retained cancellation");
    const report = await financialReport(a, "commission-earned", query); expect(report.rows[0].earnedCommissionPaise).toBe(0); expect(report.rows[0].netTicketValuePaise).toBe(29000);
  });
  it("leaves failed provider payouts unpaid and reconciles the same intent without another submit", async () => {
    const maker = platform(), checker = platform(); await capture(); await enable(maker); const row = await approved(maker, checker), id = String(row._id);
    await Settlements.recordTestSettlementReceipts(walletConfig, checker, id, "Failed payout receipt fixture"); const intent: any = await Settlements.authorizePayout(walletConfig, checker, id, "Failed payout fixture authorization");
    await M.TestPayoutRecord.create({ operatorId: a.operatorId, intentId: intent._id, reference: "test_failed_fixture", amountPaise: intent.amountPaise, currency: "INR", status: "failed" });
    const submit = vi.spyOn(testPayout, "submit"); expect(await Settlements.processPayout(walletConfig, checker, id, "Read failed provider evidence fixture")).toMatchObject({ status: "failed" }); expect(await M.JournalEntry.countDocuments({ kind: "Settlement payout" })).toBe(0);
    vi.spyOn(testPayout, "status").mockResolvedValue({ intentId: intent._id, reference: "test_failed_fixture", amountPaise: intent.amountPaise, currency: "INR", status: "processed" } as any);
    expect(await Settlements.processPayout(walletConfig, checker, id, "Reconcile original recovered provider operation")).toMatchObject({ status: "Paid" }); expect(submit).not.toHaveBeenCalled();
  });
  it("isolates agency statements and prevents reading operator batches or another agency's records", async () => {
    const maker = platform(); const { agency } = await capture(12500); await enable(maker); const operator: any = await prepared(maker), own: any = await prepared(maker, "Agency", String(agency._id));
    const owner: any = await M.User.findById(a.userId).select("+passwordHash").lean(); const user = await M.User.create({ operatorId: a.operatorId, role: "agent", name: "Commission reader", email: "commission-reader@aibus.test", passwordHash: owner.passwordHash, salesPartnerId: agency._id });
    const auth: Principal = { ...a, role: "agent", userId: String(user._id), agentId: String(agency._id) };
    expect((await Settlements.settlementDetail(auth, String(own._id))).settlement.netPaise).toBe(12500);
    await expect(Settlements.settlementDetail(auth, String(operator._id))).rejects.toMatchObject({ code: "NOT_FOUND" });
    const report = await financialReport(auth, "commission-earned", query); expect(report.rows[0].earnedCommissionPaise).toBe(12500); expect(report.rows[0].operatorLiabilityCreatedPaise).toBeUndefined();
    await expect(financialReport(auth, "commission-payable", { ...query, agentId: String(new mongoose.Types.ObjectId()) })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await M.SalesPartner.updateOne({ _id: agency._id }, { $pull: { permissions: "settlements" } }); await expect(Settlements.settlementDetail(auth, String(own._id))).rejects.toMatchObject({ code: "AGENT_FORBIDDEN" });
  });
  it("detects wallet reservation and refund liability inconsistencies without writing balancing adjustments", async () => {
    const { agency } = await capture(1000); await M.AgentWallet.create({ operatorId: a.operatorId, agentId: agency._id, createdBy: a.userId, status: "Active", reservedPaise: 10 });
    const before = await M.JournalEntry.countDocuments(); const report = await financialReconciliation(a); expect(report.consistent).toBe(false); expect(report.issues.map((i: any) => i.code)).toContain("FUNDING_RESERVATION_MISMATCH"); expect(report.automaticBalancing).toBe(false); expect(await M.JournalEntry.countDocuments()).toBe(before);
  });
  it("prevents cancellation after a claimed trip is rescheduled and preserves the financial obligation", async () => {
    const maker = platform(); const { booking } = await capture(); await enable(maker); await prepared(maker);
    await M.Trip.updateOne({ _id: tripId }, { $set: { departureAt: new Date(Date.now() + 86400000), arrivalAt: new Date(Date.now() + 172800000) } });
    const count = await M.JournalEntry.countDocuments();
    await expect(requestCancellation(a, String(booking._id), "Rescheduled settlement cancellation fixture")).rejects.toMatchObject({ code: "SETTLEMENT_CLAIMED" });
    expect((await M.Booking.findById(booking._id))!.status).toBe("Confirmed"); expect(await M.JournalEntry.countDocuments()).toBe(count); expect(await M.Cancellation.countDocuments()).toBe(0);
  });
  it("stops exhausted payout retries with a durable manual review state", async () => {
    const maker = platform(), checker = platform(); await capture(); await enable(maker); const row = await approved(maker, checker), id = String(row._id);
    await Settlements.recordTestSettlementReceipts(walletConfig, checker, id, "Pending payout receipt fixture"); const intent: any = await Settlements.authorizePayout(walletConfig, checker, id, "Pending payout fixture authorization");
    await M.TestPayoutRecord.create({ operatorId: a.operatorId, intentId: intent._id, reference: "test_pending_fixture", amountPaise: intent.amountPaise, currency: "INR", status: "pending" });
    const submit = vi.spyOn(testPayout, "submit"); for (let n = 0; n < 5; n++) await Settlements.processPayout(walletConfig, checker, id, "Verify pending original payout fixture");
    expect(await Settlements.processPayout(walletConfig, checker, id, "Bounded payout retry fixture")).toMatchObject({ status: "Manual review", dispatched: false });
    expect((await M.PayoutIntent.findById(intent._id))!.attempts).toBe(5); expect(await M.PayoutAttempt.countDocuments({ code: "PAYOUT_RETRY_LIMIT" })).toBe(1); expect(submit).not.toHaveBeenCalled(); expect(await M.JournalEntry.countDocuments({ kind: "Settlement payout" })).toBe(0);
  });
  it("reports all fifteen categories with integer paise and keeps gross ticket value distinct from platform revenue", async () => {
    await capture(12500); const report: any = await financialReport(a, "daily-ticket-revenue", query);
    expect(report.rows[0]).toMatchObject({ grossTicketValuePaise: 145000, earnedCommissionPaise: 12500, operatorLiabilityCreatedPaise: 132500, platformRevenuePaise: 0, bankReceivedPaise: 0 });
    for (const name of ["daily-ticket-revenue", "monthly-ticket-revenue", "operator-revenue", "agency-revenue", "route-revenue", "booking-source", "commission-earned", "commission-payable", "operator-settlements", "pending-payments", "refund-summary", "wallet-balances", "credit-exposure", "payment-exceptions", "settlement-reconciliation"]) expect((await financialReport(a, name, query)).rows).toBeInstanceOf(Array);
    const csv = await financialReportCsv(a, "daily-ticket-revenue", query); expect(csv).toContain('"grossTicketValuePaise"'); expect(csv).not.toContain("Settlement fixture");
  });
});

describe("Phase 5 platform management", () => {
  async function admin(profile?: string, permissions?: string[], financeRead = false, financeActions: string[] = []) {
    const owner: any = await M.User.findById(a.userId).select("+passwordHash").lean();
    const email = randomUUID() + "@platform.test";
    const user = await M.User.create({ name: profile || "Bootstrap Platform", email, role: "super_admin", passwordHash: owner.passwordHash, ...(profile ? { platformProfile: profile, platformPermissions: permissions || [] } : {}), platformFinanceRead: financeRead, platformFinanceActions: financeActions });
    const login = await request(app).post("/api/v1/auth/login").set("X-Aibus-Client", "admin").send({ email, password });
    expect(login.status).toBe(200); return { user, token: login.body.data.accessToken, identity: login.body.data.user };
  }
  const read = (path: string, actor: any) => get("/platform" + path, actor.token);
  const write = (path: string, body: any, actor: any, method: "post" | "patch" | "put" = "post", key = randomUUID()) => request(app)[method]("/api/v1/platform" + path).set("Authorization", "Bearer " + actor.token).set("Idempotency-Key", key).send(body);
  async function pending() { const hold: any = await createHold(a, tripId, ["L1"]); return createBooking(a, { tripId, holdId: hold.holdId, passengers: [{ name: "PRIVATE_PASSENGER", seat: "L1", phone: "9999912345" }], contact: { phone: "9999912345", email: "private@passenger.test" } }, randomUUID()) as any; }
  async function pay(booking: any) { return applyVerifiedPayment({ verified: true, providerId: "razorpay_test", eventId: randomUUID(), externalId: "pay_" + randomUUID().replaceAll("-", ""), operatorId: a.operatorId!, bookingId: String(booking._id), amountPaise: booking.totalPaise, currency: "INR", status: "captured" }); }
  async function status(actor: any, next: string, op = a.operatorId!) { const row: any = await M.Operator.findById(op).lean(); return write("/operators/" + op + "/status", { status: next, version: row.__v, reason: "Verified platform lifecycle fixture", password }, actor, "patch"); }
  function staffBody(profile = "Platform Operations") { return { name: "New Operations", email: randomUUID() + "@admin.test", profile, permissions: ["platform:overview:read", "platform:operators:read"], financeRead: false, financeActions: [], active: true, initialPassword: "Safe-initial-password-2026!", password, reason: "Approved least privilege staff fixture" }; }
  it("authenticates functional platform staff without granting operator or root authority", async () => {
    const ops = await admin("Platform Operations", ["platform:overview:read", "platform:operators:read", "platform:monitor:read"]);
    expect(ops.identity.permissions).not.toContain("platform:manage"); expect((await read("/operators", ops)).status).toBe(200);
    expect((await read("/admin-users", ops)).status).toBe(403); expect((await read("/finance/refund-intents", ops)).status).toBe(403);
    expect((await get("/operator/buses", ops.token)).status).toBe(403); expect((await read("/overview", { token: tokenA })).status).toBe(403);
  });
  it("reports actual metrics, source and travel-date filters without exposing financial metrics to operations", async () => {
    const root = await admin(), booking: any = await pending(); await pay(booking);
    const overview = await read("/overview?from=2030-11-13&to=2030-11-13&source=operator", root);
    expect(overview.body.data.metrics).toMatchObject({ totalOperators: 2, buses: 1, confirmedBookings: 1, availableSeats: 2 });
    expect(overview.body.data.metrics.grossBookingValuePaise).toBeUndefined();
    const fin = await admin("Finance Manager", ["platform:overview:read"], true);
    expect((await read("/overview?source=operator", fin)).body.data.metrics).toMatchObject({ grossBookingValuePaise: 145000, platformEarningsPaise: 0 });
    expect((await read("/overview?source=agent", root)).body.data.metrics.confirmedBookings).toBe(0);
    expect((await read("/overview?from=2031-01-01&to=2031-01-02", root)).body.data.metrics.activeTrips).toBe(0);
  });
  it("monitors fleet and inventory with operator isolation, pagination and strict query validation", async () => {
    const root = await admin(); const booking: any = await pending(); await pay(booking); await M.Trip.updateOne({ _id: tripId }, { $set: { "seats.1.state": "blocked" } });
    const trips = await read("/trips?limit=1", root); expect(trips.body.data[0]).toMatchObject({ booked: 1, blocked: 1, available: 1, operator: "Operator A" }); expect(trips.body.meta.total).toBe(1);
    expect((await read("/buses?operatorId=" + b.operatorId, root)).body.data).toEqual([]);
    expect((await read("/buses?operatorId[$ne]=x", root)).status).toBe(400);
    expect((await read("/trips?from=2031-01-01&to=2030-01-01", root)).status).toBe(400);
    expect((await write("/trips/" + tripId, { status: "Cancelled" }, root, "patch")).status).toBe(404);
  });
  it("redacts passenger data from lists, exports and support details unless explicitly granted", async () => {
    const support = await admin("Booking Support", ["platform:bookings:read"]), root = await admin(), booking: any = await pending(); await pay(booking);
    const list = await read("/bookings?search=" + booking.reference, support); expect(list.body.data).toHaveLength(1); expect(JSON.stringify(list.body)).not.toContain("PRIVATE_PASSENGER");
    const detail = await read("/bookings/" + booking._id, support); expect(detail.body.data.passengerDataRestricted).toBe(true); expect(JSON.stringify(detail.body)).not.toContain("private@passenger.test");
    const allowed = await read("/bookings/" + booking._id, root); expect(allowed.body.data.contact.email).toBe("private@passenger.test"); expect(allowed.body.data.ticket.status).toBe("valid");
    expect(await M.Audit.countDocuments({ action: "platform.passengers.view", resourceId: String(booking._id) })).toBe(1);
    expect((await write("/bookings/" + booking._id + "/confirm", {}, root)).status).toBe(404);
  });
  it("requires re-verification and a reason for operator lifecycle changes, rejects invalid and repeated transitions", async () => {
    const root = await admin(), row: any = await M.Operator.findById(a.operatorId).lean(), path = "/operators/" + a.operatorId + "/status";
    expect((await write(path, { status: "suspended", version: row.__v, reason: "Valid lifecycle reason", password: "wrong-password" }, root, "patch")).status).toBe(403);
    expect((await write(path, { status: "suspended", version: row.__v, password }, root, "patch")).status).toBe(400);
    expect((await status(root, "rejected")).status).toBe(409);
    const changed = await status(root, "suspended"); expect(changed.status).toBe(200);
    expect((await write(path, { status: "suspended", version: row.__v, reason: "Repeat lifecycle request", password }, root, "patch")).status).toBe(409);
    expect(await M.Audit.countDocuments({ action: "operator.suspended" })).toBe(1);
  });
  it("supports review, rejection and reopening while preserving tickets when an operator is suspended", async () => {
    const root = await admin(), booking: any = await pending(); await pay(booking);
    expect((await status(root, "suspended")).body.data.bookingPolicy.existingTickets).toBe("Preserved");
    expect((await M.Ticket.findOne({ bookingId: booking._id }))!.status).toBe("valid"); expect((await M.Booking.findById(booking._id))!.status).toBe("Confirmed");
    await expect(createHold(a, tripId, ["L2"])).rejects.toMatchObject({ code: "OPERATOR_SALES_BLOCKED" });
    expect((await get("/operator/buses")).status).toBe(403);
    expect((await status(root, "rejected")).status).toBe(200); expect((await status(root, "pending")).status).toBe(200); expect((await status(root, "approved")).status).toBe(200);
  });
  it("blocks only new sales without preventing confirmation of an existing owned pending booking", async () => {
    const root = await admin(), booking: any = await pending(), row: any = await M.Operator.findById(a.operatorId).lean();
    const blocked = await write("/operators/" + a.operatorId + "/status", { salesBlocked: true, version: row.__v, reason: "Stop new sales only fixture", password }, root, "patch"); expect(blocked.status).toBe(200);
    await expect(createHold(a, tripId, ["L2"])).rejects.toMatchObject({ code: "OPERATOR_SALES_BLOCKED" }); await pay(booking);
    expect((await M.Booking.findById(booking._id))!.status).toBe("Confirmed"); expect((await M.Operator.findById(a.operatorId))!.status).toBe("approved");
  });
  it("serializes simultaneous operator policy updates and does not duplicate audit/outbox transitions", async () => {
    const root = await admin(), row: any = await M.Operator.findById(a.operatorId).lean(), body = { salesBlocked: true, version: row.__v, reason: "Concurrent policy update fixture", password };
    const responses = await Promise.all([write("/operators/" + a.operatorId + "/status", body, root, "patch"), write("/operators/" + a.operatorId + "/status", body, root, "patch")]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]); expect(await M.Audit.countDocuments({ action: "operator.sales-policy" })).toBe(1);
  });
  it("reviews only owned document references with explicit verification authority", async () => {
    const root = await admin(), ops = await admin("Platform Operations", ["platform:operators:read"]);
    const created = await write("/operators/" + a.operatorId + "/documents", { kind: "Business registration", reference: "external-verification-123", password, reason: "Approved external evidence reference" }, root); expect(created.status).toBe(201);
    const body = { status: "Reviewed", version: 0, password, reason: "Document source manually checked" }, doc = created.body.data;
    expect((await write("/operators/" + b.operatorId + "/documents/" + doc._id + "/review", body, root)).status).toBe(409);
    expect((await write("/operators/" + a.operatorId + "/documents/" + doc._id + "/review", body, ops)).status).toBe(403);
    expect((await write("/operators/" + a.operatorId + "/documents/" + doc._id + "/review", body, root)).status).toBe(200);
    expect((await read("/operators/" + a.operatorId, root)).body.data.documents[0].status).toBe("Reviewed");
  });
  it("keeps canonical agencies under their operator and protects wallet exposure with a finance grant", async () => {
    const root = await admin(), agency = await M.SalesPartner.create({ operatorId: a.operatorId, kind: "Agent", name: "Agency Private", commissionRate: 1000 });
    await M.AgentWallet.create({ operatorId: a.operatorId, agentId: agency._id, status: "Suspended", createdBy: a.userId });
    const rows = await read("/agencies", root); expect(rows.body.data[0]).toMatchObject({ name: "Agency Private", operatorId: a.operatorId }); expect(rows.body.data[0].walletStatus).toBeUndefined();
    const fin = await admin("Finance Manager", ["platform:agencies:read"], true); expect((await read("/agencies", fin)).body.data[0].walletStatus).toBe("Suspended");
    expect((await read("/agencies?operatorId=" + b.operatorId, root)).body.data).toEqual([]);
    expect((await write("/agencies/" + agency._id, { operatorId: b.operatorId }, root, "patch")).status).toBe(404);
  });
  it("creates idempotent least-privilege staff and rejects root role or permission escalation", async () => {
    const root = await admin(), body = staffBody(), key = randomUUID();
    const first = await write("/admin-users", body, root, "post", key), again = await write("/admin-users", body, root, "post", key);
    expect(first.status).toBe(201); expect(again.body.data.id).toBe(first.body.data.id); expect(JSON.stringify(first.body)).not.toContain("passwordHash");
    expect((await write("/admin-users", { ...body, role: "super_admin" }, root)).status).toBe(400);
    expect((await write("/admin-users", { ...body, email: "other@staff.test", permissions: ["platform:staff:write"] }, root)).status).toBe(400);
    expect((await write("/admin-users", { ...body, email: "other@staff.test", profile: "Super Admin" }, root)).status).toBe(400);
    expect((await write("/admin-users", { ...body, email: "changed@staff.test" }, root, "post", key)).status).toBe(409);
    const login = await request(app).post("/api/v1/auth/login").set("X-Aibus-Client", "admin").send({ email: body.email, password: body.initialPassword }); expect(login.status).toBe(200); expect(login.body.data.user.permissions).not.toContain("platform:staff:write");
  });
  it("revokes staff access sessions on role or status changes and protects Super Admin and self access", async () => {
    const root = await admin(), staff = await admin("Platform Operations", ["platform:overview:read"]), { initialPassword, ...body } = staffBody();
    const changed = await write("/admin-users/" + staff.user._id, { ...body, email: staff.user.email, version: staff.user.__v, active: false }, root, "patch"); expect(changed.status).toBe(200);
    expect((await read("/overview", staff)).status).toBe(401);
    expect((await write("/admin-users/" + root.user._id, { ...body, version: root.user.__v }, root, "patch")).status).toBe(403);
    const otherRoot = await admin(); expect((await write("/admin-users/" + otherRoot.user._id, { ...body, version: otherRoot.user.__v }, root, "patch")).status).toBe(409);
  });
  it("revokes every active staff session without changing protected financial or booking records", async () => {
    const root = await admin(), staff = await admin("Booking Support", ["platform:bookings:read"]);
    const result = await write("/admin-users/" + staff.user._id + "/revoke-sessions", { password, reason: "Approved session revocation fixture" }, root); expect(result.body.data.revoked).toBe(1); expect((await read("/bookings", staff)).status).toBe(401);
    expect((await write("/admin-users/" + root.user._id + "/revoke-sessions", { password, reason: "Forbidden self session operation" }, root)).status).toBe(403);
  });
  it("requires explicit finance action grants and prevents operations from modifying credit limits", async () => {
    const ops = await admin("Platform Operations", ["platform:overview:read"]), finance = await admin("Finance Manager", ["platform:overview:read"], true);
    expect((await read("/finance/refund-intents", finance)).status).toBe(200);
    expect((await write("/finance/settlements", { operatorId: a.operatorId, kind: "Operator", from: "2026-01-01", to: "2030-12-31", reason: "Unauthorized preparation fixture" }, finance)).status).toBe(403);
    expect((await request(app).put("/api/v1/operator/finance/wallets/" + new mongoose.Types.ObjectId() + "/credit").set("Authorization", "Bearer " + ops.token).set("Idempotency-Key", randomUUID()).send({ limitPaise: 999999, status: "Active", reason: "Forbidden credit limit change" })).status).toBe(403);
    expect((await write("/finance/refund-intents/" + new mongoose.Types.ObjectId() + "/recheck", { reason: "Forbidden refund approval fixture" }, ops)).status).toBe(403);
  });
  it("returns sanitized actor-aware audits and prevents finance history from leaking through read-only operational audit", async () => {
    const root = await admin(), audit = await admin("Audit / Read Only", ["platform:audit:read"]);
    await M.Audit.create({ actorId: root.user._id, operatorId: a.operatorId, action: "platform.checked", resourceId: "fixture", metadata: { reason: "Safe audit reason", token: "PRIVATE_TOKEN", providerSecret: "PRIVATE_KEY", password: "PRIVATE_PASSWORD" }, expiresAt: null });
    await M.Audit.create({ actorId: root.user._id, action: "refund.verified", metadata: { reason: "Financial event" }, expiresAt: null });
    const response = await read("/audit", audit); expect(response.status).toBe(200); expect(response.body.data[0].actor).toBe("Bootstrap Platform"); expect(JSON.stringify(response.body)).not.toMatch(/PRIVATE_|Financial event/);
    expect((await read("/audit", { token: tokenA })).status).toBe(403);
  });
  it("authorizes operational reports and neutralizes CSV formulas without exporting passenger details", async () => {
    const root = await admin(), booking: any = await pending(); await pay(booking); await M.Operator.updateOne({ _id: a.operatorId }, { $set: { company: "=SENSITIVE_FORMULA" } });
    for (const report of ["operator-performance", "agency-performance", "booking-source", "route-bookings", "bus-occupancy", "confirmed-cancelled", "payment-status", "operational-alerts"]) expect((await read("/reports/" + report, root)).status).toBe(200);
    const csv = await read("/reports/operator-performance.csv?from=2030-11-13&to=2030-11-13", root); expect(csv.status).toBe(200); expect(csv.text).toContain("'=SENSITIVE_FORMULA"); expect(csv.text).not.toContain("PRIVATE_PASSENGER");
    expect((await read("/reports/operator-performance.csv?from=2030-11-13&to=2030-11-13", { token: tokenA })).status).toBe(403);
    expect((await read("/bookings.csv?from=2030-11-13&to=2030-11-13", root)).text).not.toContain("9999912345");
  });
  it("provisions explicit finance grants without bypassing review separation or enabling live execution", async () => {
    const root = await admin(), body = { ...staffBody("Finance Manager"), financeRead: true, financeActions: ["settlements:prepare"] };
    const created = await write("/admin-users", body, root); expect(created.status).toBe(201);
    const login = await request(app).post("/api/v1/auth/login").set("X-Aibus-Client", "admin").send({ email: body.email, password: body.initialPassword }); const actor = { token: login.body.data.accessToken };
    expect(login.body.data.user.permissions).toContain("settlements:prepare"); expect(login.body.data.user.permissions).not.toContain("settlements:approve");
    expect((await read("/finance/refund-intents", actor)).status).toBe(200);
    expect((await write("/finance/settlements", { operatorId: a.operatorId, kind: "Operator", from: "2026-01-01", to: "2030-12-31", reason: "Configured permission test runtime remains off" }, actor)).status).toBe(503);
    expect((await write("/finance/settlements/" + new mongoose.Types.ObjectId() + "/review", { action: "Approve", reason: "No approval grant fixture" }, actor)).status).toBe(403);
  });
  it("fails closed if additive platform command uniqueness is missing", async () => {
    const root = await admin(), index = (await M.PlatformCommand.collection.indexes()).find(i => i.key.actorId && i.key.key)!;
    await M.PlatformCommand.collection.dropIndex(index.name!);
    try { const response = await write("/admin-users", staffBody(), root); expect(response.status).toBe(503); expect(await M.User.countDocuments({ platformProfile: { $exists: true } })).toBe(0); }
    finally { await M.PlatformCommand.createIndexes(); }
  });
  it("keeps settings and health summaries secret-free and uses versioned re-verified changes", async () => {
    const root = await admin(), readOnly = await admin("Audit / Read Only", ["platform:settings:read"]);
    const initial = await read("/settings", root); expect(initial.body.data.settings.version).toBe(0); expect(initial.body.data.integration.livePayouts).toBe(false); expect(JSON.stringify(initial.body)).not.toMatch(/JWT_SECRET|MONGODB_URI|RAZORPAY_KEY_SECRET/);
    const body = { displayName: "Aibus Platform", supportEmail: "support@aibus.test", onboardingMode: "Manual review", templates: { operatorApproved: "Approved {{company}}" }, version: 0, reason: "Approved settings change fixture", password };
    expect((await write("/settings", body, readOnly, "put")).status).toBe(403); expect((await write("/settings", { ...body, password: "incorrect" }, root, "put")).status).toBe(403);
    expect((await write("/settings", body, root, "put")).status).toBe(200); expect((await write("/settings", body, root, "put")).status).toBe(409);
    expect((await write("/settings", { ...body, version: 1, RAZORPAY_KEY_SECRET: "blocked" }, root, "put")).status).toBe(400);
    expect((await read("/capabilities", root)).body.data.mfa.available).toBe(false);
  });
});

describe("Phase 6 job lease and operational monitoring", () => {
  it("acquires a durable job lease, records a run, and prevents duplicate acquisition", async () => {
    let calls = 0;
    const r1 = await runLeasedJob("test-dedup", async () => { calls++; }, { leaseMs: 5000, intervalMs: 60000 });
    expect(r1).toMatchObject({ acquired: true, succeeded: true });
    expect(calls).toBe(1);
    // Second call: nextRunAt is in the future – should not acquire
    const r2 = await runLeasedJob("test-dedup", async () => { calls++; }, { leaseMs: 5000, intervalMs: 60000 });
    expect(r2).toMatchObject({ acquired: false });
    expect(calls).toBe(1);
    const run = await M.OperationalJobRun.findOne({ jobKey: "test-dedup" }).lean();
    expect(run?.status).toBe("Succeeded");
  });

  it("transitions a failed job to Backoff state and records the failure run", async () => {
    const key = "test-fail-" + randomUUID();
    await runLeasedJob(key, async () => { throw new Error("intentional"); }, { leaseMs: 5000 });
    const job = await M.OperationalJob.findOne({ key }).lean();
    expect(job?.state).toBe("Backoff");
    expect(job?.failures).toBe(1);
    const run = await M.OperationalJobRun.findOne({ jobKey: key }).lean();
    expect(run?.status).toBe("Failed");
    expect(run?.code).toBe("JOB_FAILED");
  });

  it("enters Manual review after maxFailures and prevents further acquisition", async () => {
    const key = "test-maxfail-" + randomUUID();
    for (let i = 0; i < 3; i++) {
      await M.OperationalJob.updateOne({ key }, { $set: { state: "Idle", nextRunAt: new Date(0), failures: i, leaseUntil: null } }, { upsert: true });
      await runLeasedJob(key, async () => { throw new Error("fail"); }, { leaseMs: 5000, maxFailures: 3 });
    }
    const job = await M.OperationalJob.findOne({ key }).lean();
    expect(job?.state).toBe("Manual review");
    // Further acquisition attempts are blocked
    const r = await runLeasedJob(key, async () => {}, { leaseMs: 5000 });
    expect(r).toMatchObject({ acquired: false });
  });

  it("detects booked-seat-without-confirmed-owner discrepancy (read-only: does not repair)", async () => {
    // Create a trip with a seat incorrectly marked 'booked' but no matching booking
    const orphanTrip: any = await M.Trip.create({
      operatorId: a.operatorId, busId, routeId, journeyDate: "2030-11-20",
      departureAt: new Date("2030-11-20T21:30:00+05:30"),
      seats: [{ number: "X1", deck: "lower", row: 0, column: 0, category: "sleeper", farePaise: 100000, state: "booked", bookingId: new mongoose.Types.ObjectId() }],
    });
    const issues = await inspectTripIntegrity(a.operatorId!, String(orphanTrip._id));
    expect(issues.some(i => i.code === "BOOKED_SEAT_WITHOUT_CONFIRMED_OWNER")).toBe(true);
    // Seat is still booked – integrity check is read-only
    const after: any = await M.Trip.findById(orphanTrip._id).lean();
    expect(after.seats[0].state).toBe("booked");
  });

  it("detects expired-hold pending cleanup (read-only: does not remove the hold)", async () => {
    const expiredHold: any = await M.Hold.create({
      operatorId: a.operatorId, tripId, holdId: randomUUID(), userId: a.userId,
      seats: ["L1"], expiresAt: new Date(Date.now() - 60000), status: "held",
    });
    await M.Trip.updateOne({ _id: tripId, "seats.number": "L1" }, {
      $set: { "seats.$.state": "held", "seats.$.holdId": expiredHold.holdId, "seats.$.holdUserId": a.userId, "seats.$.holdUntil": expiredHold.expiresAt }
    });
    const issues = await inspectTripIntegrity(a.operatorId!, tripId);
    expect(issues.some(i => i.code === "EXPIRED_HOLD_PENDING_CLEANUP")).toBe(true);
    // Hold document still exists – not auto-deleted by the read-only scanner
    const holdAfter = await M.Hold.findById(expiredHold._id).lean();
    expect(holdAfter).not.toBeNull();
  });

  it("persists issues upsert-idempotently and resolves stale ones when they clear", async () => {
    const op = a.operatorId!;
    await persistIssues(op, [{ code: "TEST_A", resourceId: "r1", category: "Inventory" }]);
    await persistIssues(op, [{ code: "TEST_A", resourceId: "r1", category: "Inventory" }]);
    expect(await M.OperationalIssue.countDocuments({ operatorId: op, code: "TEST_A" })).toBe(1);
    // Calling with an empty list resolves previous ones
    await persistIssues(op, []);
    const resolved = await M.OperationalIssue.findOne({ operatorId: op, code: "TEST_A" }).lean();
    expect(resolved?.status).toBe("Resolved");
  });
});

describe("Phase 6 operations API", () => {
  async function platformAdmin(perms: string[] = ["platform:monitor:read"]) {
    const owner: any = await M.User.findById(a.userId).select("+passwordHash").lean();
    const email = randomUUID() + "@ops.test";
    await M.User.create({ name: "Ops Staff", email, role: "super_admin", passwordHash: owner.passwordHash, platformPermissions: perms, platformProfile: "Platform Operations" });
    const login = await request(app).post("/api/v1/auth/login").set("X-Aibus-Client", "admin").send({ email, password });
    return { token: login.body.data.accessToken };
  }

  it("returns health summary for platform monitor without exposing secrets", async () => {
    const admin = await platformAdmin(["platform:monitor:read"]);
    const r = await request(app).get("/api/v1/platform/operations/health").set("Authorization", "Bearer " + admin.token);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ mongoConnected: true });
    expect(r.body.data.jobs).toBeInstanceOf(Array);
    expect(JSON.stringify(r.body)).not.toMatch(/JWT_SECRET|RAZORPAY_KEY_SECRET|passwordHash/);
  });

  it("denies health to operator tokens and unauthenticated requests", async () => {
    expect((await get("/platform/operations/health")).status).toBe(403);
    expect((await request(app).get("/api/v1/platform/operations/health")).status).toBe(401);
  });

  it("lists job runs for platform monitor with no cross-tenant job details", async () => {
    await runLeasedJob("ops-api-test-" + randomUUID(), async () => {}, { leaseMs: 5000, intervalMs: 1 });
    const admin = await platformAdmin(["platform:monitor:read"]);
    const r = await request(app).get("/api/v1/platform/operations/jobs").set("Authorization", "Bearer " + admin.token);
    expect(r.status).toBe(200);
    expect(r.body.data).toBeInstanceOf(Array);
  });

  it("lists operational issues with pagination and category filter", async () => {
    await persistIssues(a.operatorId!, [{ code: "INVENTORY_CHECK", resourceId: "seat-1", category: "Inventory" }, { code: "FINANCE_ALERT", resourceId: "wallet-1", category: "Finance" }]);
    // Operator admin has finance:read and can see both
    const rAdmin = await get("/operator/operations/issues?limit=10", tokenA);
    expect(rAdmin.status).toBe(200);
    expect(rAdmin.body.data.some((i: any) => i.code === "INVENTORY_CHECK")).toBe(true);
    expect(rAdmin.body.data.some((i: any) => i.code === "FINANCE_ALERT")).toBe(true);
    // Reader lacks finance:read and cannot see finance category
    const rReader = await get("/operator/operations/issues?limit=10", readerToken);
    expect(rReader.status).toBe(200);
    expect(rReader.body.data.some((i: any) => i.code === "INVENTORY_CHECK")).toBe(true);
    expect(rReader.body.data.some((i: any) => i.code === "FINANCE_ALERT")).toBe(false);
    expect(rReader.body.meta.total).toBeGreaterThanOrEqual(1);
  });

  it("enforces operator isolation on issues — Operator B cannot read Operator A issues", async () => {
    await persistIssues(a.operatorId!, [{ code: "SECRET_A_ISSUE", resourceId: "a-resource", category: "Inventory" }]);
    const r = await get("/operator/operations/issues", tokenB);
    expect(r.status).toBe(200);
    expect(r.body.data.some((i: any) => i.code === "SECRET_A_ISSUE")).toBe(false);
  });

  it("returns trip integrity scan for owned trip and rejects cross-operator access", async () => {
    const r = await get(`/operator/operations/trips/${tripId}/integrity`);
    expect(r.status).toBe(200);
    expect(r.body.data).toBeInstanceOf(Array);
    // Operator B cannot check Operator A's trip integrity
    const rB = await get(`/operator/operations/trips/${tripId}/integrity`, tokenB);
    expect(rB.status).toBe(404);
  });

  it("creates an idempotent trip incident and rejects future timestamps", async () => {
    await M.Trip.updateOne({ _id: tripId }, { $set: { inventoryOwner: "internal" } });
    const key = randomUUID();
    const body = { kind: "Delay", reason: "Road construction near junction", at: new Date(Date.now() - 60000).toISOString() };
    const r1 = await request(app).post(`/api/v1/operator/operations/trips/${tripId}/incidents`).set("Authorization", "Bearer " + tokenA).set("Idempotency-Key", key).send(body);
    expect(r1.status).toBe(201);
    const r2 = await request(app).post(`/api/v1/operator/operations/trips/${tripId}/incidents`).set("Authorization", "Bearer " + tokenA).set("Idempotency-Key", key).send(body);
    expect(r2.status).toBe(201);
    expect(r2.body.data._id).toBe(r1.body.data._id); // same record returned
    // Future timestamp rejected
    const future = { ...body, at: new Date(Date.now() + 3600000).toISOString() };
    const rFuture = await request(app).post(`/api/v1/operator/operations/trips/${tripId}/incidents`).set("Authorization", "Bearer " + tokenA).set("Idempotency-Key", randomUUID()).send(future);
    expect(rFuture.status).toBe(400);
  });

  it("lists trip incidents for owned trip and enforces read-only scope", async () => {
    await M.Trip.updateOne({ _id: tripId }, { $set: { inventoryOwner: "internal" } });
    const incBody = { kind: "Breakdown", reason: "Engine fault reported by driver", at: new Date(Date.now() - 120000).toISOString() };
    await request(app).post(`/api/v1/operator/operations/trips/${tripId}/incidents`).set("Authorization", "Bearer " + tokenA).set("Idempotency-Key", randomUUID()).send(incBody);
    const r = await get(`/operator/operations/trips/${tripId}/incidents`);
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBeGreaterThanOrEqual(1);
    expect(r.body.data[0]).toMatchObject({ kind: "Breakdown" });
    // Operator B cannot read Operator A incidents
    expect((await get(`/operator/operations/trips/${tripId}/incidents`, tokenB)).status).toBe(404);
  });

  it("returns operational report with correct columns and policy disclaimer", async () => {
    const q = "from=2030-11-13&to=2030-11-13";
    const r = await get(`/operator/operations/reports/seat-occupancy?${q}`);
    expect(r.status).toBe(200);
    expect(r.body.data).toBeInstanceOf(Array);
    expect(r.body.meta.columns).toContain("occupancyPercent");
    expect(r.body.meta.policy).toMatch(/operational observations/i);
    // Unknown report name should 404
    expect((await get(`/operator/operations/reports/nonexistent?${q}`)).status).toBe(404);
    // Missing date range should 400
    expect((await get("/operator/operations/reports/seat-occupancy")).status).toBe(400);
  });

  it("hides fuel-expense report from operators without finance permission", async () => {
    const q = "from=2030-11-13&to=2030-11-13";
    const rNoFinance = await get(`/operator/operations/reports/fuel-expenses?${q}`, readerToken);
    expect(rNoFinance.status).toBe(403);
    const rWithFinance = await get(`/operator/operations/reports/fuel-expenses?${q}`, tokenA);
    expect(rWithFinance.status).toBe(200);
  });

  it("platform monitor can access issues across operators with operatorId filter", async () => {
    await persistIssues(a.operatorId!, [{ code: "PLATFORM_A_ISSUE", resourceId: "x1", category: "Inventory" }]);
    const admin = await platformAdmin(["platform:monitor:read"]);
    const r = await request(app).get(`/api/v1/platform/operations/issues?operatorId=${a.operatorId}`).set("Authorization", "Bearer " + admin.token);
    expect(r.status).toBe(200);
    expect(r.body.data.some((i: any) => i.code === "PLATFORM_A_ISSUE")).toBe(true);
  });

  it("requires platform:settings:write to rearm a job and validates idempotency", async () => {
    const key = "rearm-test-" + randomUUID();
    // Set job to Manual review
    await M.OperationalJob.updateOne({ key }, { $set: { state: "Manual review", failures: 5, nextRunAt: new Date() } }, { upsert: true });
    const job: any = await M.OperationalJob.findOne({ key }).lean();
    const admin = await platformAdmin(["platform:monitor:read"]); // no settings:write
    const readOnlyAttempt = await request(app).post(`/api/v1/platform/operations/jobs/${job._id}/rearm`)
      .set("Authorization", "Bearer " + admin.token).set("Idempotency-Key", randomUUID())
      .send({ reason: "Test rearm without permission", password });
    expect(readOnlyAttempt.status).toBe(403);
  });
});
