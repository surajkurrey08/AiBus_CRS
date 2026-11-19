import type mongoose from "mongoose";
import { CommissionRule, SalesPartner } from "../models/index.js";
import { fail, type Principal } from "../utils/core.js";
import { commissionConfig } from "../validators/agent.schemas.js";
import { paise, safeMoney } from "./ledger.service.js";
export async function partnerCommission(
  auth: Principal,
  trip: any,
  pricing: { grossPaise: number; discountPaise: number; totalPaise: number },
  partnerId?: string,
  session?: mongoose.ClientSession,
) {
  if (auth.agentId) partnerId = auth.agentId;
  // Unlinked booking staff are internal users, not separate agency identities.
  if (!partnerId) return { commissionPaise: 0 };
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
  if (!rule && partner!.kind === "Agent") {
    const config = commissionConfig.parse({
      commissionType: partner!.commissionType ?? "Percent",
      commissionRate: partner!.commissionRate ?? 500,
    });
    const basisPaise = Math.max(0, pricing.grossPaise - pricing.discountPaise);
    const commissionPaise =
      config.commissionType === "Fixed"
        ? config.commissionRate
        : safeMoney(
            (paise(basisPaise) * paise(config.commissionRate) + 5000n) / 10000n,
          );
    if (!Number.isSafeInteger(commissionPaise) || commissionPaise > basisPaise)
      fail(
        409,
        "COMMISSION_INVALID",
        "Commission exceeds the discounted base fare",
      );
    return {
      salesPartnerId: String(partner!._id),
      commissionPaise,
      commissionSnapshot: {
        agentId: String(partner!._id),
        partnerName: partner!.name,
        partnerKind: "Agent",
        basis: "Fare after discount",
        basisPaise,
        kind: config.commissionType,
        ...(config.commissionType === "Fixed"
          ? { fixedPaise: config.commissionRate }
          : { basisPoints: config.commissionRate }),
      },
    };
  }
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
  commissionConfig.parse({
    commissionType: rule!.kind,
    commissionRate:
      rule!.kind === "Percent" ? rule!.basisPoints : rule!.fixedPaise,
  });
  const commissionPaise =
    rule!.kind === "Percent"
      ? safeMoney(
          (paise(basisPaise) * paise(Number(rule!.basisPoints)) + 5000n) /
            10000n,
        )
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
