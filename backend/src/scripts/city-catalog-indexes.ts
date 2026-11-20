import mongoose from "mongoose";
import { readConfig } from "../config/env.js";
import {
  CatalogCity,
  CityCatalogImport,
} from "../models/city-catalog.model.js";
const apply = process.argv.includes("--apply");
await mongoose.connect(readConfig().MONGODB_URI, {
  autoIndex: false,
  autoCreate: false,
});
try {
  for (const model of [CatalogCity, CityCatalogImport]) {
    const installed = await model.collection
      .listIndexes()
      .toArray()
      .catch((error: any) => {
        if (error.code === 26) return [];
        throw error;
      });
    console.log(
      JSON.stringify({
        collection: model.collection.collectionName,
        installed: installed.map((i) => ({ key: i.key, unique: !!i.unique })),
        required: model.schema
          .indexes()
          .map(([keys, options]) => ({ keys, unique: !!options.unique })),
      }),
    );
    if (apply) await model.createIndexes();
  }
  console.log(
    apply
      ? "Additive City Catalog indexes provisioned. No existing indexes or records were removed."
      : "Read-only check complete. Review a current backup and rerun with --apply to provision these two catalog collections.",
  );
} finally {
  await mongoose.disconnect();
}
