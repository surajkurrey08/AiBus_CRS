import mongoose, { type ClientSession } from "mongoose";
import { createHash, randomUUID } from "node:crypto";
import * as M from "../models/index.js";
import { fail, type Principal } from "../utils/core.js";
import { authorizeAgent } from "./agent.service.js";
import {
  paise,
  safeMoney,
  postJournalInTransaction,
  type AccountSpec,
} from "./ledger.service.js";
import { applyVerifiedPayment } from "./inventory.service.js";
import type { Config } from "../config/env.js";

export async function financeTransaction<T>(
  work: (session: ClientSession) => Promise<T>,
): Promise<T> {
  for (const model of [
    M.AgentWallet,
    M.CreditFacility,
    M.FinancePolicy,
    M.WalletFundingIntent,
    M.WalletReservation,
    M.CreditLimitHistory,
    M.TestFundingEvidence,
  ]) {
    let installed: any[];
    try {
      installed = await model.collection.listIndexes().toArray();
    } catch {
      fail(
        503,
        "AGENCY_FINANCE_NOT_READY",
        "Review and provision versioned agency finance indexes first",
      );
    }
    for (const [keys, options] of model.schema.indexes())
      if (
        options.unique &&
        !installed!.some(
          (i) =>
            i.unique &&
            !i.partialFilterExpression &&
            !i.sparse &&
            JSON.stringify(i.key) === JSON.stringify(keys),
        )
      )
        fail(
          503,
          "AGENCY_FINANCE_NOT_READY",
          "Required agency finance unique index is missing",
        );
  }
  for (let attempt = 0; ; attempt++) {
    try {
      let result!: T;
      await mongoose.connection.transaction(
        async (session) => {
          result = await work(session);
        },
        { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
      );
      return result;
    } catch (e) {
      if ((e as any).code !== 11000 || attempt >= 3) throw e;
    }
  }
}
export function testFinance(config: Config) {
  if (!config.FINANCE_TEST_MODE || config.NODE_ENV === "production")
    fail(
      503,
      "FINANCE_DISABLED",
      "Live funding and credit are disabled. Explicit isolated finance test mode is required.",
    );
}
export async function agencyFinanceScope(
  auth: Principal,
  agentId?: string,
  write = false,
  session?: ClientSession,
): Promise<{ operatorId: string; agentId: string }> {
  if (!auth.operatorId)
    fail(403, "OPERATOR_CONTEXT_REQUIRED", "Use an operator-owned account");
  if (auth.agentId || auth.role === "agent") {
    if (agentId && agentId !== auth.agentId)
      fail(404, "NOT_FOUND", "Agency not found");
    await authorizeAgent(auth, "wallet", session);
    return { operatorId: auth.operatorId!, agentId: auth.agentId! };
  }
  if (!auth.permissions.includes(write ? "finance:manage" : "finance:read"))
    fail(403, "FORBIDDEN", "Authorized operator finance access is required");
  if (
    !agentId ||
    !(await M.SalesPartner.exists({
      _id: agentId,
      operatorId: auth.operatorId,
      kind: "Agent",
    }).session(session || null))
  )
    fail(404, "NOT_FOUND", "Agency not found");
  return { operatorId: auth.operatorId!, agentId: agentId! };
}
export async function financeAudit(
  auth: Principal,
  action: string,
  resourceId: string,
  session: ClientSession,
  metadata: Record<string, unknown> = {},
) {
  await M.Audit.create(
    [
      {
        operatorId: auth.operatorId,
        actorId: auth.userId,
        action,
        resourceId,
        metadata,
        expiresAt: null,
      },
    ],
    { session },
  );
}
export async function financePolicy(
  operatorId: string,
  session?: ClientSession,
  lock = false,
) {
  const policy: any = lock
    ? await M.FinancePolicy.findOneAndUpdate(
        { operatorId },
        { $inc: { __v: 1 } },
        { new: true, session },
      ).lean()
    : await M.FinancePolicy.findOne({ operatorId })
        .session(session || null)
        .lean();
  return (
    policy || {
      walletEnabled: false,
      creditEnabled: false,
      testOperationsEnabled: false,
      custodyOwner: "Unconfigured",
      version: 0,
    }
  );
}
export async function requirePolicy(
  config: Config,
  operatorId: string,
  session: ClientSession,
  mode?: "wallet" | "credit",
) {
  testFinance(config);
  const policy = await financePolicy(operatorId, session, true);
  if (
    !policy.testOperationsEnabled ||
    policy.custodyOwner !== "Operator" ||
    (mode && !policy[mode === "wallet" ? "walletEnabled" : "creditEnabled"])
  )
    fail(
      409,
      "FINANCE_POLICY_REQUIRED",
      "Configure and explicitly enable the operator test custody and funding policy",
    );
  return policy;
}
export async function configureFinancePolicy(
  auth: Principal,
  input: {
    walletEnabled: boolean;
    creditEnabled: boolean;
    testOperationsEnabled: boolean;
    custodyOwner: "Operator" | "Unconfigured";
    version: number;
    reason: string;
  },
) {
  if (
    !auth.operatorId ||
    !auth.permissions.includes("finance:manage") ||
    auth.agentId
  )
    fail(403, "FORBIDDEN", "Operator finance management required");
  if (
    (input.walletEnabled ||
      input.creditEnabled ||
      input.testOperationsEnabled) &&
    input.custodyOwner !== "Operator"
  )
    fail(400, "CUSTODY_REQUIRED", "Explicit operator test custody is required");
  return financeTransaction(async (session) => {
    const previous = await financePolicy(auth.operatorId!, session);
    if (input.version !== previous.version)
      fail(
        409,
        "POLICY_CONFLICT",
        "Finance policy changed; reload before saving",
      );
    const { reason, version, ...value } = input;
    const result = await M.FinancePolicy.findOneAndUpdate(
      { operatorId: auth.operatorId, ...(version ? { version } : {}) },
      { $set: { ...value, updatedBy: auth.userId }, $inc: { version: 1 } },
      { upsert: version === 0, new: true, session, setDefaultsOnInsert: false },
    );
    if (!result) fail(409, "POLICY_CONFLICT", "Finance policy changed");
    await financeAudit(auth, "finance.policy", String(result!._id), session, {
      reason,
      previousVersion: version,
    });
    return result;
  });
}
export async function ledgerBalance(
  operatorId: string,
  agentId: string,
  code: string,
  session?: ClientSession,
) {
  const account: any = await M.LedgerAccount.findOne({
    operatorId,
    ownerType: "Agent",
    ownerId: agentId,
    code,
    currency: "INR",
  })
    .session(session || null)
    .lean();
  if (!account) return { amountPaise: 0, accountId: null };
  const projection: any = await M.AccountBalanceProjection.findOne({
    operatorId,
    accountId: account._id,
    currency: "INR",
  })
    .session(session || null)
    .lean();
  if (!projection)
    fail(
      409,
      "LEDGER_INCONSISTENT",
      "Account projection is missing; finance review required",
    );
  const value =
    code === "agency-credit-receivable"
      ? paise(projection.debitPaise) - paise(projection.creditPaise)
      : paise(projection.creditPaise) - paise(projection.debitPaise);
  return { amountPaise: safeMoney(value), accountId: account._id };
}
export async function walletView(auth: Principal, agentId?: string) {
  return financeTransaction(async (session) => {
    const scope = await agencyFinanceScope(auth, agentId, false, session);
    const wallet: any = await M.AgentWallet.findOne(scope)
      .session(session)
      .lean();
    const credit: any = await M.CreditFacility.findOne(scope)
      .session(session)
      .lean();
    const cash = await ledgerBalance(
      scope.operatorId,
      scope.agentId,
      "agency-prepaid",
      session,
    );
    const exposure = await ledgerBalance(
      scope.operatorId,
      scope.agentId,
      "agency-credit-receivable",
      session,
    );
    const reserved = wallet?.reservedPaise || 0,
      creditReserved = credit?.reservedPaise || 0;
    return {
      ...scope,
      currency: "INR",
      wallet,
      credit,
      ledgerAccountId: cash.accountId,
      postedPaise: cash.amountPaise,
      reservedPaise: reserved,
      availablePaise: safeMoney(paise(cash.amountPaise) - paise(reserved)),
      creditLimitPaise: credit?.limitPaise || 0,
      creditReservedPaise: creditReserved,
      creditOutstandingPaise: exposure.amountPaise,
      creditAvailablePaise: safeMoney(
        paise(credit?.limitPaise || 0) -
          paise(creditReserved) -
          paise(exposure.amountPaise),
      ),
      policy: await financePolicy(scope.operatorId, session),
      liveFundingAvailable: false,
      commissionTransferAvailable: false,
    };
  });
}
export async function walletOverview(auth: Principal) {
  if (
    !auth.operatorId ||
    auth.agentId ||
    !auth.permissions.includes("finance:read")
  )
    fail(403, "FORBIDDEN", "Operator finance reporting required");
  return financeTransaction(async (session) => {
    const accounts = await M.LedgerAccount.find({
      operatorId: auth.operatorId,
      ownerType: "Agent",
      code: { $in: ["agency-prepaid", "agency-credit-receivable"] },
    })
      .session(session)
      .lean();
    let prepaid = 0n,
      exposure = 0n,
      reserved = 0n,
      creditReserved = 0n,
      limits = 0n;
    for (const account of accounts) {
      const value: any = await M.AccountBalanceProjection.findOne({
        accountId: account._id,
        operatorId: auth.operatorId,
      })
        .session(session)
        .lean();
      if (!value) fail(409, "LEDGER_INCONSISTENT", "Missing agency projection");
      if (account.code === "agency-prepaid")
        prepaid += paise(value.creditPaise) - paise(value.debitPaise);
      else exposure += paise(value.debitPaise) - paise(value.creditPaise);
    }
    const wallets = await M.AgentWallet.find({ operatorId: auth.operatorId })
      .session(session)
      .lean();
    for (const wallet of wallets) reserved += paise(wallet.reservedPaise);
    for (const credit of await M.CreditFacility.find({
      operatorId: auth.operatorId,
    })
      .session(session)
      .lean()) {
      limits += paise(credit.limitPaise);
      creditReserved += paise(credit.reservedPaise);
    }
    return {
      currency: "INR",
      walletCount: wallets.length,
      prepaidLiabilityPaise: safeMoney(prepaid),
      reservedPrepaidPaise: safeMoney(reserved),
      creditExposurePaise: safeMoney(exposure),
      reservedCreditPaise: safeMoney(creditReserved),
      recordedCreditLimitsPaise: safeMoney(limits),
      liveFunds: false,
    };
  });
}
export async function createWallet(auth: Principal, agentId: string) {
  return financeTransaction(async (session) => {
    const scope = await agencyFinanceScope(auth, agentId, true, session);
    if (auth.agentId)
      fail(403, "FORBIDDEN", "Only the operator can create a wallet");
    const prior = await M.AgentWallet.findOne(scope).session(session).lean();
    if (prior) return prior;
    const [wallet] = await M.AgentWallet.create(
      [{ ...scope, createdBy: auth.userId }],
      { session },
    );
    await financeAudit(auth, "wallet.create", String(wallet._id), session);
    return wallet;
  });
}
export async function setWalletStatus(
  auth: Principal,
  agentId: string,
  status: "Active" | "Suspended",
  reason: string,
) {
  return financeTransaction(async (session) => {
    const scope = await agencyFinanceScope(auth, agentId, true, session);
    if (auth.agentId) fail(403, "FORBIDDEN", "Operator management required");
    const wallet = await M.AgentWallet.findOneAndUpdate(
      scope,
      { $set: { status }, $inc: { revision: 1 } },
      { session, new: true },
    );
    if (!wallet) fail(404, "NOT_FOUND", "Wallet not found");
    await financeAudit(auth, "wallet.status", String(wallet!._id), session, {
      status,
      reason,
    });
    return wallet;
  });
}
export async function configureCredit(
  auth: Principal,
  agentId: string,
  limitPaise: number,
  status: "Active" | "Suspended",
  key: string,
  reason: string,
) {
  paise(limitPaise);
  return financeTransaction(async (session) => {
    const scope = await agencyFinanceScope(auth, agentId, true, session);
    if (auth.agentId)
      fail(403, "FORBIDDEN", "Only the operator authorizes credit");
    const prior: any = await M.CreditLimitHistory.findOne({ ...scope, key })
      .session(session)
      .lean();
    if (prior) {
      if (
        prior.afterPaise !== limitPaise ||
        prior.afterStatus !== status ||
        prior.reason !== reason
      )
        fail(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Credit request key has different content",
        );
      return prior;
    }
    const facility: any = await M.CreditFacility.findOne(scope)
      .session(session)
      .lean();
    const outstanding = await ledgerBalance(
      scope.operatorId,
      scope.agentId,
      "agency-credit-receivable",
      session,
    );
    if (
      paise(limitPaise) <
      paise(outstanding.amountPaise) + paise(facility?.reservedPaise || 0)
    )
      fail(
        409,
        "CREDIT_IN_USE",
        "Limit cannot be lower than outstanding and reserved exposure",
      );
    const result = await M.CreditFacility.findOneAndUpdate(
      scope,
      { $set: { limitPaise, status }, $inc: { revision: 1 } },
      { session, new: true, upsert: true },
    );
    await M.CreditLimitHistory.create(
      [
        {
          ...scope,
          key,
          beforePaise: facility?.limitPaise || 0,
          afterPaise: limitPaise,
          beforeStatus: facility?.status || "Unconfigured",
          afterStatus: status,
          reason,
          actorId: auth.userId,
        },
      ],
      { session },
    );
    await financeAudit(auth, "credit.configure", String(result!._id), session, {
      reason,
      limitPaise,
      status,
    });
    return result;
  });
}
export async function requestFunding(
  auth: Principal,
  agentId: string | undefined,
  amountPaise: number,
  purpose: "Wallet" | "Credit repayment",
  key: string,
) {
  if (paise(amountPaise) <= 0n)
    fail(400, "INVALID_MONEY", "Positive funding amount required");
  const hash = createHash("sha256")
    .update(JSON.stringify({ amountPaise, purpose }))
    .digest("hex");
  return financeTransaction(async (session) => {
    const scope = await agencyFinanceScope(
      auth,
      agentId,
      !auth.agentId,
      session,
    );
    const prior: any = await M.WalletFundingIntent.findOne({ ...scope, key })
      .session(session)
      .lean();
    if (prior) {
      if (prior.requestHash !== hash)
        fail(409, "IDEMPOTENCY_CONFLICT", "Funding key has different content");
      return prior;
    }
    if (!(await M.AgentWallet.exists(scope).session(session)))
      fail(409, "WALLET_REQUIRED", "Operator must create the wallet first");
    const [intent] = await M.WalletFundingIntent.create(
      [
        {
          ...scope,
          purpose,
          amountPaise,
          key,
          requestHash: hash,
          requestedBy: auth.userId,
        },
      ],
      { session },
    );
    await financeAudit(auth, "funding.request", String(intent._id), session);
    return intent;
  });
}
export async function reviewFunding(
  config: Config,
  auth: Principal,
  agentId: string,
  intentId: string,
  action: "Verify test evidence" | "Confirm" | "Reject",
  reason: string,
) {
  return financeTransaction(async (session) => {
    const scope = await agencyFinanceScope(auth, agentId, true, session);
    if (auth.agentId)
      fail(403, "FORBIDDEN", "Operator finance review required");
    const intent: any = await M.WalletFundingIntent.findOne({
      _id: intentId,
      ...scope,
    }).session(session);
    if (!intent) fail(404, "NOT_FOUND", "Funding intent not found");
    if (intent.status === "Posted" || intent.status === "Rejected") {
      if ((intent.status === "Rejected") !== (action === "Reject"))
        fail(409, "FUNDING_CLOSED", "Funding review already completed");
      return intent;
    }
    if (action === "Reject") {
      intent.status = "Rejected";
      intent.reason = reason;
    } else {
      await requirePolicy(
        config,
        scope.operatorId,
        session,
        intent.purpose === "Wallet" ? "wallet" : "credit",
      );
      const wallet = await M.AgentWallet.findOneAndUpdate(
        { ...scope, status: "Active" },
        { $inc: { revision: 1 } },
        { session, new: true },
      );
      if (!wallet)
        fail(409, "WALLET_SUSPENDED", "An active wallet is required");
      if (action === "Verify test evidence") {
        if (intent.status === "Verified") return intent;
        const [evidence] = await M.TestFundingEvidence.create(
          [
            {
              ...scope,
              resourceId: intent._id,
              amountPaise: intent.amountPaise,
              provider: "aibus-test",
              status: "succeeded",
              reference: `test_${randomUUID()}`,
              verifiedAt: new Date(),
            },
          ],
          { session },
        );
        intent.testEvidenceId = evidence._id;
        intent.status = "Verified";
      } else {
        if (intent.status !== "Verified")
          fail(
            409,
            "EVIDENCE_REQUIRED",
            "Verify server test-provider evidence before posting",
          );
        const evidence: any = await M.TestFundingEvidence.findOne({
          _id: intent.testEvidenceId,
          resourceId: intent._id,
          ...scope,
          provider: "aibus-test",
          status: "succeeded",
        })
          .session(session)
          .lean();
        if (!evidence || evidence.amountPaise !== intent.amountPaise)
          fail(
            409,
            "EVIDENCE_INVALID",
            "Funding evidence does not match the intent",
          );
        const repayment = intent.purpose === "Credit repayment";
        if (repayment) {
          const facility = await M.CreditFacility.findOneAndUpdate(
            scope,
            { $inc: { revision: 1 } },
            { session },
          );
          if (!facility)
            fail(409, "CREDIT_REQUIRED", "Credit facility not found");
          const outstanding = await ledgerBalance(
            scope.operatorId,
            scope.agentId,
            "agency-credit-receivable",
            session,
          );
          if (intent.amountPaise > outstanding.amountPaise)
            fail(
              409,
              "REPAYMENT_EXCESS",
              "Repayment exceeds actual outstanding credit",
            );
        }
        const journal = await postJournalInTransaction(
          {
            operatorId: scope.operatorId,
            idempotencyKey: `funding:${intent._id}`,
            currency: "INR",
            kind: repayment ? "Credit repayment" : "Wallet funding",
            reason: repayment
              ? "Verified isolated test credit repayment; not bank cash"
              : "Verified isolated test prepaid funding; operator custody liability",
            actorId: auth.userId,
            sourceEventId: String(evidence._id),
            lines: [
              {
                account: {
                  ownerType: "Operator",
                  ownerId: scope.operatorId,
                  code: "test-funds-clearing",
                },
                debitPaise: intent.amountPaise,
                creditPaise: 0,
              },
              {
                account: {
                  ownerType: "Agent",
                  ownerId: scope.agentId,
                  code: repayment
                    ? "agency-credit-receivable"
                    : "agency-prepaid",
                },
                debitPaise: 0,
                creditPaise: intent.amountPaise,
              },
            ],
          },
          session,
        );
        intent.status = "Posted";
        intent.journalId = journal._id;
      }
    }
    intent.reviewedBy = auth.userId;
    await intent.save({ session });
    await financeAudit(auth, "funding.review", intentId, session, {
      action,
      reason,
      testOnly: action !== "Reject",
    });
    return intent;
  });
}
export async function reserveBookingFunds(
  config: Config,
  auth: Principal,
  bookingId: string,
  mode: "wallet" | "credit",
  key: string,
) {
  return financeTransaction(async (session) => {
    const scope = await agencyFinanceScope(auth, undefined, false, session);
    if (!auth.agentId)
      fail(403, "AGENT_REQUIRED", "Agency membership required");
    await authorizeAgent(auth, "book", session);
    if (mode === "credit") await authorizeAgent(auth, "credit", session);
    const existing: any = await M.WalletReservation.findOne({
      ...scope,
      $or: [{ bookingId }, { key }],
    })
      .session(session)
      .lean();
    if (existing) {
      if (
        String(existing.bookingId) !== bookingId ||
        existing.key !== key ||
        existing.mode !== mode ||
        String(existing.userId) !== auth.userId
      )
        fail(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Funding reservation key or booking is already used",
        );
      return existing;
    }
    const policy = await requirePolicy(config, scope.operatorId, session, mode);
    const booking: any = await M.Booking.findOneAndUpdate(
      {
        _id: bookingId,
        ...scope,
        userId: auth.userId,
        status: "Pending payment",
        paymentStatus: "Pending",
        fundingMethod: { $exists: false },
      },
      { $set: { fundingMethod: mode } },
      { session, new: true },
    ).lean();
    if (!booking)
      fail(
        409,
        "FUNDING_CONFLICT",
        "Booking is unavailable or already selected a funding method",
      );
    if (
      await M.PaymentOrder.exists({
        bookingId,
        operatorId: scope.operatorId,
      }).session(session)
    )
      fail(
        409,
        "MIXED_FUNDING_UNSUPPORTED",
        "Gateway checkout already started",
      );
    const hold: any = await M.Hold.findOne({
      operatorId: scope.operatorId,
      holdId: booking.holdId,
      userId: auth.userId,
      status: "consumed",
      expiresAt: { $gt: new Date() },
    })
      .session(session)
      .lean();
    if (!hold) fail(409, "HOLD_EXPIRED", "Seat hold has expired");
    const wallet: any = await M.AgentWallet.findOneAndUpdate(
      { ...scope, status: "Active" },
      { $inc: { revision: 1 } },
      { session, new: true },
    ).lean();
    if (!wallet) fail(409, "WALLET_SUSPENDED", "An active wallet is required");
    const amount = safeMoney(paise(booking.totalPaise));
    if (mode === "wallet") {
      const posted = await ledgerBalance(
        scope.operatorId,
        scope.agentId,
        "agency-prepaid",
        session,
      );
      if (
        paise(posted.amountPaise) - paise(wallet.reservedPaise) <
        paise(amount)
      )
        fail(
          409,
          "INSUFFICIENT_FUNDS",
          "Available prepaid funds are insufficient",
        );
      await M.AgentWallet.updateOne(
        { _id: wallet._id, revision: wallet.revision },
        {
          $set: {
            reservedPaise: safeMoney(
              paise(wallet.reservedPaise) + paise(amount),
            ),
          },
        },
        { session },
      );
    } else {
      const facility: any = await M.CreditFacility.findOneAndUpdate(
        { ...scope, status: "Active" },
        { $inc: { revision: 1 } },
        { session, new: true },
      ).lean();
      if (!facility)
        fail(409, "CREDIT_SUSPENDED", "Active authorized credit required");
      const exposure = await ledgerBalance(
        scope.operatorId,
        scope.agentId,
        "agency-credit-receivable",
        session,
      );
      if (
        paise(facility.limitPaise) -
          paise(facility.reservedPaise) -
          paise(exposure.amountPaise) <
        paise(amount)
      )
        fail(
          409,
          "CREDIT_EXCEEDED",
          "Available authorized credit is insufficient",
        );
      await M.CreditFacility.updateOne(
        { _id: facility._id, revision: facility.revision },
        {
          $set: {
            reservedPaise: safeMoney(
              paise(facility.reservedPaise) + paise(amount),
            ),
          },
        },
        { session },
      );
    }
    const [reservation] = await M.WalletReservation.create(
      [
        {
          ...scope,
          bookingId,
          userId: auth.userId,
          amountPaise: amount,
          mode,
          key,
          expiresAt: hold.expiresAt,
          policyVersion: policy.version,
        },
      ],
      { session },
    );
    await financeAudit(
      auth,
      "wallet.reserve",
      String(reservation._id),
      session,
      { mode, amountPaise: amount },
    );
    return reservation;
  });
}
export async function confirmFundedBooking(
  config: Config,
  auth: Principal,
  reservationId: string,
) {
  return financeTransaction(async (session) => {
    const scope = await agencyFinanceScope(auth, undefined, false, session);
    const reservation: any = await M.WalletReservation.findOne({
      _id: reservationId,
      ...scope,
      userId: auth.userId,
    }).session(session);
    if (!reservation) fail(404, "NOT_FOUND", "Funding reservation not found");
    if (reservation.status === "Consumed")
      return M.Booking.findOne({ _id: reservation.bookingId, ...scope })
        .session(session)
        .lean();
    if (
      reservation.status !== "Reserved" ||
      reservation.expiresAt <= new Date()
    )
      fail(
        409,
        "FUNDING_EXPIRED",
        "Funding reservation expired; no debit was posted",
      );
    await requirePolicy(config, scope.operatorId, session, reservation.mode);
    await authorizeAgent(auth, "book", session);
    if (reservation.mode === "credit")
      await authorizeAgent(auth, "credit", session);
    const wallet: any = await M.AgentWallet.findOneAndUpdate(
      { ...scope, status: "Active" },
      { $inc: { revision: 1 } },
      { session, new: true },
    ).lean();
    if (!wallet) fail(409, "WALLET_SUSPENDED", "Wallet is suspended");
    const holder: any =
      reservation.mode === "wallet"
        ? wallet
        : await M.CreditFacility.findOneAndUpdate(
            { ...scope, status: "Active" },
            { $inc: { revision: 1 } },
            { session, new: true },
          ).lean();
    if (!holder || holder.reservedPaise < reservation.amountPaise)
      fail(
        409,
        "FUNDING_INCONSISTENT",
        "Funding reservation requires finance review",
      );
    await applyVerifiedPayment(
      {
        verified: true,
        providerId: `agency-${reservation.mode}`,
        externalId: String(reservation._id),
        eventId: `consume:${reservation._id}`,
        operatorId: scope.operatorId,
        bookingId: String(reservation.bookingId),
        amountPaise: reservation.amountPaise,
        currency: "INR",
        status: "captured",
      },
      0,
      {
        session,
        debitAccount: {
          ownerType: "Agent",
          ownerId: scope.agentId,
          code:
            reservation.mode === "wallet"
              ? "agency-prepaid"
              : "agency-credit-receivable",
        },
      },
    );
    const model =
      reservation.mode === "wallet" ? M.AgentWallet : M.CreditFacility;
    await model.updateOne(
      { _id: holder._id },
      {
        $set: {
          reservedPaise: safeMoney(
            paise(holder.reservedPaise) - paise(reservation.amountPaise),
          ),
        },
      },
      { session },
    );
    reservation.status = "Consumed";
    await reservation.save({ session });
    await financeAudit(auth, "wallet.consume", reservationId, session, {
      mode: reservation.mode,
    });
    return M.Booking.findOne({ _id: reservation.bookingId, ...scope })
      .session(session)
      .lean();
  });
}
export async function releaseFundingReservation(
  reservationId: string,
  auth?: Principal,
) {
  return financeTransaction(async (session) => {
    let scope: Record<string, unknown> = {};
    if (auth) {
      scope = await agencyFinanceScope(auth, undefined, false, session);
      scope.userId = auth.userId;
    }
    const reservation: any = await M.WalletReservation.findOne({
      _id: reservationId,
      ...scope,
    }).session(session);
    if (!reservation) fail(404, "NOT_FOUND", "Funding reservation not found");
    if (reservation.status !== "Reserved") return reservation;
    if (!auth && reservation.expiresAt > new Date()) return reservation;
    const model =
      reservation.mode === "wallet" ? M.AgentWallet : M.CreditFacility;
    const holder: any = await model
      .findOneAndUpdate(
        { operatorId: reservation.operatorId, agentId: reservation.agentId },
        { $inc: { revision: 1 } },
        { session, new: true },
      )
      .lean();
    if (!holder || holder.reservedPaise < reservation.amountPaise)
      fail(
        409,
        "FUNDING_INCONSISTENT",
        "Reserved projection requires finance review",
      );
    await model.updateOne(
      { _id: holder._id },
      {
        $set: {
          reservedPaise: safeMoney(
            paise(holder.reservedPaise) - paise(reservation.amountPaise),
          ),
        },
      },
      { session },
    );
    reservation.status = auth ? "Released" : "Expired";
    await reservation.save({ session });
    await M.Audit.create(
      [
        {
          operatorId: reservation.operatorId,
          actorId: auth?.userId,
          action: "wallet.release",
          resourceId: reservationId,
          metadata: { status: reservation.status },
          expiresAt: null,
        },
      ],
      { session },
    );
    return reservation;
  });
}
export async function expireFundingReservations() {
  const expired = await M.WalletReservation.find({
    status: "Reserved",
    expiresAt: { $lte: new Date() },
  })
    .select("_id")
    .limit(100)
    .lean();
  for (const reservation of expired)
    await releaseFundingReservation(String(reservation._id));
}
