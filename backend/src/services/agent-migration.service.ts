import mongoose from "mongoose";
import * as M from "../models/index.js";
import { agentCapabilities } from "../types/agent.js";
import { commissionConfig } from "../validators/agent.schemas.js";
import { fail } from "../utils/core.js";

// Explicitly selected legacy users only. Internal booking staff are not automatically converted.
export async function migrateAgentUser(
  operatorId: string,
  userId: string,
  apply = false,
) {
  let result: any;
  const run = async (session?: mongoose.ClientSession) => {
    const user: any = await M.User.findOne({
      _id: userId,
      operatorId,
      role: { $in: ["booking_staff", "agent"] },
    })
      .session(session || null)
      .lean();
    if (!user)
      fail(404, "NOT_FOUND", "Select a booking staff user from this operator");
    const matches: any[] = await M.SalesPartner.find({
      operatorId,
      kind: "Agent",
      ...(user.salesPartnerId
        ? { _id: user.salesPartnerId }
        : { $or: [{ legacyUserId: user._id }, { email: user.email }] }),
    })
      .collation({ locale: "en", strength: 2 })
      .session(session || null)
      .lean();
    if (matches.length > 1)
      fail(
        409,
        "AMBIGUOUS_AGENT",
        "Multiple agencies match this user; explicitly link the correct existing agency first",
      );
    if (user.salesPartnerId && !matches.length)
      fail(
        409,
        "AGENT_LINK_INVALID",
        "Existing agency link is invalid; resolve it before migration",
      );
    const existing = matches[0];
    const config = commissionConfig.parse({
      commissionType:
        existing?.commissionType ?? user.commissionType ?? "Percent",
      commissionRate: existing?.commissionRate ?? user.commissionRate ?? 500,
    });
    result = {
      userId,
      operatorId,
      agentId: existing ? String(existing._id) : null,
      action: existing ? "reuse-existing-agency" : "create-agency",
      applied: apply,
    };
    if (!apply) return;
    let agency = existing;
    if (!agency)
      [agency] = await M.SalesPartner.create(
        [
          {
            operatorId,
            kind: "Agent",
            name: user.name,
            email: user.email,
            phone: user.phone,
            status: user.active ? "Active" : "Inactive",
            legacyUserId: user._id,
            permissions: [...agentCapabilities],
            ...config,
          },
        ],
        { session },
      );
    else
      await M.SalesPartner.updateOne(
        { _id: agency._id, operatorId },
        {
          $set: {
            permissions: agency.permissions ?? [...agentCapabilities],
            allowedBusIds: agency.allowedBusIds ?? [],
            ...config,
          },
        },
        { session },
      );
    await M.User.updateOne(
      { _id: userId, operatorId },
      { $set: { salesPartnerId: agency._id } },
      { session },
    );
    // Add attribution only. Never change source, PNR, money, payment state or snapshots.
    const backfill = await M.Booking.updateMany(
      {
        operatorId,
        agentId: { $exists: false },
        $or: [
          { salesPartnerId: agency._id },
          {
            userId: user._id,
            source: { $in: ["operator", "agent"] },
            salesPartnerId: { $exists: false },
          },
        ],
      },
      [
        {
          $set: {
            agentId: agency._id,
            createdByUserId: { $ifNull: ["$createdByUserId", "$userId"] },
          },
        },
      ],
      { session },
    );
    await M.Session.updateMany(
      { userId, revokedAt: null },
      { $set: { revokedAt: new Date() } },
      { session },
    );
    await M.Audit.create(
      [
        {
          operatorId,
          actorId: userId,
          action: "agent.migration.link",
          resourceId: String(agency._id),
          metadata: {
            migration: "operator-owned-agents-v1",
            attributedBookings: backfill.modifiedCount,
          },
        },
      ],
      { session },
    );
    result.agentId = String(agency._id);
    result.attributedBookings = backfill.modifiedCount;
  };
  if (apply)
    await mongoose.connection.transaction(async (session) => run(session));
  else await run();
  return result;
}
