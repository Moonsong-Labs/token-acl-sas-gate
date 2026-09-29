import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  workers: 1,
  timeout: 90000,
  use: { baseURL: "http://127.0.0.1:3300", trace: "retain-on-failure" },
  webServer: {
    command: "npx tsx scripts/test-server.ts",
    url: "http://127.0.0.1:3300",
    timeout: 120000,
    reuseExistingServer: false,
  },
});
