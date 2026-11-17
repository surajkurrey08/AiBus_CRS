import { z } from "zod";

export const id = z.string().regex(/^[a-f\d]{24}$/i, "Invalid identifier");

export const text = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((v) => !/[<>\x00-\x08]/.test(v), "Invalid characters");

export const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Invalid date",
  );

export const amount = z.coerce.number().int().min(0).max(100_000_000);
