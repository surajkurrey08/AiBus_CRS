import { z } from "zod";
export const phoneNumber = z.string().trim().regex(/^[0-9]{10}$/, "Enter exactly 10 digits");
export const strongPassword = z.string().min(8).max(128)
  .regex(/[A-Z]/, "Include at least one uppercase letter")
  .regex(/[\x21-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E]/, "Include at least one special character")
  .refine(value => (value.match(/[a-z]/g) ?? []).length >= 4, "Include at least four lowercase letters");
