import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type Address } from "@solana/kit";
import {
  account,
  addresses,
  readKey,
  signer,
  issue,
  activate,
  RpcFailure,
  GATE,
  SAS,
  TOKEN,
  endpoint,
} from "./chain";
export type InvestorId = "alice" | "bob";
export type Manifest = {
  rpc: string;
  payerSeed: string;
  issuerSeed: string;
  mint: Address;
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
  return data;
}
export async function snapshot() {
  const m = await manifest();
  const gate = await account(GATE);
  if (!gate?.executable)
    throw new Error("Gate is not deployed. Run mise run seed.");
  const a = await addresses(
    m.mint,
    m.credential,
    m.schema,
    m.investors.alice.wallet,
    m.investors.alice.token,
  );
  const policy = await account(a.policy);
  if (
    !policy ||
    policy.owner !== GATE ||
    policy.data.length !== 91 ||
    policy.data[0] !== 1
  )
    throw new Error("Fund policy unavailable. Run mise run seed.");
  const countries = Array.from({ length: policy.data[74] }, (_, i) =>
    policy.data.subarray(75 + i * 2, 77 + i * 2).toString(),
  );
  const investors = await Promise.all(
    (["alice", "bob"] as const).map(async (id) => {
      const investor = m.investors[id];
      const a = await addresses(
        m.mint,
        m.credential,
        m.schema,
        investor.wallet,
        investor.token,
      );
      const [token, evidence] = await Promise.all([
        account(investor.token),
        account(a.evidence),
      ]);
      if (
        !token ||
        token.owner !== TOKEN ||
        token.data.length < 165 ||
        ![1, 2].includes(token.data[108]) ||
        readKey(token.data, 0) !== m.mint ||
        readKey(token.data, 32) !== investor.wallet
      )
        throw new Error("Investor account unavailable. Run mise run seed.");
      let credential = null;
      if (evidence) {
        const b = evidence.data;
        if (
          evidence.owner !== SAS ||
          b.length < 173 ||
          b[0] !== 2 ||
          b.length !== 173 + b.readUInt32LE(97)
        )
          throw new Error("Invalid credential data.");
        const length = b.readUInt32LE(97);
        if (
          length !== 14 ||
          b.readUInt32LE(101) !== 2 ||
          readKey(b, 1) !== investor.wallet ||
          readKey(b, 33) !== m.credential ||
          readKey(b, 65) !== m.schema
        )
          throw new Error("Unexpected demo credential.");
        credential = {
          jurisdiction: b.subarray(105, 107).toString(),
          verifiedAt: Number(b.readBigInt64LE(107)),
          expiry: Number(b.readBigInt64LE(133 + length)),
          address: a.evidence,
        };
      }
      return {
        id,
        name: investor.name,
        wallet: investor.wallet,
        token: investor.token,
        jurisdiction: investor.jurisdiction,
        active: token.data[108] === 1,
        credential,
      };
    }),
  );
  return {
    fund: {
      name: "Durin Private Credit Fund",
      mint: m.mint,
      jurisdictions: countries,
      issuer: readKey(policy.data, 1),
      schema: readKey(policy.data, 33),
      maxAge: Number(policy.data.readBigInt64LE(66)),
    },
    investors,
  };
}
export type DemoSnapshot = Awaited<ReturnType<typeof snapshot>>;
export type ActionResult = {
  ok: boolean;
  message: string;
  signature?: string;
  logs?: string[];
  state: DemoSnapshot;
};
// Serialize local demo actions; double clicks cannot issue the same PDA twice.
let pending: Promise<unknown> = Promise.resolve();
export function act(
  action: "issue" | "activate",
  id: InvestorId,
): Promise<ActionResult> {
  const run = pending.then(async () => {
    const m = await manifest();
    const investor = m.investors[id];
    const current = (await snapshot()).investors.find((i) => i.id === id)!;
    if (action === "issue" && current.credential)
      throw new Error("This investor already has a credential.");
    if (action === "activate" && current.active)
      throw new Error("This account is already active.");
    const payer = await signer(m.payerSeed);
    try {
      const signature =
        action === "issue"
          ? await issue(
              payer,
              await signer(m.issuerSeed),
              m.credential,
              m.schema,
              investor.wallet,
              investor.token,
              m.mint,
              investor.jurisdiction,
            )
          : await activate(
              payer,
              m.mint,
              m.credential,
              m.schema,
              investor.wallet,
              investor.token,
            );
      const state = await snapshot();
      if (
        action === "activate" &&
        !state.investors.find((i) => i.id === id)?.active
      )
        throw new Error(
          "Transaction confirmed but account is not active. Refresh to inspect.",
        );
      return {
        ok: true,
        message:
          action === "issue"
            ? "Credential issued and confirmed."
            : "Account activated. Admission confirmed on-chain.",
        signature,
        state,
      };
    } catch (error) {
      if (!(error instanceof RpcFailure)) throw error;
      const logs = error.details?.logs ?? [];
      const gateRejected = logs.some((line) =>
        line.startsWith(`Program ${GATE} failed:`),
      );
      const code = (
        error.details?.err as {
          InstructionError?: [number, { Custom?: number }];
        }
      )?.InstructionError?.[1]?.Custom;
      const missingEvidence =
        !current.credential &&
        action === "activate" &&
        gateRejected &&
        code === 2;
      const reason = missingEvidence
        ? "No accepted credential. Account remains frozen."
        : gateRejected && code === 13
          ? "Jurisdiction not accepted by this fund. Account remains frozen."
          : gateRejected && code === 9
            ? "Credential expired. Account remains frozen."
            : gateRejected && code === 10
              ? "Verification is no longer fresh. Account remains frozen."
              : "Transaction rejected. See the chain details.";
      return {
        ok: false,
        message: reason,
        logs: [error.message, ...logs],
        state: await snapshot(),
      };
    }
  });
  pending = run.catch(() => undefined);
  return run;
}
