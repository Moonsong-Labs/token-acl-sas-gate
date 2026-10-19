import { test, expect, type Page } from "@playwright/test";

// Walks the demo on a freshly seeded, isolated surfnet (scripts/test-server.ts)
// and writes the README screenshots. Each capture waits for the outcome it
// shows, so a screen that no longer reaches that state fails here instead of
// producing a misleading image.

const OUT = "../docs/images/screenshots";

async function capture(page: Page, name: string) {
  // Keep hover and focus styles out of the image.
  await page.mouse.move(0, 0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
}

async function issue(page: Page, who: "lena" | "mark") {
  await page.goto("/issuer");
  await page.getByLabel("Investor wallet — who this credential is for").selectOption(who);
  await page.getByLabel("Valid until").selectOption("year");
  await page.getByRole("button", { name: "Issue credential", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Credential issued and confirmed");
}

async function requestAccess(page: Page, who: "lena" | "mark", outcome: string) {
  await page.goto(`/investor/${who}`);
  await page.getByRole("button", { name: "Request access" }).click();
  await expect(page.getByRole("status")).toContainText(outcome);
}

test("README screenshots", async ({ page }) => {
  await page.goto("/");
  await capture(page, "01-overview");

  await page.goto("/operator");
  for (const step of [
    "Fund token created",
    "Access handed to the eligibility gate",
    "Eligibility checks wired in",
    "Investors can request access",
  ])
    await expect(page.getByText(`${step} — done`)).toBeAttached();
  await capture(page, "02-operator-fund-setup");

  await page.goto("/authority");
  await expect(page.getByRole("listitem").filter({ hasText: "Acme KYC" })).toBeVisible();
  await capture(page, "03-authority");

  await requestAccess(page, "lena", "No credential on file");
  await capture(page, "04-investor-lena-refused-no-credential");

  await issue(page, "lena");
  await capture(page, "05-issuer-credential-issued");

  await requestAccess(page, "lena", "Admission confirmed on-chain");
  await expect(page.getByTestId("account-state")).toHaveText("Active");
  await capture(page, "06-investor-lena-admitted");

  await page.goto("/operator");
  await page.getByRole("button", { name: "Allocate 25,000" }).first().click();
  await expect(page.getByRole("status")).toContainText("25,000 MERID received");
  await capture(page, "07-operator-allocation-received");

  await issue(page, "mark");
  await requestAccess(page, "mark", "Region not accepted");
  await capture(page, "08-investor-mark-denied-region");

  await page.goto("/status");
  await page.waitForLoadState("networkidle");
  await capture(page, "09-network-status");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/investor/lena");
  await expect(page.getByTestId("account-state")).toHaveText("Active");
  await capture(page, "10-phone-investor-lena");
});
