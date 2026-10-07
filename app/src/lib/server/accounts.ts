// Read-only decoders for the accounts the demo screens display. Every screen
// fact comes from chain state through these, so each decoder checks the owning
// program and layout first and refuses to guess on anything unexpected.
// Layouts: SPL Token-2022, Token ACL `MintConfig` (token-acl-client 0.3.1),
// SAS (docs/SAS_SPIKE.md §2), and the gate (docs/ADMISSION.md).
import type { Address } from "@solana/kit";
import { GATE, SAS, TOKEN, TOKEN_ACL, readKey } from "./chain";

type Raw = { owner: Address; data: Buffer } | null;

export function decodeStatus(raw: Raw) {
  if (!raw || raw.owner !== GATE || raw.data.length !== 3 || raw.data[0] !== 2 ||
      raw.data[1] > 1 || raw.data[2] > 1)
    throw new Error("Investor status unavailable. Run mise run seed.");
  return { blocked: raw.data[1] === 1, invalidated: raw.data[2] === 1 };
}

/** Token-2022 TLV extension types used here. */
const DEFAULT_ACCOUNT_STATE = 6;
const IMMUTABLE_OWNER = 7;
/** Token-2022 base lengths; extensions start after a 1-byte account type. */
const BASE = 165;
const MINT_TYPE = 1;
const ACCOUNT_TYPE = 2;

function extensions(data: Buffer, accountType: number) {
  const found = new Map<number, Buffer>();
  if (data.length <= BASE) return found;
  if (data[BASE] !== accountType) throw new Error("Unexpected Token-2022 account type.");
  let offset = BASE + 1;
  while (offset + 4 <= data.length) {
    const type = data.readUInt16LE(offset);
    const length = data.readUInt16LE(offset + 2);
    const end = offset + 4 + length;
    if (type === 0 || end > data.length) break;
    found.set(type, data.subarray(offset + 4, end));
    offset = end;
  }
  return found;
}

export function decodeMint(raw: Raw) {
  if (!raw || raw.owner !== TOKEN || raw.data.length < 82)
    throw new Error("Fund mint unavailable. Run mise run seed.");
  const d = raw.data;
  const option = (at: number) =>
    d.readUInt32LE(at) === 1 ? readKey(d, at + 4) : null;
  const state = extensions(d, MINT_TYPE).get(DEFAULT_ACCOUNT_STATE);
  return {
    mintAuthority: option(0),
    supply: d.readBigUInt64LE(36),
    decimals: d[44],
    freezeAuthority: option(46),
    /** `AccountState::Frozen = 2`. */
    frozenByDefault: state?.[0] === 2,
  };
}

/** Token ACL `MintConfig`: the gate authenticates the same 100-byte layout. */
export function decodeMintConfig(raw: Raw) {
  if (!raw || raw.owner !== TOKEN_ACL || raw.data.length !== 100 || raw.data[0] !== 1)
    throw new Error("Token ACL config unavailable. Run mise run seed.");
  const d = raw.data;
  return {
    permissionlessThaw: d[2] === 1,
    permissionlessFreeze: d[3] === 1,
    mint: readKey(d, 4),
    authority: readKey(d, 36),
    gatingProgram: readKey(d, 68),
  };
}

export function decodeTokenAccount(raw: Raw) {
  if (!raw || raw.owner !== TOKEN || raw.data.length < BASE)
    throw new Error("Investor account unavailable. Run mise run seed.");
  const d = raw.data;
  if (![1, 2].includes(d[108])) throw new Error("Investor account is not initialized.");
  return {
    mint: readKey(d, 0),
    owner: readKey(d, 32),
    amount: d.readBigUInt64LE(64),
    /** `AccountState`: 1 initialized (thawed), 2 frozen. */
    active: d[108] === 1,
    immutableOwner: extensions(d, ACCOUNT_TYPE).has(IMMUTABLE_OWNER),
  };
}

function field(d: Buffer, offset: { at: number }) {
  const length = d.readUInt32LE(offset.at);
  const value = d.subarray(offset.at + 4, offset.at + 4 + length);
  if (value.length !== length) throw new Error("Truncated SAS account.");
  offset.at += 4 + length;
  return value;
}

/** SAS credential: `0 | authority | name | authorized_signers`. */
export function decodeCredential(raw: Raw) {
  if (!raw || raw.owner !== SAS || raw.data[0] !== 0)
    throw new Error("SAS credential unavailable. Run mise run seed.");
  const d = raw.data;
  const offset = { at: 33 };
  const name = field(d, offset).toString();
  const count = d.readUInt32LE(offset.at);
  const signers = Array.from({ length: count }, (_, i) =>
    readKey(d, offset.at + 4 + i * 32),
  );
  return { authority: readKey(d, 1), name, signers };
}

const TYPE_NAMES: Record<number, string> = { 8: "i64", 12: "String" };

/** SAS schema: `1 | credential | name | description | layout | field_names | paused | version`. */
export function decodeSchema(raw: Raw) {
  if (!raw || raw.owner !== SAS || raw.data[0] !== 1)
    throw new Error("SAS schema unavailable. Run mise run seed.");
  const d = raw.data;
  const offset = { at: 33 };
  const name = field(d, offset).toString();
  const description = field(d, offset).toString();
  const layout = [...field(d, offset)];
  const names = field(d, offset);
  const nameOffset = { at: 0 };
  const fields = layout.map((type) => ({
    name: field(names, nameOffset).toString(),
    type: TYPE_NAMES[type] ?? `type ${type}`,
  }));
  return {
    credential: readKey(d, 1),
    name,
    description,
    fields,
    paused: d[offset.at] === 1,
    version: d[offset.at + 1],
  };
}

/** The gate's policy account, format v1 (docs/ADMISSION.md "Addresses and layouts"). */
export function decodePolicy(raw: Raw) {
  if (!raw || raw.owner !== GATE || raw.data.length !== 91 || raw.data[0] !== 1)
    throw new Error("Fund policy unavailable. Run mise run seed.");
  const d = raw.data;
  return {
    credential: readKey(d, 1),
    schema: readKey(d, 33),
    schemaVersion: d[65],
    /** Seconds; `0` disables the age limit (expiry is always enforced). */
    maxAge: Number(d.readBigInt64LE(66)),
    jurisdictions: Array.from({ length: d[74] }, (_, i) =>
      d.subarray(75 + i * 2, 77 + i * 2).toString(),
    ),
  };
}

/**
 * The investor's SAS attestation, or `null` when none exists. A closed
 * attestation is emptied and handed to the System program, which is also "none".
 */
export function decodeAttestation(raw: Raw) {
  if (!raw || raw.owner !== SAS || raw.data.length === 0) return null;
  const d = raw.data;
  if (d.length < 173 || d[0] !== 2) throw new Error("Invalid credential data.");
  const length = d.readUInt32LE(97);
  if (d.length !== 173 + length) throw new Error("Invalid credential data.");
  const claim = d.subarray(101, 101 + length);
  const offset = { at: 0 };
  const jurisdiction = field(claim, offset).toString();
  const verifiedAt = Number(claim.readBigInt64LE(offset.at));
  return {
    nonce: readKey(d, 1),
    credential: readKey(d, 33),
    schema: readKey(d, 65),
    jurisdiction,
    verifiedAt,
    signer: readKey(d, 101 + length),
    expiry: Number(d.readBigInt64LE(133 + length)),
  };
}
