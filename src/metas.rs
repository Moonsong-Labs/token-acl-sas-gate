//! Standard sRFC37 discovery list, generated from the authenticated policy.
use crate::{SAS, THAW, state::Policy};
use pinocchio::{Address, error::ProgramError};
use spl_discriminator::{ArrayDiscriminator, SplDiscriminate};
use spl_tlv_account_resolution::{
    account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList,
};
pub const SEED: &[u8] = b"thaw_extra_account_metas";
pub struct Thaw;
impl SplDiscriminate for Thaw {
    const SPL_DISCRIMINATOR: ArrayDiscriminator = ArrayDiscriminator::new(THAW);
}
pub fn bytes(program: &Address, mint: &Address, policy: &Policy) -> Result<Vec<u8>, ProgramError> {
    // Token ACL resolves this list before calling the gate. Select evidence
    // from the mint's policy and the token account's current owner, rather than
    // letting the caller choose another investor's credential.
    let literal = |bytes: &[u8]| Seed::Literal {
        bytes: bytes.to_vec(),
    };
    let key = |index| Seed::AccountKey { index };
    let fixed = |address: Address| {
        ExtraAccountMeta::new_with_pubkey(&address.to_bytes().into(), false, false)
    };
    let status = |index| {
        ExtraAccountMeta::new_with_seeds(&[literal(b"status"), key(2), key(index)], false, false)
    };
    let entries = [
        fixed(Address::find_program_address(&[b"policy", mint.as_ref()], program).0)?,
        fixed(policy.schema)?,
        fixed(SAS)?,
        // SAS derives evidence from credential + schema + nonce. Account 6 is
        // the policy, 7 the schema, 8 SAS, and 3 the owner used as nonce. The
        // regulated mint is absent from these seeds, allowing credential reuse.
        ExtraAccountMeta::new_external_pda_with_seeds(
            8,
            &[
                literal(b"attestation"),
                Seed::AccountData {
                    account_index: 6,
                    data_index: 1,
                    length: 32,
                },
                key(7),
                key(3),
            ],
            false,
            false,
        )?,
        status(3)?,
        status(1)?,
    ];
    let mut data = vec![0; ExtraAccountMetaList::size_of(entries.len())?];
    ExtraAccountMetaList::init::<Thaw>(&mut data, &entries)?;
    Ok(data)
}
