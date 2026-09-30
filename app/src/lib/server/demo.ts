import { readFile } from "node:fs/promises";
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
  RpcFailure,
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
  decodeTokenAccount,
} from "./accounts";
import { CODES, type Decision } from "../gate";

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
export async function snapshot() {
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
      const [tokenRaw, evidenceRaw] = await Promise.all([
        account(investor.token),
        account(a.evidence),
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
          subjectMatches: evidence.nonce === investor.wallet,
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

/** The fund's initial allocation to an admitted investor. */
const ALLOCATION = 25_000n;

export type ActionResult = {
  ok: boolean;
  message: string;
  decision?: Decision;
  signature?: string;
  logs?: string[];
  state: DemoSnapshot;
};

// Serialize local demo actions; double clicks cannot issue the same PDA twice.
let pending: Promise<unknown> = Promise.resolve();

export function act(
  action: "issue" | "activate" | "allocate",
  id: InvestorId,
  options: IssueOptions = { verified: "today", validity: "year" },
): Promise<ActionResult> {
  const run = pending.then(async () => {
    const m = await manifest();
    const investor = m.investors[id];
    const current = (await snapshot()).investors.find((i) => i.id === id)!;
    if (action === "issue" && current.credential)
      throw new Error(
        "This investor already has a credential. Renewal arrives with the lifecycle screens; reseed to start over.",
      );
    if (action === "activate" && current.active)
      throw new Error("This account is already active.");
    const payer = await signer(m.payerSeed);

    // Only the send is classified: a chain or gate rejection is an outcome to
    // show, anything else is a failure to surface. Reading state afterwards is
    // deliberately outside this, so a flaky read after a confirmed transaction
    // can never be reported as a rejection.
    let signature: string;
    try {
      if (action === "issue") {
        const now = await ledgerNow();
        signature = await issue(
          payer,
          await signer(m.issuerSeed),
          m.credential,
          m.schema,
          investor.wallet,
          investor.jurisdiction,
          now - BigInt(VERIFIED[options.verified]),
          now + BigInt(VALIDITY[options.validity]),
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
        const decimals = (await snapshot()).fund.decimals;
        signature = await mintTo(
          payer,
          payer,
          m.fund.mint,
          investor.token,
          ALLOCATION * 10n ** BigInt(decimals),
        );
      }
    } catch (error) {
      if (!(error instanceof RpcFailure)) throw error;
      return rejection(action, error, !current.credential, await snapshot());
    }

    const state = await snapshot();
    const after = state.investors.find((i) => i.id === id)!;
    if (action === "activate" && !after.active)
      throw new Error(
        "Transaction confirmed but the account is not active. Refresh to inspect.",
      );
    return {
      ok: true,
      message:
        action === "issue"
          ? "Credential issued and confirmed."
          : action === "activate"
            ? "Access granted. Admission confirmed on-chain."
            : `${ALLOCATION.toLocaleString("en-GB")} ${m.fund.symbol} received.`,
      decision: action === "activate" ? { outcome: "admitted" } : undefined,
      signature,
      state,
    } satisfies ActionResult;
  });
  pending = run.catch(() => undefined);
  return run;
}

/** Turn a failed send into an outcome the screens can explain. */
function rejection(
  action: "issue" | "activate" | "allocate",
  error: RpcFailure,
  noCredential: boolean,
  state: DemoSnapshot,
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
    const { name, step } = CODES[code];
    const decision: Decision =
      step === "inputs_authentic"
        ? { outcome: "unverified", code, name }
        : { outcome: "denied", code, name };
    return {
      ...base,
      decision,
      message:
        code === 2 && noCredential
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
    await snapshot();
    seeded = true;
  } catch {}
  return { endpoint: url, healthy, now, programs, seeded };
}
export type NetworkStatus = Awaited<ReturnType<typeof status>>;
