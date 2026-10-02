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
  getSignatureFromTransaction,
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
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
/** Whether an HTTP `Host` header names this machine, with an optional port. */
export function isLocalHost(host: string) {
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
}
/** `value` as a URL, if it is plain HTTP to this machine; throws otherwise. */
function localHttpUrl(value: string, what: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`The demo requires a local ${what} URL.`);
  }
  if (url.protocol !== "http:" || !LOCAL_HOSTS.includes(url.hostname))
    throw new Error(`The demo requires a local ${what} URL.`);
  return url;
}
export function endpoint() {
  const value = process.env.DEMO_RPC_URL ?? "http://127.0.0.1:8899";
  localHttpUrl(value, "surfnet RPC");
  return value;
}
/**
 * Surfpool Studio, the surfnet's local explorer. It opens a transaction from
 * `/?t=<signature>`. Local HTTP only, like the RPC endpoint.
 */
export function studio() {
  return localHttpUrl(process.env.DEMO_STUDIO_URL ?? "http://127.0.0.1:18488", "Surfpool Studio")
    .origin;
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
/**
 * A transaction was signed and possibly sent, but whether it landed is unknown:
 * the send itself failed in transit, or its confirmation could not be read.
 * Never a rejection: retrying could repeat a transaction that went through.
 */
export class Unconfirmed extends Error {
  constructor(public signature: string) {
    super(`Transaction ${signature} could not be confirmed.`);
  }
}
/** How long to keep polling for confirmation, across transient RPC errors. */
const CONFIRM_MS = 15_000;
export class RpcFailure extends Error {
  constructor(
    message: string,
    public details: { err?: unknown; logs?: string[] } = {},
    /** The JSON-RPC error code, when the failure came from an error response. */
    public code?: number,
  ) {
    super(message);
  }
}
/**
 * JSON-RPC error codes with which a node refuses a transaction without
 * broadcasting it (Solana's RPC custom errors, plus malformed requests). Any
 * other error from `sendTransaction`, e.g. an internal one, can come after the
 * transaction was accepted, so it is not proof that nothing was sent.
 */
const REFUSED = new Set([
  -32002, // SendTransactionPreflightFailure: simulation failed; logs attached
  -32003, // TransactionSignatureVerificationFailure
  -32006, // TransactionPrecompileVerificationFailure
  -32013, // TransactionSignatureLenMismatch
  -32015, // UnsupportedTransactionVersion
  -32600, // Invalid request
  -32602, // Invalid params: the transaction could not be decoded
]);
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
  if (body.error)
    throw new RpcFailure(body.error.message, body.error.data, body.error.code);
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
/**
 * Sign, send and confirm. Throws `RpcFailure` only when the transaction was
 * refused (with a refusal code before broadcasting, or on-chain with an
 * error), `Unconfirmed` when it may have landed but cannot be confirmed, and a
 * plain `Error` when nothing was signed.
 */
export async function send(payer: KeyPairSigner, instructions: Instruction[]) {
  let latest: { value: { blockhash: string; lastValidBlockHeight: number } };
  try {
    latest = await rpc("getLatestBlockhash", [{ commitment: "confirmed" }]);
  } catch (error) {
    // Nothing has been signed yet: this is a read failure, not a rejection.
    throw new Error(
      `Could not read a recent blockhash: ${error instanceof Error ? error.message : error}`,
    );
  }
  const { value } = latest;
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
  // Known before sending, so an uncertain outcome can still name the transaction.
  const signature = getSignatureFromTransaction(transaction);
  try {
    await rpc<string>("sendTransaction", [
      getBase64EncodedWireTransaction(transaction),
      { encoding: "base64", preflightCommitment: "confirmed" },
    ]);
  } catch (error) {
    // Only a refusal code proves nothing was sent. Anything else (another
    // JSON-RPC error, network, HTTP, timeout) may have happened after
    // delivery: confirm the outcome below instead of assuming one.
    if (error instanceof RpcFailure && error.code !== undefined && REFUSED.has(error.code))
      throw error;
  }
  const deadline = Date.now() + CONFIRM_MS;
  while (Date.now() < deadline) {
    let status: { err: unknown; confirmationStatus: string } | null = null;
    try {
      const result = await rpc<{
        value: ({ err: unknown; confirmationStatus: string } | null)[];
      }>("getSignatureStatuses", [[signature]]);
      status = result.value[0];
    } catch {
      // A failed status read says nothing about the transaction: poll again.
    }
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
  throw new Unconfirmed(signature);
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
