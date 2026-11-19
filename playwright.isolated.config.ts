import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/isolated",
  workers: 1,
  retries: 0,
  timeout: 45000,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report/isolated", open: "never" }],
  ],
  use: {
    channel: "chrome",
    headless: true,
    viewport: { width: 1280, height: 850 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    { command: "node node_modules/vite/bin/vite.js partner --config partner/vite.config.ts --host 127.0.0.1 --port 15176", url:"http://127.0.0.1:15176", reuseExistingServer:false, env:{VITE_API_TARGET:"http://127.0.0.1:14100"} },
    {
      command:
        "node node_modules/tsx/dist/cli.mjs backend/tests/browser-harness.ts",
      url: "http://127.0.0.1:14100/health/ready",
      reuseExistingServer: false,
      timeout: 180000,
    },
    {
      command:
        "node node_modules/vite/bin/vite.js frontend --config frontend/vite.config.ts --host 127.0.0.1 --port 15173",
      url: "http://127.0.0.1:15173",
      reuseExistingServer: false,
      env: { VITE_API_TARGET: "http://127.0.0.1:14100" },
    },
    {
      command:
        "node node_modules/vite/bin/vite.js admin --config admin/vite.config.ts --host 127.0.0.1 --port 15174",
      url: "http://127.0.0.1:15174",
      reuseExistingServer: false,
      env: { VITE_API_TARGET: "http://127.0.0.1:14100" },
    },
  ],
});
