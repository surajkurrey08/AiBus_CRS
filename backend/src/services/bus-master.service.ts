import mongoose from "mongoose";
import { CrewMember, Trip } from "../models/index.js";
import { fail, type Principal } from "../utils/core.js";
export async function lockTripCrew(
  auth: Principal,
  crewIds: string[],
  tripId: string | undefined,
  departure: Date,
  arrival: Date,
  journeyDate: string,
  session: mongoose.ClientSession,
) {
  if (!crewIds.length) return;
  const crew = await CrewMember.find({
    operatorId: auth.operatorId,
    _id: { $in: crewIds },
    status: "Active",
  })
    .session(session)
    .lean();
  if (crew.length !== crewIds.length)
    fail(400, "CREW_UNAVAILABLE", "Select active crew from your company");
  if (
    crew.some(
      (member) =>
        member.role === "Driver" &&
        (!member.licenceNumber ||
          !member.licenceExpiry ||
          member.licenceExpiry < journeyDate),
    )
  )
    fail(
      409,
      "DRIVER_LICENCE_EXPIRED",
      "A driver's licence is missing or expires before this trip",
    );
  // Touch each shared crew record so concurrent trip assignments conflict and retry.
  await CrewMember.updateMany(
    { _id: { $in: crewIds }, operatorId: auth.operatorId },
    { $inc: { __v: 1 } },
    { session },
  );
  const conflict = await Trip.exists({
    operatorId: auth.operatorId,
    ...(tripId ? { _id: { $ne: tripId } } : {}),
    status: { $in: ["Scheduled", "Departed"] },
    crewIds: { $in: crewIds },
    departureAt: { $lt: arrival },
    $or: [{ arrivalAt: { $gt: departure } }, { arrivalAt: null }],
  }).session(session);
  if (conflict)
    fail(
      409,
      "CREW_SCHEDULE_CONFLICT",
      "A selected crew member is assigned to an overlapping trip",
    );
}
