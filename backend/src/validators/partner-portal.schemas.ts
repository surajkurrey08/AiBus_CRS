import { strongPassword, phoneNumber } from "./account-input.schemas.js";
import { z } from "zod";
import { publicScopes } from "../services/public-auth.service.js";
import { partnerRoles, applicationStates } from "../types/partner-portal.js";
const text = z.string().trim().min(2).max(500);
export const secretReview = {
  password: z.string().min(1).max(128),
  reason: text.max(500),
  key: z.string().regex(/^[\w:-]{16,100}$/),
};
export const applicationInput = z
  .object({
    name: text.max(150),
    contactPerson: text.max(150),
    businessEmail: z
      .string()
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    phone: phoneNumber,
    address: text,
    registrationDetails: z.preprocess(
      (value) =>
        typeof value === "string" && !value.trim() ? undefined : value,
      text.optional(),
    ),
    technicalEmail: z.string().email().max(254),
    intendedUsage: text,
    requestedEnvironment: z.enum(["Sandbox", "Production"]),
    password: strongPassword,
    submit: z.boolean().default(true),
  })
  .strict();
export const credentialInput = z
  .object({
    ...secretReview,
    label: text.max(80),
    scopes: z.array(z.enum(publicScopes)).min(1).max(8),
    expiresAt: z.string().datetime(),
    rotateId: z.string().max(120).optional(),
  })
  .strict();
export const reviewInput = z
  .object({
    ...secretReview,
    version: z.number().int().min(0),
    status: z.enum(applicationStates).optional(),
    scopes: z.array(z.enum(publicScopes)).max(8).optional(),
    requestsPerMinute: z.number().int().min(1).max(120).optional(),
  })
  .strict();
export const teamInput = z
  .object({
    ...secretReview,
    name: text.max(150),
    email: z
      .string()
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    initialPassword: strongPassword,
    role: z.enum(partnerRoles),
  })
  .strict();
export const teamChange = z
  .object({ ...secretReview, role: z.enum(partnerRoles), active: z.boolean() })
  .strict();
export const listQuery = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    search: z.string().max(100).optional(),
    status: z.string().max(40).optional(),
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    endpoint: z.string().max(150).optional(),
  })
  .strict();
export const webhookInput = z
  .object({ ...secretReview, url: z.string().url().max(500) })
  .strict();
export const webhookAction = z
  .object({
    ...secretReview,
    action: z.enum(["enable", "disable", "rotate", "test"]),
  })
  .strict();
export const grantInput = z
  .object({
    ...secretReview,
    operatorId: z.string().regex(/^[a-f\d]{24}$/i),
    kind: z.enum(["Operator", "Route", "Service", "Trip"]),
    targetId: z.string().regex(/^[a-f\d]{24}$/i),
    active: z.boolean(),
    expiresAt: z.string().datetime(),
  })
  .strict();
