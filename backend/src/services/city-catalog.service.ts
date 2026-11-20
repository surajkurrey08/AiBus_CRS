import { createHash, randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { z } from "zod";
import {
  CatalogCity,
  CityCatalogImport,
} from "../models/city-catalog.model.js";
import { fail, type Principal } from "../utils/core.js";
import { platformPermit } from "./platform-read.service.js";
import {
  platformAudit,
  verifyPlatformAction,
} from "./platform-admin.service.js";

const text = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine(
    (v) =>
      Array.from(v).every((c) => c.charCodeAt(0) >= 32) &&
      /[\p{L}\p{N}]/u.test(v),
  );
export const catalogCityInput = z
  .object({ name: text, state: text, country: text.default("India") })
  .strict();
const sourceRow = z
  .object({
    CityId: z.union([
      z.string().trim().min(1).max(120),
      z.number().int().safe(),
    ]),
    City: text,
    State: text,
  })
  .strict();
export const normalizeCity = (value: string) =>
  value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
export function cityKey(name: string, state: string, country = "India") {
  const slug = (v: string) =>
    normalizeCity(v)
      .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
      .replace(/^-|-$/g, "");
  return [name, state, country].map(slug).join("-");
}
export type PreviewRow = {
  row: number;
  sourceId?: string;
  name?: string;
  state?: string;
  key?: string;
  status: "ready" | "conflict" | "duplicate" | "invalid" | "existing";
  reason?: string;
};
// Examine the complete upload before classifying any row; chunking must not hide
// source-ID conflicts in another part of the file.
export function analyzeCityRows(input: unknown[]): PreviewRow[] {
  const parsed = input.map((row) => sourceRow.safeParse(row));
  const identities = new Map<string, Set<string>>(),
    keys = new Map<string, Set<string>>();
  for (const row of parsed)
    if (row.success) {
      const d = row.data,
        source = String(d.CityId),
        key = cityKey(d.City, d.State);
      const identity = JSON.stringify([
        normalizeCity(d.City),
        normalizeCity(d.State),
      ]);
      if (!identities.has(source)) identities.set(source, new Set());
      identities.get(source)!.add(identity);
      if (!keys.has(key)) keys.set(key, new Set());
      keys.get(key)!.add(source + "|" + identity);
    }
  const seen = new Set<string>();
  return parsed.map((row, index) => {
    if (!row.success)
      return {
        row: index + 1,
        status: "invalid",
        reason: "CityId, City and State are required and must be valid.",
      };
    const d = row.data,
      sourceId = String(d.CityId),
      key = cityKey(d.City, d.State);
    const base = {
      row: index + 1,
      sourceId,
      name: d.City,
      state: d.State,
      key,
    };
    if (identities.get(sourceId)!.size > 1 || keys.get(key)!.size > 1)
      return {
        ...base,
        status: "conflict",
        reason:
          "Ambiguous source ID or city key. Review this locality manually.",
      };
    if (seen.has(key))
      return {
        ...base,
        status: "duplicate",
        reason: "Identical row already included.",
      };
    seen.add(key);
    return { ...base, status: "ready" };
  });
}
export async function catalogIndexesReady() {
  for (const model of [CatalogCity, CityCatalogImport]) {
    const installed = await model.collection
      .listIndexes()
      .toArray()
      .catch(() => []);
    for (const [keys, options] of model.schema.indexes())
      if (
        options.unique &&
        !installed.some(
          (i) =>
            i.unique &&
            !i.partialFilterExpression &&
            !i.sparse &&
            JSON.stringify(i.key) === JSON.stringify(keys),
        )
      )
        fail(
          503,
          "CATALOG_NOT_READY",
          "Install the additive City Catalog indexes before saving cities.",
        );
  }
}
export async function prepareCityImport(
  auth: Principal,
  rows: unknown[],
  source: string,
) {
  platformPermit(auth, "platform:settings:write");
  await catalogIndexesReady();
  const digest = createHash("sha256")
    .update(JSON.stringify({ source, rows }))
    .digest("hex");
  const previous = await CityCatalogImport.findOne({
    actorId: auth.userId,
    digest,
  });
  if (previous) return previous;
  const analyzed = analyzeCityRows(rows);
  if (
    mongoose.mongo.BSON.calculateObjectSize({ rows: analyzed }) >
    12 * 1024 * 1024
  )
    fail(
      413,
      "IMPORT_PREVIEW_TOO_LARGE",
      "The normalized preview is too large to store safely. Reduce the number of source rows and review cross-file conflicts separately.",
    );
  const existing = new Set(
    (
      await CatalogCity.find({
        key: { $in: analyzed.flatMap((r) => (r.key ? [r.key] : [])) },
      })
        .select("key")
        .lean()
    ).map((r) => String(r.key)),
  );
  for (const row of analyzed)
    if (row.status === "ready" && existing.has(row.key!))
      row.status = "existing";
  const counts = Object.fromEntries(
    ["ready", "conflict", "duplicate", "invalid", "existing"].map((s) => [
      s,
      analyzed.filter((r) => r.status === s).length,
    ]),
  );
  try {
    return await CityCatalogImport.create({
      actorId: auth.userId,
      digest,
      source,
      rows: analyzed,
      counts,
    });
  } catch (error) {
    if ((error as any).code !== 11000) throw error;
    return (await CityCatalogImport.findOne({ actorId: auth.userId, digest }))!;
  }
}
export async function commitCityImport(
  auth: Principal,
  importId: string,
  input: { cursor: number; password: string; reason: string },
) {
  platformPermit(auth, "platform:settings:write");
  await verifyPlatformAction(auth, input.password);
  await catalogIndexesReady();
  return mongoose.connection.transaction(async (session) => {
    const batch: any = await CityCatalogImport.findOne({
      _id: importId,
      actorId: auth.userId,
    }).session(session);
    if (!batch) fail(404, "NOT_FOUND", "Import preview not found");
    // Stable cursor is the idempotency key. A lost response must never insert twice.
    if (input.cursor < batch.cursor || batch.status === "Complete")
      return batch;
    if (input.cursor !== batch.cursor)
      fail(
        409,
        "IMPORT_CURSOR_CONFLICT",
        "Reload the current import progress before continuing.",
      );
    const slice = batch.rows.slice(
      batch.cursor,
      batch.cursor + 250,
    ) as PreviewRow[];
    let inserted = 0,
      skipped = 0;
    for (const row of slice) {
      if (row.status !== "ready") {
        skipped++;
        continue;
      }
      const result = await CatalogCity.updateOne(
        { key: row.key },
        {
          $setOnInsert: {
            cityId: "city_" + randomUUID().replaceAll("-", ""),
            key: row.key,
            name: row.name,
            state: row.state,
            country: "India",
            status: "Active",
            createdBy: auth.userId,
            importId: batch._id,
          },
        },
        { upsert: true, session, runValidators: true },
      );
      result.upsertedCount ? inserted++ : skipped++;
    }
    batch.cursor += slice.length;
    batch.inserted += inserted;
    batch.skipped += skipped;
    batch.status = batch.cursor >= batch.rows.length ? "Complete" : "Importing";
    await batch.save({ session });
    await platformAudit(
      auth,
      "city_catalog.import.chunk",
      String(batch._id),
      input.reason,
      session,
      undefined,
      { cursor: batch.cursor, inserted, skipped, digest: batch.digest },
    );
    return batch;
  });
}
export async function addCatalogCity(
  auth: Principal,
  values: z.infer<typeof catalogCityInput>,
  password: string,
  reason: string,
) {
  platformPermit(auth, "platform:settings:write");
  await verifyPlatformAction(auth, password);
  await catalogIndexesReady();
  return mongoose.connection.transaction(async (session) => {
    const key = cityKey(values.name, values.state, values.country);
    const existing = await CatalogCity.findOne({ key }).session(session);
    if (existing) return existing;
    const [city] = await CatalogCity.create(
      [
        {
          ...values,
          key,
          cityId: "city_" + randomUUID().replaceAll("-", ""),
          createdBy: auth.userId,
        },
      ],
      { session },
    );
    await platformAudit(
      auth,
      "city_catalog.create",
      String(city.cityId),
      reason,
      session,
    );
    return city;
  });
}
