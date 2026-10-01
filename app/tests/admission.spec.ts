import { getAddressDecoder } from "@solana/kit";
import { test, expect, type Page } from "@playwright/test";

// UC1 in a browser, against the real gate on an isolated surfnet
// (scripts/test-server.ts). Every outcome asserted here is the gate's, read
// back from chain state; the screens do not simulate a decision.

const GATE = "55fu8EtaF3Zsp35cXtWvQvBi9iVeGgCKms6WWbanj1zz";

async function surfnet(method: string, params: unknown[]) {
  const response = await fetch("http://127.0.0.1:18999", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return (await response.json()).result;
}

async function accountData(address: string) {
  const result = await surfnet("getAccountInfo", [
    address,
    { encoding: "base64", commitment: "confirmed" },
  ]);
  return Buffer.from(result.value.data[0], "base64");
}

async function tokenState(token: string) {
  return (await accountData(token))[108];
}

const readKey = (data: Buffer, offset: number) =>
  getAddressDecoder().decode(data.subarray(offset, offset + 32));

/** Open the collapsed chain details and return them. */
async function chainDetails(page: Page) {
  const details = page.locator("details.chain-details");
  await details.getByText("Chain details").click();
  return details;
}

/** A confirmed transaction links to Surfpool Studio; a refusal links nowhere. */
async function expectTransactionLink(page: Page, linked: boolean) {
  const link = page.getByRole("status").getByRole("link", { name: /View transaction/ });
  if (!linked) return expect(link).toHaveCount(0);
  await expect(link).toHaveAttribute("href", /^http:\/\/127\.0\.0\.1:19488\/\?t=[1-9A-HJ-NP-Za-km-z]{64,88}$/);
  await expect(link).toHaveAttribute("target", "_blank");
}

async function issue(page: Page, who: "lena" | "mark", validity = "year") {
  await page.goto("/issuer");
  await page.getByLabel("Investor wallet — who this credential is for").selectOption(who);
  await page.getByLabel("Valid until").selectOption(validity);
  await page.getByRole("button", { name: "Issue credential", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Credential issued and confirmed");
  await expectTransactionLink(page, true);
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
  await expectTransactionLink(page, false);
  await expect((await chainDetails(page)).getByLabel("Program logs")).toContainText(
    `Program ${GATE} failed`,
  );
  await expect(page.getByTestId("account-state")).toHaveText("Frozen");

  // A frozen account cannot receive the fund's token.
  await page.goto("/operator");
  await page.getByRole("button", { name: "Allocate 25,000" }).first().click();
  await expect(page.getByRole("status")).toContainText("frozen account cannot receive");
  await expectTransactionLink(page, false);

  // Screens 3 and 4: issue, then admission. Lena's credential is short-lived so
  // it can lapse after admission, below.
  await issue(page, "lena", "two-minutes");
  const signature = (await (await chainDetails(page)).locator("code").innerText()).trim();
  expect(signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
  await page.goto("/investor/lena");
  await page.getByRole("button", { name: "Request access" }).click();
  await expect(page.getByRole("status")).toContainText("Admission confirmed on-chain");
  await expectTransactionLink(page, true);
  await expect(page.getByTestId("account-state")).toHaveText("Active");
  await expect(page.getByText("Admission checks — all passed")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("account-state")).toHaveText("Active");
  // An admitted account is not shown the requirements for admission.
  await expect(page.getByText("To be admitted, you need")).toHaveCount(0);
  await expect(page.getByTestId("lapsed-admission")).toHaveCount(0);

  await page.goto("/operator");
  await page.getByRole("button", { name: "Allocate 25,000" }).first().click();
  await expect(page.getByRole("status")).toContainText("25,000 MERID received");
  await expectTransactionLink(page, true);
  // An active account can receive MERID repeatedly: a second click mints again.
  await page.getByRole("button", { name: "Allocate 25,000" }).first().click();
  await expect(page.getByRole("status")).toContainText("25,000 MERID received");
  // A retried request (same ID, e.g. after a lost response) returns the original
  // outcome and mints nothing more.
  const requestId = crypto.randomUUID();
  const allocate = () =>
    request.post("/api/demo", {
      headers: { Origin: "http://127.0.0.1:3300" },
      data: { action: "allocate", investor: "lena", requestId },
    });
  const first = await (await allocate()).json();
  const replay = await (await allocate()).json();
  expect(first.ok).toBe(true);
  expect(replay.signature).toBe(first.signature);

  // Screen 6: a genuine, current credential refused on region alone.
  await issue(page, "mark");
  await page.goto("/investor/mark");
  await page.getByRole("button", { name: "Request access" }).click();
  await expect(page.getByRole("status")).toContainText("Region not accepted");
  await expect(page.getByRole("status")).toContainText("Claim · 13");
  await expectTransactionLink(page, false);
  await expect(page.getByTestId("account-state")).toHaveText("Frozen");

  const state = await (await request.get("/api/demo")).json();
  expect(JSON.stringify(state)).not.toMatch(/Seed|privateKey|secretKey/);

  // The roles are separate on-chain, not just in labels or the session file.
  // SAS credential: `0 | authority | name (u32 + bytes) | signers (u32 + keys)`.
  const { registry, issuer, fund } = state;
  const credential = await accountData(registry.credential);
  expect(credential[0]).toBe(0);
  expect(readKey(credential, 1)).toBe(registry.authority);
  expect(new Set([registry.authority, issuer.address, fund.configAuthority]).size).toBe(3);
  const nameLength = credential.readUInt32LE(33);
  expect(credential.subarray(37, 37 + nameLength).toString()).toBe(registry.credentialName);
  // Exactly one authorized signer, the issuer: the authority is not one.
  expect(credential.readUInt32LE(37 + nameLength)).toBe(1);
  expect(readKey(credential, 41 + nameLength)).toBe(issuer.address);
  // Every attestation was signed by the issuer. Its `signer` sits after the
  // variable-length claim: `101 + data_len`.
  for (const investor of state.investors) {
    const evidence = await accountData(investor.credential.address);
    expect(readKey(evidence, 101 + evidence.readUInt32LE(97))).toBe(issuer.address);
  }
  expect(await tokenState(state.investors[0].token)).toBe(1);
  expect(await tokenState(state.investors[1].token)).toBe(2);
  // Two clicks and one request sent twice: exactly three allocations.
  expect(state.investors[0].balance).toBe(75_000);
  await page.screenshot({ path: "test-results/uc1-denial.png", fullPage: true });

  // Admission is a past decision. Once Lena's credential lapses her account
  // stays active, and the screen must say so rather than imply compliance.
  // Everything below navigates in-app, never reloading the page: the screens
  // must catch up with the chain through Refresh and navigation alone.
  await page.getByRole("link", { name: "Lena R.", exact: true }).click();
  await expect(page.getByTestId("account-state")).toHaveText("Active");
  await expect(page.getByTestId("lapsed-admission")).toHaveCount(0);
  const now = Number((await request.get("/api/status").then((r) => r.json())).now);
  await surfnet("surfnet_timeTravel", [{ absoluteTimestamp: (now + 300) * 1000 }]);
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByTestId("lapsed-admission")).toContainText(
    "Your credential has since expired",
  );
  await expect(page.getByText("was admitted when its credential met the fund")).toBeVisible();
  await expect(page.getByText(/meets the fund.s policy/)).toHaveCount(0);
  expect(await tokenState(state.investors[0].token)).toBe(1);

  // Moving between screens re-reads state: a mint made outside this page shows
  // up on the operator screen reached through an in-app link.
  const outside = await request.post("/api/demo", {
    headers: { Origin: "http://127.0.0.1:3300" },
    data: { action: "allocate", investor: "lena" },
  });
  expect((await outside.json()).ok).toBe(true);
  await page.getByRole("link", { name: "Receive MERID" }).click();
  await expect(page.getByText("100,000 MERID")).toBeVisible();

  // A read started by navigating during an action must not overwrite that
  // action's newer result. Force the worst ordering: the allocation is held
  // until a navigation read has fetched the pre-allocation state, and that read
  // is delivered only after the allocation has finished. A screen that does not
  // read during an action releases the allocation after a short wait instead.
  let navigationFetched!: () => void;
  const fetchedOld = new Promise<void>((resolve) => (navigationFetched = resolve));
  const allocated = page.waitForResponse(
    (r) => r.url().endsWith("/api/demo") && r.request().method() === "POST",
  );
  await page.route("**/api/demo", async (route) => {
    if (route.request().method() === "POST") {
      await Promise.race([fetchedOld, new Promise((r) => setTimeout(r, 1500))]);
      return route.continue();
    }
    const stale = await route.fetch();
    navigationFetched();
    await allocated;
    await route.fulfill({ response: stale });
  });
  await page.getByRole("button", { name: "Allocate 25,000" }).first().click();
  await page.getByRole("link", { name: "Open investor view" }).click();
  await allocated;
  await expect(page.getByText("125,000")).toBeVisible();
  await page.waitForTimeout(1000); // room for a late read to land, if one was made
  await expect(page.getByText("125,000")).toBeVisible();
  await page.unroute("**/api/demo");

  const paths = ["/", "/operator", "/authority", "/issuer", "/investor/lena", "/investor/mark", "/status"];
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const path of paths) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        `${path} must not scroll horizontally at ${width}px`,
      ).toBeLessThanOrEqual(width);
    }
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
