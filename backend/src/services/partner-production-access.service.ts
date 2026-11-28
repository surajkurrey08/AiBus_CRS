import mongoose from "mongoose";
import { randomBytes } from "node:crypto";
import * as M from "../models/index.js";
import * as P from "../models/public-api.model.js";
import { fail, type Principal } from "../utils/core.js";
import { platformAudit, verifyPlatformAction } from "./platform-admin.service.js";
import { platformPermit } from "./platform-read.service.js";
import { hashToken } from "./auth.service.js";

export async function configurePartnerProductionAccess(
  auth: Principal,
  partnerId: string,
  input: {
    status: "Disabled" | "Enabled" | "Suspended";
    operatorIds: string[];
    allowedIps: string[];
    password: string;
    reason: string;
  },
) {
  platformPermit(auth, "platform:partners:write");
  await verifyPlatformAction(auth, input.password);
  return mongoose.connection.transaction(async (session) => {
    const partner: any = await P.ApiPartner.findById(partnerId).session(session);
    if (!partner) fail(404, "NOT_FOUND", "Partner not found");
    if (partner.onboardingStatus !== "Approved" || partner.status !== "Active")
      fail(409, "PARTNER_NOT_APPROVED", "Approve the partner before changing production access");

    const operators = input.operatorIds.length
      ? await M.Operator.countDocuments({
          _id: { $in: input.operatorIds },
          status: "approved",
          salesBlocked: { $ne: true },
        }).session(session)
      : 0;
    if (operators !== input.operatorIds.length)
      fail(400, "INVALID_OPERATOR", "Every selected operator must be approved and open for sales");

    partner.productionAccess = {
      status: input.status,
      operatorIds: input.operatorIds,
      allowedIps: [...new Set(input.allowedIps)],
      ...(input.status === "Enabled" ? { enabledAt: new Date(), enabledBy: auth.userId } : {}),
      updatedAt: new Date(),
    };
    partner.revision += 1;
    await partner.save({ session });
    await platformAudit(
      auth,
      "partner.production_access.update",
      String(partner._id),
      input.reason,
      session,
      undefined,
      {
        partnerId: String(partner._id),
        status: input.status,
        operatorCount: input.operatorIds.length,
        ipLockEnabled: input.allowedIps.length > 0,
      },
    );
    return partner.productionAccess;
  });
}

export async function issuePartnerProductionCredential(
  auth: Principal,
  partnerId: string,
  input: { password: string; reason: string },
) {
  platformPermit(auth, "platform:partners:write");
  await verifyPlatformAction(auth, input.password);
  const secret = "aicar_live_" + randomBytes(32).toString("hex");
  await mongoose.connection.transaction(async (session) => {
    const partner: any = await P.ApiPartner.findById(partnerId).session(session);
    if (!partner) fail(404, "NOT_FOUND", "Partner not found");
    if (partner.productionAccess?.status !== "Enabled")
      fail(409, "PRODUCTION_ACCESS_DISABLED", "Enable production access before issuing a credential");
    partner.productionAccess.credentialHash = hashToken(secret);
    partner.productionAccess.credentialIssuedAt = new Date();
    partner.productionAccess.updatedAt = new Date();
    partner.revision += 1;
    await partner.save({ session });
    await platformAudit(
      auth,
      "partner.production_credential.rotate",
      String(partner._id),
      input.reason,
      session,
      undefined,
      { partnerId: String(partner._id) },
    );
  });
  return { credential: secret, environment: "Production" };
}
