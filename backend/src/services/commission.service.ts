import type mongoose from "mongoose";
import { CommissionRule, SalesPartner, User } from "../models/index.js";
import { fail, type Principal } from "../utils/core.js";
export async function partnerCommission(
  auth: Principal,
  trip: any,
  pricing: { grossPaise: number; discountPaise: number; totalPaise: number },
  partnerId?: string,
  session?: mongoose.ClientSession,
) {
  if (!partnerId) {
    if (auth.role === "booking_staff" && auth.userId) {
      const user = await User.findById(auth.userId)
        .session(session || null)
        .lean();
      if (user && user.commissionRate) {
        const basisPaise = Math.max(0, pricing.grossPaise - pricing.discountPaise);
        const commissionPaise =
          user.commissionType === "Fixed"
            ? Number(user.commissionRate)
            : Math.round((basisPaise * Number(user.commissionRate)) / 10000);
        return {
          commissionPaise: Math.max(0, commissionPaise),
          commissionSnapshot: {
            partnerName: user.name,
            partnerKind: "Agent",
            agentId: String(user._id),
            basis: "Fare after discount",
            basisPaise,
            kind: user.commissionType || "Percent",
            basisPoints:
              user.commissionType === "Percent" ? user.commissionRate : undefined,
            fixedPaise:
              user.commissionType === "Fixed" ? user.commissionRate : undefined,
          },
        };
      }
    }
    return { commissionPaise: 0 };
  }
  const partner = await SalesPartner.findOne({
    _id: partnerId,
    operatorId: auth.operatorId,
    status: "Active",
  })
    .session(session || null)
    .lean();
  if (!partner)
    fail(
      404,
      "PARTNER_UNAVAILABLE",
      "Select an active agent or branch from your company",
    );
  const rules = await CommissionRule.find({
    operatorId: auth.operatorId,
    partnerId,
    status: "Active",
    $or: [
      { tripId: trip._id },
      ...(trip.serviceId ? [{ tripId: null, serviceId: trip.serviceId }] : []),
    ],
  })
    .session(session || null)
    .lean();
  const rule =
    rules.find((value) => String(value.tripId) === String(trip._id)) ||
    rules.find((value) => !value.tripId);
  if (!rule)
    fail(
      409,
      "COMMISSION_RULE_REQUIRED",
      "Configure this agent or branch's service/trip commission first",
    );
  const basisPaise =
    rule!.basis === "Grand total"
      ? pricing.totalPaise
      : Math.max(0, pricing.grossPaise - pricing.discountPaise);
  const commissionPaise =
    rule!.kind === "Percent"
      ? Math.round((basisPaise * Number(rule!.basisPoints)) / 10000)
      : Number(rule!.fixedPaise);
  if (!Number.isSafeInteger(commissionPaise) || commissionPaise < 0)
    fail(409, "COMMISSION_INVALID", "Commission configuration is invalid");
  return {
    salesPartnerId: partnerId,
    commissionPaise,
    commissionSnapshot: {
      partnerName: partner!.name,
      partnerKind: partner!.kind,
      ruleId: String(rule!._id),
      basis: rule!.basis,
      basisPaise,
      kind: rule!.kind,
      basisPoints: rule!.basisPoints,
      fixedPaise: rule!.fixedPaise,
    },
  };
}
