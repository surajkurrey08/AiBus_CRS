import { z } from "zod";

export const passengerInputSchema = z.object({
  seatId: z.string().min(1, "Seat ID is required"),
  name: z.string().min(1, "Passenger name is required").trim(),
  age: z.number().int().min(1).max(120).optional(),
  gender: z.enum(["M", "F", "O"]).optional(),
  phone: z.string().trim().optional(),
  email: z.string().email().trim().optional(),
});

export const createHoldSchema = z.object({
  tripId: z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid tripId ObjectId"),
  seatIds: z
    .array(z.string().min(1))
    .min(1, "At least one seat must be selected")
    .max(7, "Cannot hold more than 7 seats in a single request"),
  legType: z.enum(["outbound", "return", "single"]).optional(),
  holdDurationSeconds: z.number().int().min(60).max(3600).optional(),
});

export const createRoundTripHoldSchema = z.object({
  outboundTripId: z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid outboundTripId ObjectId"),
  outboundSeatIds: z.array(z.string().min(1)).min(1).max(7),
  returnTripId: z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid returnTripId ObjectId"),
  returnSeatIds: z.array(z.string().min(1)).min(1).max(7),
  holdDurationSeconds: z.number().int().min(60).max(3600).optional(),
});

export const confirmBookingSchema = z
  .object({
    bookingType: z.enum(["ONE_WAY", "ROUND_TRIP"]),
    holdId: z.string().optional(),
    outboundHoldId: z.string().optional(),
    returnHoldId: z.string().optional(),
    passengers: z.array(passengerInputSchema).min(1).max(7),
    returnPassengers: z.array(passengerInputSchema).optional(),
    contact: z.object({
      phone: z.string().min(5, "Contact phone is required").trim(),
      email: z.string().email("Valid email required").optional(),
    }),
    idempotencyKey: z.string().min(1, "Idempotency key is required").trim(),
    payment: z.object({
      mode: z.enum(["sandbox", "agent_wallet", "mock_payment"]),
      paymentReference: z.string().optional(),
      amountPaise: z.number().int().min(0).optional(),
    }),
    agentId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.bookingType === "ONE_WAY" && !data.holdId && !data.outboundHoldId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["holdId"],
        message: "holdId is required for ONE_WAY booking",
      });
    }
    if (data.bookingType === "ROUND_TRIP") {
      if (!data.outboundHoldId && !data.holdId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["outboundHoldId"],
          message: "outboundHoldId is required for ROUND_TRIP booking",
        });
      }
      if (!data.returnHoldId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["returnHoldId"],
          message: "returnHoldId is required for ROUND_TRIP booking",
        });
      }
    }
  });

export const cancelBookingSchema = z.object({
  reason: z.string().min(2, "Cancellation reason is required").trim(),
  cancelledBy: z.string().optional(),
});
