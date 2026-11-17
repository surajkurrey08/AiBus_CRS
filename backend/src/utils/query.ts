import type { Request } from "express";
import { z } from "zod";
import { dateOnly, id } from "../validators/common.schemas.js";

export function pagination(req: Request) {
  return z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(25),
      search: z.string().trim().max(100).default(""),
      status: z.string().max(30).optional(),
      from: dateOnly.optional(),
      to: dateOnly.optional(),
      tripId: id.optional(),
      journeyDate: dateOnly.optional(),
      sort: z
        .enum([
          "id",
          "registration",
          "name",
          "type",
          "capacity",
          "route",
          "source",
          "destination",
          "departure",
          "arrival",
          "duration",
          "status",
          "date",
          "createdAt",
          "fare",
          "amount",
          "passenger",
          "seat",
          "code",
          "email",
          "phone",
          "licenceExpiry",
          "expiresOn",
          "deviceId",
          "arrangement",
          "state",
          "country",
          "usage",
          "category",
          "address",
          "decks",
          "role",
          "weekday",
          "weekend",
          "festival",
          "commission",
        ])
        .optional(),
      order: z.enum(["asc", "desc"]).default("desc"),
    })
    .parse(req.query);
}

export const literalRegex = (s: string) =>
  new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
