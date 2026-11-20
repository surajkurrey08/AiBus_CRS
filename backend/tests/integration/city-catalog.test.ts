import { beforeAll, afterAll, beforeEach, it, expect } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import * as M from "../../src/models/index.js";
import { createApp } from "../../src/app.js";
import { readConfig } from "../../src/config/env.js";
import { hashPassword } from "../../src/services/auth.service.js";
import {
  analyzeCityRows,
  cityKey,
} from "../../src/services/city-catalog.service.js";
const password = "City-Catalog-Fixture-Password!";
const app = createApp(
  readConfig({
    NODE_ENV: "test",
    MONGODB_URI: "mongodb://127.0.0.1/disposable",
    JWT_SECRET: "c".repeat(64),
  }),
  { check: async () => true },
);
let mongo: MongoMemoryReplSet,
  token: string,
  otherToken: string,
  operatorToken: string,
  owner: any;
const city = { CityId: 1, City: "Pune", State: "Maharashtra" };
const post = (path: string, body: unknown, auth = token) =>
  request(app)
    .post("/api/v1/platform/city-catalog" + path)
    .set("Authorization", "Bearer " + auth)
    .send(body);
const review = { password, reason: "Configure AIBUS city catalog" };
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await Promise.all(
    Object.values(M)
      .filter((m: any) => m?.init)
      .map((m: any) => m.init()),
  );
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  for (const model of Object.values(mongoose.models))
    await model.collection.deleteMany({});
  const passwordHash = await hashPassword(password);
  owner = await M.Operator.create({
    company: "City fixture",
    email: "owner@city.test",
    status: "approved",
  });
  await M.User.create([
    {
      name: "Root",
      email: "root@city.test",
      role: "super_admin",
      passwordHash,
    },
    {
      name: "Other root",
      email: "other@city.test",
      role: "super_admin",
      passwordHash,
    },
    {
      name: "Operator",
      email: "operator@city.test",
      role: "operator_admin",
      operatorId: owner._id,
      passwordHash,
    },
  ]);
  const login = async (email: string, client = "admin") =>
    (
      await request(app)
        .post("/api/v1/auth/login")
        .set("X-Aibus-Client", client)
        .send({ email, password })
    ).body.data.accessToken;
  token = await login("root@city.test");
  otherToken = await login("other@city.test");
  operatorToken = await login("operator@city.test", "operator");
});
it("quarantines all conflicting source IDs and ambiguous keys across the full file", () => {
  const result = analyzeCityRows([
    city,
    { ...city, City: "Mumbai" },
    { CityId: 2, City: "Nagpur", State: "Maharashtra" },
    { CityId: 3, City: "Nagpur", State: "Maharashtra" },
    {},
  ]);
  expect(result.map((r) => r.status)).toEqual([
    "conflict",
    "conflict",
    "conflict",
    "conflict",
    "invalid",
  ]);
  expect(
    analyzeCityRows([city, { ...city, City: "  PUNE " }]).map((r) => r.status),
  ).toEqual(["ready", "duplicate"]);
  expect(cityKey(" पुणे ", "Maharashtra")).toBe("पुणे-maharashtra-india");
});
it("previews without creating cities; retries preview and commit without duplicate records", async () => {
  const data = {
    source: "uploaded-provider-list.json",
    rows: [city, city, {}],
  };
  const preview = await post("/imports/preview", data);
  expect(preview.status).toBe(200);
  expect(preview.body.data.counts).toEqual({
    ready: 1,
    duplicate: 1,
    invalid: 1,
    existing: 0,
    conflict: 0,
  });
  expect(await M.CatalogCity.countDocuments()).toBe(0);
  expect((await post("/imports/preview", data)).body.data.id).toBe(
    preview.body.data.id,
  );
  const path = `/imports/${preview.body.data.id}/commit`;
  expect(
    (await post(path, { ...review, cursor: 0, password: "wrong" })).status,
  ).toBe(403);
  expect((await post(path, { ...review, cursor: 0 })).body.data.inserted).toBe(
    1,
  );
  expect((await post(path, { ...review, cursor: 0 })).body.data.inserted).toBe(
    1,
  );
  const saved: any = await M.CatalogCity.findOne().lean();
  expect(saved.cityId).toMatch(/^city_[a-f0-9]{32}$/);
  expect(saved.cityId).not.toBe("1");
  expect(
    await M.Audit.countDocuments({ action: "city_catalog.import.chunk" }),
  ).toBe(1);
  expect(await M.CatalogCity.countDocuments()).toBe(1);
});
it("enforces platform and preview ownership before import", async () => {
  expect(
    (
      await post(
        "/imports/preview",
        { source: "cities", rows: [city] },
        operatorToken,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await post(
        "",
        { ...review, name: "Pune", state: "Maharashtra", country: "India" },
        "",
      )
    ).status,
  ).toBe(401);
  const preview = await post("/imports/preview", {
    source: "cities",
    rows: [city],
  });
  expect(
    (
      await post(
        `/imports/${preview.body.data.id}/commit`,
        { ...review, cursor: 0 },
        otherToken,
      )
    ).status,
  ).toBe(404);
});
it("resumes bounded chunks and rejects future cursors", async () => {
  const rows = Array.from({ length: 260 }, (_, n) => ({
    CityId: n,
    City: "Fixture " + n,
    State: "Maharashtra",
  }));
  const batch = (await post("/imports/preview", { source: "bulk.json", rows }))
    .body.data;
  const path = `/imports/${batch.id}/commit`;
  expect((await post(path, { ...review, cursor: 250 })).status).toBe(409);
  expect((await post(path, { ...review, cursor: 0 })).body.data.cursor).toBe(
    250,
  );
  const retry = await post(path, { ...review, cursor: 0 });
  expect(retry.body.data.cursor).toBe(250);
  const complete = await post(path, { ...review, cursor: 250 });
  expect(complete.body.data.status).toBe("Complete");
  expect(await M.CatalogCity.countDocuments()).toBe(260);
});
it("derives operator city data server-side and preserves tenant IDs", async () => {
  const catalog = (
    await post("", {
      ...review,
      name: "Pune",
      state: "Maharashtra",
      country: "India",
    })
  ).body.data;
  const response = await request(app)
    .post("/api/v1/operator/area-master/cities")
    .set("Authorization", "Bearer " + operatorToken)
    .send({
      catalogId: catalog._id,
      name: "Forged name",
      state: "Wrong",
      country: "Wrong",
      status: "Active",
    });
  expect(response.status).toBe(201);
  expect(response.body.data.name).toBe("Pune");
  expect(response.body.data.operatorId).toBe(String(owner._id));
  expect(response.body.data._id).not.toBe(catalog._id);
  const originalId = response.body.data._id;
  expect(
    (
      await request(app)
        .patch(`/api/v1/operator/area-master/cities/${originalId}`)
        .set("Authorization", "Bearer " + operatorToken)
        .send({ name: "Edited", state: "Edited", status: "Active" })
    ).body.data.name,
  ).toBe("Pune");
  const result = await request(app)
    .get("/api/v1/operator/area-master/catalog?search=Pune")
    .set("Authorization", "Bearer " + operatorToken);
  expect(result.body.data).toHaveLength(1);
  expect(result.body.data[0].createdBy).toBeUndefined();
});
it("accepts a complete large preview only with authorized admin authentication", async () => {
  const rows = Array.from({ length: 2500 }, (_, n) => ({
    CityId: n,
    City: "Unique city long name " + n,
    State: "Maharashtra",
  }));
  expect(JSON.stringify(rows).length).toBeGreaterThan(128 * 1024);
  expect(
    (
      await post(
        "/imports/preview",
        { source: "large.json", rows },
        operatorToken,
      )
    ).status,
  ).toBe(403);
  expect(
    (await post("/imports/preview", { source: "large.json", rows })).status,
  ).toBe(200);
});
it("protects unique city identity during simultaneous commit retries", async () => {
  const batch = (
    await post("/imports/preview", { source: "concurrent.json", rows: [city] })
  ).body.data;
  const results = await Promise.all(
    [0, 1, 2].map(() =>
      post(`/imports/${batch.id}/commit`, { ...review, cursor: 0 }),
    ),
  );
  expect(results.some((r) => r.status === 200)).toBe(true);
  expect(results.every((r) => [200, 409].includes(r.status))).toBe(true);
  expect(await M.CatalogCity.countDocuments()).toBe(1);
  const final = await post(`/imports/${batch.id}/commit`, {
    ...review,
    cursor: 0,
  });
  expect(final.body.data.inserted).toBe(1);
  expect(
    await M.Audit.countDocuments({ action: "city_catalog.import.chunk" }),
  ).toBe(1);
});
it("fails closed if the catalog unique indexes have not been installed", async () => {
  await M.CatalogCity.collection.dropIndex("key_1");
  try {
    expect(
      (await post("", { ...review, name: "Pune", state: "Maharashtra" })).body
        .error.code,
    ).toBe("CATALOG_NOT_READY");
    expect(await M.CatalogCity.countDocuments()).toBe(0);
  } finally {
    await M.CatalogCity.createIndexes();
  }
});
