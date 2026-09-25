//! Hand-built SAS instruction builders for the integration probe.
//!
//! The first-party `solana-attestation-service-client` targets the solana 2.x
//! stack and cannot interoperate with the surfpool (4.x) crates the harness is
//! built on, so the probe constructs SAS instructions directly from the
//! discriminators, account layouts, PDA seeds, and byte encodings recorded in
//! `docs/SAS_SPIKE.md` §2/§6. Instruction data is `[1-byte discriminator] ++
//! borsh(args)`; every length prefix is a 4-byte little-endian `u32`.

use super::ids;
use solana_instruction::{AccountMeta, Instruction};
use surfpool_sdk::Pubkey;

/// The System program, an account on every create instruction.
const SYSTEM_PROGRAM: Pubkey = Pubkey::from_str_const("11111111111111111111111111111111");

// Instruction discriminators (SAS `entrypoint.rs`).
const CREATE_CREDENTIAL: u8 = 0;
const CREATE_SCHEMA: u8 = 1;
const CREATE_ATTESTATION: u8 = 6;
const CLOSE_ATTESTATION: u8 = 7;

/// Credential PDA: `["credential", authority, name]`.
pub fn credential_pda(authority: &Pubkey, name: &str) -> Pubkey {
    Pubkey::find_program_address(
        &[b"credential", authority.as_ref(), name.as_bytes()],
        &ids::SAS.id,
    )
    .0
}

/// Schema PDA: `["schema", credential, name, [1]]` (version 1 is fixed for a
/// fresh schema).
pub fn schema_pda(credential: &Pubkey, name: &str) -> Pubkey {
    Pubkey::find_program_address(
        &[b"schema", credential.as_ref(), name.as_bytes(), &[1u8]],
        &ids::SAS.id,
    )
    .0
}

/// Attestation PDA: `["attestation", credential, schema, nonce]`. The nonce
/// carries the subject, so this address is one-per-subject (§7).
pub fn attestation_pda(credential: &Pubkey, schema: &Pubkey, nonce: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[
            b"attestation",
            credential.as_ref(),
            schema.as_ref(),
            nonce.as_ref(),
        ],
        &ids::SAS.id,
    )
    .0
}

fn event_authority() -> Pubkey {
    Pubkey::find_program_address(&[b"__event_authority"], &ids::SAS.id).0
}

fn push_len_prefixed(out: &mut Vec<u8>, bytes: &[u8]) {
    out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    out.extend_from_slice(bytes);
}

/// Borsh-encode a claim with a single `String` field (schema layout `[12]`),
/// e.g. `jurisdiction = "DE"`.
pub fn string_claim(value: &str) -> Vec<u8> {
    let mut data = Vec::new();
    push_len_prefixed(&mut data, value.as_bytes());
    data
}

/// `CreateCredential` — creates `credential` owned by `authority`, with
/// `signers` as the authorized-signer set.
pub fn create_credential(
    payer: &Pubkey,
    credential: &Pubkey,
    authority: &Pubkey,
    name: &str,
    signers: &[Pubkey],
) -> Instruction {
    let mut data = vec![CREATE_CREDENTIAL];
    push_len_prefixed(&mut data, name.as_bytes());
    data.extend_from_slice(&(signers.len() as u32).to_le_bytes());
    for signer in signers {
        data.extend_from_slice(signer.as_ref());
    }
    Instruction::new_with_bytes(
        ids::SAS.id,
        &data,
        vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new(*credential, false),
            AccountMeta::new_readonly(*authority, true),
            AccountMeta::new_readonly(SYSTEM_PROGRAM, false),
        ],
    )
}

/// `CreateSchema` — one `layout` byte per field (`12` = `String`) and one
/// `field_names` entry per field.
#[allow(clippy::too_many_arguments)]
pub fn create_schema(
    payer: &Pubkey,
    authority: &Pubkey,
    credential: &Pubkey,
    schema: &Pubkey,
    name: &str,
    description: &str,
    layout: &[u8],
    field_names: &[&str],
) -> Instruction {
    let mut data = vec![CREATE_SCHEMA];
    push_len_prefixed(&mut data, name.as_bytes());
    push_len_prefixed(&mut data, description.as_bytes());
    push_len_prefixed(&mut data, layout);
    data.extend_from_slice(&(field_names.len() as u32).to_le_bytes());
    for field in field_names {
        push_len_prefixed(&mut data, field.as_bytes());
    }
    Instruction::new_with_bytes(
        ids::SAS.id,
        &data,
        vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new_readonly(*authority, true),
            AccountMeta::new_readonly(*credential, false),
            AccountMeta::new(*schema, false),
            AccountMeta::new_readonly(SYSTEM_PROGRAM, false),
        ],
    )
}

/// `CreateAttestation` — args are `nonce: Pubkey`, `data: Vec<u8>`,
/// `expiry: i64` (Unix seconds; `0` = never). A past non-zero `expiry` is
/// rejected at creation.
#[allow(clippy::too_many_arguments)]
pub fn create_attestation(
    payer: &Pubkey,
    authority: &Pubkey,
    credential: &Pubkey,
    schema: &Pubkey,
    attestation: &Pubkey,
    nonce: &Pubkey,
    claim: &[u8],
    expiry: i64,
) -> Instruction {
    let mut data = vec![CREATE_ATTESTATION];
    data.extend_from_slice(nonce.as_ref());
    push_len_prefixed(&mut data, claim);
    data.extend_from_slice(&expiry.to_le_bytes());
    Instruction::new_with_bytes(
        ids::SAS.id,
        &data,
        vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new_readonly(*authority, true),
            AccountMeta::new_readonly(*credential, false),
            AccountMeta::new_readonly(*schema, false),
            AccountMeta::new(*attestation, false),
            AccountMeta::new_readonly(SYSTEM_PROGRAM, false),
        ],
    )
}

/// `CloseAttestation` — native revocation. Drains the account to `payer` and
/// reassigns it to the System program; emits an event through the SAS
/// event-authority PDA.
pub fn close_attestation(
    payer: &Pubkey,
    authority: &Pubkey,
    credential: &Pubkey,
    attestation: &Pubkey,
) -> Instruction {
    Instruction::new_with_bytes(
        ids::SAS.id,
        &[CLOSE_ATTESTATION],
        vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new_readonly(*authority, true),
            AccountMeta::new_readonly(*credential, false),
            AccountMeta::new(*attestation, false),
            AccountMeta::new_readonly(event_authority(), false),
            AccountMeta::new_readonly(SYSTEM_PROGRAM, false),
            AccountMeta::new_readonly(ids::SAS.id, false),
        ],
    )
}
