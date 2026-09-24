//! Integration suite against an in-process surfnet.
//!
//! One test binary on purpose: each `tests/*.rs` is a separate crate that
//! links the whole surfpool graph, so splitting them multiplies link time.
//!
//! Every test needs `#[tokio::test(flavor = "multi_thread")]`. The blocking
//! `RpcClient` wraps every call in `tokio::task::block_in_place`, which tokio
//! allows only on the multi-threaded scheduler; a plain `#[tokio::test]` fails
//! with "can call blocking only when running on the multi-threaded runtime",
//! pointing at solana-rpc-client rather than at the attribute.
//!
//! Tests are `#[ignore]`d because they build the program with
//! `cargo build-sbf`; run them through `mise run integration`. They need no
//! network: SAS and Token ACL are deployed from pinned binaries.

mod support;

use solana_instruction::{Instruction, error::InstructionError};
use solana_transaction_error::TransactionError;
use support::{Harness, Outcome, ids, sas, sas_ix};
use surfpool_sdk::{Keypair, Pubkey, Signer};

/// Ledger time as SAS sees it (`Clock::unix_timestamp`), read from the surfnet.
/// Deriving expiries from this keeps successful-creation cases from going stale
/// on a fixed calendar date.
fn on_chain_unix(harness: &Harness) -> i64 {
    let clock = harness
        .rpc()
        .get_account(&Pubkey::from_str_const(
            "SysvarC1ock11111111111111111111111111111111",
        ))
        .expect("read clock sysvar");
    i64::from_le_bytes(
        clock.data[32..40]
            .try_into()
            .expect("clock unix_timestamp field"),
    )
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "builds the program with cargo build-sbf; run via `mise run integration`"]
async fn gate_and_pinned_programs_deploy_and_execute() {
    let harness = Harness::start().await;

    for id in [ids::GATE, ids::SAS.id, ids::TOKEN_ACL.id] {
        let account = harness
            .rpc()
            .get_account(&id)
            .unwrap_or_else(|error| panic!("{id} should be deployed: {error}"));
        assert!(account.executable, "{id} must be executable");
    }

    assert_eq!(
        ids::TOKEN_ACL.id,
        token_acl_interface::TOKEN_ACL_ID,
        "our pinned Token ACL address must match the client's, so a client bump \
         that repoints the program fails here rather than silently testing the \
         wrong program"
    );

    // The processor currently accepts any instruction, so an empty one is the
    // narrowest proof that real SBF bytecode executed in the runtime.
    let outcome: Outcome = harness.send(
        &[Instruction::new_with_bytes(ids::GATE, &[], vec![])],
        &[harness.payer()],
    );
    outcome.assert_success();
    assert!(
        outcome.reached(&ids::GATE),
        "logs should show the gate being invoked:\n{}",
        outcome.logs.join("\n")
    );
    assert!(
        outcome.compute_units_for(&ids::GATE).is_some(),
        "per-program compute units should be parseable from the logs, which is \
         what makes docs/IMPLEMENTATION.md §9.3 measurable:\n{}",
        outcome.logs.join("\n")
    );
}

/// The pinned Token ACL binary really runs, not just resolves as an account.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "builds the program with cargo build-sbf; run via `mise run integration`"]
async fn pinned_token_acl_executes() {
    let harness = Harness::start().await;

    // Deliberately malformed: Token ACL should reject it itself, which only
    // happens if its bytecode actually executed.
    let outcome = harness.send(
        &[Instruction::new_with_bytes(
            ids::TOKEN_ACL.id,
            &[9, 9, 9],
            vec![],
        )],
        &[harness.payer()],
    );
    assert!(outcome.error.is_some(), "malformed instruction should fail");
    assert!(
        outcome.reached(&ids::TOKEN_ACL.id),
        "Token ACL should appear in the logs as invoked:\n{}",
        outcome.logs.join("\n")
    );
}

/// The SAS spike: issue a real attestation against the pinned SAS binary,
/// confirm our decoder reads what SAS actually wrote, and walk the lifecycle —
/// pre-expired rejection, revocation by closure, and close-and-recreate
/// renewal. Instructions are hand-built (`support::sas_ix`) because the SAS
/// client crate targets the old solana stack (see `docs/SAS_SPIKE.md` §6).
#[tokio::test(flavor = "multi_thread")]
#[ignore = "builds the program with cargo build-sbf; run via `mise run integration`"]
async fn sas_issue_decode_and_lifecycle() {
    let harness = Harness::start().await;
    let payer = harness.payer().pubkey();

    // The issuer is the credential authority and its own authorized signer; the
    // subject is the investor wallet the credential binds to (nonce = subject).
    let authority = Keypair::new();
    let subject = Keypair::new().pubkey();
    let credential = sas_ix::credential_pda(&authority.pubkey(), "doors-of-durin-spike");
    let schema = sas_ix::schema_pda(&credential, "jurisdiction");
    let attestation = sas_ix::attestation_pda(&credential, &schema, &subject);

    // Credential + schema in one transaction.
    harness
        .send(
            &[
                sas_ix::create_credential(
                    &payer,
                    &credential,
                    &authority.pubkey(),
                    "doors-of-durin-spike",
                    &[authority.pubkey()],
                ),
                sas_ix::create_schema(
                    &payer,
                    &authority.pubkey(),
                    &credential,
                    &schema,
                    "jurisdiction",
                    "investor jurisdiction claim",
                    &[12],
                    &["jurisdiction"],
                ),
            ],
            &[harness.payer(), &authority],
        )
        .assert_success();

    // Attestation: jurisdiction = "DE", bound to the subject, valid.
    let claim = sas_ix::string_claim("DE");
    let now = on_chain_unix(&harness);
    let expiry = now + 30 * 24 * 60 * 60; // 30 days past ledger time
    harness
        .send(
            &[sas_ix::create_attestation(
                &payer,
                &authority.pubkey(),
                &credential,
                &schema,
                &attestation,
                &subject,
                &claim,
                expiry,
            )],
            &[harness.payer(), &authority],
        )
        .assert_success();

    // Our decoder reads exactly what SAS wrote.
    let account = harness
        .rpc()
        .get_account(&attestation)
        .expect("attestation deployed");
    let decoded = sas::authenticate_and_decode(&account.owner, &account.data)
        .expect("our decoder accepts a genuine attestation");
    assert_eq!(decoded.nonce, subject, "nonce binds to the subject wallet");
    assert_ne!(
        decoded.nonce,
        Pubkey::new_unique(),
        "nonce is not an unrelated wallet",
    );
    assert_eq!(decoded.credential, credential);
    assert_eq!(decoded.schema, schema);
    assert_eq!(
        decoded.signer,
        authority.pubkey(),
        "signer is the credential-authorized signer, not the subject",
    );
    assert_eq!(decoded.expiry, expiry, "expiry round-trips");
    assert_eq!(decoded.data, claim, "claim bytes round-trip");
    assert_eq!(
        decoded.token_account,
        Pubkey::default(),
        "non-tokenized => zeros",
    );
    assert_eq!(
        account.data.len(),
        173 + claim.len(),
        "attestation account is 173 + data_len bytes",
    );
    assert!(
        sas::is_time_valid(decoded.expiry, now),
        "our read-time rule accepts an unexpired attestation",
    );

    // Pre-expired: a past non-zero expiry is refused at creation. A negative
    // expiry is below any on-chain time, so this is deterministic.
    let pre_expired_nonce = Keypair::new().pubkey();
    let pre_expired = sas_ix::attestation_pda(&credential, &schema, &pre_expired_nonce);
    let rejected = harness.send(
        &[sas_ix::create_attestation(
            &payer,
            &authority.pubkey(),
            &credential,
            &schema,
            &pre_expired,
            &pre_expired_nonce,
            &claim,
            -100,
        )],
        &[harness.payer(), &authority],
    );
    assert_eq!(
        rejected.error,
        Some(TransactionError::InstructionError(
            0,
            InstructionError::Custom(6),
        )),
        "SAS must reject a pre-expired attestation with InvalidAttestationData \
         (Custom 6), not some unrelated failure:\n{}",
        rejected.logs.join("\n"),
    );
    assert!(
        rejected.reached(&ids::SAS.id),
        "the rejection must be SAS's own decision (it was invoked):\n{}",
        rejected.logs.join("\n"),
    );

    // Revocation by closure: after close, the account is gone (or emptied and
    // system-owned) and our decoder rejects the residual.
    harness
        .send(
            &[sas_ix::close_attestation(
                &payer,
                &authority.pubkey(),
                &credential,
                &attestation,
            )],
            &[harness.payer(), &authority],
        )
        .assert_success();
    match harness.rpc().get_account(&attestation) {
        Err(_) => {} // purged entirely: absence is the revocation
        Ok(closed) => assert!(
            sas::authenticate_and_decode(&closed.owner, &closed.data).is_err(),
            "a closed attestation must not decode",
        ),
    }

    // Renewal = close-and-recreate at the SAME PDA (the subject fixes the
    // nonce, §3/§7): recreate with fresh evidence and decode the replacement.
    let renewed_expiry = now + 60 * 24 * 60 * 60; // 60 days past ledger time
    harness
        .send(
            &[sas_ix::create_attestation(
                &payer,
                &authority.pubkey(),
                &credential,
                &schema,
                &attestation,
                &subject,
                &claim,
                renewed_expiry,
            )],
            &[harness.payer(), &authority],
        )
        .assert_success();
    let renewed = harness
        .rpc()
        .get_account(&attestation)
        .expect("renewed attestation deployed");
    let renewed_decoded = sas::authenticate_and_decode(&renewed.owner, &renewed.data)
        .expect("our decoder accepts the recreated attestation");
    assert_eq!(
        renewed_decoded.nonce, subject,
        "renewal keeps the same subject",
    );
    assert_eq!(
        renewed_decoded.expiry, renewed_expiry,
        "renewal carries a fresh expiry",
    );
}
