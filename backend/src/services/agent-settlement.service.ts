import mongoose from "mongoose";
import * as M from "../models/index.js";
import { fail } from "../utils/core.js";
const day = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
const validDate = (date: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  !Number.isNaN(Date.parse(date)) &&
  new Date(date).toISOString().slice(0, 10) === date;
async function agency(
  operatorId: string,
  agentId: string,
  session?: mongoose.ClientSession,
) {
  const value = await M.SalesPartner.findOne({
    _id: agentId,
    operatorId,
    kind: "Agent",
  })
    .session(session || null)
    .lean();
  if (!value) fail(404, "NOT_FOUND", "Owned agent not found");
  return value!;
}
async function summary(
  operatorId: string,
  agentId: string,
  date: string,
  session?: mongoose.ClientSession,
) {
  if (!validDate(date))
    fail(400, "INVALID_DATE", "Use a valid YYYY-MM-DD date");
  const partner = await agency(operatorId, agentId, session);
  const start = new Date(date + "T00:00:00+05:30"),
    end = new Date(+start + 86400000);
  const bookings: any[] = await M.Booking.find({
    operatorId,
    agentId,
    status: "Confirmed",
    paymentStatus: "Paid",
    createdAt: { $gte: start, $lt: end },
  })
    .session(session || null)
    .lean();
  const grossPaise = bookings.reduce(
      (n, b) => n + Number(b.totalPaise || 0),
      0,
    ),
    commissionPaise = bookings.reduce(
      (n, b) => n + Number(b.commissionPaise || 0),
      0,
    );
  return {
    operatorId,
    agentId,
    agentName: partner.name,
    date,
    totalBookings: bookings.length,
    grossPaise,
    commissionPaise,
    netPayablePaise: Math.max(0, grossPaise - commissionPaise),
    reportOnly: true,
  };
}
// Sales reconciliation projection only: this does not transfer funds or repay credit.
export async function syncDailySettlement(
  operatorId: string,
  agentId: string,
  date: string,
  session?: mongoose.ClientSession,
) {
  const value = await summary(operatorId, agentId, date, session);
  return M.DailyAgentSettlement.findOneAndUpdate(
    { operatorId, agentId, date },
    { $set: value, $setOnInsert: { status: "Pending" } },
    { upsert: true, new: true, session },
  ).lean();
}
async function row(operatorId: string, agentId: string, date: string) {
  const value = await summary(operatorId, agentId, date);
  const existing = await M.DailyAgentSettlement.findOne({
    operatorId,
    agentId,
    date,
  }).lean();
  const reviewed =
    existing?.status === "Cleared" &&
    existing.grossPaise === value.grossPaise &&
    existing.commissionPaise === value.commissionPaise &&
    existing.totalBookings === value.totalBookings;
  return {
    ...value,
    _id: existing ? String(existing._id) : agentId + ":" + date,
    status: reviewed ? "Cleared" : "Pending",
    clearedAt: reviewed ? existing?.clearedAt : undefined,
    notes: existing?.notes,
  };
}
export async function getAgentDailySettlements(
  operatorId: string,
  agentId: string,
) {
  await agency(operatorId, agentId);
  const bookings: any[] = await M.Booking.find({
    operatorId,
    agentId,
    status: "Confirmed",
    paymentStatus: "Paid",
  })
    .select("createdAt")
    .lean();
  const dates = [
    ...new Set([
      day(new Date()),
      ...bookings.map((b) => day(new Date(b.createdAt))),
    ]),
  ]
    .sort()
    .reverse();
  const result = [];
  for (const date of dates) result.push(await row(operatorId, agentId, date));
  return result;
}
export async function getOperatorAgentSettlements(
  operatorId: string,
  targetDate?: string,
) {
  const date = targetDate || day(new Date());
  if (!validDate(date))
    fail(400, "INVALID_DATE", "Use a valid YYYY-MM-DD date");
  const agents: any[] = await M.SalesPartner.find({
    operatorId,
    kind: "Agent",
  }).lean();
  const rows = [];
  for (const a of agents)
    rows.push({
      ...(await row(operatorId, String(a._id), date)),
      agencyEmail: a.email || "—",
      agencyPhone: a.phone || "—",
      commissionRate: a.commissionRate ?? 0,
    });
  return rows.sort((a, b) => b.netPayablePaise - a.netPayablePaise);
}
export async function markSettlementCleared(
  operatorId: string,
  settlementId: string,
  userId: string,
  notes?: string,
) {
  let result: any;
  await mongoose.connection.transaction(async (session) => {
    let agentId: string, date: string;
    if (/^[a-f\d]{24}$/i.test(settlementId)) {
      const old = await M.DailyAgentSettlement.findOne({
        _id: settlementId,
        operatorId,
      })
        .session(session)
        .lean();
      if (!old) fail(404, "NOT_FOUND", "Owned reconciliation report not found");
      agentId = String(old!.agentId);
      date = old!.date;
    } else {
      const parts = settlementId.split(":");
      if (
        parts.length !== 2 ||
        !/^[a-f\d]{24}$/i.test(parts[0]) ||
        !validDate(parts[1])
      )
        fail(400, "INVALID_ID", "Invalid report identifier");
      [agentId, date] = parts;
    }
    const value = await summary(operatorId, agentId, date, session);
    const prior = await M.DailyAgentSettlement.findOne({
      operatorId,
      agentId,
      date,
    })
      .session(session)
      .lean();
    if (
      prior?.status === "Cleared" &&
      prior.totalBookings === value.totalBookings &&
      prior.grossPaise === value.grossPaise &&
      prior.commissionPaise === value.commissionPaise
    ) {
      result = prior;
      return;
    }
    result = await M.DailyAgentSettlement.findOneAndUpdate(
      { operatorId, agentId, date },
      {
        $set: {
          ...value,
          status: "Cleared",
          clearedAt: new Date(),
          clearedByUserId: userId,
          notes: notes?.slice(0, 500),
        },
      },
      { upsert: true, new: true, session },
    ).lean();
    await M.Audit.create(
      [
        {
          operatorId,
          actorId: userId,
          action: "agent.daily_report.reviewed",
          resourceId: String(result._id),
          metadata: {
            date,
            agentId,
            grossPaise: value.grossPaise,
            commissionPaise: value.commissionPaise,
            reportOnly: true,
            previousStatus: prior?.status,
          },
        },
      ],
      { session },
    );
  });
  return result;
}
