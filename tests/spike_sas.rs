//! SAS issuance + decode probe (spike).
//!
//! Ignored like `e2e.rs`: it needs the pinned SBF toolchain and a fresh
//! `solana-test-validator` loaded with the SAS binary. It runs the full
//! `CreateCredential -> CreateSchema -> CreateAttestation` flow through the
//! first-party client builders, then decodes the resulting account **two
//! ways** — our hand-rolled `authenticate_and_decode` and the client's
//! `Attestation::from_bytes` — and asserts they agree with what was issued.
//! The printed account length is a first size/CU datapoint (see §5).

mod support;

use borsh::BorshSerialize;
use solana_attestation_service_client::{
    accounts::Attestation,
    instructions::{
        CloseAttestationBuilder, CreateAttestationBuilder, CreateCredentialBuilder,
        CreateSchemaBuilder,
    },
    programs::SOLANA_ATTESTATION_SERVICE_ID,
};
use solana_rpc_client::rpc_client::RpcClient;
use solana_sdk::{
    commitment_config::CommitmentConfig,
    instruction::InstructionError,
    native_token::LAMPORTS_PER_SOL,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    transaction::{Transaction, TransactionError},
};
use std::{
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use support::{LocalValidator, SAS_PROGRAM_ID};

/// One `String` field per `docs/SAS_SPIKE.md` §5 (SchemaDataTypes `String = 12`).
const SCHEMA_STRING_TYPE: u8 = 12;

/// System program ID (spelled out to avoid the deprecated `solana_sdk::system_program`).
const SYSTEM_PROGRAM_ID: Pubkey = solana_sdk::pubkey!("11111111111111111111111111111111");

/// The claim carried in the attestation `data`. Borsh-serialising this struct
/// yields the schema-encoded bytes: a `u32` length prefix plus the UTF-8.
#[derive(BorshSerialize)]
struct JurisdictionClaim {
    jurisdiction: String,
}

/// On-chain Unix time as SAS itself sees it (`Clock::unix_timestamp`), read from
/// the validator via the current block's production time. Used for the expiry
/// assertions so they hinge on ledger time, not the host wall clock.
fn on_chain_unix(rpc: &RpcClient) -> i64 {
    let slot = rpc.get_slot().expect("fetch current slot");
    rpc.get_block_time(slot).expect("fetch on-chain block time")
}

#[test]
#[ignore = "requires Solana CLI tools; downloads SAS unless SAS_PROGRAM_SO is set"]
fn issue_and_decode_jurisdiction_attestation() {
    // Our hardcoded program ID must match the client crate's, or the owner
    // check and the PDA derivations would be about different programs.
    assert_eq!(
        SAS_PROGRAM_ID, SOLANA_ATTESTATION_SERVICE_ID,
        "support SAS_PROGRAM_ID must equal the client crate's program ID",
    );

    let validator = LocalValidator::start();
    let rpc = &validator.rpc;

    // The credential authority co-signs issuance and becomes the attestation
    // `signer`. Fund the payer for the three account creations.
    let authority = Keypair::new();
    let airdrop = rpc
        .request_airdrop(&validator.payer.pubkey(), LAMPORTS_PER_SOL)
        .expect("request local airdrop");
    validator.confirm(&airdrop);

    // --- Credential -> Schema (one transaction, like the SAS worked example) ---
    let credential_name = "doors-of-durin-spike";
    let credential_pda = Pubkey::find_program_address(
        &[
            b"credential",
            authority.pubkey().as_ref(),
            credential_name.as_bytes(),
        ],
        &SAS_PROGRAM_ID,
    )
    .0;
    let create_credential_ix = CreateCredentialBuilder::new()
        .payer(validator.payer.pubkey())
        .credential(credential_pda)
        .authority(authority.pubkey())
        .system_program(SYSTEM_PROGRAM_ID)
        .name(credential_name.to_string())
        .signers(vec![authority.pubkey()])
        .instruction();

    let schema_name = "jurisdiction";
    let schema_pda = Pubkey::find_program_address(
        &[
            b"schema",
            credential_pda.as_ref(),
            schema_name.as_bytes(),
            &[1u8],
        ],
        &SAS_PROGRAM_ID,
    )
    .0;
    let create_schema_ix = CreateSchemaBuilder::new()
        .payer(validator.payer.pubkey())
        .authority(authority.pubkey())
        .credential(credential_pda)
        .schema(schema_pda)
        .system_program(SYSTEM_PROGRAM_ID)
        .name(schema_name.to_string())
        .description("investor jurisdiction claim".to_string())
        .layout(vec![SCHEMA_STRING_TYPE])
        .field_names(vec!["jurisdiction".to_string()])
        .instruction();

    let setup_tx = Transaction::new_signed_with_payer(
        &[create_credential_ix, create_schema_ix],
        Some(&validator.payer.pubkey()),
        &[&validator.payer, &authority],
        rpc.get_latest_blockhash().expect("fetch recent blockhash"),
    );
    validator.confirm(
        &rpc.send_transaction(&setup_tx)
            .expect("create credential+schema"),
    );

    // --- Attestation ---
    // `nonce` is the subject binding (SAS has no subject field, §7); use a
    // chosen wallet. Expiry is a valid future time — SAS rejects a pre-expired
    // attestation at creation (§6), so we cannot mint one already expired here.
    let subject_wallet = Keypair::new().pubkey();
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before UNIX epoch")
        .as_secs() as i64;
    let expiry = now + 86_400; // one day ahead — comfortably valid at read time

    let claim = JurisdictionClaim {
        jurisdiction: "DE".to_string(),
    };
    let claim_data = borsh::to_vec(&claim).expect("serialize jurisdiction claim");

    let attestation_pda = Pubkey::find_program_address(
        &[
            b"attestation",
            credential_pda.as_ref(),
            schema_pda.as_ref(),
            subject_wallet.as_ref(),
        ],
        &SAS_PROGRAM_ID,
    )
    .0;
    let create_attestation_ix = CreateAttestationBuilder::new()
        .payer(validator.payer.pubkey())
        .authority(authority.pubkey())
        .credential(credential_pda)
        .schema(schema_pda)
        .attestation(attestation_pda)
        .system_program(SYSTEM_PROGRAM_ID)
        .nonce(subject_wallet)
        .data(claim_data.clone())
        .expiry(expiry)
        .instruction();

    let attest_tx = Transaction::new_signed_with_payer(
        &[create_attestation_ix],
        Some(&validator.payer.pubkey()),
        &[&validator.payer, &authority],
        rpc.get_latest_blockhash().expect("fetch recent blockhash"),
    );
    validator.confirm(
        &rpc.send_transaction(&attest_tx)
            .expect("create attestation"),
    );

    // --- Fetch + decode both ways ---
    let account = rpc
        .get_account(&attestation_pda)
        .expect("fetch attestation account");
    assert_eq!(
        account.owner, SAS_PROGRAM_ID,
        "attestation must be SAS-owned"
    );

    let ours = support::sas::authenticate_and_decode(&account.owner, &account.data)
        .expect("our decoder must accept the freshly issued attestation");
    let theirs = Attestation::from_bytes(&account.data).expect("client decoder must accept it");

    // The two decoders agree on every field.
    assert_eq!(ours.nonce, theirs.nonce, "nonce");
    assert_eq!(ours.credential, theirs.credential, "credential");
    assert_eq!(ours.schema, theirs.schema, "schema");
    assert_eq!(ours.data, theirs.data, "data");
    assert_eq!(ours.signer, theirs.signer, "signer");
    assert_eq!(ours.expiry, theirs.expiry, "expiry");
    assert_eq!(ours.token_account, theirs.token_account, "token_account");

    // And they agree with what we issued.
    assert_eq!(ours.nonce, subject_wallet, "nonce == subject wallet");
    assert_eq!(ours.credential, credential_pda);
    assert_eq!(ours.schema, schema_pda);
    assert_eq!(
        ours.signer,
        authority.pubkey(),
        "signer == credential authority"
    );
    assert_eq!(ours.expiry, expiry, "expiry round-trips");
    assert_eq!(ours.data, claim_data, "data round-trips");
    assert_eq!(
        ours.token_account,
        Pubkey::default(),
        "non-tokenized => zeros"
    );

    // Sanity: our own read-time validity rule accepts a future expiry.
    assert!(
        support::sas::is_time_valid(ours.expiry, now),
        "attestation with future expiry must be time-valid now",
    );

    // First size datapoint (§5). Total = 173 + data_len.
    println!(
        "SAS attestation account: {} bytes ({} bytes claim data)",
        account.data.len(),
        ours.data.len(),
    );

    // ===================================================================
    // Lifecycle assertions (spike extensions). These reuse the credential,
    // schema, authority, and subject wallet issued above.
    // ===================================================================

    // --- 3. Negative subject binding (§7) ---------------------------------
    // The locked rule is `attestation.nonce == token-account owner`. Pure
    // host-level check on the decoded struct — no transactions.
    assert_eq!(
        ours.nonce, subject_wallet,
        "nonce must bind to the chosen investor wallet (accept)",
    );
    assert_ne!(
        ours.nonce,
        Pubkey::new_unique(),
        "nonce must not match an unrelated wallet (reject)",
    );

    // --- 2a. Deterministic pre-expired rejection (§6) ---------------------
    // SAS refuses `expiry < now` at creation, so a pre-expired attestation
    // can never be minted. Confirm the exact program error rather than any
    // failure. Uses on-chain time and a fresh nonce.
    let pre_expired_nonce = Keypair::new().pubkey();
    let pre_expired_expiry = on_chain_unix(rpc) - 100;
    let pre_expired_pda = Pubkey::find_program_address(
        &[
            b"attestation",
            credential_pda.as_ref(),
            schema_pda.as_ref(),
            pre_expired_nonce.as_ref(),
        ],
        &SAS_PROGRAM_ID,
    )
    .0;
    let pre_expired_ix = CreateAttestationBuilder::new()
        .payer(validator.payer.pubkey())
        .authority(authority.pubkey())
        .credential(credential_pda)
        .schema(schema_pda)
        .attestation(pre_expired_pda)
        .system_program(SYSTEM_PROGRAM_ID)
        .nonce(pre_expired_nonce)
        .data(claim_data.clone())
        .expiry(pre_expired_expiry)
        .instruction();
    let pre_expired_tx = Transaction::new_signed_with_payer(
        &[pre_expired_ix],
        Some(&validator.payer.pubkey()),
        &[&validator.payer, &authority],
        rpc.get_latest_blockhash().expect("fetch recent blockhash"),
    );
    let send_err = rpc
        .send_transaction(&pre_expired_tx)
        .expect_err("SAS must reject a pre-expired attestation at creation");
    let tx_err = send_err
        .get_transaction_error()
        .expect("rejection must carry a transaction error");
    // Custom(6) = AttestationServiceError::InvalidAttestationData (expiry < now).
    assert_eq!(
        tx_err,
        TransactionError::InstructionError(0, InstructionError::Custom(6)),
        "expected InvalidAttestationData (Custom 6) for a pre-expired attestation",
    );

    // --- 2b. Expiry enforcement is ours (§3) ------------------------------
    // Mint a short-lived attestation, confirm our rule accepts it now, then
    // wait (bounded) for on-chain time to cross expiry and confirm our rule
    // then rejects it. SAS never re-checks expiry, so only our check flips.
    let expiring_nonce = Keypair::new().pubkey();
    let expiring_expiry = on_chain_unix(rpc) + 2; // a couple of seconds ahead
    let expiring_pda = Pubkey::find_program_address(
        &[
            b"attestation",
            credential_pda.as_ref(),
            schema_pda.as_ref(),
            expiring_nonce.as_ref(),
        ],
        &SAS_PROGRAM_ID,
    )
    .0;
    let expiring_ix = CreateAttestationBuilder::new()
        .payer(validator.payer.pubkey())
        .authority(authority.pubkey())
        .credential(credential_pda)
        .schema(schema_pda)
        .attestation(expiring_pda)
        .system_program(SYSTEM_PROGRAM_ID)
        .nonce(expiring_nonce)
        .data(claim_data.clone())
        .expiry(expiring_expiry)
        .instruction();
    let expiring_tx = Transaction::new_signed_with_payer(
        &[expiring_ix],
        Some(&validator.payer.pubkey()),
        &[&validator.payer, &authority],
        rpc.get_latest_blockhash().expect("fetch recent blockhash"),
    );
    validator.confirm(
        &rpc.send_transaction(&expiring_tx)
            .expect("mint short-lived attestation"),
    );
    assert!(
        support::sas::is_time_valid(expiring_expiry, on_chain_unix(rpc)),
        "short-lived attestation must be time-valid immediately after minting",
    );
    // Bounded poll: wait until ledger time reaches expiry, capped at 10s so a
    // stalled validator can never hang the probe.
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut now_on_chain = on_chain_unix(rpc);
    while now_on_chain < expiring_expiry {
        assert!(
            Instant::now() < deadline,
            "on-chain time did not reach expiry within the 10s bound",
        );
        thread::sleep(Duration::from_millis(250));
        now_on_chain = on_chain_unix(rpc);
    }
    assert!(
        !support::sas::is_time_valid(expiring_expiry, now_on_chain),
        "our rule must reject the attestation once on-chain time reaches expiry",
    );

    // --- 1. Revocation by closure (§3) ------------------------------------
    // Close the original attestation; SAS drains it and reassigns it to the
    // System Program. Absence (or an emptied, system-owned account) is the
    // revocation signal, and our decoder must reject it.
    let close_ix = CloseAttestationBuilder::new()
        .payer(validator.payer.pubkey())
        .authority(authority.pubkey())
        .credential(credential_pda)
        .attestation(attestation_pda)
        .instruction();
    let close_tx = Transaction::new_signed_with_payer(
        &[close_ix],
        Some(&validator.payer.pubkey()),
        &[&validator.payer, &authority],
        rpc.get_latest_blockhash().expect("fetch recent blockhash"),
    );
    validator.confirm(&rpc.send_transaction(&close_tx).expect("close attestation"));

    let closed = rpc
        .get_account_with_commitment(&attestation_pda, CommitmentConfig::confirmed())
        .expect("query closed attestation")
        .value;
    let residual: &[u8] = match &closed {
        Some(acct) => {
            assert_eq!(
                acct.owner, SYSTEM_PROGRAM_ID,
                "revoked attestation must be reassigned to the System Program",
            );
            assert!(
                acct.data.is_empty(),
                "revoked attestation data must be truncated"
            );
            &acct.data
        }
        // Purged entirely (0 lamports): absence itself is the revocation.
        None => &[],
    };
    assert!(
        support::sas::authenticate_and_decode(&SAS_PROGRAM_ID, residual).is_err(),
        "our decoder must reject a revoked (closed) attestation",
    );

    // --- Renewal: close-and-recreate at the SAME PDA (docs/SAS_SPIKE.md §3, §7) --
    // Because the subject fixes the nonce, renewal reuses the same address: recreate
    // the just-closed attestation with fresh evidence and confirm it decodes again.
    // This covers the locked close-and-recreate renewal path, not only revocation.
    let renewed_expiry = on_chain_unix(rpc) + 86_400;
    let renew_ix = CreateAttestationBuilder::new()
        .payer(validator.payer.pubkey())
        .authority(authority.pubkey())
        .credential(credential_pda)
        .schema(schema_pda)
        .attestation(attestation_pda) // same PDA as the attestation just closed
        .system_program(SYSTEM_PROGRAM_ID)
        .nonce(subject_wallet) // same nonce = same subject
        .data(claim_data.clone())
        .expiry(renewed_expiry)
        .instruction();
    let renew_tx = Transaction::new_signed_with_payer(
        &[renew_ix],
        Some(&validator.payer.pubkey()),
        &[&validator.payer, &authority],
        rpc.get_latest_blockhash().expect("fetch recent blockhash"),
    );
    validator.confirm(
        &rpc.send_transaction(&renew_tx)
            .expect("recreate attestation at the same PDA"),
    );

    let renewed = rpc
        .get_account(&attestation_pda)
        .expect("fetch renewed attestation");
    let renewed_decoded = support::sas::authenticate_and_decode(&renewed.owner, &renewed.data)
        .expect("our decoder must accept the recreated attestation");
    assert_eq!(
        renewed_decoded.nonce, subject_wallet,
        "renewed attestation keeps the same subject",
    );
    assert_eq!(
        renewed_decoded.expiry, renewed_expiry,
        "renewed attestation carries a fresh expiry",
    );
    assert!(
        support::sas::is_time_valid(renewed_decoded.expiry, on_chain_unix(rpc)),
        "renewed attestation is valid again",
    );

    println!(
        "lifecycle: pre-expired mint rejected (Custom 6); short-lived attestation \
         invalidated at on-chain expiry; attestation revoked by closure; \
         renewed by close-and-recreate at the same PDA",
    );
}
