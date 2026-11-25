import { CarJournalEntry, CarFinanceOutbox } from "../models/car-ledger.model.js";

export interface BookingFinancialParams {
  operatorId: string;
  bookingId: string;
  pnr: string;
  totalPayablePaise: number;
  agentId?: string;
  commissionPaise?: number;
  platformFeePaise?: number;
  channel?: string;
}

export interface CancellationFinancialParams {
  operatorId: string;
  bookingId: string;
  pnr: string;
  refundablePaise: number;
  cancellationFeePaise: number;
  reason?: string;
}

/**
 * Posts double-entry journal for confirmed car booking.
 * Balanced rule: Total Debits == Total Credits.
 * - Debit: Gateway Cash / Sandbox Inflow
 * - Credit: Operator Payable
 * - Credit: Agent Commission Payable (if agent channel)
 * - Credit: Platform Fee (if configured)
 */
export async function postBookingFinancialJournal(params: BookingFinancialParams) {
  const {
    operatorId,
    bookingId,
    pnr,
    totalPayablePaise,
    agentId,
    commissionPaise = 0,
    platformFeePaise = 0,
  } = params;

  const operatorPayablePaise = totalPayablePaise - commissionPaise - platformFeePaise;

  const lines: any[] = [
    // Inflow into gateway cash asset
    {
      accountCode: "1000-CASH-GATEWAY-SANDBOX",
      ownerType: "Platform",
      ownerId: "PLATFORM",
      debitPaise: totalPayablePaise,
      creditPaise: 0,
    },
    // Operator earned payable liability
    {
      accountCode: "2000-OPERATOR-PAYABLE",
      ownerType: "Operator",
      ownerId: operatorId,
      debitPaise: 0,
      creditPaise: operatorPayablePaise,
    },
  ];

  if (commissionPaise > 0 && agentId) {
    lines.push({
      accountCode: "2010-AGENT-COMMISSION-PAYABLE",
      ownerType: "Agent",
      ownerId: agentId,
      debitPaise: 0,
      creditPaise: commissionPaise,
    });
  }

  if (platformFeePaise > 0) {
    lines.push({
      accountCode: "4000-PLATFORM-FEE-REVENUE",
      ownerType: "Platform",
      ownerId: "PLATFORM",
      debitPaise: 0,
      creditPaise: platformFeePaise,
    });
  }

  const operationId = `OP-BOOKING-${bookingId}`;

  // Idempotent upsert
  const existing = await CarJournalEntry.findOne({ operationId });
  if (existing) {
    return existing;
  }

  const journal = await CarJournalEntry.create({
    operatorId,
    operationId,
    bookingId,
    pnr,
    kind: "Booking captured",
    currency: "INR",
    reason: `Confirmed car booking revenue capture for PNR ${pnr}`,
    lines,
    totalPaise: totalPayablePaise,
  });

  // Outbox dispatch event for ledger reconciliation
  await CarFinanceOutbox.create({
    operatorId,
    eventId: `EVT-CAPTURE-${bookingId}`,
    eventType: "BOOKING_CAPTURED",
    bookingId,
    pnr,
    payload: {
      operationId,
      totalPayablePaise,
      operatorPayablePaise,
      commissionPaise,
      platformFeePaise,
    },
    status: "processed",
  });

  return journal;
}

/**
 * Posts reversing double-entry journal for cancelled car booking.
 * - Debit: Operator Payable (or Refund Expense) for refundable amount
 * - Credit: Gateway Outflow / Customer Payable
 */
export async function postCancellationFinancialJournal(params: CancellationFinancialParams) {
  const { operatorId, bookingId, pnr, refundablePaise, cancellationFeePaise, reason } = params;

  if (refundablePaise <= 0) {
    return null;
  }

  const operationId = `OP-CANCEL-${bookingId}`;
  const existing = await CarJournalEntry.findOne({ operationId });
  if (existing) {
    return existing;
  }

  const lines = [
    {
      accountCode: "2000-OPERATOR-PAYABLE",
      ownerType: "Operator",
      ownerId: operatorId,
      debitPaise: refundablePaise,
      creditPaise: 0,
    },
    {
      accountCode: "1000-CASH-GATEWAY-SANDBOX",
      ownerType: "Platform",
      ownerId: "PLATFORM",
      debitPaise: 0,
      creditPaise: refundablePaise,
    },
  ];

  const journal = await CarJournalEntry.create({
    operatorId,
    operationId,
    bookingId,
    pnr,
    kind: "Refund",
    currency: "INR",
    reason: `Refund adjustment for cancelled booking PNR ${pnr}. Reason: ${reason || "Customer requested"}`,
    lines,
    totalPaise: refundablePaise,
    reversalOf: `OP-BOOKING-${bookingId}`,
  });

  await CarFinanceOutbox.create({
    operatorId,
    eventId: `EVT-REFUND-${bookingId}`,
    eventType: "REFUND_PROCESSED",
    bookingId,
    pnr,
    payload: {
      operationId,
      refundablePaise,
      cancellationFeePaise,
    },
    status: "processed",
  });

  return journal;
}
