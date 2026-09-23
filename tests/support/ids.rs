//! Pinned programs the suite deploys into each surfnet.

use surfpool_sdk::Pubkey;

/// A third-party program deployed from a committed binary.
///
/// The binary is pinned by hash so a refresh shows up as a diff rather than as
/// behaviour that quietly changed underneath the suite: the file is checked
/// against `sha256` before every deploy. Nothing here watches mainnet —
/// `mise run sync-programs` re-dumps both programs and prints their hashes, and
/// the suite fails on a pin mismatch until someone reviews the diff.
pub struct Program {
    pub id: Pubkey,
    pub file: &'static str,
    pub sha256: &'static str,
}

/// Solana Attestation Service. The gate reads its accounts and authenticates
/// them by owning program, so this address is a security boundary: point it
/// elsewhere and forged evidence passes.
pub const SAS: Program = Program {
    id: Pubkey::from_str_const("22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG"),
    file: "sas.so",
    sha256: "afacc7215d6ab6759bcf5edb958a1ad1d9de7559d53ac807c6aa4775a1a5a357",
};

/// Token ACL (sRFC37). Calls our gate through `can_thaw_permissionless` and
/// holds the mint freeze authority in its `MintConfig` PDA.
pub const TOKEN_ACL: Program = Program {
    id: Pubkey::from_str_const("TACLkU6CiCdkQN2MjoyDkVg2yAH9zkxiHDsiztQ52TP"),
    file: "token_acl.so",
    sha256: "af9bffc6f6dc143656b82cb7cc8a78e57bdb0172e7d36bd51659157bf01fb4a0",
};

pub const PINNED: [Program; 2] = [SAS, TOKEN_ACL];

/// Our gate, at a fixed test-only address.
///
/// Pinocchio's `entrypoint!` bakes in no address and the crate declares no
/// program ID, so the same `.so` deploys anywhere. Fixing it here keeps PDAs
/// derived under it — `["thaw_extra_account_metas", mint]` and the per-mint
/// policy accounts — reproducible across runs.
pub const GATE: Pubkey = Pubkey::from_str_const("55fu8EtaF3Zsp35cXtWvQvBi9iVeGgCKms6WWbanj1zz");
