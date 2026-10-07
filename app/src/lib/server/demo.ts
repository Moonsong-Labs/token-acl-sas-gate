import { readFile, writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { type Address } from "@solana/kit";
import {
  account,
  addresses,
  signer,
  issue,
  activate,
  mintTo,
  ledgerNow,
  transactionLink,
  RpcFailure,
  type Submitted,
  Unconfirmed,
  revoke,
  freeze,
  setStatus,
  history,
  GATE,
  endpoint,
  rpc,
} from "./chain";
import { PROGRAMS } from "../ids";
import {
  decodeAttestation,
  decodeCredential,
  decodeMint,
  decodeMintConfig,
  decodePolicy,
  decodeSchema,
  decodeStatus,
  decodeTokenAccount,
} from "./accounts";
import { CODES, locate, type Decision } from "../gate";

export const INVESTORS = ["lena", "mark"] as const;
export type InvestorId = (typeof INVESTORS)[number];

export type Manifest = {
  rpc: string;
  /** Fund operator: pays fees, mint authority, Token ACL config authority. */
  payerSeed: string;
  /** Acme KYC: an authorized signer of the credential. */
  issuerSeed: string;
  fund: { name: string; symbol: string; mint: Address };
  /** The credential authority. Its key is not stored; nothing here signs as it. */
  authority: { name: string; address: Address };
  issuer: { name: string; address: Address };
  credential: Address;
  schema: Address;
  investors: Record<
    InvestorId,
    { name: string; wallet: Address; token: Address; jurisdiction: string }
  >;
};

export const manifestPath = () =>
  resolve(process.cwd(), process.env.DEMO_SESSION_FILE ?? ".demo/session.json");

export async function manifest(): Promise<Manifest> {
  let data: Manifest;
  try {
    data = JSON.parse(await readFile(manifestPath(), "utf8"));
  } catch {
    throw new Error("Demo is not seeded. Run mise run seed from app/.");
  }
  if (data.rpc !== endpoint())
    throw new Error("Demo RPC changed. Run mise run seed again.");
  if (!data.fund || !data.authority)
    throw new Error("Demo session is from an older build. Run mise run seed again.");
  return data;
}

/** Everything the screens show, read from chain state in one pass. */
export async function snapshot(includeHistory = true) {
  const m = await manifest();
  const gate = await account(GATE);
  if (!gate?.executable)
    throw new Error("Gate is not deployed. Run mise run seed.");
  const shared = await addresses(
    m.fund.mint,
    m.credential,
    m.schema,
    m.investors.lena.wallet,
    m.investors.lena.token,
  );
  const [mintRaw, configRaw, policyRaw, listRaw, credentialRaw, schemaRaw, now] =
    await Promise.all([
      account(m.fund.mint),
      account(shared.config),
      account(shared.policy),
      account(shared.list),
      account(m.credential),
      account(m.schema),
      ledgerNow(),
    ]);
  const mint = decodeMint(mintRaw);
  const config = decodeMintConfig(configRaw);
  const policy = decodePolicy(policyRaw);
  const credential = decodeCredential(credentialRaw);
  const schema = decodeSchema(schemaRaw);

  const investors = await Promise.all(
    INVESTORS.map(async (id) => {
      const investor = m.investors[id];
      const a = await addresses(
        m.fund.mint,
        m.credential,
        m.schema,
        investor.wallet,
        investor.token,
      );
      const [tokenRaw, evidenceRaw, walletRaw, tokenStatusRaw, timeline] = await Promise.all([
        account(investor.token),
        account(a.evidence),
        account(a.walletStatus),
        account(a.tokenStatus),
        includeHistory
          ? history(investor.token, a.evidence, a.walletStatus)
              .then((entries) => ({ entries, unavailable: false }))
              .catch(() => ({ entries: [], unavailable: true }))
          : { entries: [], unavailable: false },
      ]);
      const token = decodeTokenAccount(tokenRaw);
      if (token.mint !== m.fund.mint || token.owner !== investor.wallet)
        throw new Error("Investor account unavailable. Run mise run seed.");
      const evidence = decodeAttestation(evidenceRaw);
      return {
        id,
        name: investor.name,
        jurisdiction: investor.jurisdiction,
        wallet: investor.wallet,
        token: investor.token,
        active: token.active,
        walletStatus: decodeStatus(walletRaw),
        tokenStatus: decodeStatus(tokenStatusRaw),
        timeline: timeline.entries,
        timelineUnavailable: timeline.unavailable,
        immutableOwner: token.immutableOwner,
        balance: formatUnits(token.amount, mint.decimals),
        credential: evidence && {
          address: a.evidence,
          jurisdiction: evidence.jurisdiction,
          verifiedAt: evidence.verifiedAt,
          expiry: evidence.expiry,
          signer: evidence.signer,
          issuerName:
            evidence.signer === m.issuer.address ? m.issuer.name : null,
        },
      };
    }),
  );

  return {
    now: Number(now),
    fund: {
      name: m.fund.name,
      symbol: m.fund.symbol,
      mint: m.fund.mint,
      decimals: mint.decimals,
      /** Whole tokens minted per allocation, for the screens' labels. */
      allocation: Number(ALLOCATION),
      config: shared.config,
      configAuthority: config.authority,
      // The four setup steps that must all hold before anyone can ask for access
      // (docs/ADMISSION.md, "Configure a fund").
      readiness: {
        frozenByDefault: mint.frozenByDefault,
        gated:
          mint.freezeAuthority === shared.config &&
          config.mint === m.fund.mint &&
          config.gatingProgram === GATE,
        wired: listRaw?.owner === GATE && (listRaw?.data.length ?? 0) > 0,
        permissionlessThaw: config.permissionlessThaw,
      },
      policy,
    },
    registry: {
      name: m.authority.name,
      authority: credential.authority,
      credential: m.credential,
      credentialName: credential.name,
      issuers: credential.signers.map((address) => ({
        address,
        name: address === m.issuer.address ? m.issuer.name : null,
      })),
      schema: { address: m.schema, ...schema },
      acceptedByFund:
        policy.credential === m.credential && policy.schema === m.schema,
    },
    issuer: {
      name: m.issuer.name,
      address: m.issuer.address,
      authorized: credential.signers.includes(m.issuer.address),
    },
    investors,
  };
}

export type DemoSnapshot = Awaited<ReturnType<typeof snapshot>>;

/** How long ago the issuer says KYC was completed. */
export const VERIFIED = {
  today: 0,
  "six-months": 182 * 86_400,
  "two-years": 730 * 86_400,
} as const;
/** How long the attestation stays valid. SAS refuses a past expiry at creation. */
export const VALIDITY = {
  year: 365 * 86_400,
  "two-minutes": 120,
} as const;
export type IssueOptions = {
  verified: keyof typeof VERIFIED;
  validity: keyof typeof VALIDITY;
};

/** What the fund allocates to an investor per request; repeatable. */
const ALLOCATION = 25_000n;

export type ActionResult = {
  ok: boolean;
  message: string;
  decision?: Decision;
  signature?: string;
  /** Surfpool Studio link to the confirmed transaction. Refusals have none. */
  transaction?: string;
  logs?: string[];
  /** Sent, but whether it landed is unknown: refresh rather than retry. */
  unconfirmed?: boolean;
  /** Absent when the chain could not be re-read after the transaction. */
  state?: DemoSnapshot;
};

/** Chain state for a result, or `undefined`: a failed read never changes an outcome. */
const reread = () => snapshot().catch(() => undefined);

// Serialize local demo actions; double clicks cannot issue the same PDA twice.
let pending: Promise<unknown> = Promise.resolve();

/**
 * Outcomes by request ID, so a retry of the same request (e.g. after its
 * response was lost) returns the original outcome rather than sending its
 * transaction again. Every outcome is kept, failures included: a request that
 * failed after its send may still have landed. A new request gets a new ID and
 * runs again, which is what lets an investor receive MERID more than once.
 */
const outcomes = new Map<
  string,
  { action: string; id: InvestorId; options: string; result: Promise<ActionResult> }
>();
const REMEMBERED = 500;

export const ACTIONS = [
  "issue", "renew", "revoke", "freeze", "block", "unblock",
  "invalidate", "validate", "activate", "allocate",
] as const;
export type Action = (typeof ACTIONS)[number];

export function act(
  action: Action,
  id: InvestorId,
  options: IssueOptions = { verified: "today", validity: "year" },
  requestId?: string,
): Promise<ActionResult> {
  const normalizedOptions = action === "issue"
    ? JSON.stringify({ verified: options.verified, validity: options.validity })
    : "";
  const seen = requestId ? outcomes.get(requestId) : undefined;
  if (seen) {
    // A retry is the same request: replaying another action's outcome under it
    // would be wrong, so a reused ID is refused.
    if (seen.action !== action || seen.id !== id || seen.options !== normalizedOptions)
      throw new Error("This request ID was already used for a different action.");
    return seen.result;
  }
  const run = pending.then(async () => {
    const m = await manifest();
    const investor = m.investors[id];
    const allocationFile = `${manifestPath()}.${investor.token}.allocation.json`;
    if (action === "allocate") {
      const unresolved = await unresolvedAllocation(allocationFile);
      if (unresolved) return uncertainAllocation(unresolved, await reread());
    }
    // History is presentation data. Do not query it before submitting an action.
    const before = await snapshot(false);
    const current = before.investors.find((i) => i.id === id)!;
    if (action === "issue" && current.credential)
      throw new Error(
        "This investor already has a credential. Use Renew credential to replace it.",
      );
    if (action === "activate" && current.active)
      throw new Error("This account is already active.");
    if (action === "revoke" && !current.credential)
      throw new Error("No credential to revoke.");
    if (action === "freeze" && !current.active)
      throw new Error("This account is already frozen.");
    const payer = await signer(m.payerSeed);
    // Reads the send depends on happen first, outside the classification below:
    // a read failure here means nothing was sent, and surfaces as an error.
    const now = action === "issue" || action === "renew" ? await ledgerNow() : 0n;

    // Only the send is classified. `send()` throws RpcFailure only for a
    // refusal (preflight or on-chain), Unconfirmed when it may have landed, and
    // a plain error when nothing was sent. Reading state afterwards is outside
    // this, so a flaky read can never turn an outcome into something else.
    let signature: string;
    try {
      if (action === "issue" || action === "renew") {
        signature = await issue(
          payer,
          await signer(m.issuerSeed),
          m.credential,
          m.schema,
          investor.wallet,
          investor.jurisdiction,
          now - BigInt(VERIFIED[options.verified]),
          now + BigInt(VALIDITY[options.validity]),
          action === "renew" && Boolean(current.credential),
        );
      } else if (action === "revoke") {
        signature = await revoke(
          payer, await signer(m.issuerSeed), m.credential, current.credential!.address,
        );
      } else if (action === "freeze") {
        signature = await freeze(payer, m.fund.mint, investor.token);
      } else if (["block", "unblock", "invalidate", "validate"].includes(action)) {
        signature = await setStatus(
          payer, m.fund.mint, investor.wallet,
          action === "block" ? true : action === "unblock" ? false : current.walletStatus.blocked,
          action === "invalidate" ? true : action === "validate" ? false : current.walletStatus.invalidated,
        );
      } else if (action === "activate") {
        signature = await activate(
          payer,
          m.fund.mint,
          m.credential,
          m.schema,
          investor.wallet,
          investor.token,
        );
      } else {
        signature = await mintTo(
          payer,
          payer,
          m.fund.mint,
          investor.token,
          ALLOCATION * 10n ** BigInt(before.fund.decimals),
          (tx) => writeFile(allocationFile, JSON.stringify(tx), { mode: 0o600 }),
        );
      }
    } catch (error) {
      if (error instanceof Unconfirmed)
        return {
          ok: false,
          unconfirmed: true,
          message:
            action === "allocate"
              ? "Sent, but the transaction could not be confirmed. Press Refresh to check chain state. Further allocations are blocked until the saved transaction resolves."
              : "Sent, but the transaction could not be confirmed. Press Refresh to see whether it landed before acting again.",
          signature: error.signature,
          transaction: transactionLink(error.signature),
          state: await reread(),
        } satisfies ActionResult;
      if (!(error instanceof RpcFailure)) throw error;
      if (action === "allocate") await clearAllocation(allocationFile);
      return rejection(action, error, !current.credential, await reread());
    }

    if (action === "allocate") await clearAllocation(allocationFile).catch(() => undefined);

    // The transaction has committed. Nothing below may report it as failed:
    // the caller would retry, and a retry repeats a committed action. A failed
    // re-read becomes a warning on a confirmed result, never an error.
    const transaction = transactionLink(signature);
    let state: DemoSnapshot | undefined;
    let unread = "";
    try {
      state = await snapshot();
    } catch (error) {
      unread = ` The screen could not reload chain state (${
        error instanceof Error ? error.message : "unknown error"
      }). Press Refresh before acting again.`;
    }
    const after = state?.investors.find((i) => i.id === id);
    if (action === "activate" && after && !after.active)
      return {
        ok: false,
        message:
          "Transaction confirmed, but the account is not active. Inspect the transaction before retrying.",
        signature,
        transaction,
        state,
      } satisfies ActionResult;
    const messages: Partial<Record<Action, string>> = {
      renew: "Credential renewed and confirmed. Request access to re-admit a frozen account.",
      revoke: "Credential revoked. An active account stays active until the sponsor freezes it.",
      freeze: "Access withdrawn. Sponsor freeze confirmed; the balance is retained.",
      block: "Compliance hold added. Renewal cannot remove it.",
      unblock: "Compliance hold removed. Request access to re-check the credential.",
      invalidate: "Wallet invalidated. This status survives renewal until the operator clears it.",
      validate: "Wallet invalidation cleared. Compliance holds are preserved.",
    };
    return {
      ok: true,
      message:
        (messages[action] ?? (action === "issue"
          ? "Credential issued and confirmed."
          : action === "activate"
            ? "Access granted. Admission confirmed on-chain."
            : `${ALLOCATION.toLocaleString("en-GB")} ${m.fund.symbol} received.`)) + unread,
      decision: action === "activate" ? { outcome: "admitted" } : undefined,
      signature,
      transaction,
      state,
    } satisfies ActionResult;
  });
  pending = run.catch(() => undefined);
  if (requestId) {
    outcomes.set(requestId, { action, id, options: normalizedOptions, result: run });
    // Keep the map bounded; Map iterates oldest first.
    if (outcomes.size > REMEMBERED) outcomes.delete(outcomes.keys().next().value!);
  }
  return run;
}

/** Saved before broadcasting; survives page refreshes and server restarts. */
async function clearAllocation(path: string) {
  await unlink(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}
async function unresolvedAllocation(path: string): Promise<Submitted | undefined> {
  let saved: Submitted;
  try {
    saved = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const height = await rpc<number>("getBlockHeight", [{ commitment: "finalized" }]);
  // Read history after height: a transaction can land during the height read.
  const { value } = await rpc<{ value: ({ err: unknown; confirmationStatus: string } | null)[] }>(
    "getSignatureStatuses", [[saved.signature], { searchTransactionHistory: true }],
  );
  const status = value[0];
  if ((status && ["confirmed", "finalized"].includes(status.confirmationStatus)) ||
      (!status && height > saved.lastValidBlockHeight)) {
    await clearAllocation(path);
    return;
  }
  return saved;
}
function uncertainAllocation(saved: Submitted, state?: DemoSnapshot): ActionResult {
  return {
    ok: false, unconfirmed: true, signature: saved.signature,
    transaction: transactionLink(saved.signature), state,
    message: "The previous allocation is still unresolved. Further allocations are blocked until its signature confirms, fails, or expires. Press Refresh to check chain state.",
  };
}

/** Turn a failed send into an outcome the screens can explain. */
function rejection(
  action: Action,
  error: RpcFailure,
  noCredential: boolean,
  state: DemoSnapshot | undefined,
): ActionResult {
  const logs = error.details?.logs ?? [];
  const code = (
    error.details?.err as { InstructionError?: [number, { Custom?: number }] }
  )?.InstructionError?.[1]?.Custom;
  const fromGate = logs.some((line) =>
    line.startsWith(`Program ${GATE} failed:`),
  );
  const base = { ok: false, logs: [error.message, ...logs], state };

  if (action === "activate" && fromGate && code !== undefined && CODES[code]) {
    const { name } = CODES[code];
    const step = locate(code);
    const missing = code === 2 && noCredential;
    const decision: Decision =
      step === null
        ? { outcome: "unplaced", code, name }
        : step === "inputs_authentic"
          ? { outcome: "unverified", code, name, noCredential: missing }
          : { outcome: "denied", code, name };
    return {
      ...base,
      decision,
      message: missing
        ? "No credential on file. The account remains frozen."
        : "Access refused. The account remains frozen.",
    };
  }
  // Token-2022 `TokenError::AccountFrozen`.
  if (action === "allocate" && code === 17)
    return {
      ...base,
      message: "Refused by Token-2022: a frozen account cannot receive tokens.",
    };
  return {
    ...base,
    decision:
      action === "activate"
        ? { outcome: "rejected", detail: error.message }
        : undefined,
    message: "Transaction rejected. See the chain details.",
  };
}

function formatUnits(amount: bigint, decimals: number) {
  return Number(amount / 10n ** BigInt(decimals));
}

/**
 * Network status for the status screen. Deliberately independent of the seed:
 * it is what a presenter opens when the demo does not load.
 */
export async function status() {
  const url = endpoint();
  let healthy = false;
  let now: number | null = null;
  try {
    healthy = (await rpc<string>("getHealth")) === "ok";
    now = Number(await ledgerNow());
  } catch {
    return { endpoint: url, healthy: false, now: null, programs: [], seeded: false };
  }
  const programs = await Promise.all(
    PROGRAMS.map(async ({ name, id }) => {
      const raw = await account(id);
      return {
        name,
        id,
        state: !raw ? "absent" : raw.executable ? "executable" : "not a program",
      } as const;
    }),
  );
  let seeded = false;
  try {
    await snapshot(false);
    seeded = true;
  } catch {}
  return { endpoint: url, healthy, now, programs, seeded };
}
export type NetworkStatus = Awaited<ReturnType<typeof status>>;
