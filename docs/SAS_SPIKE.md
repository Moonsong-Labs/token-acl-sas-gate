# SAS Spike — Findings

Resolves the SAS questions in `IMPLEMENTATION.md` §3 and the highest-risk item in
§9.1, and fills the SAS rows of the §1 pin table. Findings are read from the pinned
SAS source; assumptions and gaps are labelled.

**Method.** The SAS source was cloned and read at the pinned commit below; the Rust
client crate, on-chain program, and the project's own integration tests were the
primary sources. Nothing here was taken from public docs or memory.

---

## 1. Pinned versions (fills `IMPLEMENTATION.md` §1, SAS rows)

| Item | Value |
| --- | --- |
| SAS repo | `solana-foundation/solana-attestation-service` |
| SAS commit pinned | `5b64cf09843d62ca800f7d73f8438ad3505de70e` (default branch; no release tags) |
| SAS program ID (devnet + mainnet, same) | `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG` (`program/src/lib.rs:15` `declare_id!`) |
| SAS Rust client crate | `solana-attestation-service-client` = `1.0.9` (crates.io; also `clients/rust/`) |
| Client crate deps | `borsh` 1.x + `solana-program` 2.x only — **no conflict** with our solana 2.3 dev-deps |
| Serialization (on-chain accounts) | **manual little-endian byte packing**, 1-byte discriminator; **not Borsh, not zero-copy** |
| Instruction encoding | `[1-byte discriminator] ++ borsh(args)` |

**Our harness's hardcoded `SAS_PROGRAM_ID` (`tests/support/mod.rs:19`) is correct as-is** —
verified against `declare_id!`, not memory. (An early guess that it had a trailing extra
character was wrong.)

---

## 2. Account layouts (answers §3.1)

One-byte **discriminator** at offset 0 identifies the account type: `Credential = 0`,
`Schema = 1`, `Attestation = 2`. `Vec`/`String` fields use a 4-byte LE `u32` length
prefix; all integers are little-endian.

### Attestation (`program/src/state/attestation.rs`) — total `173 + L` bytes

| Offset | Size | Field | Type | Notes |
| --- | --- | --- | --- | --- |
| 0 | 1 | discriminator | u8 | `= 2` |
| 1 | 32 | **nonce** | Pubkey | uniqueness seed; **in prod = the subject wallet** |
| 33 | 32 | credential | Pubkey | issuer/credential ref |
| 65 | 32 | schema | Pubkey | schema ref |
| 97 | 4 | data_len | u32 LE | `= L` |
| 101 | L | **data** | bytes | claim, schema-encoded (§5) |
| 101+L | 32 | **signer** | Pubkey | authorized signer that attested (issuer identity) |
| 133+L | 8 | **expiry** | i64 LE | Unix seconds; `0` = never |
| 141+L | 32 | token_account | Pubkey | asset restriction: binds the attestation to a specific token account (tokenized attestations); all-zeros (default) = not asset-restricted. **Not** the subject — see §7 |

### Schema (`program/src/state/schema.rs`) — `51 + N + D + Y + F`

`disc(=1) | credential(32) | name(u32 len N + bytes) | description(u32 len D + bytes) |
layout(u32 len Y + Y bytes) | field_names(u32 byte-len F + blob) | is_paused(1) | version(1)`.
`layout` is one `SchemaDataTypes` code byte per field (§5). `version` is hardcoded to `1`
for a new schema (not a create arg).

### Credential (`program/src/state/credential.rs`) — `41 + N + 32·S`

`disc(=0) | authority(32) | name(u32 len N + bytes) | authorized_signers(u32 count S + S×32)`.

> **There is no dedicated `subject` field.** The closest is `nonce`; the SAS demo sets
> `nonce = subject wallet` (`examples/.../main.rs:287`). See §7 (design implication).

---

## 3. Expiry, revocation, renewal, claim decoding (answers §3.2–3.5, §3.7)

**Expiry (§3, "Time units" + boundary).** `i64` **Unix seconds**, compared against
`Clock::unix_timestamp`. Sentinel `0` = never expires. SAS checks expiry **only at
creation** (`create_attestation.rs:64`: reject if `expiry < now && expiry != 0`, operator
`<`, so `expiry == now` is accepted at creation). **There is no verify/read-time check —
our gate must enforce `expiry == 0 || now < expiry` itself.**

**Revocation / closure (§3.3).** Revocation is **account closure** (`close_attestation`):
lamports drained, data truncated to zero, owner reassigned to the System Program. **No
status/revoked flag, no on-chain tombstone or revocation list.** A `CloseAttestationEvent`
is emitted as a log only. → **For a reader, the presence of a valid account is the
signal; absence (owner = System, empty data) is the revocation.** `change_schema_status`
(`is_paused`) blocks *new* issuance only; it does **not** invalidate existing attestations.

**Renewal / reissuance (§3.4 — resolves §9.1/§9.2).** **No renew instruction.** Renewal =
create a new attestation with a new `nonce` → new PDA. Prior evidence is invalidated only
by explicitly closing that specific attestation. Granularity: **per-attestation-instance
only.** No per-subject or per-claim native revocation. → **Reissuance does not supersede
prior evidence automatically**; our design must decide what remains valid.

**Claim data (§3.7).** `data` is a flat concatenation of LE-packed field values in
`layout` order, with no self-describing tags — decoding requires the schema. `layout` is a
`Vec<u8>` of `SchemaDataTypes` codes (`U8=0, U16=1, U32=2, U64=3, U128=4, I8=5 … Bool=10,
Char=11, String=12, VecU8=13 … VecString=25`). Fixed types have fixed sizes; `String`/`Vec`
use a 4-byte LE length prefix. `field_names` is a blob of (`u32` len + UTF-8) entries, count
= `layout.len()`. **Decode a named field** by finding its index in `field_names`, summing the
sizes of preceding fields via `layout` to get the offset, then reading per its type code.

> Caveat: the `cereal_macro` crate (`solana-attestation-service-macros`) that *derives*
> `layout` is a workspace member but was **not in the staged copy**, so the derive path is
> unverified from source. Hand-coding `layout` with the observed codes (e.g. `String = 12`)
> is the fallback and is what the test sketch uses. Note `core/src/lib.rs` also defines an
> *unused* `PrimitiveDataTypes` enum (`U8=1…`) that does **not** match the emitted codes —
> use the `SchemaDataTypes` table above.

---

## 4. Authenticity check the gate must replicate (answers §3, §4.1)

Only two checks authenticate a genuine SAS attestation — sound because only the SAS
program can own accounts it created via PDA:

1. `account.owner == 22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG` (SAS program ID).
2. `data.len() >= 173` and `data[0] == 2` (Attestation discriminator).

Recommended additional hardening for our gate: recompute the attestation PDA from
`["attestation", credential, schema, nonce]` to bind those fields, and enforce expiry
ourselves (§3). To validate the claim conforms, load the `schema` account
(`owner == SAS`, `data[0] == 1`) and decode per §5's rules.

---

## 5. Verification model & measured cost

**Read-and-decode, no CPI.** The gate validates a supplied SAS account by reading it and
checking owner + discriminator + layout; account-ownership rules prevent forgery. A CPI
into SAS adds no security (SAS has no "verify" instruction anyway) and costs CU.

**Measured (probe test, `tests/spike_sas.rs`, run against a live validator):** an
attestation with a one-field `jurisdiction = "DE"` claim is **179 bytes** — exactly
`173 + L` with `L = 6` (4-byte length prefix + `"DE"`), confirming the byte layout in §2
end-to-end. The spike decoder and the client crate's `Attestation::from_bytes` agree
field-by-field on the issued values.

**On-chain decode CU is still TODO** — it can only be measured once the actual gate
program decodes during a thaw callback; the spike decoder runs host-side in the test.
Deferred to the UC1 build (step 3).

---

## 6. Test-harness implications (feed into the UC1 build)

- **Depend on `solana-attestation-service-client = "1.0.9"`** (crates.io) — first-party
  builders (`CreateCredential/CreateSchema/CreateAttestation/CloseAttestation`) and Borsh
  account decoders. Keep the harness on **borsh 1.x** to match it.
- **Full issuance flow:** `CreateCredential` → `CreateSchema` → `CreateAttestation`, all
  ordinary transactions; payer + the credential authority / an authorized signer co-sign.
  PDA seeds are byte-for-byte in §3 above.
- **You cannot mint a pre-expired attestation** — SAS rejects `expiry < now` at creation
  (`Custom(6)`). To test the expired/expiry-boundary rows, mint with a short future expiry
  and **warp the validator clock past it**, then assert the gate denies. Use `expiry = 0`
  as the never-expires positive control.
- **`nonce` is the subject key.** Negative "wrong subject" = mint with a nonce ≠ the token
  account owner. "Wrong schema"/"wrong credential" = pass a mismatched account so the PDA
  fails to re-derive.
- **`emit_event` / event-authority PDA** (`__event_authority` →
  `DzSpKpST2TSyrxokMXchFz3G2yn5WEGoxzpGEUDjCX4g`) is needed for **close** only; the client
  builder defaults it. `CreateAttestation` needs no event authority.

---

## 7. Subject binding — DECISION LOCKED

SAS has **no `subject` field**, so UC1's "attestation subject matches the current
token-account owner" (`IMPLEMENTATION.md` §4.3) needs a chosen field to carry the subject
identity.

**Decision (locked): bind the subject on `nonce`.** The gate reads `nonce` as the investor
wallet and checks:

```
attestation.nonce == current_owner_of(token_account_being_thawed)
```

This is what the SAS reference demo does (`examples/.../main.rs:287`). `nonce` is a 32-byte
Pubkey and is part of the attestation PDA seeds (`["attestation", credential, schema,
nonce]`), so a `(credential, schema, subject)` triple maps to exactly one attestation
address — the gate re-derives that address rather than trusting the account it is handed.

**Operational requirement (must be in the issuer agreement / policy):** SAS does not enforce
`nonce == subject`; it is a convention. The allowlisted issuer **must set `nonce` = the
investor's wallet** at issuance. (Our probe test used a random `nonce` because it was not
exercising the binding — step-3 fixtures must set `nonce = subject`.)

**`token_account` is a different property — not the subject.** The attestation's
`token_account` field is an **asset restriction**: it scopes a (tokenized) attestation to a
specific token account/asset, and is all-zeros by default when the attestation is not
asset-restricted. It answers "which asset may this evidence be used for," not "who is this
evidence about." Subject binding stays on `nonce`; asset restriction via `token_account` is
an orthogonal narrowing we can layer later if a policy needs it.

**Rejected for the MVP:** carrying the subject as an explicit `subject: Pubkey` field inside
the schema `data` — more self-documenting but couples binding to claim decoding, adds a field
to every schema, and gives no address-level (PDA) binding.

**Still required alongside `nonce` (unchanged from §4.3):** the token account must carry the
`ImmutableOwner` extension **and** current owner must equal the subject at thaw time — nonce
binding supplies "who is the subject," `ImmutableOwner` + current-owner-match prevent a later
owner swap.
