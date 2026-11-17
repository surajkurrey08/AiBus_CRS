import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const backend = path.join(root, "backend");
const output = path.resolve(backend, "dist");
if (path.dirname(output) !== backend || path.basename(output) !== "dist") {
  throw new Error("Refusing to clean outside backend/dist");
}
// Compiled files only: prevent old entrypoints surviving a source move.
fs.rmSync(output, { recursive: true, force: true });
const result = spawnSync(
  process.execPath,
  [path.join(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"],
  { cwd: backend, stdio: "inherit" },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
