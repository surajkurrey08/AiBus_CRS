import { strongPassword, phoneNumber } from "./account-input.schemas.js";
import { z } from "zod";
import { amount, id, text } from "./common.schemas.js";
import { agentCapabilities } from "../types/agent.js";
export const commissionConfig = z
  .object({
    commissionType: z.enum(["Percent", "Fixed"]),
    commissionRate: amount,
  })
  .strict()
  .refine(
    (v) => v.commissionType !== "Percent" || v.commissionRate <= 10000,
    "Percentage commission must be between 0 and 10000 basis points (0–100%)",
  );
export const agentInput = z
  .object({
    name: text,
    email: z
      .string()
      .email()
      .max(254)
      .transform((v) => v.toLowerCase())
      .optional(),
    phone: phoneNumber.optional(),
    status: z.enum(["Active", "Inactive"]).default("Active"),
    permissions: z
      .array(z.enum(agentCapabilities))
      .max(agentCapabilities.length)
      .default(
        agentCapabilities.filter((p) => !["wallet", "credit"].includes(p)),
      ),
    allowedBusIds: z.array(id).max(200).default([]),
    commissionType: z.enum(["Percent", "Fixed"]).default("Percent"),
    commissionRate: amount.default(500),
  })
  .strict();
export const agentUserInput = z.union([
  z.object({ userId: id }).strict(),
  z
    .object({
      name: text,
      email: z
        .string()
        .email()
        .max(254)
        .transform((v) => v.toLowerCase()),
      password: strongPassword,
    })
    .strict(),
]);
