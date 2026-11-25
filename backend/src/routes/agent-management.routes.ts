import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import * as M from "../models/index.js";
import { hashPassword } from "../services/auth.service.js";
import {
  agentDetails,
  agentPerformance,
  agentBookingReport,
  ownedAgent,
} from "../services/agent.service.js";
import {
  getOperatorAgentSettlements,
  markSettlementCleared,
} from "../services/agent-settlement.service.js";
import {
  agentInput,
  agentUserInput,
  commissionConfig,
} from "../validators/agent.schemas.js";
import {
  asyncRoute,
  fail,
  id,
  ok,
  pagination,
  permit,
  tenant,
} from "../utils/core.js";
export function agentManagementRouter() {
  const router = Router();
  router.use(permit("agents:read"));
  router.get(
    "/performance",
    asyncRoute(async (req, res) =>
      ok(res, await agentPerformance(req.auth.operatorId!)),
    ),
  );
  router.get(
    "/",
    asyncRoute(async (req, res) => {
      const p = pagination(req);
      const scope = { ...tenant(req), kind: "Agent" };
      const [agencies, total] = await Promise.all([
        M.SalesPartner.find(scope)
          .sort({ createdAt: -1, _id: -1 })
          .skip((p.page - 1) * p.limit)
          .limit(p.limit)
          .lean(),
        M.SalesPartner.countDocuments(scope),
      ]);
      ok(res, await Promise.all(agencies.map(agentDetails)), {
        page: p.page,
        limit: p.limit,
        total,
        pages: Math.max(1, Math.ceil(total / p.limit)),
      });
    }),
  );
  router.get(
    "/:id/bookings",
    asyncRoute(async (req, res) => {
      const agency = await ownedAgent(
          req.auth.operatorId!,
          id.parse(req.params.id),
        ),
        p = pagination(req);
      const report = await agentBookingReport(
        req.auth.operatorId!,
        String(agency._id),
        p.page,
        p.limit,
      );
      ok(
        res,
        { agent: await agentDetails(agency), bookings: report.bookings },
        {
          page: p.page,
          limit: p.limit,
          total: report.total,
          pages: Math.max(1, Math.ceil(report.total / p.limit)),
        },
      );
    }),
  );
  router.get(
    "/:id",
    asyncRoute(async (req, res) =>
      ok(
        res,
        await agentDetails(
          await ownedAgent(req.auth.operatorId!, id.parse(req.params.id)),
        ),
      ),
    ),
  );
  router.post(
    "/",
    permit("agents:write"),
    asyncRoute(async (req, res) => {
      const input = agentInput.parse(req.body);
      commissionConfig.parse({
        commissionType: input.commissionType,
        commissionRate: input.commissionRate,
      });
      let agency: any;
      await mongoose.connection.transaction(async (session) => {
        if (
          (await M.Bus.countDocuments({
            ...tenant(req),
            _id: { $in: input.allowedBusIds },
          }).session(session)) !== new Set(input.allowedBusIds).size
        )
          fail(
            404,
            "NOT_FOUND",
            "One or more authorized buses do not belong to your operator",
          );
        [agency] = await M.SalesPartner.create(
          [{ ...tenant(req), ...input, kind: "Agent" }],
          { session },
        );
        await M.Audit.create(
          [
            {
              ...tenant(req),
              actorId: req.auth.userId,
              action: "agent.create",
              resourceId: String(agency._id),
            },
          ],
          { session },
        );
      });
      ok(res, await agentDetails(agency.toObject()), undefined, 201);
    }),
  );
  router.patch(
    "/:id",
    permit("agents:write"),
    asyncRoute(async (req, res) => {
      const agencyId = id.parse(req.params.id);
      const input = agentInput
        .partial()
        .strict()
        .refine((v) => Object.keys(v).length > 0, "Provide changes")
        .parse(req.body);
      let agency: any;
      await mongoose.connection.transaction(async (session) => {
        agency = await M.SalesPartner.findOne({
          _id: agencyId,
          ...tenant(req),
          kind: "Agent",
        }).session(session);
        if (!agency) fail(404, "NOT_FOUND", "Agent not found");
        commissionConfig.parse({
          commissionType:
            input.commissionType ?? agency.commissionType ?? "Percent",
          commissionRate: input.commissionRate ?? agency.commissionRate ?? 500,
        });
        if (
          input.allowedBusIds &&
          (await M.Bus.countDocuments({
            ...tenant(req),
            _id: { $in: input.allowedBusIds },
          }).session(session)) !== new Set(input.allowedBusIds).size
        )
          fail(
            404,
            "NOT_FOUND",
            "An authorized bus does not belong to your operator",
          );
        agency.set(input);
        await agency.save({ session });
        const users = await M.User.find({
          ...tenant(req),
          salesPartnerId: agencyId,
        })
          .select("_id")
          .session(session)
          .lean();
        await M.Session.updateMany(
          { userId: { $in: users.map((u) => u._id) }, revokedAt: null },
          { $set: { revokedAt: new Date() } },
          { session },
        );
        await M.Audit.create(
          [
            {
              ...tenant(req),
              actorId: req.auth.userId,
              action: "agent.update",
              resourceId: agencyId,
              metadata: { changedFields: Object.keys(input) },
            },
          ],
          { session },
        );
      });
      ok(res, await agentDetails(agency.toObject()));
    }),
  );
  router.post(
    "/:id/users",
    permit("agents:write"),
    asyncRoute(async (req, res) => {
      const agencyId = id.parse(req.params.id),
        input = agentUserInput.parse(req.body);
      const passwordHash =
        "password" in input ? await hashPassword(input.password) : undefined;
      let user: any;
      await mongoose.connection.transaction(async (session) => {
        const agency = await M.SalesPartner.findOneAndUpdate(
          { _id: agencyId, ...tenant(req), kind: "Agent" },
          { $inc: { __v: 1 } },
          { session },
        );
        if (!agency) fail(404, "NOT_FOUND", "Agent not found");
        if ("userId" in input) {
          user = await M.User.findOneAndUpdate(
            {
              _id: input.userId,
              ...tenant(req),
              role: { $in: ["booking_staff", "agent"] },
              $or: [
                { salesPartnerId: { $exists: false } },
                { salesPartnerId: null },
                { salesPartnerId: agencyId },
              ],
            },
            { $set: { salesPartnerId: agencyId } },
            { session, new: true },
          );
          if (!user)
            fail(
              409,
              "USER_LINK_CONFLICT",
              "Choose an unlinked booking staff user from your operator",
            );
        } else {
          [user] = await M.User.create(
            [
              {
                ...tenant(req),
                name: input.name,
                email: input.email,
                passwordHash,
                role: "agent",
                salesPartnerId: agencyId,
              },
            ],
            { session },
          );
        }
        await M.Session.updateMany(
          { userId: user._id, revokedAt: null },
          { $set: { revokedAt: new Date() } },
          { session },
        );
        await M.Audit.create(
          [
            {
              ...tenant(req),
              actorId: req.auth.userId,
              action: "agent.user.link",
              resourceId: agencyId,
              metadata: { userId: String(user._id) },
            },
          ],
          { session },
        );
      });
      ok(
        res,
        {
          id: String(user._id),
          name: user.name,
          email: user.email,
          agentId: agencyId,
        },
        undefined,
        201,
      );
    }),
  );
  router.get(
    "/settlements/daily",
    asyncRoute(async (req, res) => {
      const targetDate = typeof req.query.date === "string" ? req.query.date : undefined;
      const settlements = await getOperatorAgentSettlements(
        req.auth.operatorId!,
        targetDate,
      );
      ok(res, { settlements, date: targetDate || settlements[0]?.date });
    }),
  );
  router.post(
    "/settlements/:id/clear",
    permit("agents:write"),
    asyncRoute(async (req, res) => {
      const settlementId = Array.isArray(req.params.id) ? req.params.id[0] : String(req.params.id);
      const notes = typeof req.body.notes === "string" ? req.body.notes : undefined;
      const result = await markSettlementCleared(
        req.auth.operatorId!,
        settlementId,
        req.auth.userId,
        notes,
      );
      ok(res, { settlement: result, message: "Daily amount marked as Cleared." });
    }),
  );
  return router;
}
