import mongoose from "mongoose";
import type { Config } from "../config/env.js";
import * as M from "../models/index.js";
import * as P from "../models/public-api.model.js";
import {
  sandboxReady,
  publicIndexesReady,
  publicScopes,
} from "./public-auth.service.js";
import { grantFilter } from "./public-inventory.service.js";

/** Read-only readiness evidence. Never issues credentials, creates IDs or repairs indexes. */
export async function inspectPublicReadiness(
  config: Config,
  partnerIds: string[],
) {
  const checks: { name: string; ready: boolean }[] = [];
  const check = (name: string, ready: boolean) => checks.push({ name, ready });
  try {
    sandboxReady(config);
    check("isolated-sandbox", true);
  } catch {
    return {
      ready: false,
      readOnly: true,
      checks: [{ name: "isolated-sandbox", ready: false }],
      partners: [],
    };
  }
  check(
    "razorpay-test-mode",
    config.FINANCE_TEST_MODE &&
      !!config.RAZORPAY_KEY_ID?.startsWith("rzp_test_") &&
      !!config.RAZORPAY_KEY_SECRET,
  );
  const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
  check(
    "transaction-capable-mongodb",
    !!hello.setName || hello.msg === "isdbgrid",
  );
  try {
    await publicIndexesReady();
    check("public-unique-indexes", true);
  } catch {
    check("public-unique-indexes", false);
  }
  check(
    "two-distinct-app-partners-selected",
    partnerIds.length === 2 && new Set(partnerIds).size === 2,
  );
  const requiredScopes = publicScopes.filter((s) => s !== "webhooks:read");
  const partners = [];
  for (const publicId of [...new Set(partnerIds)]) {
    const partner = await P.ApiPartner.findOne({
      publicId,
      environment: "sandbox",
      status: "Active",
      onboardingStatus: "Approved",
    }).lean();
    let credentialsReady = false,
      sellableTrips = 0;
    const scopesReady =
      !!partner && requiredScopes.every((s) => partner.scopes.includes(s));
    if (partner && scopesReady) {
      const credential = await P.ApiCredential.findOne({
        partnerId: partner._id,
        environment: "sandbox",
        revokedAt: null,
        expiresAt: { $gt: new Date() },
        scopes: { $all: requiredScopes },
      })
        .select("_id")
        .lean();
      credentialsReady = !!credential;
      const filter = await grantFilter({
        partnerId: String(partner._id),
        credentialId: "readiness-only",
        publicId,
        scopes: requiredScopes,
        environment: "sandbox",
      });
      const counts = await M.Trip.aggregate([
        { $match: filter },
        {
          $match: {
            seats: {
              $elemMatch: {
                $or: [
                  { state: "available" },
                  { state: "held", holdUntil: { $lte: new Date() } },
                ],
              },
            },
          },
        },
        {
          $lookup: {
            from: M.Bus.collection.name,
            localField: "busId",
            foreignField: "_id",
            as: "bus",
          },
        },
        { $unwind: "$bus" },
        {
          $lookup: {
            from: M.Route.collection.name,
            localField: "routeId",
            foreignField: "_id",
            as: "route",
          },
        },
        { $unwind: "$route" },
        {
          $match: {
            "bus.status": "Active",
            "route.status": "Active",
            $expr: {
              $and: [
                { $eq: ["$bus.operatorId", "$operatorId"] },
                { $eq: ["$route.operatorId", "$operatorId"] },
              ],
            },
          },
        },
        { $count: "count" },
      ]);
      sellableTrips = counts[0]?.count || 0;
    }
    partners.push({
      publicId,
      approved: !!partner,
      scopesReady,
      credentialsReady,
      sellableTrips,
      ready: !!partner && scopesReady && credentialsReady && sellableTrips > 0,
    });
  }
  return {
    ready: checks.every((c) => c.ready) && partners.every((p) => p.ready),
    readOnly: true,
    checks,
    partners,
  };
}
