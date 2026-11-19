// One-time, additive AIBUS transfer. Never drops, replaces or upserts records.
// Credentials are read from backend/.env and are never logged or written to reports.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { parse } from "dotenv";
import mongoose from "mongoose";

const root = fileURLToPath(new URL("../", import.meta.url));
const { MongoClient, BSON } = mongoose.mongo;
const settings = parse(
  await fs.readFile(path.join(root, "backend/.env"), "utf8"),
);
const atlasUri = settings.MONGODB_URI;
if (!atlasUri || !atlasUri.startsWith("mongodb+srv://"))
  throw new Error("Expected the updated Atlas SRV connection in backend/.env");
const sourceUri =
  "mongodb://127.0.0.1:27018/aibus?directConnection=true&replicaSet=rs0";
const targetName = "aibus";
const apply = process.argv.includes("--apply");
const source = new MongoClient(sourceUri, { serverSelectionTimeoutMS: 10000 });
const target = new MongoClient(atlasUri, { serverSelectionTimeoutMS: 10000 });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backup = path.join(root, "backups", `aibus-to-atlas-${stamp}`);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const log = (data) => console.log(JSON.stringify(data));
let phase = "preflight";
try {
  await Promise.all([source.connect(), target.connect()]);
  const from = source.db("aibus"),
    to = target.db(targetName);
  const info = await from.listCollections({}, { nameOnly: false }).toArray();
  if (
    !info.some((c) => c.name === "users") ||
    !info.some((c) => c.name === "buses")
  )
    throw new Error("Original AIBUS collections are missing");
  const destination = await to
    .listCollections({}, { nameOnly: true })
    .toArray();
  // A fresh dedicated database avoids mixing existing Atlas test/application data.
  if (destination.length)
    throw new Error(
      "Destination aibus already has collections; refusing automatic merge or overwrite",
    );
  if (
    info.some(
      (c) => c.type !== "collection" || !/^[A-Za-z0-9_-]+$/.test(c.name),
    )
  )
    throw new Error(
      "Unexpected collection type or name requires manual review",
    );
  const roleCounts = await from
    .collection("users")
    .aggregate([{ $group: { _id: "$role", count: { $sum: 1 } } }])
    .toArray();
  log({
    phase,
    source: "local Docker / aibus",
    destination: "Atlas / aibus",
    destinationEmpty: true,
    collections: info.length,
    userRoles: roleCounts,
    apply,
  });
  if (apply) {
    phase = "backup";
    await fs.mkdir(path.join(backup, "aibus"), { recursive: true });
    const metadata = new Map();
    for (const c of info)
      metadata.set(c.name, {
        options: c.options || {},
        indexes: await from.collection(c.name).listIndexes().toArray(),
        collectionName: c.name,
        type: "collection",
      });
    const session = source.startSession();
    const rows = new Map();
    const report = {
      source: "local Docker / aibus",
      destination: "Atlas / aibus",
      createdAt: new Date().toISOString(),
      status: "backing-up",
      collections: [],
      accounts: {},
      containsSensitiveData: true,
    };
    try {
      session.startTransaction({ readConcern: { level: "snapshot" } });
      for (const c of info) {
        // Native BSON bypasses Mongoose hooks/defaults: IDs, timestamps and hashes survive.
        const docs = await from
          .collection(c.name)
          .find({}, { session, promoteValues: false })
          .sort({ _id: 1 })
          .toArray();
        const bytes = Buffer.concat(docs.map((d) => BSON.serialize(d)));
        rows.set(c.name, docs);
        await fs.writeFile(
          path.join(backup, "aibus", `${c.name}.bson`),
          bytes,
          { flag: "wx" },
        );
        await fs.writeFile(
          path.join(backup, "aibus", `${c.name}.metadata.json`),
          BSON.EJSON.stringify(metadata.get(c.name), { relaxed: false }),
          { flag: "wx" },
        );
        report.collections.push({
          name: c.name,
          documents: docs.length,
          bsonSha256: digest(bytes),
          indexes: metadata.get(c.name).indexes.length,
        });
      }
      await session.commitTransaction();
    } catch (error) {
      await session.abortTransaction().catch(() => {});
      throw error;
    } finally {
      await session.endSession();
    }
    report.status = "backup-verified";
    await fs.writeFile(
      path.join(backup, "manifest.json"),
      JSON.stringify(report, null, 2),
    );
    await fs.writeFile(
      path.join(backup, "destination-before.json"),
      JSON.stringify({
        database: targetName,
        collections: [],
        existedWithData: false,
      }),
    );
    for (const c of report.collections) {
      if (
        digest(
          await fs.readFile(path.join(backup, "aibus", `${c.name}.bson`)),
        ) !== c.bsonSha256
      )
        throw new Error("Local backup checksum mismatch");
    }
    log({
      phase: "backup-verified",
      directory: path.relative(root, backup),
      documents: report.collections.reduce((n, c) => n + c.documents, 0),
    });
    phase = "create-collections-and-indexes";
    for (const c of info) {
      const meta = metadata.get(c.name);
      await to.createCollection(c.name, meta.options);
      const indexes = meta.indexes
        .filter((i) => i.name !== "_id_")
        .map(({ v, ns, buildUUID, ...index }) => index);
      if (indexes.length) await to.collection(c.name).createIndexes(indexes);
    }
    log({ phase: "indexes-ready", collections: info.length });
    phase = "atomic-copy";
    const writeSession = target.startSession();
    try {
      await writeSession.withTransaction(
        async () => {
          for (const c of info) {
            if (
              await to
                .collection(c.name)
                .countDocuments({}, { session: writeSession })
            )
              throw new Error(
                "Destination changed during transfer; refusing overwrite",
              );
            const docs = rows.get(c.name);
            if (docs.length)
              await to
                .collection(c.name)
                .insertMany(docs, { session: writeSession, ordered: true });
          }
        },
        { writeConcern: { w: "majority" }, readConcern: { level: "snapshot" } },
      );
    } finally {
      await writeSession.endSession();
    }
    phase = "verify";
    for (const c of report.collections) {
      const docs = await to
        .collection(c.name)
        .find({}, { promoteValues: false })
        .sort({ _id: 1 })
        .toArray();
      const copied = digest(Buffer.concat(docs.map((d) => BSON.serialize(d))));
      if (docs.length !== c.documents || copied !== c.bsonSha256)
        throw new Error(
          `Verification mismatch in ${c.name}; preserve backups and inspect before use`,
        );
      const actualIndexes = await to.collection(c.name).listIndexes().toArray();
      if (actualIndexes.length !== c.indexes)
        throw new Error(`Index count mismatch in ${c.name}`);
      c.verified = true;
    }
    let hashes = 0;
    for (const original of rows.get("users")) {
      const copied = await to
        .collection("users")
        .findOne(
          { _id: original._id },
          {
            projection: {
              passwordHash: 1,
              role: 1,
              operatorId: 1,
              partnerId: 1,
            },
          },
        );
      if (
        !copied ||
        copied.passwordHash !== original.passwordHash ||
        copied.role !== original.role ||
        String(copied.operatorId) !== String(original.operatorId) ||
        String(copied.partnerId) !== String(original.partnerId)
      )
        throw new Error("Account password or ownership verification failed");
      hashes++;
    }
    report.accounts = {
      passwordHashesPreserved: hashes,
      rolesAndOwnershipPreserved: true,
    };
    report.status = "verified";
    await fs.writeFile(
      path.join(backup, "manifest.json"),
      JSON.stringify(report, null, 2),
    );
    log({
      phase: "verified",
      database: targetName,
      collections: report.collections.length,
      documents: report.collections.reduce((n, c) => n + c.documents, 0),
      passwordHashesPreserved: hashes,
      backup: path.relative(root, backup),
    });
  }
} catch (error) {
  // Do not print raw connection errors: provider exceptions can include credentials.
  log({
    phase,
    status: "failed",
    type: error.name,
    code: error.codeName || error.code || "TRANSFER_STOPPED",
    action:
      "No records are deleted or overwritten; inspect private backup before retrying",
  });
  process.exitCode = 1;
} finally {
  await Promise.allSettled([source.close(), target.close()]);
}
