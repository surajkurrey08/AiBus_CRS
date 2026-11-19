import type { ClientSession } from "mongoose";
import * as M from "../models/index.js";
import { postJournalInTransaction } from "./ledger.service.js";
export async function postDuplicateCapture(
  booking: any,
  payment: any,
  eventId: string,
  session: ClientSession,
  post: boolean,
) {
  const operatorId = String(booking.operatorId);
  if (post)
    await postJournalInTransaction(
      {
        operatorId,
        idempotencyKey: `capture:${payment._id}`,
        currency: "INR",
        kind: "Payment exception",
        bookingId: String(booking._id),
        paymentId: String(payment._id),
        sourceEventId: eventId,
        reason:
          "Distinct additional captured payment; original booking, ticket and payable preserved; reconciliation required",
        lines: [
          {
            account: {
              ownerType: "Platform",
              ownerId: "aibus",
              code: "payment-clearing",
            },
            debitPaise: payment.amountPaise,
            creditPaise: 0,
          },
          {
            account: {
              ownerType: "Platform",
              ownerId: "aibus",
              code: "payment-exceptions",
            },
            debitPaise: 0,
            creditPaise: payment.amountPaise,
          },
        ],
      },
      session,
    );
  await M.FinanceException.findOneAndUpdate(
    { operatorId, kind: "Duplicate capture", resourceKey: String(payment._id) },
    {
      $setOnInsert: {
        operatorId,
        bookingId: booking._id,
        paymentId: payment._id,
        kind: "Duplicate capture",
        resourceKey: String(payment._id),
        status: "Open",
        code: "ADDITIONAL_CAPTURE",
      },
      $set: { lastSeenAt: new Date() },
    },
    { session, upsert: true },
  );
}
