import mongoose, { type ClientSession } from "mongoose";
import { createHash } from "node:crypto";
import * as M from "../models/index.js";
import { fail } from "../utils/errors.js";

export type AccountSpec = {
  ownerType: "Platform" | "Operator" | "Agent" | "ApiPartner";
  ownerId: string;
  code: string;
};
export type JournalInput = {
  operatorId: string;
  idempotencyKey: string;
  currency: string;
  kind:
    | "Booking captured"
    | "Payment exception"
    | "Reversal"
    | "Wallet funding"
    | "Credit repayment"
    | "Cancellation adjustment"
    | "Refund"
    | "Exception refund"
    | "Settlement receipt"
    | "Settlement payout";
  reason: string;
  bookingId?: string;
  paymentId?: string;
  sourceEventId?: string;
  reversalOf?: string;
  actorId?: string;
  lines: { account: AccountSpec; debitPaise: number; creditPaise: number }[];
};
const chart: Record<string, { owner: string; type: string }> = {
  "counter-cash-clearing": { owner: "Operator", type: "Asset" },
  "simulated-bank-clearing": { owner: "Platform", type: "Asset" },
  "payment-clearing": { owner: "Platform", type: "Asset" },
  "payment-exceptions": { owner: "Platform", type: "Liability" },
  "operator-payable": { owner: "Operator", type: "Liability" },
  "agent-commission-payable": { owner: "Agent", type: "Liability" },
  "platform-commission": { owner: "Platform", type: "Revenue" },
  "test-funds-clearing": { owner: "Operator", type: "Asset" },
  "agency-prepaid": { owner: "Agent", type: "Liability" },
  "agency-credit-receivable": { owner: "Agent", type: "Asset" },
  "customer-refunds-payable": { owner: "Operator", type: "Liability" },
  "operator-cancellation-payable": { owner: "Operator", type: "Liability" },
};
export function paise(value: unknown): bigint {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    fail(
      400,
      "INVALID_MONEY",
      "Amounts must be non-negative safe integer paise",
    );
  return BigInt(value as number);
}
export function safeMoney(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER))
    fail(
      409,
      "LEDGER_OVERFLOW",
      "Financial amount exceeds the safe integer limit",
    );
  return Number(value);
}
function oid(value: string): string {
  if (!/^[a-f\d]{24}$/i.test(value))
    fail(400, "INVALID_ID", "Invalid financial identifier");
  return value.toLowerCase();
}
function normalize(input: JournalInput) {
  if (input.currency !== "INR")
    fail(400, "LEDGER_CURRENCY", "Only INR is supported");
  if (
    !input.idempotencyKey ||
    input.idempotencyKey.length > 200 ||
    !input.reason?.trim() ||
    input.reason.length > 240
  )
    fail(
      400,
      "LEDGER_INPUT",
      "An operation key and concise reason are required",
    );
  if (
    ![
      "Booking captured",
      "Payment exception",
      "Reversal",
      "Wallet funding",
      "Credit repayment",
      "Cancellation adjustment",
      "Refund",
      "Exception refund",
      "Settlement receipt",
      "Settlement payout",
    ].includes(input.kind) ||
    !Array.isArray(input.lines) ||
    input.lines.length < 2 ||
    input.lines.length > 100
  )
    fail(400, "LEDGER_INPUT", "Invalid journal kind or line count");
  const operatorId = oid(input.operatorId);
  let debit = 0n,
    credit = 0n;
  const seen = new Set<string>();
  const lines = input.lines
    .map((line) => {
      const d = paise(line.debitPaise),
        c = paise(line.creditPaise);
      if ((d === 0n) === (c === 0n))
        fail(
          400,
          "LEDGER_LINE",
          "Each line must have exactly one positive side",
        );
      const definition = chart[line.account.code];
      if (
        !definition ||
        definition.owner !== line.account.ownerType ||
        line.account.ownerType === "ApiPartner"
      )
        fail(
          400,
          "LEDGER_ACCOUNT",
          "Account is not enabled in the accounting chart",
        );
      const ownerId =
        line.account.ownerType === "Platform"
          ? line.account.ownerId
          : oid(line.account.ownerId);
      if (
        (line.account.ownerType === "Platform" && ownerId !== "aibus") ||
        (line.account.ownerType === "Operator" && ownerId !== operatorId)
      )
        fail(
          403,
          "LEDGER_OWNER",
          "Account owner does not match its operator partition",
        );
      const account = {
        ownerType: line.account.ownerType,
        ownerId,
        code: line.account.code,
      };
      const key = JSON.stringify(account);
      if (seen.has(key))
        fail(400, "LEDGER_LINE", "Consolidate duplicate account lines");
      seen.add(key);
      debit += d;
      credit += c;
      return { account, debitPaise: Number(d), creditPaise: Number(c) };
    })
    .sort((a, b) =>
      JSON.stringify(a.account).localeCompare(JSON.stringify(b.account)),
    );
  if (!debit || debit !== credit)
    fail(400, "LEDGER_UNBALANCED", "Journal debits and credits must balance");
  const normalized = {
    operatorId,
    currency: "INR",
    kind: input.kind,
    reason: input.reason.trim(),
    ...(input.bookingId ? { bookingId: oid(input.bookingId) } : {}),
    ...(input.paymentId ? { paymentId: oid(input.paymentId) } : {}),
    ...(input.sourceEventId ? { sourceEventId: input.sourceEventId } : {}),
    ...(input.reversalOf ? { reversalOf: oid(input.reversalOf) } : {}),
    accountingVersion: 1,
    lines,
    totalPaise: safeMoney(debit),
  };
  if ((input.kind === "Reversal") !== !!input.reversalOf)
    fail(
      400,
      "LEDGER_REVERSAL",
      "A reversal must reference its original journal",
    );
  return {
    normalized,
    hash: createHash("sha256").update(JSON.stringify(normalized)).digest("hex"),
  };
}
export function journalPayloadHash(input: JournalInput) {
  return normalize(input).hash;
}

export async function assertLedgerIndexesReady() {
  const requirements = [
    [
      M.LedgerAccount,
      [{ operatorId: 1, ownerType: 1, ownerId: 1, code: 1, currency: 1 }],
    ],
    [
      M.FinancialOperation,
      [{ operatorId: 1, idempotencyKey: 1 }, { journalId: 1 }],
    ],
    [M.JournalEntry, [{ operationId: 1 }, { reversalOf: 1 }, { paymentId: 1 }]],
    [M.AccountBalanceProjection, [{ accountId: 1 }]],
  ] as const;
  for (const [model, keys] of requirements) {
    let indexes;
    try {
      indexes = await model.collection.listIndexes().toArray();
    } catch {
      fail(
        503,
        "LEDGER_NOT_READY",
        "Ledger indexes must be reviewed and installed before capture processing",
      );
    }
    for (const key of keys) {
      const found = indexes!.find(
        (i) =>
          i.unique === true && JSON.stringify(i.key) === JSON.stringify(key),
      );
      if (
        !found ||
        ("reversalOf" in key &&
          (!found.sparse || found.partialFilterExpression)) ||
        ("paymentId" in key &&
          JSON.stringify(found.partialFilterExpression) !==
            JSON.stringify({
              paymentId: { $type: "objectId" },
              kind: { $in: ["Booking captured", "Payment exception"] },
            })) ||
        (!("reversalOf" in key) &&
          !("paymentId" in key) &&
          (found.sparse || found.partialFilterExpression))
      )
        fail(
          503,
          "LEDGER_NOT_READY",
          "Required unique ledger index is missing or incompatible",
        );
    }
  }
}

// Trusted server-internal primitive. No HTTP endpoint accepts posting instructions.
export async function postJournalInTransaction(
  input: JournalInput,
  session: ClientSession,
) {
  if (!session.inTransaction())
    fail(
      500,
      "LEDGER_TRANSACTION_REQUIRED",
      "Journal posting requires an active transaction",
    );
  // Metadata reads do not create indexes and do not share the data transaction.
  // Fail closed when production autoIndex=false has not been provisioned safely.
  await assertLedgerIndexesReady();
  const { normalized: n, hash } = normalize(input);
  const previous = await M.FinancialOperation.findOne({
    operatorId: n.operatorId,
    idempotencyKey: input.idempotencyKey,
  })
    .session(session)
    .lean();
  if (previous) {
    if (previous.payloadHash !== hash)
      fail(
        409,
        "LEDGER_IDEMPOTENCY_CONFLICT",
        "Operation key already has a different payload",
      );
    const existing = await M.JournalEntry.findOne({
      _id: previous.journalId,
      operationId: previous._id,
      operatorId: n.operatorId,
    })
      .session(session)
      .lean();
    if (!existing)
      fail(409, "LEDGER_INCONSISTENT", "Operation journal is missing");
    return existing!;
  }
  if (!(await M.Operator.exists({ _id: n.operatorId }).session(session)))
    fail(404, "LEDGER_OWNER", "Operator not found");
  if (
    n.bookingId &&
    !(await M.Booking.exists({
      _id: n.bookingId,
      operatorId: n.operatorId,
    }).session(session))
  )
    fail(404, "LEDGER_REFERENCE", "Booking not found in operator partition");
  if (
    n.paymentId &&
    !(await M.Payment.exists({
      _id: n.paymentId,
      operatorId: n.operatorId,
      ...(n.bookingId ? { bookingId: n.bookingId } : {}),
    }).session(session))
  )
    fail(404, "LEDGER_REFERENCE", "Payment not found in operator partition");
  const lines: { accountId: any; debitPaise: number; creditPaise: number }[] =
    [];
  for (const line of n.lines) {
    if (
      line.account.ownerType === "Agent" &&
      !(await M.SalesPartner.exists({
        _id: line.account.ownerId,
        operatorId: n.operatorId,
        kind: "Agent",
      }).session(session))
    )
      fail(403, "LEDGER_OWNER", "Agency does not belong to this operator");
    const identity = {
      operatorId: n.operatorId,
      ...line.account,
      currency: "INR",
    };
    let account: any = await M.LedgerAccount.findOne(identity)
      .session(session)
      .lean();
    if (!account)
      account = (
        await M.LedgerAccount.create(
          [{ ...identity, accountType: chart[line.account.code].type }],
          { session },
        )
      )[0].toObject();
    if (account!.accountType !== chart[line.account.code].type)
      fail(
        409,
        "LEDGER_INCONSISTENT",
        "Account type conflicts with accounting chart",
      );
    lines.push({
      accountId: account!._id,
      debitPaise: line.debitPaise,
      creditPaise: line.creditPaise,
    });
  }
  if (n.reversalOf) {
    const original = await M.JournalEntry.findOne({
      _id: n.reversalOf,
      operatorId: n.operatorId,
      kind: { $ne: "Reversal" },
    })
      .session(session)
      .lean();
    const sorted = (ls: any[]) =>
      ls.map((l) => `${l.accountId}:${l.debitPaise}:${l.creditPaise}`).sort();
    if (
      !original ||
      String(original.bookingId || "") !== (n.bookingId || "") ||
      String(original.paymentId || "") !== (n.paymentId || "") ||
      JSON.stringify(sorted(lines)) !==
        JSON.stringify(
          sorted(
            (original.lines as any[]).map((l) => ({
              accountId: l.accountId,
              debitPaise: l.creditPaise,
              creditPaise: l.debitPaise,
            })),
          ),
        )
    )
      fail(
        409,
        "LEDGER_REVERSAL",
        "Reversal must exactly invert its original journal and references",
      );
  }
  const operationId = new mongoose.Types.ObjectId(),
    journalId = new mongoose.Types.ObjectId();
  await M.FinancialOperation.create(
    [
      {
        _id: operationId,
        operatorId: n.operatorId,
        idempotencyKey: input.idempotencyKey,
        payloadHash: hash,
        journalId,
        actorId: input.actorId || "system",
      },
    ],
    { session },
  );
  const journal = (
    await M.JournalEntry.create(
      [{ ...n, lines, _id: journalId, operationId }],
      { session },
    )
  )[0];
  for (const line of lines) {
    const projection = await M.AccountBalanceProjection.findOne({
      accountId: line.accountId,
      operatorId: n.operatorId,
    })
      .session(session)
      .lean();
    if (projection) {
      const debitPaise = safeMoney(
        paise(projection.debitPaise) + paise(line.debitPaise),
      );
      const creditPaise = safeMoney(
        paise(projection.creditPaise) + paise(line.creditPaise),
      );
      const version = safeMoney(paise(projection.version) + 1n);
      const changed = await M.AccountBalanceProjection.updateOne(
        { _id: projection._id, version: projection.version },
        { $set: { debitPaise, creditPaise, version } },
        { session, runValidators: true },
      );
      if (changed.modifiedCount !== 1)
        fail(409, "LEDGER_CONCURRENT", "Balance changed concurrently");
    } else {
      if (
        await M.JournalEntry.exists({
          _id: { $ne: journalId },
          "lines.accountId": line.accountId,
        }).session(session)
      )
        fail(
          409,
          "LEDGER_INCONSISTENT",
          "An existing account projection is missing",
        );
      await M.AccountBalanceProjection.create(
        [
          {
            operatorId: n.operatorId,
            accountId: line.accountId,
            currency: "INR",
            debitPaise: line.debitPaise,
            creditPaise: line.creditPaise,
            version: 1,
          },
        ],
        { session },
      );
    }
  }
  await M.Audit.create(
    [
      {
        operatorId: n.operatorId,
        action: "ledger.posted",
        resource: "JournalEntry",
        resourceId: String(journalId),
        metadata: {
          operationId: String(operationId),
          kind: n.kind,
          actor: input.actorId || "system",
          reversalOf: n.reversalOf,
        },
        expiresAt: null,
      },
    ],
    { session },
  );
  return journal.toObject();
}

export async function postJournal(input: JournalInput) {
  // Snapshot caller input before yielding. Duplicate-index races abort, then retry
  // the whole transaction and re-check both the operation key and payload hash.
  const snapshot = structuredClone(input);
  normalize(snapshot);
  for (let attempt = 0; ; attempt++) {
    try {
      let result: any;
      await mongoose.connection.transaction(
        async (session) => {
          result = await postJournalInTransaction(snapshot, session);
        },
        { writeConcern: { w: "majority" }, readConcern: { level: "snapshot" } },
      );
      return result;
    } catch (error) {
      if ((error as any).code !== 11000 || attempt >= 3) throw error;
    }
  }
}

export async function reverseJournal(
  operatorId: string,
  journalId: string,
  key: string,
  reason: string,
  actorId: string,
) {
  const original = await M.JournalEntry.findOne({
    _id: oid(journalId),
    operatorId: oid(operatorId),
  }).lean();
  if (!original || original.kind === "Reversal")
    fail(404, "LEDGER_REVERSAL", "Original journal not found");
  const lines = [];
  for (const line of original!.lines as any[]) {
    const account = await M.LedgerAccount.findOne({
      _id: line.accountId,
      operatorId,
    }).lean();
    if (!account)
      fail(409, "LEDGER_INCONSISTENT", "Original account is missing");
    lines.push({
      account: {
        ownerType: account!.ownerType as AccountSpec["ownerType"],
        ownerId: account!.ownerId as string,
        code: account!.code as string,
      },
      debitPaise: line.creditPaise,
      creditPaise: line.debitPaise,
    });
  }
  return postJournal({
    operatorId,
    idempotencyKey: key,
    currency: "INR",
    kind: "Reversal",
    reversalOf: journalId,
    reason,
    actorId,
    ...(original!.bookingId ? { bookingId: String(original!.bookingId) } : {}),
    ...(original!.paymentId ? { paymentId: String(original!.paymentId) } : {}),
    lines,
  });
}

export async function postCapturedBooking(
  booking: any,
  payment: any,
  sourceEventId: string,
  session: ClientSession,
  fundingAccount?: AccountSpec,
) {
  if (
    payment.status !== "captured" ||
    booking.paymentStatus !== "Paid" ||
    !["Confirmed", "Reconciliation required"].includes(booking.status) ||
    String(payment.bookingId) !== String(booking._id) ||
    String(payment.operatorId) !== String(booking.operatorId) ||
    payment.currency !== "INR" ||
    payment.amountPaise !== booking.totalPaise
  )
    fail(
      409,
      "LEDGER_EVENT",
      "Only an authoritative captured payment can be posted",
    );
  const operatorId = String(booking.operatorId),
    amount = safeMoney(paise(payment.amountPaise));
  const confirmed = booking.status === "Confirmed";
  const agentId = booking.agentId
    ? String(booking.agentId)
    : booking.commissionSnapshot?.partnerKind === "Agent" &&
        booking.salesPartnerId
      ? String(booking.salesPartnerId)
      : undefined;
  const commission =
    confirmed && agentId ? safeMoney(paise(booking.commissionPaise)) : 0;
  if (commission > amount)
    fail(409, "LEDGER_COMMISSION", "Agency commission exceeds captured funds");
  const lines: JournalInput["lines"] = [
    {
      account: fundingAccount || {
        ownerType: "Platform",
        ownerId: "aibus",
        code: "payment-clearing",
      },
      debitPaise: amount,
      creditPaise: 0,
    },
  ];
  if (!confirmed)
    lines.push({
      account: {
        ownerType: "Platform",
        ownerId: "aibus",
        code: "payment-exceptions",
      },
      debitPaise: 0,
      creditPaise: amount,
    });
  else {
    const payable = safeMoney(paise(amount) - paise(commission));
    if (payable)
      lines.push({
        account: {
          ownerType: "Operator",
          ownerId: operatorId,
          code: "operator-payable",
        },
        debitPaise: 0,
        creditPaise: payable,
      });
    if (commission)
      lines.push({
        account: {
          ownerType: "Agent",
          ownerId: agentId!,
          code: "agent-commission-payable",
        },
        debitPaise: 0,
        creditPaise: commission,
      });
  }
  return postJournalInTransaction(
    {
      operatorId,
      idempotencyKey: `capture:${payment._id}`,
      currency: "INR",
      kind: confirmed ? "Booking captured" : "Payment exception",
      reason: confirmed
        ? "Captured passenger funds allocated; platform fee unconfigured (zero); operator payable includes taxes/charges"
        : "Captured funds require reconciliation; no ticket or earned commission",
      bookingId: String(booking._id),
      paymentId: String(payment._id),
      sourceEventId,
      lines,
    },
    session,
  );
}
