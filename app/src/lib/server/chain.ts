// Server-side wire adapter for the pinned programs. Encodings mirror the Rust
// UC1 fixture; browser tests execute these instructions against their real SBF.
import {
  address,
  getAddressEncoder,
  getAddressDecoder,
  getBase58Encoder,
  getProgramDerivedAddress,
  createKeyPairSignerFromPrivateKeyBytes,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  getBase64EncodedWireTransaction,
  type Address,
  type Instruction,
  type KeyPairSigner,
  blockhash,
} from "@solana/kit";
import { GATE, SAS, TOKEN_ACL } from "../ids";
export { GATE, SAS, TOKEN_ACL };
export const SYSTEM = address("11111111111111111111111111111111");
export const TOKEN = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const key = (a: Address) => Buffer.from(getAddressEncoder().encode(a));
export const readKey = (b: Buffer, offset: number) =>
  getAddressDecoder().decode(b.subarray(offset, offset + 32));
export const num = (n: number | bigint, size = 8) => {
  const b = Buffer.alloc(size);
  if (size === 8) b.writeBigInt64LE(BigInt(n));
  else b.writeUIntLE(Number(n), 0, size);
  return b;
};
export const bytes = (...parts: (Buffer | Uint8Array | number[])[]) =>
  Buffer.concat(parts.map((p) => Buffer.from(p)));
export const str = (s: string | Buffer) => {
  const b = Buffer.from(s);
  return bytes(num(b.length, 4), b);
};
export const ro = (a: Address) => ({ address: a, role: 0 as const });
export const rw = (a: Address) => ({ address: a, role: 1 as const });
export const signed = (s: KeyPairSigner, writable = false) => ({
  address: s.address,
  role: writable ? (3 as const) : (2 as const),
  signer: s,
});
export const ix = (
  programAddress: Address,
  data: Buffer | number[],
  accounts: NonNullable<Instruction["accounts"]>,
): Instruction => ({ programAddress, data: Buffer.from(data), accounts });
export const signer = (seed: string) =>
  createKeyPairSignerFromPrivateKeyBytes(Buffer.from(seed, "hex"));
export async function pda(
  programAddress: Address,
  ...seeds: (string | Buffer)[]
) {
  return (
    await getProgramDerivedAddress({
      programAddress,
      seeds: seeds.map((s) => Buffer.from(s)),
    })
  )[0];
}
export function endpoint() {
  const value = process.env.DEMO_RPC_URL ?? "http://127.0.0.1:8899";
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw new Error("The demo requires a local surfnet RPC.");
  return value;
}
/**
 * Surfpool Studio, the surfnet's local explorer. It opens a transaction from
 * `/?t=<signature>`. Local HTTP only, like the RPC endpoint.
 */
export function studio() {
  const value = process.env.DEMO_STUDIO_URL ?? "http://127.0.0.1:18488";
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw new Error("The demo requires a local Surfpool Studio URL.");
  return url.origin;
}
/** `undefined` when `DEMO_STUDIO_URL` is unusable: the link is never worth failing for. */
export function transactionLink(signature: string): string | undefined {
  try {
    return `${studio()}/?t=${encodeURIComponent(signature)}`;
  } catch (error) {
    console.warn(`No transaction link: ${error instanceof Error ? error.message : error}`);
    return undefined;
  }
}
export class RpcFailure extends Error {
  constructor(
    message: string,
    public details: { err?: unknown; logs?: string[] } = {},
  ) {
    super(message);
  }
}
export async function rpc<T>(
  method: string,
  params: unknown[] = [],
): Promise<T> {
  const response = await fetch(endpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Surfnet HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new RpcFailure(body.error.message, body.error.data);
  return body.result as T;
}
export async function account(a: Address) {
  const result = await rpc<{
    value: null | {
      owner: Address;
      data: [string, string];
      executable: boolean;
    };
  }>("getAccountInfo", [a, { encoding: "base64", commitment: "confirmed" }]);
  return result.value
    ? { ...result.value, data: Buffer.from(result.value.data[0], "base64") }
    : null;
}
export async function send(payer: KeyPairSigner, instructions: Instruction[]) {
  const { value } = await rpc<{
    value: { blockhash: string; lastValidBlockHeight: number };
  }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
  const message = appendTransactionMessageInstructions(
    instructions,
    setTransactionMessageLifetimeUsingBlockhash(
      {
        blockhash: blockhash(value.blockhash),
        lastValidBlockHeight: BigInt(value.lastValidBlockHeight),
      },
      setTransactionMessageFeePayerSigner(
        payer,
        createTransactionMessage({ version: 0 }),
      ),
    ),
  );
  const transaction = await signTransactionMessageWithSigners(message);
  const signature = await rpc<string>("sendTransaction", [
    getBase64EncodedWireTransaction(transaction),
    { encoding: "base64", preflightCommitment: "confirmed" },
  ]);
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await rpc<{
      value: ({ err: unknown; confirmationStatus: string } | null)[];
    }>("getSignatureStatuses", [[signature]]);
    const status = result.value[0];
    if (status?.err)
      throw new RpcFailure(`Transaction ${signature} failed`, {
        err: status.err,
      });
    if (
      status &&
      ["confirmed", "finalized"].includes(status.confirmationStatus)
    )
      return signature;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Confirmation timed out for ${signature}. Refresh before retrying.`,
  );
}
export async function addresses(
  mint: Address,
  credential: Address,
  schema: Address,
  wallet: Address,
  token: Address,
) {
  return {
    config: await pda(TOKEN_ACL, "MINT_CONFIG", key(mint)),
    policy: await pda(GATE, "policy", key(mint)),
    list: await pda(GATE, "thaw_extra_account_metas", key(mint)),
    evidence: await pda(
      SAS,
      "attestation",
      key(credential),
      key(schema),
      key(wallet),
    ),
    walletStatus: await pda(GATE, "status", key(mint), key(wallet)),
    tokenStatus: await pda(GATE, "status", key(mint), key(token)),
    flag: await pda(TOKEN_ACL, "FLAG_ACCOUNT", key(token)),
  };
}
export function createAccount(
  payer: KeyPairSigner,
  target: KeyPairSigner,
  space: number,
) {
  return ix(SYSTEM, bytes(num(0, 4), num(10000000), num(space), key(TOKEN)), [
    signed(payer, true),
    signed(target, true),
  ]);
}
/** Ledger time in Unix seconds, as the gate reads it from `Clock`. */
export async function ledgerNow(): Promise<bigint> {
  const clock = await account(
    address("SysvarC1ock11111111111111111111111111111111"),
  );
  if (!clock) throw new Error("Clock unavailable");
  return clock.data.readBigInt64LE(32);
}
/**
 * SAS `CreateAttestation`, signed by an authorized signer of the credential,
 * i.e. an issuer the credential authority registered. The subject is bound
 * through `nonce = wallet`; the claim is the UC1 schema: `jurisdiction`
 * (String) then `verified_at` (i64).
 */
export async function issue(
  payer: KeyPairSigner,
  issuer: KeyPairSigner,
  credential: Address,
  schema: Address,
  wallet: Address,
  jurisdiction: string,
  verifiedAt: bigint,
  expiry: bigint,
  replace = false,
) {
  const evidence = await pda(
    SAS,
    "attestation",
    key(credential),
    key(schema),
    key(wallet),
  );
  return send(payer, [
    ...(replace ? [await closeEvidence(payer, issuer, credential, evidence)] : []),
    ix(
      SAS,
      bytes(
        [6],
        key(wallet),
        str(bytes(str(jurisdiction), num(verifiedAt))),
        num(expiry),
      ),
      [
        signed(payer, true),
        signed(issuer),
        ro(credential),
        ro(schema),
        rw(evidence),
        ro(SYSTEM),
      ],
    ),
  ]);
}

async function closeEvidence(
  payer: KeyPairSigner, issuer: KeyPairSigner, credential: Address, evidence: Address,
) {
  return ix(SAS, [7], [signed(payer, true), signed(issuer), ro(credential), rw(evidence),
    ro(await pda(SAS, "__event_authority")), ro(SYSTEM), ro(SAS)]);
}

export async function revoke(
  payer: KeyPairSigner, issuer: KeyPairSigner, credential: Address, evidence: Address,
) {
  return send(payer, [await closeEvidence(payer, issuer, credential, evidence)]);
}

export async function freeze(payer: KeyPairSigner, mint: Address, token: Address) {
  return send(payer, [ix(TOKEN_ACL, [5], [signed(payer), ro(mint), rw(token),
    ro(await pda(TOKEN_ACL, "MINT_CONFIG", key(mint))), ro(TOKEN)])]);
}

export async function setStatus(
  payer: KeyPairSigner, mint: Address, subject: Address, blocked: boolean, invalidated: boolean,
) {
  return send(payer, [ix(GATE, [2, Number(blocked), Number(invalidated)], [
    signed(payer, true), signed(payer), ro(mint),
    ro(await pda(TOKEN_ACL, "MINT_CONFIG", key(mint))), ro(subject),
    rw(await pda(GATE, "status", key(mint), key(subject))), ro(SYSTEM),
  ])]);
}

/** Recent confirmed lifecycle transactions, reconstructed from RPC history. */
export async function history(token: Address, evidence: Address, walletStatus: Address) {
  const lists = await Promise.all([token, evidence, walletStatus].map((a) =>
    rpc<{ signature: string; slot: number; blockTime: number | null; err: unknown }[]>(
      "getSignaturesForAddress", [a, { limit: 30, commitment: "confirmed" }])));
  const signatures = [...new Map(lists.flat().filter((s) => !s.err).map((s) => [s.signature, s])).values()]
    .sort((a, b) => b.slot - a.slot).slice(0, 30);
  const entries = await Promise.all(signatures.map(async (s) => {
    const tx = await rpc<null | { meta: { err: unknown }; transaction: { message: {
      accountKeys: Address[]; instructions: { programIdIndex: number; accounts: number[]; data: string }[];
    } } }>("getTransaction", [s.signature, { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 0 }]);
    if (!tx || tx.meta.err) return null;
    const messages: string[] = [];
    for (const instruction of tx.transaction.message.instructions) {
      const program = tx.transaction.message.accountKeys[instruction.programIdIndex];
      const data = getBase58Encoder().encode(instruction.data);
      const target = (index: number) =>
        tx.transaction.message.accountKeys[instruction.accounts[index]];
      if (program === SAS && data[0] === 7 && target(3) === evidence) messages.push("Credential revoked");
      if (program === SAS && data[0] === 6 && target(4) === evidence) messages.push("Credential issued");
      if (program === TOKEN_ACL && data[0] === 5 && target(2) === token) messages.push("Access withdrawn by sponsor freeze");
      if (program === TOKEN_ACL && data[0] === 6 && target(2) === token) messages.push("Access granted");
      if (program === GATE && data[0] === 2 && target(5) === walletStatus) messages.push(`Wallet status: compliance hold ${data[1] ? "on" : "off"}, invalidation ${data[2] ? "on" : "off"}`);
    }
    if (!messages.length) return null;
    return { signature: s.signature, slot: s.slot, time: s.blockTime,
      message: messages.includes("Credential revoked") && messages.includes("Credential issued")
        ? "Credential renewed" : messages.join("; "), transaction: transactionLink(s.signature) };
  }));
  return entries.filter((e) => e !== null);
}
/**
 * Token-2022 `MintTo`. A frozen destination is refused by Token-2022 itself,
 * which is the point of the allocation step: only admitted accounts receive.
 */
export async function mintTo(
  payer: KeyPairSigner,
  mintAuthority: KeyPairSigner,
  mint: Address,
  token: Address,
  amount: bigint,
) {
  return send(payer, [
    ix(TOKEN, bytes([7], num(amount)), [
      rw(mint),
      rw(token),
      signed(mintAuthority),
    ]),
  ]);
}
export async function activate(
  payer: KeyPairSigner,
  mint: Address,
  credential: Address,
  schema: Address,
  wallet: Address,
  token: Address,
) {
  const a = await addresses(mint, credential, schema, wallet, token);
  return send(payer, [
    ix(
      TOKEN_ACL,
      [6],
      [
        signed(payer),
        ro(mint),
        rw(token),
        rw(a.flag),
        ro(wallet),
        ro(a.config),
        ro(TOKEN),
        ro(SYSTEM),
        ro(GATE),
        ro(a.list),
        ro(a.policy),
        ro(schema),
        ro(SAS),
        ro(a.evidence),
        ro(a.walletStatus),
        ro(a.tokenStatus),
      ],
    ),
  ]);
}
