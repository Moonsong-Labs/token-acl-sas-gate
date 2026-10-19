import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Regenerates the README screenshots in docs/images/screenshots: `mise run
// screenshots`. Kept out of the e2e suite, which asserts behaviour rather than
// pixels; this walk only waits for each screen's outcome before capturing it.
export default defineConfig({
  ...base,
  testDir: "./screenshots",
  use: { ...base.use, viewport: { width: 1280, height: 860 } },
});
