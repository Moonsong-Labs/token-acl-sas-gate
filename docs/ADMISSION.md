# UC1 credential admission

The gate implements the first private-fund admission use case. It authorizes
permissionless thaw through Token ACL after checking current SAS evidence against
the mint's policy. It does not check transfers or automatically freeze accounts.
Token ACL's permissioned administrative thaw remains available.

The program has no baked-in deployment address. The integration suite deploys it at the
existing test address in `tests/support/ids.rs`.

## Configure a fund

1. Create a Token-2022 mint with `DefaultAccountState = Frozen`.
2. Create its Token ACL config with this program as `gating_program`. Token ACL
   takes the mint's freeze authority.
3. Issue the gate's configure instruction as the config's current freeze
   authority. This creates or replaces the policy and its discovery list atomically.
4. Enable permissionless thaw in Token ACL. Permissionless freeze is unsupported.
5. Create investor token accounts with `ImmutableOwner`. The gate also accepts
   separately created accounts with that extension; it does not require an ATA.
6. Initialize clear status records for the investor wallet and the token account.
   Anyone can fund these records. Initialization never clears existing flags.
7. Have the accepted SAS issuer issue evidence with `nonce = investor wallet`.
8. Submit Token ACL's non-idempotent `ThawPermissionless` instruction with the
   discovered extra accounts. The investor or a relayer can submit it.

Executable instruction builders and this complete flow are in
`tests/support/admission.rs`. The integration suite also verifies discovery with
`token_acl_interface::offchain::add_extra_account_metas_for_thaw`.

## Policy and evidence

Each mint accepts one SAS credential PDA as its issuer and one SAS schema address
and version. The credential identifies the issuer. The attestation's signing key
is not used as an issuer identity because SAS supports signer rotation.

The adapter accepts this schema layout, with these exact field names and order:

| Field | SAS type code | Encoding |
| --- | --- | --- |
| `jurisdiction` | 12, String | u32 byte length, followed by two uppercase country-code bytes |
| `verified_at` | 8, i64 | Unix seconds, little-endian |

The accepted jurisdiction set contains one to eight codes. This is a simple
fixture predicate, not a regulatory classification. Investor categories, multiple
issuers, and provider-specific schemas require later extensions.

The issuer must bind `nonce` to the investor wallet and set `verified_at` to the
underlying verification time. The gate checks that nonce against the current token
owner and requires `ImmutableOwner`. SAS `token_account` identifies the recipient
account holding the tokenized attestation itself. It is not compared with the
regulated token account being thawed.

Expiry is valid when `expiry == 0 || now < expiry`. A zero expiry does not disable
freshness. `max_age = 0` disables the additional age limit; otherwise the gate
requires `0 <= now - verified_at < max_age`. Negative or future verification times
are rejected even when the age limit is disabled. Reissuance with an unchanged
`verified_at` does not reset the age limit.

SAS revocation closes the attestation. A missing, emptied, or non-SAS-owned account
cannot qualify. SAS schema pause controls issuance and does not invalidate existing
evidence. The gate does not reinterpret pause as revocation.

Status records contain independent block and invalidation flags. They are scoped
to a mint and either a wallet or token account. Invalidation is an explicit
operator decision, persists across reissuance, and requires authorized removal.
No expiry or SAS revocation state is copied into policy or status storage.

## Addresses and layouts

All gate PDAs use the deployed gate address. Integers use little-endian encoding.

| Account | Seeds | Data |
| --- | --- | --- |
| Policy | `policy`, mint | 91 bytes, layout below |
| Discovery list | `thaw_extra_account_metas`, mint | Standard TLV list, 226 bytes |
| Status | `status`, mint, wallet or token account | `[2, blocked, invalidated]`, flags 0 or 1 |
| SAS evidence | `attestation`, credential, schema, wallet | Under the pinned SAS program |

Policy data also forms the configure instruction payload:

| Offset | Length | Field |
| --- | --- | --- |
| 0 | 1 | Format version, 1 |
| 1 | 32 | SAS credential PDA |
| 33 | 32 | SAS schema PDA |
| 65 | 1 | SAS schema version, nonzero |
| 66 | 8 | Maximum age in seconds, i64, nonnegative |
| 74 | 1 | Jurisdiction count, 1 through 8 |
| 75 | 16 | Two-byte jurisdiction entries, unused bytes zero |

The callback receives these accounts, all read-only:

| Index | Account |
| --- | --- |
| 0 | Caller, no investor signature required |
| 1 | Token account |
| 2 | Mint |
| 3 | Current token account owner |
| 4 | Token ACL flag PDA |
| 5 | Discovery list |
| 6 | Policy |
| 7 | SAS schema |
| 8 | SAS program |
| 9 | SAS attestation, derived from policy credential, schema, and wallet |
| 10 | Wallet status |
| 11 | Token account status |

The gate verifies PDA addresses, owners, and encodings before policy decisions.
It checks the discovery list against its generated contents. The Token ACL flag
must be owned by Token ACL, derived from the token account, and contain `[1]`.
The callback only returns a decision; Token ACL performs the thaw.

## Instructions and authority

`Configure`: byte `0`, followed by the 91-byte policy. Accounts, in order:

1. Writable payer, signer when funding is needed.
2. Current Token ACL config authority, signer.
3. Mint.
4. Token ACL config, derived from `MINT_CONFIG`, mint under Token ACL.
5. Writable policy PDA.
6. Writable discovery list PDA.
7. SAS schema.
8. System program.

The program authenticates the config's owner, mint, authority, and gating program.
Every update follows the current config authority. There is no separately stored
admin key to become stale after a Token ACL authority rotation. The program accepts
prefunded System-owned PDAs, so lamport donations cannot prevent initialization.

`InitializeStatus`: byte `1`. `SetStatus`: bytes `[2, blocked, invalidated]`.
Both use these accounts:

1. Writable payer, signer when funding is needed.
2. Authority, signer for `SetStatus`.
3. Mint.
4. Token ACL config.
5. Subject wallet or token account.
6. Writable status PDA.
7. System program.

`InitializeStatus` is permissionless and idempotent. `SetStatus` checks the same
current config authority as `Configure`. Updates emit a `status` log containing
the record address and both flags. A missing status record denies admission;
there is no implicit clear state.

`CanThawPermissionless` uses the standard eight-byte discriminator
`[8, 175, 169, 129, 137, 74, 61, 241]`, without trailing instruction data.
All other instructions, including the freeze callback, are rejected.

## Denials and verification

| Custom code | Meaning |
| --- | --- |
| 1 | Wrong derived address |
| 2 | Wrong account owner |
| 3 | Malformed account or payload |
| 4 | Unauthorized administrator |
| 5 | Explicit wallet or token-account block |
| 6 | Unaccepted schema, version, or schema layout |
| 7 | Subject, token mint, or token owner mismatch |
| 8 | Missing ImmutableOwner or invalid base token layout |
| 9 | Expired evidence |
| 10 | Stale, negative, or future verification time |
| 11 | Explicit invalidation |
| 12 | Unaccepted issuer credential |
| 13 | Jurisdiction outside the accepted set |
| 14 | Inactive Token ACL flag |

Standard program errors cover invalid instructions, missing accounts, missing
signatures, and CPI failures. A rejection can occur before the callback: the
pinned Token ACL binary resolves the discovery list before invoking the gate.
An omitted list reaches the gate with only the five base accounts and is rejected.
Omitted required entries fail during Token ACL resolution. Neither path admits.

Run `mise run check` and `mise run verify`. Tests cover real SAS issuance, actual
frozen-to-thawed account state, investor and relayer callers, authority checks,
blocks, invalidation, closure, stale reissuance, standard discovery, malformed and
substituted accounts, authority rotation, tokenized attestations with a separate recipient, and non-ATA
accounts without ImmutableOwner. Paused-clock SBF
simulations verify exact expiry and freshness boundaries. Synthetic account
mutations are limited to negative cases ordinary instructions cannot produce.

The integration test prints callback CU, total Token ACL CU, instruction data size,
and discovery-list size for the pinned binaries. These are fixture measurements,
not a performance guarantee for arbitrary schemas or deployments. The total Token
ACL measurement includes discovery, the gate callback, and the Token-2022 thaw; it
does not isolate discovery cost.
