import mongoose from "mongoose";
import type { Server } from "socket.io";
import { provider, safeProviderRead } from "../integrations/providers.js";
import { Booking, Hold, Outbox, Trip } from "../models/index.js";
import { logger } from "../utils/core.js";
export async function reconcileExpiredHolds() {
  const now = new Date();
  const trips = await Trip.find({
    inventoryOwner: "internal",
    seats: { $elemMatch: { state: "held", holdUntil: { $lte: now } } },
  })
    .select("_id operatorId")
    .limit(100)
    .lean();
  for (const trip of trips)
    await mongoose.connection.transaction(async (session) => {
      const filter = {
        _id: trip._id,
        operatorId: trip.operatorId,
        inventoryOwner: "internal",
      };
      const expired = await Hold.find({
        operatorId: trip.operatorId,
        tripId: trip._id,
        expiresAt: { $lte: now },
        status: { $in: ["held", "consumed"] },
      })
        .session(session)
        .lean();
      for (const hold of expired) {
        await Booking.updateMany(
          {
            operatorId: trip.operatorId,
            tripId: trip._id,
            holdId: hold.holdId,
            status: "Pending payment",
            paymentStatus: "Pending",
          },
          { $set: { status: "Failed", paymentStatus: "Failed" } },
          { session },
        );
        await Hold.updateOne(
          { _id: hold._id, operatorId: trip.operatorId },
          { $set: { status: "expired" } },
          { session },
        );
      }
      await Trip.updateOne(
        filter,
        {
          $set: { "seats.$[seat].state": "available" },
          $unset: {
            "seats.$[seat].holdId": 1,
            "seats.$[seat].holdUserId": 1,
            "seats.$[seat].holdUntil": 1,
            "seats.$[seat].bookingId": 1,
          },
        },
        {
          session,
          arrayFilters: [
            { "seat.state": "held", "seat.holdUntil": { $lte: now } },
          ],
        },
      );
      await Outbox.create(
        [
          {
            operatorId: trip.operatorId,
            event: "seat.availability.changed",
            resourceId: String(trip._id),
          },
        ],
        { session },
      );
    });
  return trips.length;
}
export async function reconcileExternalBookings() {
  if (!provider.capabilities.has("status"))
    return { available: false, checked: 0 };
  const rows = await Booking.find({
    providerId: provider.id,
    status: { $in: ["Pending payment", "Reconciliation required"] },
  })
    .limit(50)
    .lean();
  for (const row of rows) {
    try {
      const result = await safeProviderRead((signal) =>
        provider.getBookingStatus(String(row.externalId), signal),
      );
      /* No generic confirmation: provider-specific implementation must atomically validate payment and inventory. */ if (
        result.status === "confirmed"
      )
        logger.warn(
          { bookingId: String(row._id) },
          "Provider confirmation requires adapter-specific reconciliation",
        );
    } catch {
      logger.warn(
        { bookingId: String(row._id) },
        "Provider status reconciliation failed",
      );
    }
  }
  return { available: true, checked: rows.length };
}
export async function publishOutbox(io: Server) {
  const rows = await Outbox.find({ deliveredAt: null })
    .sort({ createdAt: 1 })
    .limit(100)
    .lean();
  for (const row of rows) {
    if (row.event === "operator.status.updated")
      io.in(`operator:${row.operatorId}`).disconnectSockets(true);
    else
      io.to(`operator:${row.operatorId}`).emit(String(row.event), {
        eventId: String(row._id),
        resourceId: row.resourceId,
      });
    await Outbox.updateOne(
      { _id: row._id, operatorId: row.operatorId, deliveredAt: null },
      { $set: { deliveredAt: new Date() } },
    );
  }
  return rows.length;
}
