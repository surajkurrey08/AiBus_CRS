import { partnerRolePermissions } from "../types/partner-portal.js";
import { platformIdentity } from "../types/platform.js";
import mongoose from "mongoose";
import * as M from "../models/index.js";
import {
  fail,
  rolePermissions,
  type Principal,
  type Role,
} from "../utils/core.js";
import { agentCapabilities, type AgentCapability } from "../types/agent.js";

export async function identityFor(
  user: any,
): Promise<Pick<Principal, "role" | "permissions" | "agentId"> & { platformProfile?: string; partnerId?: string; partnerRole?: string }> {
  if (user.role === "partner") {
    const partner = user.partnerId && !user.operatorId && !user.salesPartnerId && await M.ApiPartner.findOne({ _id: user.partnerId, status: "Active", onboardingStatus: "Approved" }).lean();
    if (!partner || !partnerRolePermissions[user.partnerRole]) fail(403, "PARTNER_NOT_APPROVED", "Partner access is pending approval or suspended");
    return { role: "partner", partnerId: String(partner._id), partnerRole: user.partnerRole, permissions: partnerRolePermissions[user.partnerRole] as any };
  }
  if (user.role !== "agent" && !user.salesPartnerId)
    return {
      role: user.role as Role,
      ...(user.role === "super_admin" ? { platformProfile: user.platformProfile || "Super Admin" } : {}),
      permissions: user.role === "super_admin" ? platformIdentity(user) : rolePermissions[user.role as Role],
    };
  if (!["agent", "booking_staff"].includes(user.role))
    fail(403, "AGENT_LINK_INVALID", "This account has an invalid agency link");
  const agency: any = await M.SalesPartner.findOne({
    _id: user.salesPartnerId,
    operatorId: user.operatorId,
    kind: "Agent",
    status: "Active",
  }).lean();
  if (!agency)
    fail(403, "AGENT_INACTIVE", "Your agency is inactive or unavailable");
  return {
    role: "agent",
    agentId: String(agency._id),
    permissions: (agency.permissions || agentCapabilities).includes("book")
      ? ["bookings:write"]
      : [],
  };
}

// Always re-read the authenticated membership. No client supplied tenant/agent is authoritative.
export async function authorizeAgent(
  auth: Principal,
  capability: AgentCapability,
  session?: mongoose.ClientSession,
  trip?: any,
) {
  if (!auth.agentId || auth.role !== "agent")
    fail(403, "AGENT_REQUIRED", "An agent account is required");
  const user = await M.User.findOne({
    _id: auth.userId,
    operatorId: auth.operatorId,
    salesPartnerId: auth.agentId,
    active: true,
    role: { $in: ["agent", "booking_staff"] },
  })
    .session(session || null)
    .lean();
  if (!user)
    fail(403, "AGENT_LINK_INVALID", "Agency membership is no longer valid");
  const filter = {
    _id: auth.agentId,
    operatorId: auth.operatorId,
    kind: "Agent",
    status: "Active",
    permissions: capability,
  };
  // A transactional write serializes booking/hold creation with deactivation and permission changes.
  const agency: any = session
    ? await M.SalesPartner.findOneAndUpdate(
        filter,
        { $inc: { __v: 1 } },
        { session, new: true },
      ).lean()
    : await M.SalesPartner.findOne(filter).lean();
  if (!agency)
    fail(403, "AGENT_FORBIDDEN", "Your agency does not have this permission");
  if (
    trip &&
    (String(trip.operatorId) !== auth.operatorId ||
      (agency.allowedBusIds?.length &&
        !agency.allowedBusIds.some(
          (bus: any) => String(bus) === String(trip.busId),
        )))
  )
    fail(404, "NOT_FOUND", "Trip not found");
  return agency;
}

export async function ownedAgent(
  operatorId: string,
  agentOrLegacyUserId: string,
) {
  let agency: any = await M.SalesPartner.findOne({
    _id: agentOrLegacyUserId,
    operatorId,
    kind: "Agent",
  }).lean();
  if (!agency) {
    const legacy: any = await M.User.findOne({
      _id: agentOrLegacyUserId,
      operatorId,
      role: { $in: ["booking_staff", "agent"] },
    }).lean();
    if (legacy?.salesPartnerId)
      agency = await M.SalesPartner.findOne({
        _id: legacy.salesPartnerId,
        operatorId,
        kind: "Agent",
      }).lean();
  }
  if (!agency) fail(404, "NOT_FOUND", "Agent not found");
  return agency;
}

export async function agentDetails(agency: any) {
  const users = await M.User.find({
    operatorId: agency.operatorId,
    salesPartnerId: agency._id,
  })
    .select("name email role active")
    .lean();
  return {
    ...agency,
    id: String(agency._id),
    agencyName: agency.name,
    active: agency.status === "Active",
    linkedUsers: users,
    linkedUserIds: users.map((u) => String(u._id)),
  };
}

export function agencyBookingScope(operatorId: string, agentId: string) {
  return {
    operatorId,
    $or: [
      { agentId },
      { salesPartnerId: agentId, agentId: { $exists: false } },
    ],
  };
}
export async function agentBookingReport(
  operatorId: string,
  agentId: string,
  page = 1,
  limit = 25,
) {
  const scope = agencyBookingScope(operatorId, agentId);
  const [rows, total] = await Promise.all([
    M.Booking.find(scope)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    M.Booking.countDocuments(scope),
  ]);
  return {
    bookings: rows.map((b: any) => ({
      id: String(b._id),
      reference: b.reference,
      pnr: b.pnr,
      tripId: b.tripId,
      seats: b.passengers.map((p: any) => p.seat),
      passengerName: b.passengers[0]?.name,
      passengersCount: b.passengers.length,
      totalPaise: b.totalPaise,
      grossPaise: b.grossPaise,
      commissionPaise: b.commissionPaise,
      commissionSnapshot: b.commissionSnapshot,
      status: b.status,
      paymentStatus: b.paymentStatus,
      createdAt: b.createdAt,
    })),
    total,
  };
}
export async function agentPerformance(operatorId: string, agencyId?: string) {
  const agencies: any[] = await M.SalesPartner.find({
    operatorId,
    kind: "Agent",
    ...(agencyId ? { _id: agencyId } : {}),
  }).lean();
  const stats = await M.Booking.aggregate([
    {
      $match: {
        operatorId: new mongoose.Types.ObjectId(operatorId),
        $or: [
          { agentId: { $in: agencies.map((a) => a._id) } },
          {
            agentId: { $exists: false },
            salesPartnerId: { $in: agencies.map((a) => a._id) },
          },
        ],
      },
    },
    {
      $group: {
        _id: { $ifNull: ["$agentId", "$salesPartnerId"] },
        totalBookings: { $sum: 1 },
        pendingBookings: {
          $sum: { $cond: [{ $eq: ["$status", "Pending payment"] }, 1, 0] },
        },
        confirmedBookings: {
          $sum: { $cond: [{ $eq: ["$status", "Confirmed"] }, 1, 0] },
        },
        cancelledBookings: {
          $sum: { $cond: [{ $eq: ["$status", "Cancelled"] }, 1, 0] },
        },
        refundedBookings: {
          $sum: { $cond: [{ $eq: ["$paymentStatus", "Refunded"] }, 1, 0] },
        },
        totalSalesPaise: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$status", "Confirmed"] },
                  { $eq: ["$paymentStatus", "Paid"] },
                ],
              },
              "$grossPaise",
              0,
            ],
          },
        },
        commissionEarnedPaise: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$status", "Confirmed"] },
                  { $eq: ["$paymentStatus", "Paid"] },
                ],
              },
              "$commissionPaise",
              0,
            ],
          },
        },
        lastBookingAt: { $max: "$createdAt" },
      },
    },
  ]);
  const agents = agencies.map((a) => ({
    ...a,
    id: String(a._id),
    active: a.status === "Active",
    totalBookings: 0,
    pendingBookings: 0,
    confirmedBookings: 0,
    cancelledBookings: 0,
    refundedBookings: 0,
    totalSalesPaise: 0,
    commissionEarnedPaise: 0,
    ...stats.find((s) => String(s._id) === String(a._id)),
    _id: a._id,
  }));
  return {
    agents,
    totals: {
      totalAgents: agents.length,
      activeAgents: agents.filter((a) => a.active).length,
      totalBookings: agents.reduce((n, a) => n + a.totalBookings, 0),
      totalSalesPaise: agents.reduce((n, a) => n + a.totalSalesPaise, 0),
      commissionEarnedPaise: agents.reduce(
        (n, a) => n + a.commissionEarnedPaise,
        0,
      ),
    },
  };
}
