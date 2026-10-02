import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

// How the screens report outcomes when the RPC misbehaves. The app reaches the
// surfnet through the fault proxy in scripts/test-server.ts, armed per test.
// Each test brings the shared session to the state it needs, so it does not
// depend on running after the walkthrough in admission.spec.ts.

const ORIGIN = { Origin: "http://127.0.0.1:3300" };

/** The app's error banner; Next.js adds its own empty role="alert" route announcer. */
const banner = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)');

async function faults(
  rules: { method: string; count: number; after?: string; code?: number; deliver?: boolean }[],
) {
  const response = await fetch("http://127.0.0.1:18998/__faults", {
    method: "POST",
    body: JSON.stringify({ rules }),
  });
  expect(response.status).toBe(204);
}

async function post(request: APIRequestContext, data: Record<string, unknown>) {
  return request.post("/api/demo", { headers: ORIGIN, data });
}

async function snapshot(request: APIRequestContext) {
  return (await request.get("/api/demo")).json();
}

async function balance(request: APIRequestContext, who: "lena" | "mark") {
  const state = await snapshot(request);
  return state.investors.find((i: { id: string }) => i.id === who).balance as number;
}

/** Lena admitted (so she can receive), Mark holding a credential (so he is denied). */
async function ready(request: APIRequestContext) {
  const state = await snapshot(request);
  const [lena, mark] = state.investors;
  if (!lena.credential) await post(request, { action: "issue", investor: "lena" });
  if (!lena.active) await post(request, { action: "activate", investor: "lena" });
  if (!mark.credential) await post(request, { action: "issue", investor: "mark" });
}

test.afterEach(async () => {
  await faults([]);
});

test("an RPC error while confirming does not turn a sent allocation into a rejection", async ({
  page,
  request,
}) => {
  await ready(request);
  const before = await balance(request, "lena");
  await page.goto("/operator");
  await faults([{ method: "getSignatureStatuses", count: 2 }]);
  await page.getByRole("button", { name: "Allocate 25,000" }).first().click();
  await expect(page.getByRole("status")).toContainText("25,000 MERID received");
  await expect(page.getByText("Transaction rejected")).toHaveCount(0);
  expect(await balance(request, "lena")).toBe(before + 25_000);
});

test("an allocation whose confirmation cannot be read is reported as unconfirmed, not rejected", async ({
  page,
  request,
}) => {
  await ready(request);
  const before = await balance(request, "lena");
  await page.goto("/operator");
  await faults([{ method: "getSignatureStatuses", count: 100_000 }]);
  await page.getByRole("button", { name: "Allocate 25,000" }).first().click();
  const status = page.getByRole("status");
  await expect(status).toContainText("could not be confirmed", { timeout: 30_000 });
  await expect(status.getByRole("link", { name: /View transaction/ })).toHaveCount(1);
  await expect(page.getByText("Transaction rejected")).toHaveCount(0);
  // It landed, exactly once: Refresh shows it, and nothing was sent twice.
  await faults([]);
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByText(`${(before + 25_000).toLocaleString("en-GB")} MERID`)).toBeVisible();
  expect(await balance(request, "lena")).toBe(before + 25_000);
});

// An error from sendTransaction is only a refusal when its code says so
// (preflight failure, bad signature, ...). An internal error may come after
// the node accepted the transaction, so the outcome must be confirmed instead.
test("an internal error after sending is confirmed by polling, not reported as rejected", async ({
  page,
  request,
}) => {
  await ready(request);
  const before = await balance(request, "lena");
  await page.goto("/operator");
  await faults([{ method: "sendTransaction", count: 1, code: -32603, deliver: true }]);
  await page.getByRole("button", { name: "Allocate 25,000" }).first().click();
  await expect(page.getByRole("status")).toContainText("25,000 MERID received");
  await expect(page.getByText("Transaction rejected")).toHaveCount(0);
  expect(await balance(request, "lena")).toBe(before + 25_000);
});

test("an internal error with nothing delivered is reported as unconfirmed, not rejected", async ({
  page,
  request,
}) => {
  await ready(request);
  const before = await balance(request, "lena");
  await page.goto("/operator");
  await faults([{ method: "sendTransaction", count: 1, code: -32603 }]);
  await page.getByRole("button", { name: "Allocate 25,000" }).first().click();
  const status = page.getByRole("status");
  await expect(status).toContainText("could not be confirmed", { timeout: 30_000 });
  await expect(status.getByRole("link", { name: /View transaction/ })).toHaveCount(1);
  await expect(page.getByText("Transaction rejected")).toHaveCount(0);
  expect(await balance(request, "lena")).toBe(before);
});

test("a gate denial is still shown when reading state after it fails", async ({ page, request }) => {
  await ready(request);
  await page.goto("/investor/mark");
  await faults([{ method: "getAccountInfo", after: "sendTransaction", count: 100_000 }]);
  await page.getByRole("button", { name: "Request access" }).click();
  await expect(page.getByRole("status")).toContainText("Region not accepted");
  await expect(page.getByRole("status")).toContainText("Claim · 13");
  await expect(banner(page)).toHaveCount(0);
});

test("a failed action's error replaces the earlier success and does not follow you", async ({
  page,
  request,
}) => {
  await ready(request);
  await page.goto("/operator");
  await page.getByRole("button", { name: "Allocate 25,000" }).first().click();
  await expect(page.getByRole("status")).toContainText("25,000 MERID received");
  await page.route("**/api/demo", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 400, json: { error: "Injected failure" } })
      : route.continue(),
  );
  await page.getByRole("button", { name: "Allocate 25,000" }).first().click();
  await expect(banner(page)).toContainText("Injected failure");
  await expect(page.getByText("25,000 MERID received")).toHaveCount(0);
  await page.unroute("**/api/demo");
  await page.getByRole("link", { name: "Open investor view" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(banner(page)).toHaveCount(0);
});

test("a request ID cannot be reused for a different action", async ({ request }) => {
  await ready(request);
  const requestId = crypto.randomUUID();
  const first = await post(request, { action: "allocate", investor: "lena", requestId });
  expect((await first.json()).ok).toBe(true);
  const other = await post(request, { action: "allocate", investor: "mark", requestId });
  expect(other.status()).toBe(400);
  expect((await other.json()).error).toContain("already used");
});
