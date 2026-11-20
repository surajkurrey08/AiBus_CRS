import mongoose from "mongoose";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { readConfig } from "../config/env.js";
import * as M from "../models/index.js";
import * as P from "../models/public-api.model.js";
import {
  publicId,
  publicScopes,
  sandboxReady,
  generateCredential,
} from "../services/public-auth.service.js";
import {
  webhookSecret,
  webhookTarget,
} from "../services/public-webhook.service.js";
const config = readConfig(),
  args = process.argv.slice(2),
  command = args[0];
if (
  ![
    "--create-fixture",
    "--issue-credential",
    "--revoke-credential",
    "--grant-trip",
    "--subscribe",
  ].includes(command)
)
  throw Error(
    "Use --create-fixture | --issue-credential partner_public_id | --revoke-credential credential_public_id | --grant-trip partner_public_id operator_object_id trip_object_id reason | --subscribe partner_public_id HTTPS_URL reason",
  );
await mongoose.connect(config.MONGODB_URI, {
  autoCreate: false,
  autoIndex: false,
});
try {
  sandboxReady(config); // This tool cannot write to ordinary or production CRS databases.
  if (command === "--create-fixture") {
    for (const model of Object.values(mongoose.models))
      await model.createIndexes();
    if (await P.ApiPartner.exists({ publicId: "partner_aibus_sandbox_demo" })) {
      console.log(
        JSON.stringify({
          existing: true,
          note: "Existing fixture retained. Secrets are never reprinted; explicitly issue another credential if needed.",
        }),
      );
    } else {
      let partner: any;
      await mongoose.connection.transaction(async (session) => {
        const [operator] = await M.Operator.create(
          [
            {
              company: "AIBUS isolated sandbox",
              email: "sandbox@example.invalid",
              status: "approved",
              publicSandboxInventory: true,
            },
          ],
          { session },
        );
        const [bus] = await M.Bus.create(
          [
            {
              operatorId: operator._id,
              name: "Sandbox Sleeper",
              registration: "SB" + randomBytes(5).toString("hex").toUpperCase(),
              type: "AC Sleeper",
              capacity: 4,
            },
          ],
          { session },
        );
        const [route] = await M.Route.create(
          [
            {
              operatorId: operator._id,
              source: "Pune",
              destination: "Mumbai",
              boarding: [{ name: "Wakad" }],
              dropping: [{ name: "Dadar" }],
              departure: "20:00",
              arrival: "23:00",
              durationMinutes: 180,
            },
          ],
          { session },
        );
        [partner] = await P.ApiPartner.create(
          [
            {
              publicId: "partner_aibus_sandbox_demo",
              name: "Sandbox partner",
              scopes: [...publicScopes],
            },
          ],
          { session },
        );
        await M.PricingPolicy.create(
          [
            {
              operatorId: operator._id,
              taxBasisPoints: 0,
              chargePaise: 0,
              chargesTaxable: false,
              operatorDiscountMaxPaise: 0,
              requireAge: false,
              requireGender: false,
              requireMobile: false,
              gstEnabled: false,
              version: 1,
            },
          ],
          { session },
        );
        await M.Policy.create(
          [
            {
              operatorId: operator._id,
              rules: [{ hoursBefore: 0, refundPercent: 80 }],
            },
          ],
          { session },
        );
        await M.CancellationAccountingPolicy.create(
          [
            {
              operatorId: operator._id,
              enabled: true,
              refundBasis: "Discounted base fare",
              taxTreatment: "Proportional refund",
              chargeTreatment: "Non-refundable",
              commissionTreatment: "Reverse all",
            },
          ],
          { session },
        );
        const date = new Date(Date.now() + 7 * 86400000)
          .toISOString()
          .slice(0, 10);
        for (const [index, soldOut] of [false, true].entries()) {
          const [trip] = await M.Trip.create(
            [
              {
                operatorId: operator._id,
                routeId: route._id,
                busId: bus._id,
                journeyDate: date,
                departureAt: new Date(
                  `${date}T${index ? "23" : "20"}:00:00+05:30`,
                ),
                seats: ["L1", "L2", "L3", "U1"].map((number, column) => ({
                  number,
                  row: 0,
                  column,
                  deck: number === "U1" ? "upper" : "lower",
                  category: "sleeper",
                  farePaise: 100000,
                  state: soldOut ? "blocked" : "available",
                })),
              },
            ],
            { session },
          );
          await P.PartnerInventoryGrant.create(
            [
              {
                partnerId: partner._id,
                operatorId: operator._id,
                kind: "Trip",
                targetId: trip._id,
                expiresAt: new Date(Date.now() + 30 * 86400000),
              },
            ],
            { session },
          );
        }
        await M.Audit.create(
          [
            {
              action: "public.sandbox.fixture",
              resourceId: String(partner._id),
              metadata: {
                reason: "Explicit isolated sandbox creation; no live inventory",
              },
              expiresAt: null,
            },
          ],
          { session },
        );
      });
      console.log(
        JSON.stringify({
          partner: partner.publicId,
          ...(await generateCredential(
            config,
            String(partner._id),
            [...publicScopes],
            new Date(Date.now() + 7 * 86400000),
          )),
          warning:
            "ONE-TIME sandbox credential. Store server-side; never place in frontend or commit.",
        }),
      );
    }
  } else if (command === "--revoke-credential") {
    const credential = await P.ApiCredential.findOneAndUpdate(
      { publicId: args[1], revokedAt: null },
      { $set: { revokedAt: new Date() }, $inc: { version: 1 } },
      { new: true },
    );
    if (!credential) throw Error("Active credential not found");
    await M.Audit.create({
      action: "public.credential.revoked",
      resourceId: String(credential._id),
      metadata: { reason: "Trusted sandbox CLI revocation" },
      expiresAt: null,
    });
    console.log(JSON.stringify({ revoked: true }));
  } else {
    const partner = await P.ApiPartner.findOne({
      publicId: args[1],
      status: "Active",
    });
    if (!partner) throw Error("Active sandbox partner not found");
    if (command === "--issue-credential")
      console.log(
        JSON.stringify(
          await generateCredential(
            config,
            String(partner._id),
            partner.scopes,
            new Date(Date.now() + 7 * 86400000),
          ),
        ),
      );
    else if (command === "--grant-trip") {
      const operatorId = z
          .string()
          .regex(/^[a-f\d]{24}$/i)
          .parse(args[2]),
        tripId = z
          .string()
          .regex(/^[a-f\d]{24}$/i)
          .parse(args[3]),
        reason = z.string().min(5).max(240).parse(args[4]);
      if (
        !(await M.Operator.exists({
          _id: operatorId,
          status: "approved",
          publicSandboxInventory: true,
        })) ||
        !(await M.Trip.exists({
          _id: tripId,
          operatorId,
          inventoryOwner: "internal",
        }))
      )
        throw Error(
          "Grant target must be an explicitly isolated sandbox operator's internal trip",
        );
      await P.PartnerInventoryGrant.findOneAndUpdate(
        { partnerId: partner._id, operatorId, kind: "Trip", targetId: tripId },
        {
          $set: {
            active: true,
            expiresAt: new Date(Date.now() + 30 * 86400000),
          },
        },
        { upsert: true },
      );
      await M.Audit.create({
        action: "public.inventory.granted",
        operatorId,
        resourceId: tripId,
        metadata: { reason, partner: partner.publicId },
        expiresAt: null,
      });
      console.log(JSON.stringify({ granted: true }));
    } else {
      const target = webhookTarget(config, args[2]),
        reason = z.string().min(5).max(240).parse(args[3]);
      const existing = await P.PartnerWebhookSubscription.findOne({
        partnerId: partner._id,
        url: target.toString(),
      }).lean();
      if (existing)
        throw Error(
          "Subscription already exists; its signing secret is not reprinted. Use controlled server-side key recovery/rotation.",
        );
      if (!config.PUBLIC_WEBHOOK_SIGNING_KEY)
        throw Error("Configure dedicated sandbox webhook signing first");
      const sub = await P.PartnerWebhookSubscription.findOneAndUpdate(
        { partnerId: partner._id, url: target.toString() },
        { $setOnInsert: { publicId: publicId("sub") }, $set: { active: true } },
        { upsert: true, new: true },
      );
      await M.Audit.create({
        action: "public.webhook.configured",
        resourceId: String(sub!._id),
        metadata: { reason },
        expiresAt: null,
      });
      console.log(
        JSON.stringify({
          subscriptionId: sub!.publicId,
          signingSecret: webhookSecret(
            config,
            String(partner._id),
            sub!.publicId,
          ),
          warning: "One-time trusted CLI output; server-side only",
        }),
      );
    }
  }
} finally {
  await mongoose.disconnect();
}
