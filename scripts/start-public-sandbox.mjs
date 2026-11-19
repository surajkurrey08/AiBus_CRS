import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn } from "node:child_process";
import { parse } from "dotenv";

const root = fileURLToPath(new URL("../", import.meta.url));
const envFile = path.join(root, "backend/.env.public-sandbox");
const sandbox = parse(await fs.readFile(envFile, "utf8"));
if (
  sandbox.PORT !== "4001" ||
  sandbox.PUBLIC_API_SANDBOX !== "true" ||
  sandbox.NODE_ENV === "production" ||
  !new URL(sandbox.MONGODB_URI).pathname.startsWith("/aibus_public_sandbox_")
)
  throw new Error(
    "Refusing to start without a dedicated test database and port",
  );
const child = spawn(process.execPath, ["dist/server.js"], {
  cwd: path.join(root, "backend"),
  env: { ...process.env, ...sandbox, DOTENV_CONFIG_PATH: envFile },
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 1));
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
