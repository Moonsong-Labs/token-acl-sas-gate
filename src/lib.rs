use pinocchio::{
    AccountView, Address, ProgramResult,
    cpi::{Seed, Signer},
    error::ProgramError,
    sysvars::{Sysvar, clock::Clock, rent::Rent},
};
use pinocchio_system::instructions::{Allocate, Assign, CreateAccount, Transfer};
pub mod metas;
pub mod state;
use state::{Attestation, Policy};

pub const SAS: Address = Address::from_str_const("22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG");
pub const TOKEN: Address = Address::from_str_const("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
pub const ACL: Address = Address::from_str_const("TACLkU6CiCdkQN2MjoyDkVg2yAH9zkxiHDsiztQ52TP");
pub const THAW: [u8; 8] = [8, 175, 169, 129, 137, 74, 61, 241];

#[derive(Clone, Copy, Debug, PartialEq)]
#[repr(u32)]
pub enum GateError {
    Address = 1,
    Owner,
    Malformed,
    Unauthorized,
    Blocked,
    Schema,
    Subject,
    ImmutableOwner,
    Expired,
    Freshness,
    Invalidated,
    Issuer,
    Claim,
    Context,
}
impl From<GateError> for ProgramError {
    fn from(e: GateError) -> Self {
        Self::Custom(e as u32)
    }
}
#[cfg(not(feature = "no-entrypoint"))]
pinocchio::entrypoint!(process_instruction);

/// Admin opcodes: 0 configure policy/metas, 1 create clear status, 2 set status.
pub fn process_instruction(
    program: &Address,
    accounts: &mut [AccountView],
    data: &[u8],
) -> ProgramResult {
    if data == THAW {
        return can_thaw(program, accounts);
    }
    match data.split_first() {
        Some((0, policy)) => configure(program, accounts, policy),
        Some((1, [])) => status(program, accounts, None),
        Some((2, [blocked @ 0..=1, invalidated @ 0..=1])) => {
            status(program, accounts, Some([*blocked, *invalidated]))
        }
        _ => Err(ProgramError::InvalidInstructionData),
    }
}
fn owner(account: &AccountView, expected: &Address) -> ProgramResult {
    if account.owner() != expected {
        return Err(GateError::Owner.into());
    }
    Ok(())
}
fn derived(account: &AccountView, seeds: &[&[u8]], program: &Address) -> Result<u8, ProgramError> {
    let (key, bump) = Address::find_program_address(seeds, program);
    if account.address() != &key {
        return Err(GateError::Address.into());
    }
    Ok(bump)
}
fn authority(
    program: &Address,
    signer: &AccountView,
    mint: &AccountView,
    config: &AccountView,
) -> ProgramResult {
    // The fund operator is the mint's current Token ACL authority. Read its
    // config on every update so an authority rotation also changes who may
    // configure this gate's policy and compliance flags.
    if !signer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    owner(mint, &TOKEN)?;
    derived(config, &[b"MINT_CONFIG", mint.address().as_ref()], &ACL)?;
    owner(config, &ACL)?;
    let data = config.try_borrow()?;
    if data.len() != 100 || data[0] != 1 || data[2] > 1 || data[3] > 1 {
        return Err(GateError::Malformed.into());
    }
    if state::address(&data, 4)? != *mint.address()
        || state::address(&data, 36)? != *signer.address()
        || state::address(&data, 68)? != *program
    {
        return Err(GateError::Unauthorized.into());
    }
    Ok(())
}
/// Creates PDAs even if someone has already sent lamports to their addresses.
fn create(
    program: &Address,
    payer: &AccountView,
    account: &AccountView,
    seeds: &[&[u8]],
    len: usize,
) -> ProgramResult {
    let bump = [derived(account, seeds, program)?];
    owner(account, &pinocchio_system::ID)?;
    if !account.is_data_empty() {
        return Err(GateError::Malformed.into());
    }
    let mut signing: Vec<Seed> = seeds.iter().map(|s| Seed::from(*s)).collect();
    signing.push(Seed::from(&bump));
    let signers = [Signer::from(signing.as_slice())];
    let rent = Rent::get()?.try_minimum_balance(len)?;
    if account.lamports() == 0 {
        CreateAccount {
            from: payer,
            to: account,
            lamports: rent,
            space: len as u64,
            owner: program,
        }
        .invoke_signed(&signers)?;
    } else {
        if account.lamports() < rent {
            Transfer {
                from: payer,
                to: account,
                lamports: rent - account.lamports(),
            }
            .invoke()?;
        }
        Allocate {
            account,
            space: len as u64,
        }
        .invoke_signed(&signers)?;
        Assign {
            account,
            owner: program,
        }
        .invoke_signed(&signers)?;
    }
    Ok(())
}
fn configure(program: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [
        payer,
        auth,
        mint,
        config,
        policy_account,
        list,
        schema,
        system,
    ] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    authority(program, auth, mint, config)?;
    if system.address() != &pinocchio_system::ID {
        return Err(GateError::Address.into());
    }
    let policy = Policy::decode(data)?;
    // Each mint chooses its own credential, schema version, regions and KYC
    // age limit. The same SAS evidence can therefore qualify for several funds.
    owner(schema, &SAS)?;
    state::decode_schema(&schema.try_borrow()?, schema.address())?
        .validate(schema.address(), &policy)?;
    let list_data = metas::bytes(program, mint.address(), &policy)?;
    for (account, seed, bytes) in [
        (policy_account, b"policy".as_slice(), data),
        (list, metas::SEED, list_data.as_slice()),
    ] {
        derived(account, &[seed, mint.address().as_ref()], program)?;
        if account.owner() == &pinocchio_system::ID {
            create(
                program,
                payer,
                account,
                &[seed, mint.address().as_ref()],
                bytes.len(),
            )?;
        }
        owner(account, program)?;
        let mut target = account.try_borrow_mut()?;
        if target.len() != bytes.len() {
            return Err(GateError::Malformed.into());
        }
        target.copy_from_slice(bytes);
    }
    Ok(())
}
fn status(
    program: &Address,
    accounts: &mut [AccountView],
    flags: Option<[u8; 2]>,
) -> ProgramResult {
    let [payer, auth, mint, config, subject, record, system] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if system.address() != &pinocchio_system::ID {
        return Err(GateError::Address.into());
    }
    let seeds = [
        b"status".as_slice(),
        mint.address().as_ref(),
        subject.address().as_ref(),
    ];
    derived(record, &seeds, program)?;
    if flags.is_some() {
        authority(program, auth, mint, config)?;
    }
    // Anyone may initialize a clear record, but only the fund operator may
    // change its flags. Reusing a record preserves holds across KYC renewal.
    // These flags deny a later thaw; setting them does not freeze an account.
    if record.owner() == &pinocchio_system::ID {
        create(program, payer, record, &seeds, state::STATUS_LEN)?;
        record.try_borrow_mut()?.copy_from_slice(&[2, 0, 0]);
    }
    owner(record, program)?;
    let record_address = *record.address();
    let mut data = record.try_borrow_mut()?;
    if data.len() != state::STATUS_LEN || data[0] != 2 || data[1] > 1 || data[2] > 1 {
        return Err(GateError::Malformed.into());
    }
    if let Some(flags) = flags {
        data[1..].copy_from_slice(&flags);
        solana_msg::msg!(
            "status {} blocked={} invalidated={}",
            record_address,
            flags[0],
            flags[1]
        );
    }
    Ok(())
}
fn read_status(
    program: &Address,
    mint: &Address,
    subject: &Address,
    record: &AccountView,
) -> Result<[u8; 2], ProgramError> {
    derived(
        record,
        &[b"status", mint.as_ref(), subject.as_ref()],
        program,
    )?;
    owner(record, program)?;
    let data = record.try_borrow()?;
    if data.len() != 3 || data[0] != 2 || data[1] > 1 || data[2] > 1 {
        return Err(GateError::Malformed.into());
    }
    Ok([data[1], data[2]])
}
fn immutable_token(data: &[u8], mint: &Address, subject: &Address) -> ProgramResult {
    if data.len() < 166 || data[165] != 2 || ![1, 2].contains(&data[108]) {
        return Err(GateError::ImmutableOwner.into());
    }
    if state::address(data, 0)? != *mint || state::address(data, 32)? != *subject {
        return Err(GateError::Subject.into());
    }
    let mut offset = 166;
    let mut found = false;
    while offset < data.len() {
        if data[offset..].iter().all(|v| *v == 0) {
            break;
        }
        let kind = u16::from_le_bytes(state::array(data, offset)?);
        let len = u16::from_le_bytes(state::array(data, offset + 2)?) as usize;
        offset = offset.checked_add(4 + len).ok_or(GateError::Malformed)?;
        if offset > data.len() {
            return Err(GateError::Malformed.into());
        }
        if kind == 7 {
            if len != 0 || found {
                return Err(GateError::Malformed.into());
            }
            found = true;
        }
    }
    if !found {
        return Err(GateError::ImmutableOwner.into());
    }
    Ok(())
}
// Token ACL calls this predicate during permissionless thaw and performs the
// Token-2022 thaw only after success. We read current evidence without copying
// it into gate state. Transfers between active accounts do not call this gate;
// expiry or SAS revocation requires an operator freeze to stop an active account.
fn can_thaw(program: &Address, accounts: &[AccountView]) -> ProgramResult {
    let [
        _caller,
        token,
        mint,
        subject,
        flag,
        list,
        policy_account,
        schema,
        sas,
        evidence,
        wallet_status,
        token_status,
    ] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    owner(token, &TOKEN)?;
    owner(mint, &TOKEN)?;
    // Token ACL supplies this flag for the thaw context. The gate makes an
    // admission decision; it neither transfers tokens nor implements freezing.
    derived(flag, &[b"FLAG_ACCOUNT", token.address().as_ref()], &ACL)?;
    owner(flag, &ACL)?;
    if flag.try_borrow()?.as_ref() != [1] {
        return Err(GateError::Context.into());
    }
    derived(
        policy_account,
        &[b"policy", mint.address().as_ref()],
        program,
    )?;
    owner(policy_account, program)?;
    let policy = Policy::decode(&policy_account.try_borrow()?)?;
    derived(list, &[metas::SEED, mint.address().as_ref()], program)?;
    owner(list, program)?;
    if list.try_borrow()?.as_ref() != metas::bytes(program, mint.address(), &policy)? {
        return Err(GateError::Malformed.into());
    }
    if sas.address() != &SAS {
        return Err(GateError::Address.into());
    }
    owner(schema, &SAS)?;
    let schema_data = schema.try_borrow()?;
    let decoded_schema = state::decode_schema(&schema_data, schema.address())?;
    // Decode evidence and authenticate its address before any policy decision.
    // SAS owns genuine attestations and closes them on revocation. Missing or
    // revoked evidence cannot pass this decoding step as a live SAS account.
    let evidence_data = evidence.try_borrow()?;
    let attestation = Attestation::decode(evidence.owner(), &evidence_data)?;
    derived(
        evidence,
        &[
            b"attestation",
            attestation.credential.as_ref(),
            attestation.schema.as_ref(),
            attestation.nonce.as_ref(),
        ],
        &SAS,
    )?;
    let wallet_flags = read_status(program, mint.address(), subject.address(), wallet_status)?;
    let token_flags = read_status(program, mint.address(), token.address(), token_status)?;
    // Both records must exist. A wallet hold applies across its accounts for
    // this mint; an account hold applies only to the supplied token account.
    if wallet_flags[0] != 0 || token_flags[0] != 0 {
        return Err(GateError::Blocked.into());
    }
    decoded_schema.validate(schema.address(), &policy)?;
    if attestation.schema != policy.schema {
        return Err(GateError::Schema.into());
    }
    immutable_token(&token.try_borrow()?, mint.address(), subject.address())?;
    // SAS has no subject field, so the issuer uses nonce as the investor wallet.
    // Bind evidence to the current token owner, not the caller, so relayers may
    // request admission. ImmutableOwner prevents moving admission to a new owner.
    // SAS token_account holds the tokenized credential; it does not scope admission.
    if attestation.nonce != *subject.address() {
        return Err(GateError::Subject.into());
    }
    let now = Clock::get()?.unix_timestamp;
    // Credential validity and KYC age are separate checks. A live attestation
    // can still contain KYC older than the fund permits.
    if !state::time_valid(attestation.expiry, now) {
        return Err(GateError::Expired.into());
    }
    // Freshness is evaluated before invalidation and issuer/claim decisions.
    let claim = state::Claim::decode(attestation.data)?;
    claim.validate_age(policy.max_age, now)?;
    if wallet_flags[1] != 0 || token_flags[1] != 0 {
        // Replacement evidence cannot clear an operator's invalidation flag.
        return Err(GateError::Invalidated.into());
    }
    // The policy trusts the credential authority's authorized issuers. SAS
    // enforces issuance rights; pinning the attestation signer here would break
    // signer rotation. Trust is scoped to the credential, not one issuer key.
    if attestation.credential != policy.credential {
        return Err(GateError::Issuer.into());
    }
    // Genuine, current KYC can still fail this fund's jurisdiction rule.
    // Return the first denial so the demo can name the check that failed.
    claim.validate_values(&policy)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_unknown_and_trailing_instruction_data() {
        let program = Address::default();
        for data in [
            vec![],
            vec![99],
            vec![1, 0],
            vec![2, 2, 0],
            [THAW.as_slice(), &[0]].concat(),
        ] {
            assert_eq!(
                process_instruction(&program, &mut [], &data),
                Err(ProgramError::InvalidInstructionData)
            );
        }
        assert_eq!(
            process_instruction(&program, &mut [], &THAW),
            Err(ProgramError::NotEnoughAccountKeys)
        );
    }
    #[test]
    fn immutable_owner_requires_valid_token_layout_and_current_owner() {
        let mint = Address::new_from_array([1; 32]);
        let subject = Address::new_from_array([2; 32]);
        let mut bytes = vec![0; 170];
        bytes[..32].copy_from_slice(mint.as_ref());
        bytes[32..64].copy_from_slice(subject.as_ref());
        bytes[108] = 2;
        bytes[165] = 2;
        bytes[166] = 7;
        assert_eq!(immutable_token(&bytes, &mint, &subject), Ok(()));
        assert_eq!(
            immutable_token(&bytes, &mint, &Address::default()),
            Err(GateError::Subject.into())
        );
        assert_eq!(
            immutable_token(&bytes[..165], &mint, &subject),
            Err(GateError::ImmutableOwner.into())
        );
        bytes[168] = 1;
        assert_eq!(
            immutable_token(&bytes, &mint, &subject),
            Err(GateError::Malformed.into())
        );
        bytes[168] = 0;
        bytes.extend_from_slice(&[7, 0, 0, 0]);
        assert_eq!(
            immutable_token(&bytes, &mint, &subject),
            Err(GateError::Malformed.into())
        );
    }
}
