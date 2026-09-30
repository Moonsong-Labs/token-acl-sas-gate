import { getAddressDecoder } from "@solana/kit";
import { test, expect } from "@playwright/test";
async function accountData(token: string) {
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
  return Buffer.from((await response.json()).result.value.data[0], "base64");
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
  // Check the on-chain delegation, not just the labels or manifest keys.
  const decodeKey = (data: Buffer, offset: number) =>
    getAddressDecoder().decode(data.subarray(offset, offset + 32));
  const credential = await accountData(state.fund.credential);
  expect(credential[0]).toBe(0);
  expect(decodeKey(credential, 1)).toBe(state.fund.authority);
  expect(state.fund.authority).not.toBe(state.fund.issuer);
  const nameLength = credential.readUInt32LE(33);
  expect(credential.subarray(37, 37 + nameLength).toString()).toBe(
    "Aster Identity",
  );
  expect(credential.readUInt32LE(37 + nameLength)).toBe(1);
  expect(decodeKey(credential, 41 + nameLength)).toBe(state.fund.issuer);
  for (const investor of state.investors) {
    const evidence = await accountData(investor.credential.address);
    expect(decodeKey(evidence, 101 + evidence.readUInt32LE(97))).toBe(
      state.fund.issuer,
    );
  }
  await expect(page.getByText("Aster Identity", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Aster Verification Desk", { exact: true }),
  ).toBeVisible();
  expect(
    state.investors.map((investor: { name: string }) => investor.name),
  ).toEqual(["Alice Adler", "Bob Brooks"]);

  expect((await accountData(state.investors[0].token))[108]).toBe(1);
  expect((await accountData(state.investors[1].token))[108]).toBe(2);
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
