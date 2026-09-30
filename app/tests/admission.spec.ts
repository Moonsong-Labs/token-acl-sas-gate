import { test, expect, type Page } from "@playwright/test";

// UC1 in a browser, against the real gate on an isolated surfnet
// (scripts/test-server.ts). Every outcome asserted here is the gate's, read
// back from chain state; the screens do not simulate a decision.

async function tokenState(token: string) {
  const response = await fetch("http://127.0.0.1:18999", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getAccountInfo",
      params: [token, { encoding: "base64", commitment: "confirmed" }],
    }),
  });
  return Buffer.from((await response.json()).result.value.data[0], "base64")[108];
}

async function issue(page: Page, who: "lena" | "mark") {
  await page.goto("/issuer");
  await page.getByLabel("Investor wallet — who this credential is for").selectOption(who);
  await page.getByRole("button", { name: "Issue credential", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Credential issued and confirmed");
}

test("UC1: no credential is refused, DE is admitted and receives, US is denied", async ({
  page,
  request,
}) => {
  // Operator: every setup step reads true from chain.
  await page.goto("/operator");
  await expect(page.getByRole("heading", { name: "Meridian EU Retail" })).toBeVisible();
  for (const step of [
    "Fund token created",
    "Access handed to the eligibility gate",
    "Eligibility checks wired in",
    "Investors can request access",
  ])
    await expect(page.getByText(`${step} — done`)).toBeAttached();

  // Credential authority: a separate key, with Acme KYC as its authorized issuer.
  await page.goto("/authority");
  await expect(page.getByRole("heading", { name: "KYC Trust Registry" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Acme KYC" })).toBeVisible();

  // Screen 2: the request is made and refused before any policy step.
  await page.goto("/investor/lena");
  await expect(page.getByTestId("account-state")).toHaveText("Frozen");
  await page.getByRole("button", { name: "Request access" }).click();
  await expect(page.getByRole("status")).toContainText("No credential on file");
  await expect(page.getByRole("status")).toContainText("Owner · 2");
  await expect(page.getByTestId("account-state")).toHaveText("Frozen");

  // A frozen account cannot receive the fund's token.
  await page.goto("/operator");
  await page.getByRole("button", { name: "Allocate 25,000" }).first().click();
  await expect(page.getByRole("status")).toContainText("frozen account cannot receive");

  // Screens 3 and 4: issue, then admission.
  await issue(page, "lena");
  await page.goto("/investor/lena");
  await page.getByRole("button", { name: "Request access" }).click();
  await expect(page.getByRole("status")).toContainText("Admission confirmed on-chain");
  await expect(page.getByTestId("account-state")).toHaveText("Active");
  await expect(page.getByText("Admission checks — all passed")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("account-state")).toHaveText("Active");

  await page.goto("/operator");
  await page.getByRole("button", { name: "Allocate 25,000" }).first().click();
  await expect(page.getByRole("status")).toContainText("25,000 MERID received");

  // Screen 6: a genuine, current credential refused on region alone.
  await issue(page, "mark");
  await page.goto("/investor/mark");
  await page.getByRole("button", { name: "Request access" }).click();
  await expect(page.getByRole("status")).toContainText("Region not accepted");
  await expect(page.getByRole("status")).toContainText("Claim · 13");
  await expect(page.getByTestId("account-state")).toHaveText("Frozen");

  const state = await (await request.get("/api/demo")).json();
  expect(JSON.stringify(state)).not.toMatch(/Seed|privateKey|secretKey/);
  expect(await tokenState(state.investors[0].token)).toBe(1);
  expect(await tokenState(state.investors[1].token)).toBe(2);
  await page.screenshot({ path: "test-results/uc1-denial.png", fullPage: true });

  for (const path of ["/", "/operator", "/authority", "/issuer", "/investor/mark", "/status"]) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `${path} must not scroll horizontally at phone width`,
    ).toBe(true);
  }
  await page.screenshot({ path: "test-results/uc1-mobile.png", fullPage: true });

  const unsupported = await request.post("/api/demo", {
    headers: { Origin: "http://127.0.0.1:3300" },
    data: { action: "freeze", investor: "lena" },
  });
  expect(unsupported.status()).toBe(400);
  const crossOrigin = await request.post("/api/demo", {
    headers: { Origin: "https://example.com" },
    data: { action: "issue", investor: "lena" },
  });
  expect(crossOrigin.status()).toBe(400);
});
