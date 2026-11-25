import path from "node:path";
import fs from "node:fs";
import { defineConfig } from "vitest/config";

const tempDir = path.resolve(__dirname, "..", ".temp");
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}
process.env.MONGOMS_TMP_DIR = tempDir;
process.env.TEMP = tempDir;
process.env.TMP = tempDir;

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 180000,
    fileParallelism: false,
    env: {
      MONGOMS_TMP_DIR: tempDir,
      TEMP: tempDir,
      TMP: tempDir,
      ENABLE_LEGACY_BUS_SELLING: "true",
      ENABLE_LEGACY_BUS_MASTER: "true",
    },
  },
});
