import { randomUUID } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, unlinkSync, existsSync } from "node:fs";
const runId = randomUUID(),
  registry = `.cache/e2e-redis-${runId}.json`;
let code = 1;
try {
  code = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "node_modules/@playwright/test/cli.js",
        "test",
        "--config",
        "playwright.isolated.config.ts",
        ...process.argv.slice(2),
      ],
      { stdio: "inherit", env: { ...process.env, AIBUS_E2E_RUN: runId } },
    );
    child.once("error", reject);
    child.once("exit", (status) => resolve(status ?? 1));
  });
} finally {
  if (existsSync(registry)) {
    const owned = JSON.parse(readFileSync(registry, "utf8"));
    if (owned.runId !== runId || !/^[a-f0-9]{64}$/.test(owned.id))
      throw Error("Refusing to clean up an unrecognized container identity");
    let label = "";
    try {
      label = execFileSync(
        "docker",
        [
          "inspect",
          "--format",
          '{{index .Config.Labels "aibus.test.run"}}',
          owned.id,
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
    } catch {
      /* Harness already stopped its own disposable container. */
    }
    if (label && label !== runId)
      throw Error("Refusing to stop another run's container");
    if (label === runId)
      execFileSync("docker", ["stop", owned.id], { stdio: "ignore" });
    unlinkSync(registry);
  }
}
process.exitCode = Number(code);
