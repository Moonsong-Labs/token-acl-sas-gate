import { test, expect, type APIRequestContext } from "@playwright/test";
import { execFile } from "node:child_process";

// UC3: runs the simulated screening feed (scripts/screening.ts) against the
// test surfnet and checks its effect through the demo API. A hit adds a
// compliance hold and freezes the account in one transaction, a delisting sends
// nothing, only a lift clears the hold, and every write keeps the wallet's
// invalidation flag. It shares the session the test server seeded, so it first
// brings Lena to a known state instead of depending on the walkthrough.

const ORIGIN = { Origin: "http://127.0.0.1:3300" };
// The test server's RPC and session: a session refuses any other RPC.
const ENV = {
  ...process.env,
  DEMO_RPC_URL: "http://127.0.0.1:19001",
  DEMO_SESSION_FILE: ".demo/e2e/session.json",
};

type Investor = {
  id: string;
  active: boolean;
  credential: unknown;
  walletStatus: { blocked: boolean; invalidated: boolean };
  timeline: { message: string }[];
};

function screen(...args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["--import", "tsx", "scripts/screening.ts", ...args],
      { env: ENV },
      (error, stdout, stderr) =>
        resolve({
          code: error ? (typeof error.code === "number" ? error.code : 1) : 0,
          out: stdout + stderr,
        }),
    );
  });
}

async function lena(request: APIRequestContext): Promise<Investor> {
  const state = await (await request.get("/api/demo")).json();
  return state.investors.find((i: Investor) => i.id === "lena");
}

async function act(request: APIRequestContext, action: string) {
  const response = await request.post("/api/demo", {
    headers: ORIGIN,
    data: { action, investor: "lena" },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

/** A request for access that the gate refuses: returns its code. */
async function denied(request: APIRequestContext) {
  const result = await act(request, "activate");
  expect(result.ok).toBe(false);
  return result.decision?.code;
}

/** Lena admitted with a current credential and no compliance flags. */
async function admitted(request: APIRequestContext) {
  const s = await lena(request);
  if (s.walletStatus.blocked) await act(request, "unblock");
  if (s.walletStatus.invalidated) await act(request, "validate");
  expect((await act(request, s.credential ? "renew" : "issue")).ok).toBe(true);
  if (!(await lena(request)).active) expect((await act(request, "activate")).ok).toBe(true);
}

test("UC3: a screening hit holds and freezes until an authorized lift", async ({ request }) => {
  await admitted(request);

  // A hit adds the hold and freezes the active account in one transaction.
  let run = await screen("hit", "lena");
  expect(run.code, run.out).toBe(0);
  expect(run.out).toContain("is blocked and the supplied token account is frozen");
  let s = await lena(request);
  expect(s.walletStatus).toEqual({ blocked: true, invalidated: false });
  expect(s.active).toBe(false);
  await expect
    .poll(async () => (await lena(request)).timeline[0]?.message)
    .toBe("Screening hit: compliance hold added and account frozen");

  // Repeating it sends nothing.
  run = await screen("hit", "lena");
  expect(run.code, run.out).toBe(0);
  expect(run.out).toContain("nothing sent");

  // A renewed, valid credential is still refused while the hold stands.
  expect((await act(request, "renew")).ok).toBe(true);
  expect(await denied(request)).toBe(5);

  // A delisting sends nothing: the hold stays until a review lifts it.
  run = await screen("delist", "lena");
  expect(run.code, run.out).toBe(0);
  expect(run.out).toContain("a review is due");
  expect((await lena(request)).walletStatus.blocked).toBe(true);
  expect(await denied(request)).toBe(5);

  // The review lifts the hold. That does not thaw; requesting access does.
  run = await screen("lift", "lena");
  expect(run.code, run.out).toBe(0);
  expect(run.out).toContain("Block lifted. The account stays frozen");
  s = await lena(request);
  expect(s.walletStatus.blocked).toBe(false);
  expect(s.active).toBe(false);
  expect((await act(request, "activate")).ok).toBe(true);

  // Hits and lifts keep an existing invalidation.
  expect((await act(request, "invalidate")).ok).toBe(true);
  expect((await screen("hit", "lena")).code).toBe(0);
  expect((await lena(request)).walletStatus).toEqual({ blocked: true, invalidated: true });
  expect((await screen("lift", "lena")).code).toBe(0);
  expect((await lena(request)).walletStatus).toEqual({ blocked: false, invalidated: true });
  expect(await denied(request)).toBe(11);
  expect((await act(request, "validate")).ok).toBe(true);
  expect((await act(request, "activate")).ok).toBe(true);

  // A hold added by hand leaves the account active, and a lift reports that.
  expect((await act(request, "block")).ok).toBe(true);
  expect((await lena(request)).active).toBe(true);
  run = await screen("lift", "lena");
  expect(run.code, run.out).toBe(0);
  expect(run.out).toContain("Block lifted. The account was not frozen, so it stays active.");
  s = await lena(request);
  expect(s.walletStatus.blocked).toBe(false);
  expect(s.active).toBe(true);
});

test("the screening feed rejects unknown events and investors", async () => {
  for (const args of [["bogus", "lena"], ["hit", "nobody"], ["hit"]]) {
    const run = await screen(...args);
    expect(run.code).toBe(1);
    expect(run.out).toContain("Usage:");
  }
});
