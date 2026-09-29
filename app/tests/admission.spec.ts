import { test, expect } from "@playwright/test";
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
  return Buffer.from(
    (await response.json()).result.value.data[0],
    "base64",
  )[108];
}
test("UC1: missing evidence denies, DE admits, US denies", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Durin Private Credit Fund" }),
  ).toBeVisible();
  await expect(page.getByTestId("account-state")).toHaveText("Frozen");
  await page
    .getByRole("button", { name: "Activate account", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "No accepted credential",
  );
  await expect(page.getByTestId("account-state")).toHaveText("Frozen");
  await page.getByRole("button", { name: "Issuer view" }).click();
  await page
    .getByRole("button", { name: "Issue credential", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Credential issued and confirmed",
  );
  await page.getByRole("button", { name: "Investor view" }).click();
  await page
    .getByRole("button", { name: "Activate account", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Admission confirmed on-chain",
  );
  await expect(page.getByTestId("account-state")).toHaveText("Active");
  await page.reload();
  await expect(page.getByTestId("account-state")).toHaveText("Active");
  await page.getByLabel("Investor", { exact: true }).selectOption("bob");
  await page.getByRole("button", { name: "Issuer view" }).click();
  await page
    .getByRole("button", { name: "Issue credential", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Credential issued and confirmed",
  );
  await page.getByRole("button", { name: "Investor view" }).click();
  await page
    .getByRole("button", { name: "Activate account", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Jurisdiction not accepted",
  );
  await expect(page.getByTestId("account-state")).toHaveText("Frozen");
  const response = await request.get("/api/demo");
  const state = await response.json();
  expect(JSON.stringify(state)).not.toMatch(/Seed|privateKey|secretKey/);
  expect(await tokenState(state.investors[0].token)).toBe(1);
  expect(await tokenState(state.investors[1].token)).toBe(2);
  await page.screenshot({
    path: "test-results/uc1-denial.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/uc1-mobile.png",
    fullPage: true,
  });
  const unsupported = await request.post("/api/demo", {
    headers: { Origin: "http://127.0.0.1:3300" },
    data: { action: "freeze", investor: "alice" },
  });
  expect(unsupported.status()).toBe(400);
  const crossOrigin = await request.post("/api/demo", {
    headers: { Origin: "https://example.com" },
    data: { action: "issue", investor: "alice" },
  });
  expect(crossOrigin.status()).toBe(400);
});
