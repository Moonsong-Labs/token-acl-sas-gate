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

test("UC1 and UC2: admission, credential lifecycle, sponsor freeze and block precedence", async ({
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
  // UC5: the same freshly issued evidence is evaluated under a second mint.
  const sharedBefore = await (await request.get("/api/demo")).json();
  expect(sharedBefore.second.investors[0].wallet).toBe(sharedBefore.investors[0].wallet);
  expect(sharedBefore.second.investors[0].credential).toEqual(sharedBefore.investors[0].credential);
  expect(sharedBefore.second.fund.policy.credential).toBe(sharedBefore.fund.policy.credential);
  expect(sharedBefore.second.fund.policy.schema).toBe(sharedBefore.fund.policy.schema);
  expect(sharedBefore.second.fund.policy.maxAge).toBe(sharedBefore.fund.policy.maxAge);
  const crossFundId = crypto.randomUUID();
  const usRequest = { action: "activate", investor: "lena", fund: "us", requestId: crossFundId };
  const usResult = await request.post("/api/demo", {
    headers: { origin: "http://127.0.0.1:3300" }, data: usRequest,
  });
  expect((await usResult.json()).decision.code).toBe(13);
  const wrongFundRetry = await request.post("/api/demo", {
    headers: { origin: "http://127.0.0.1:3300" }, data: { ...usRequest, fund: "retail" },
  });
  expect(wrongFundRetry.status()).toBe(400);
  await page.goto("/funds");
  await page.getByRole("button", { name: "Request access to Meridian US", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Claim · 13");
  await expect(page.getByTestId("fund-state-1")).toHaveText("Frozen");
  await expectTransactionLink(page, false);
  expect(await tokenState(sharedBefore.second.investors[0].token)).toBe(2);
  await page.getByRole("button", { name: "Request access to Meridian EU Retail", exact: true }).click();
  await expect(page.getByTestId("fund-state-0")).toHaveText("Active");
  await expectTransactionLink(page, true);
  expect(await tokenState(sharedBefore.investors[0].token)).toBe(1);
  const sharedAfter = await (await request.get("/api/demo")).json();
  expect(sharedAfter.investors[0].credential).toEqual(sharedBefore.investors[0].credential);
  // Freeze retail again so the original UC1 walkthrough still requests admission.
  const frozen = await request.post("/api/demo", {
    headers: { origin: "http://127.0.0.1:3300" },
    data: { action: "freeze", investor: "lena" },
  });
  expect((await frozen.json()).ok).toBe(true);

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
  await page.goto("/funds");
  await page.getByLabel("Compare access for").selectOption("mark");
  await page.getByRole("button", { name: "Request access to Meridian EU Retail", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Claim · 13");
  await expect(page.getByTestId("fund-state-0")).toHaveText("Frozen");
  await page.getByRole("button", { name: "Request access to Meridian US", exact: true }).click();
  await expect(page.getByTestId("fund-state-1")).toHaveText("Active");
  await expectTransactionLink(page, true);
  const markFunds = await (await request.get("/api/demo")).json();
  expect(markFunds.second.investors[1].credential).toEqual(markFunds.investors[1].credential);
  expect(await tokenState(markFunds.investors[1].token)).toBe(2);
  expect(await tokenState(markFunds.second.investors[1].token)).toBe(1);
  await page.screenshot({ path: "/tmp/doors-uc5-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/doors-uc5-phone.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
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

  // UC2: expiry did not freeze Lena. The sponsor now enforces it.
  const compliance = async () => {
    await page.goto("/compliance");

  };
  await compliance();
  await page.getByRole("button", { name: "Freeze account", exact: true }).first().click();
  await expect(page.getByRole("status").first()).toContainText("Sponsor freeze confirmed");
  await page.goto("/investor/lena");
  await expect(page.getByTestId("account-state")).toHaveText("Frozen");
  await expect(page.getByText("125,000")).toBeVisible();
  await page.getByRole("button", { name: "Request access" }).click();
  await expect(page.getByRole("status")).toContainText("Expired · 9");

  const renew = async (verified = "today") => {
    await page.goto("/issuer");
    await page.getByLabel("KYC completed").selectOption(verified);
    await page.getByRole("button", { name: "Renew credential", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Credential renewed and confirmed");
  };
  await renew("two-years");
  await page.goto("/investor/lena");
  await page.getByRole("button", { name: "Request access" }).click();
  await expect(page.getByRole("status")).toContainText("Freshness · 10");
  await renew();
  await page.goto("/investor/lena");
  await expect(page.getByTestId("account-state")).toHaveText("Frozen");
  await page.getByRole("button", { name: "Request access" }).click();
  await expect(page.getByTestId("account-state")).toHaveText("Active");

  // Native SAS closure does not freeze an already admitted account.
  await page.goto("/issuer");
  await page.getByRole("button", { name: "Revoke credential" }).click();
  await expect(page.getByRole("status")).toContainText("Credential revoked");
  await page.goto("/investor/lena");
  await expect(page.getByTestId("account-state")).toHaveText("Active");
  await expect(page.getByTestId("lapsed-admission")).toContainText("no longer on file");
  await compliance();
  await page.getByRole("button", { name: "Freeze account", exact: true }).first().click();
  await expect(page.getByRole("status").first()).toContainText("Sponsor freeze confirmed");
  await page.goto("/investor/lena");
  await page.getByRole("button", { name: "Request access" }).click();
  await expect(page.getByRole("status")).toContainText("Owner · 2");
  // No replacement exists until the issuer writes one.
  await issue(page, "lena");
  await page.goto("/investor/lena");
  await expect(page.getByTestId("account-state")).toHaveText("Frozen");
  await page.getByRole("button", { name: "Request access" }).click();
  await expect(page.getByTestId("account-state")).toHaveText("Active");

  await compliance();
  await page.getByRole("button", { name: "Freeze account", exact: true }).first().click();
  await expect(page.getByRole("status").first()).toContainText("Sponsor freeze confirmed");
  await page.getByRole("button", { name: "Add compliance hold" }).first().click();
  await expect(page.getByRole("status").first()).toContainText("Compliance hold added");
  await page.getByRole("button", { name: "Invalidate wallet", exact: true }).first().click();
  await expect(page.getByRole("status").first()).toContainText("Wallet invalidated");
  await renew();
  await page.goto("/investor/lena");
  await page.getByRole("button", { name: "Request access" }).click();
  await expect(page.getByRole("status")).toContainText("Blocked · 5");
  await compliance();
  await page.getByRole("button", { name: "Remove compliance hold" }).first().click();
  await expect(page.getByRole("status").first()).toContainText("Compliance hold removed");
  await page.goto("/investor/lena");
  await page.getByRole("button", { name: "Request access" }).click();
  await expect(page.getByRole("status")).toContainText("Invalidated · 11");
  await compliance();
  await page.getByRole("button", { name: "Clear wallet invalidation" }).first().click();
  await expect(page.getByRole("status").first()).toContainText("Wallet invalidation cleared");
  await page.goto("/investor/lena");
  await page.getByRole("button", { name: "Request access" }).click();
  await expect(page.getByTestId("account-state")).toHaveText("Active");
  await page.reload();
  await expect(page.getByTestId("access-timeline")).toContainText("Access withdrawn by sponsor freeze");
  await expect(page.getByTestId("access-timeline")).toContainText("Credential revoked");
  await expect(page.getByTestId("access-timeline")).toContainText("Credential renewed");
  await expect(page.getByTestId("access-timeline")).toContainText("Access granted");
  const restored = await (await request.get("/api/demo")).json();
  expect(restored.investors[0].balance).toBe(125_000);
  expect(await tokenState(restored.investors[0].token)).toBe(1);
  expect(restored.investors[0].walletStatus).toEqual({ blocked: false, invalidated: false });
  await page.screenshot({ path: "test-results/uc2-restored.png", fullPage: true });

  const paths = ["/funds", "/compliance", "/", "/operator", "/authority", "/issuer", "/investor/lena", "/investor/mark", "/status"];
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
    data: { action: "freeze-all", investor: "lena" },
  });
  expect(unsupported.status()).toBe(400);
  const crossOrigin = await request.post("/api/demo", {
    headers: { Origin: "https://example.com" },
    data: { action: "issue", investor: "lena" },
  });
  expect(crossOrigin.status()).toBe(400);
});

for (const method of ["getSignaturesForAddress", "getTransaction"]) {
  test(`UC2 enforcement remains available when ${method} fails`, async ({ page, request }) => {
    const action = async (name: string) => {
      const response = await request.post("/api/demo", {
        headers: { Origin: "http://127.0.0.1:3300" },
        data: { action: name, investor: "lena", requestId: crypto.randomUUID() },
      });
      expect(response.status()).toBe(200);
      return response.json();
    };
    // Each case can run independently against the seeded real programs.
    const original = await (await request.get("/api/demo")).json();
    await action(original.investors[0].credential ? "renew" : "issue");
    expect((await action("unblock")).ok).toBe(true);
    expect((await action("validate")).ok).toBe(true);
    const ready = await (await request.get("/api/demo")).json();
    if (!ready.investors[0].active) expect((await action("activate")).ok).toBe(true);
    const token = ready.investors[0].token;

    await request.post("http://127.0.0.1:19001/fault", { data: { method } });
    try {
      await page.goto("/investor/lena");
      await expect(page.getByTestId("account-state")).toHaveText("Active");
      await expect(page.getByTestId("timeline-unavailable")).toBeVisible();
      await expect(page.getByTestId("access-timeline")).toHaveCount(0);
      const frozen = await action("freeze");
      expect(frozen.ok).toBe(true);
      expect(frozen.signature).toBeTruthy();
      expect(frozen.state.investors[0].timelineUnavailable).toBe(true);
      expect(await tokenState(token)).toBe(2);
      const held = await action("block");
      expect(held.ok).toBe(true);
      expect(held.state.investors[0].walletStatus.blocked).toBe(true);
      const revoked = await action("revoke");
      expect(revoked.ok).toBe(true);
      expect(revoked.state.investors[0].credential).toBeNull();
      // The hold allows new evidence; it denies admission until lifted.
      const issued = await action("issue");
      expect(issued.ok).toBe(true);
      expect(issued.state.investors[0].credential).not.toBeNull();
      const denied = await action("activate");
      expect(denied.ok).toBe(false);
      expect(denied.decision.code).toBe(5);
      expect(denied.state.investors[0].timelineUnavailable).toBe(true);
      expect((await action("unblock")).ok).toBe(true);
      const restored = await action("activate");
      expect(restored.ok).toBe(true);
      expect(await tokenState(token)).toBe(1);
      await page.getByRole("button", { name: "Refresh" }).click();
      await expect(page.getByTestId("timeline-unavailable")).toBeVisible();
      const fault = await (await request.get("http://127.0.0.1:19001/fault")).json();
      expect(fault.failures).toBeGreaterThan(0);
      await page.screenshot({ path: `test-results/uc2-history-unavailable-${method}.png`, fullPage: true });
    } finally {
      await request.post("http://127.0.0.1:19001/fault", { data: { method: null } });
    }
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByTestId("timeline-unavailable")).toHaveCount(0);
    await expect(page.getByTestId("access-timeline")).toContainText("Access withdrawn by sponsor freeze");
    await expect(page.getByTestId("access-timeline")).toContainText("Credential revoked");
    await expect(page.getByTestId("access-timeline")).toContainText("Access granted");
  });
}
