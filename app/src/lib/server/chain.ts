// Server-side wire adapter for the pinned programs. Encodings mirror the Rust
// UC1 fixture; browser tests execute these instructions against their real SBF.
import {
  address,
  getAddressEncoder,
  getAddressDecoder,
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
) {
  const evidence = await pda(
    SAS,
    "attestation",
    key(credential),
    key(schema),
    key(wallet),
  );
  return send(payer, [
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
