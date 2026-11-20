import { defineConfig } from "@playwright/test";
// UI contract checks use intercepted fixture APIs; database behavior is covered
// separately by the real MongoMemoryReplSet integration suite.
export default defineConfig({
  testDir: "./tests/ui",
  testMatch: "city-catalog.spec.ts",
  workers: 1,
  timeout: 45000,
  use: { channel: "chrome", headless: true, baseURL: "http://127.0.0.1:15274", screenshot: "only-on-failure", trace: "retain-on-failure" },
  webServer: {
    command: "node node_modules/vite/bin/vite.js admin --config admin/vite.config.ts --host 127.0.0.1 --port 15274",
    url: "http://127.0.0.1:15274", reuseExistingServer: false,
  },
});
