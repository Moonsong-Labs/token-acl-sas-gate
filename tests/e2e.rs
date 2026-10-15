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

    // Unknown instructions must fail closed while proving the SBF entrypoint ran.
    let outcome: Outcome = harness.send(
        &[Instruction::new_with_bytes(ids::GATE, &[], vec![])],
        &[harness.payer()],
    );
    assert_eq!(
        outcome.error,
        Some(TransactionError::InstructionError(
            0,
            InstructionError::InvalidInstructionData
        ))
    );
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

    // Aster Identity delegates issuance to Aster Verification Desk.
    // Alice Adler is the investor bound through the attestation nonce.
    let authority = Keypair::new();
    let issuer = Keypair::new();
    let subject = Keypair::new().pubkey();
    let credential = sas_ix::credential_pda(&authority.pubkey(), "Aster Identity");
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
                    "Aster Identity",
                    &[issuer.pubkey()],
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
                &issuer.pubkey(),
                &credential,
                &schema,
                &attestation,
                &subject,
                &claim,
                expiry,
            )],
            &[harness.payer(), &issuer],
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
        issuer.pubkey(),
        "signer is the credential-authorized signer, not the subject",
    );
    assert_eq!(decoded.expiry, expiry, "expiry round-trips");
    assert_eq!(decoded.data, claim, "claim bytes round-trip");
    let schema_account = harness.rpc().get_account(&schema).expect("schema deployed");
    let jurisdiction = sas::decode_single_string_claim(
        &schema_account.owner,
        &schema_account.data,
        &credential,
        "jurisdiction",
        &decoded.data,
    )
    .expect("schema decodes the attestation's jurisdiction claim");
    assert_eq!(jurisdiction, "DE");
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
            &issuer.pubkey(),
            &credential,
            &schema,
            &pre_expired,
            &pre_expired_nonce,
            &claim,
            -100,
        )],
        &[harness.payer(), &issuer],
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
                &issuer.pubkey(),
                &credential,
                &attestation,
            )],
            &[harness.payer(), &issuer],
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
                &issuer.pubkey(),
                &credential,
                &schema,
                &attestation,
                &subject,
                &claim,
                renewed_expiry,
            )],
            &[harness.payer(), &issuer],
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

fn gate_denied(outcome: &Outcome, error: token_acl_sas_gate::GateError) {
    assert!(outcome.reached(&ids::GATE), "gate not reached: {outcome:?}");
    assert_eq!(
        outcome.error,
        Some(TransactionError::InstructionError(
            0,
            InstructionError::Custom(error as u32)
        )),
        "{outcome:?}"
    );
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "builds the program with cargo build-sbf; run via `mise run integration`"]
async fn admission_and_policy_governance() {
    use support::admission::{Admission, list_pda, policy_pda, status_pda};
    use token_acl_sas_gate::GateError;
    let f = Admission::start().await;
    let payer = f.harness.payer().pubkey();
    assert_eq!(f.token_state(), 2, "default state must be frozen");
    let outcome = f.send_thaw();
    outcome.assert_success();
    assert!(outcome.reached(&ids::GATE));
    println!(
        "Admission gate CU: {:?}; ACL total CU: {:?}; instruction bytes: {}; metas bytes: {}",
        outcome.compute_units_for(&ids::GATE),
        outcome.compute_units_for(&ids::TOKEN_ACL.id),
        f.thaw(payer).data.len(),
        f.harness
            .rpc()
            .get_account(&list_pda(&f.mint))
            .unwrap()
            .data
            .len()
    );
    assert_eq!(f.token_state(), 1);
    f.freeze();
    f.harness
        .send(
            &[f.thaw(f.investor.pubkey())],
            &[f.harness.payer(), &f.investor],
        )
        .assert_success();
    f.freeze();

    let mut denied_policy = f.policy.clone();
    denied_policy.jurisdictions = vec![*b"US"];
    let before_policy = f
        .harness
        .rpc()
        .get_account(&policy_pda(&f.mint))
        .unwrap()
        .data;
    let before_list = f
        .harness
        .rpc()
        .get_account(&list_pda(&f.mint))
        .unwrap()
        .data;
    let unauthorized = f.harness.send(
        &[f.configure(&f.investor.pubkey(), &denied_policy)],
        &[f.harness.payer(), &f.investor],
    );
    gate_denied(&unauthorized, GateError::Unauthorized);
    assert_eq!(
        f.harness
            .rpc()
            .get_account(&policy_pda(&f.mint))
            .unwrap()
            .data,
        before_policy
    );
    assert_eq!(
        f.harness
            .rpc()
            .get_account(&list_pda(&f.mint))
            .unwrap()
            .data,
        before_list
    );
    f.harness
        .send(&[f.configure(&payer, &denied_policy)], &[f.harness.payer()])
        .assert_success();
    gate_denied(&f.send_thaw(), GateError::Claim);
    f.harness
        .send(&[f.configure(&payer, &f.policy)], &[f.harness.payer()])
        .assert_success();

    for subject in [f.investor.pubkey(), f.token] {
        gate_denied(
            &f.harness.send(
                &[f.status(&subject, Some([1, 0]), &f.investor.pubkey())],
                &[f.harness.payer(), &f.investor],
            ),
            GateError::Unauthorized,
        );
        f.harness
            .send(
                &[f.status(&subject, Some([1, 0]), &payer)],
                &[f.harness.payer()],
            )
            .assert_success();
        gate_denied(&f.send_thaw(), GateError::Blocked);
        // Permissionless initialization cannot clear an existing block.
        f.harness
            .send(&[f.status(&subject, None, &payer)], &[f.harness.payer()])
            .assert_success();
        assert_eq!(
            f.harness
                .rpc()
                .get_account(&status_pda(&f.mint, &subject))
                .unwrap()
                .data,
            vec![2, 1, 0]
        );
        gate_denied(&f.send_thaw(), GateError::Blocked);
        f.harness
            .send(
                &[f.status(&subject, Some([0, 1]), &payer)],
                &[f.harness.payer()],
            )
            .assert_success();
        gate_denied(&f.send_thaw(), GateError::Invalidated);
        f.harness
            .send(
                &[f.status(&subject, Some([0, 0]), &payer)],
                &[f.harness.payer()],
            )
            .assert_success();
    }
    f.send_thaw().assert_success();
    f.freeze();
    f.revoke();
    let outcome = f.send_thaw();
    assert!(outcome.error.is_some(), "closed SAS evidence must deny");
    assert_eq!(f.token_state(), 2);
    // Reissuance does not make the underlying verification fresh.
    f.issue("DE", f.now - 90000, f.now + 172800);
    gate_denied(&f.send_thaw(), GateError::Freshness);
    f.revoke();
    f.issue("DE", f.now - 1, 0);
    f.send_thaw().assert_success();
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "builds the program with cargo build-sbf; run via `mise run integration`"]
async fn fail_closed_account_matrix() {
    use support::admission::{Admission, SYSTEM, list_pda, policy_pda, status_pda};
    use token_acl_sas_gate::GateError;
    let mut f = Admission::start().await;
    let payer = f.harness.payer().pubkey();
    let evidence = f.harness.rpc().get_account(&f.evidence).unwrap();
    let expiry_offset = evidence.data.len() - 40;
    let mut cases = Vec::new();
    let mut bytes = evidence.data.clone();
    bytes[0] = 1;
    cases.push(("discriminator", ids::SAS.id, bytes, GateError::Malformed));
    cases.push((
        "forged owner",
        SYSTEM,
        evidence.data.clone(),
        GateError::Owner,
    ));
    cases.push(("truncated", ids::SAS.id, vec![2; 172], GateError::Malformed));
    let mut bytes = evidence.data.clone();
    bytes[97..101].copy_from_slice(&u32::MAX.to_le_bytes());
    cases.push(("length overflow", ids::SAS.id, bytes, GateError::Malformed));
    let mut bytes = evidence.data.clone();
    bytes[1] ^= 1;
    cases.push((
        "subject substitution",
        ids::SAS.id,
        bytes,
        GateError::Address,
    ));
    let mut bytes = evidence.data.clone();
    bytes[33] ^= 1;
    cases.push((
        "issuer substitution",
        ids::SAS.id,
        bytes,
        GateError::Address,
    ));
    let mut bytes = evidence.data.clone();
    bytes[65] ^= 1;
    cases.push((
        "schema substitution",
        ids::SAS.id,
        bytes,
        GateError::Address,
    ));
    let mut bytes = evidence.data.clone();
    bytes[expiry_offset..expiry_offset + 8].copy_from_slice(&(-1i64).to_le_bytes());
    cases.push(("expired", ids::SAS.id, bytes, GateError::Expired));
    let mut bytes = evidence.data.clone();
    bytes[105..107].copy_from_slice(b"US");
    cases.push(("claim denial", ids::SAS.id, bytes, GateError::Claim));
    let mut bytes = evidence.data.clone();
    bytes[107..115].copy_from_slice(&(f.now + 86400).to_le_bytes());
    cases.push((
        "future verification",
        ids::SAS.id,
        bytes,
        GateError::Freshness,
    ));
    for (name, owner, bytes, error) in cases {
        f.replace(f.evidence, owner, bytes);
        let outcome = f.send_thaw();
        println!("credential admission {name}: {:?}", outcome.error);
        gate_denied(&outcome, error);
        assert_eq!(f.token_state(), 2);
    }
    f.replace(f.evidence, evidence.owner, evidence.data);
    // Account resolution must never interpret omitted evidence or policy as permission.
    let valid = f.thaw(payer);
    for index in 9..valid.accounts.len() {
        let mut instruction = valid.clone();
        instruction.accounts.remove(index);
        let outcome = f.harness.send(&[instruction], &[f.harness.payer()]);
        assert!(
            outcome.error.is_some(),
            "omitting account {index} admitted: {outcome:?}"
        );
        println!(
            "credential admission omitted account {index}: gate reached {}",
            outcome.reached(&ids::GATE)
        );
        assert_eq!(f.token_state(), 2);
    }
    for key in [
        policy_pda(&f.mint),
        list_pda(&f.mint),
        status_pda(&f.mint, &f.investor.pubkey()),
        status_pda(&f.mint, &f.token),
    ] {
        let original = f.harness.rpc().get_account(&key).unwrap();
        f.replace(key, SYSTEM, vec![]);
        assert!(f.send_thaw().error.is_some());
        assert_eq!(f.token_state(), 2);
        f.replace(key, original.owner, original.data);
        let mut instruction = valid.clone();
        instruction
            .accounts
            .iter_mut()
            .find(|a| a.pubkey == key)
            .unwrap()
            .pubkey = Pubkey::new_unique();
        assert!(
            f.harness
                .send(&[instruction], &[f.harness.payer()])
                .error
                .is_some()
        );
    }
    let mut wrong_version = f.policy.clone();
    wrong_version.schema_version = 2;
    gate_denied(
        &f.harness
            .send(&[f.configure(&payer, &wrong_version)], &[f.harness.payer()]),
        GateError::Schema,
    );
    // A separately created account without ImmutableOwner is not admissible.
    f.token = f.new_token(false);
    f.harness
        .send(&[f.status(&f.token, None, &payer)], &[f.harness.payer()])
        .assert_success();
    gate_denied(&f.send_thaw(), GateError::ImmutableOwner);
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "builds the program with cargo build-sbf; run via `mise run integration`"]
async fn clock_boundaries_and_discovery() {
    use solana_rpc_client_types::request::RpcRequest;
    use solana_transaction::Transaction;
    use support::admission::{Admission, list_pda};
    use token_acl_sas_gate::GateError;
    let f = Admission::start().await;
    let payer = f.harness.payer().pubkey();
    // Resolve the standard metas via the actual SDK, not our fixture's fixed list.
    let mut resolved = f.thaw(payer);
    resolved.accounts.truncate(9);
    token_acl_interface::offchain::add_extra_account_metas_for_thaw(
        &mut resolved,
        &ids::GATE,
        &payer,
        &f.token,
        &f.mint,
        &f.investor.pubkey(),
        &token_acl_client::accounts::FlagAccount::find_pda(&f.token).0,
        |key| {
            let data = f
                .harness
                .rpc()
                .get_account(&key)
                .ok()
                .map(|account| account.data);
            async move { Ok(data) }
        },
    )
    .await
    .unwrap();
    assert_eq!(resolved.accounts, f.thaw(payer).accounts);
    f.harness
        .send(&[resolved], &[f.harness.payer()])
        .assert_success();
    f.freeze();
    let _: serde_json::Value = f
        .harness
        .rpc()
        .send(
            RpcRequest::Custom {
                method: "surfnet_pauseClock",
            },
            serde_json::json!([]),
        )
        .unwrap();
    let now = on_chain_unix(&f.harness);
    let original = f.harness.rpc().get_account(&f.evidence).unwrap();
    let expiry_offset = original.data.len() - 40;
    // Simulation executes the real SBF while the ledger clock is held constant.
    // It avoids duplicate signed transactions when the paused blockhash is fixed.
    for (expiry, verified_at, expected) in [
        (now + 1, now - 1, None),
        (now, now - 1, Some(GateError::Expired)),
        (now - 1, now - 1, Some(GateError::Expired)),
        (0, now - 1, None),
        (0, now - 86400, Some(GateError::Freshness)),
        (0, now - 86399, None),
        (0, now + 1, Some(GateError::Freshness)),
    ] {
        let mut bytes = original.data.clone();
        bytes[expiry_offset..expiry_offset + 8].copy_from_slice(&expiry.to_le_bytes());
        bytes[107..115].copy_from_slice(&verified_at.to_le_bytes());
        f.replace(f.evidence, original.owner, bytes);
        let tx = Transaction::new_signed_with_payer(
            &[f.thaw(payer)],
            Some(&payer),
            &[f.harness.payer()],
            f.harness.rpc().get_latest_blockhash().unwrap(),
        );
        let result = f.harness.rpc().simulate_transaction(&tx).unwrap().value;
        assert_eq!(
            result.err,
            expected.map(|e| TransactionError::InstructionError(
                0,
                InstructionError::Custom(e as u32)
            )
            .into()),
            "{result:?}"
        );
        assert!(
            result
                .logs
                .unwrap()
                .iter()
                .any(|log| log.starts_with(&format!("Program {} invoke", ids::GATE)))
        );
        assert_eq!(on_chain_unix(&f.harness), now);
    }
    let _: serde_json::Value = f
        .harness
        .rpc()
        .send(
            RpcRequest::Custom {
                method: "surfnet_resumeClock",
            },
            serde_json::json!([]),
        )
        .unwrap();
    assert_eq!(
        f.harness
            .rpc()
            .get_account(&list_pda(&f.mint))
            .unwrap()
            .data
            .len(),
        226
    );
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "builds the program with cargo build-sbf; run via `mise run integration`"]
async fn tokenized_attestation_recipient_does_not_restrict_the_fund() {
    use support::admission::{Admission, claim};
    let f = Admission::start().await;
    f.revoke();
    let (instructions, recipient, attestation_mint) = sas_ix::tokenized_attestation(
        &f.harness.payer().pubkey(),
        &f.credential_authority.pubkey(),
        &f.issuer.pubkey(),
        &f.credential,
        &f.schema,
        &f.evidence,
        &f.investor.pubkey(),
        &claim("DE", f.now - 1),
        f.now + 86400,
    );
    for (instruction, signer) in instructions
        .into_iter()
        .zip([&f.credential_authority, &f.issuer])
    {
        f.harness
            .send(&[instruction], &[f.harness.payer(), signer])
            .assert_success();
    }
    let evidence = f.harness.rpc().get_account(&f.evidence).unwrap();
    let decoded = sas::authenticate_and_decode(&evidence.owner, &evidence.data).unwrap();
    assert_eq!(decoded.token_account, recipient);
    assert_ne!(
        recipient, f.token,
        "credential token and fund token use different accounts"
    );
    let recipient_data = f.harness.rpc().get_account(&recipient).unwrap().data;
    assert_eq!(&recipient_data[..32], attestation_mint.as_ref());
    assert_eq!(
        u64::from_le_bytes(recipient_data[64..72].try_into().unwrap()),
        1
    );
    f.send_thaw().assert_success();
    assert_eq!(f.token_state(), 1);
}

/// Aster Identity governs schemas; Aster Verification Desk only issues evidence.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "builds the program with cargo build-sbf; run via `mise run integration`"]
async fn separates_credential_authority_and_attestation_issuer() {
    use support::admission::{Admission, claim};
    let f = Admission::start().await;
    let payer = f.harness.payer().pubkey();
    assert_ne!(f.credential_authority.pubkey(), f.issuer.pubkey());
    assert_ne!(payer, f.credential_authority.pubkey());
    assert_ne!(payer, f.issuer.pubkey());
    let evidence = f.harness.rpc().get_account(&f.evidence).unwrap();
    let decoded = sas::authenticate_and_decode(&evidence.owner, &evidence.data).unwrap();
    assert_eq!(decoded.signer, f.issuer.pubkey());
    let unauthorized_schema = sas_ix::schema_pda(&f.credential, "desk-created-schema");
    let rejected = f.harness.send(
        &[sas_ix::create_schema(
            &payer,
            &f.issuer.pubkey(),
            &f.credential,
            &unauthorized_schema,
            "desk-created-schema",
            "Issuer cannot administer schemas",
            &[12],
            &["jurisdiction"],
        )],
        &[f.harness.payer(), &f.issuer],
    );
    assert!(rejected.reached(&ids::SAS.id));
    assert_eq!(
        rejected.error,
        Some(TransactionError::InstructionError(
            0,
            InstructionError::IncorrectAuthority
        )),
        "{:?}",
        rejected.logs
    );
    assert!(f.harness.rpc().get_account(&unauthorized_schema).is_err());
    let subject = Pubkey::new_unique();
    let unauthorized_evidence = sas_ix::attestation_pda(&f.credential, &f.schema, &subject);
    let rejected = f.harness.send(
        &[sas_ix::create_attestation(
            &payer,
            &f.credential_authority.pubkey(),
            &f.credential,
            &f.schema,
            &unauthorized_evidence,
            &subject,
            &claim("DE", f.now),
            f.now + 86400,
        )],
        &[f.harness.payer(), &f.credential_authority],
    );
    assert!(rejected.reached(&ids::SAS.id));
    assert_eq!(
        rejected.error,
        Some(TransactionError::InstructionError(
            0,
            InstructionError::Custom(5)
        )),
        "{:?}",
        rejected.logs
    );
    assert!(f.harness.rpc().get_account(&unauthorized_evidence).is_err());
    f.send_thaw().assert_success();
    assert_eq!(f.token_state(), 1);
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "builds the program with cargo build-sbf; run via `mise run integration`"]
async fn rejects_genuine_but_unaccepted_evidence() {
    use support::admission::{Admission, claim};
    let f = Admission::start().await;
    let payer = f.harness.payer().pubkey();
    let other_subject = Pubkey::new_unique();
    let other_authority = Keypair::new();
    let other_issuer = Keypair::new();
    let other_credential = sas_ix::credential_pda(&other_authority.pubkey(), "Boreal Identity");
    let other_schema = sas_ix::schema_pda(&other_credential, "investor-jurisdiction");
    let wrong_schema = sas_ix::schema_pda(&f.credential, "professional-membership");
    f.harness
        .send(
            &[
                sas_ix::create_credential(
                    &payer,
                    &other_credential,
                    &other_authority.pubkey(),
                    "Boreal Identity",
                    &[other_issuer.pubkey()],
                ),
                sas_ix::create_schema(
                    &payer,
                    &other_authority.pubkey(),
                    &other_credential,
                    &other_schema,
                    "investor-jurisdiction",
                    "other issuer",
                    &[12, 8],
                    &["jurisdiction", "verified_at"],
                ),
            ],
            &[f.harness.payer(), &other_authority],
        )
        .assert_success();
    f.harness
        .send(
            &[sas_ix::create_schema(
                &payer,
                &f.credential_authority.pubkey(),
                &f.credential,
                &wrong_schema,
                "professional-membership",
                "unaccepted schema",
                &[12, 8],
                &["jurisdiction", "verified_at"],
            )],
            &[f.harness.payer(), &f.credential_authority],
        )
        .assert_success();
    for (issuer, credential, schema, subject) in [
        (&f.issuer, f.credential, f.schema, other_subject),
        (&f.issuer, f.credential, wrong_schema, f.investor.pubkey()),
        (
            &other_issuer,
            other_credential,
            other_schema,
            f.investor.pubkey(),
        ),
    ] {
        let evidence = sas_ix::attestation_pda(&credential, &schema, &subject);
        f.harness
            .send(
                &[sas_ix::create_attestation(
                    &payer,
                    &issuer.pubkey(),
                    &credential,
                    &schema,
                    &evidence,
                    &subject,
                    &claim("DE", f.now - 1),
                    f.now + 86400,
                )],
                &[f.harness.payer(), issuer],
            )
            .assert_success();
        let mut instruction = f.thaw(payer);
        instruction
            .accounts
            .iter_mut()
            .find(|a| a.pubkey == f.evidence)
            .unwrap()
            .pubkey = evidence;
        let outcome = f.harness.send(&[instruction], &[f.harness.payer()]);
        assert!(
            outcome.error.is_some(),
            "unaccepted genuine evidence admitted"
        );
        assert!(
            !outcome.reached(&ids::GATE),
            "the fixed discovery policy should reject during resolution"
        );
        assert_eq!(f.token_state(), 2);
    }
    f.send_thaw().assert_success();
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "builds the program with cargo build-sbf; run via `mise run integration`"]
async fn governance_follows_authority_rotation_and_blocks_take_precedence() {
    use support::admission::Admission;
    use token_acl_client::{
        accounts::MintConfig,
        instructions::{SetAuthority, SetAuthorityInstructionArgs},
    };
    use token_acl_sas_gate::GateError;
    let f = Admission::start().await;
    let payer = f.harness.payer().pubkey();
    let successor_fund_operator = Keypair::new();
    f.harness
        .send(
            &[SetAuthority {
                authority: payer,
                mint_config: MintConfig::find_pda(&f.mint).0,
            }
            .instruction(SetAuthorityInstructionArgs {
                new_authority: successor_fund_operator.pubkey(),
            })],
            &[f.harness.payer()],
        )
        .assert_success();
    gate_denied(
        &f.harness
            .send(&[f.configure(&payer, &f.policy)], &[f.harness.payer()]),
        GateError::Unauthorized,
    );
    gate_denied(
        &f.harness.send(
            &[f.status(&f.token, Some([1, 0]), &payer)],
            &[f.harness.payer()],
        ),
        GateError::Unauthorized,
    );
    let mut policy = f.policy.clone();
    policy.jurisdictions = vec![*b"US"];
    f.harness
        .send(
            &[
                f.configure(&successor_fund_operator.pubkey(), &policy),
                f.status(&f.token, Some([1, 0]), &successor_fund_operator.pubkey()),
            ],
            &[f.harness.payer(), &successor_fund_operator],
        )
        .assert_success();
    gate_denied(&f.send_thaw(), GateError::Blocked);
    let cleared = f.harness.send(
        &[f.status(&f.token, Some([0, 0]), &successor_fund_operator.pubkey())],
        &[f.harness.payer(), &successor_fund_operator],
    );
    cleared.assert_success();
    assert!(
        cleared
            .logs
            .iter()
            .any(|line| line.contains("blocked=0 invalidated=0"))
    );
    gate_denied(&f.send_thaw(), GateError::Claim);
}

/// credential lifecycle exercises transfers, enforcement on a supplied account, and restoration
/// with real SAS issuance/closure and real Token ACL instructions.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "builds the program with cargo build-sbf; run via `mise run integration`"]
async fn revocation_freeze_renewal_and_block_precedence() {
    use spl_token_2022_interface::instruction as token;
    use support::admission::{Admission, TOKEN};
    use token_acl_sas_gate::GateError;
    let mut f = Admission::start().await;
    let payer = f.harness.payer().pubkey();
    let supplied = f.token;
    f.send_thaw().assert_success();
    let other = f.new_token(true);
    f.harness
        .send(&[f.status(&other, None, &payer)], &[f.harness.payer()])
        .assert_success();
    f.token = other;
    f.send_thaw().assert_success();
    f.token = supplied;
    f.harness
        .send(
            &[token::mint_to(&TOKEN, &f.mint, &supplied, &payer, &[], 100).unwrap()],
            &[f.harness.payer()],
        )
        .assert_success();
    let transfer = |amount| {
        token::transfer_checked(
            &TOKEN,
            &supplied,
            &f.mint,
            &other,
            &f.investor.pubkey(),
            &[],
            amount,
            6,
        )
        .unwrap()
    };
    f.harness
        .send(&[transfer(5)], &[f.harness.payer(), &f.investor])
        .assert_success();
    f.revoke();
    // Native revocation alone does not invoke the gate on transfers.
    let outcome = f
        .harness
        .send(&[transfer(10)], &[f.harness.payer(), &f.investor]);
    outcome.assert_success();
    assert!(outcome.compute_units_for(&support::ids::GATE).is_none());
    assert_eq!(f.token_state(), 1);
    f.freeze();
    assert_eq!(f.token_state(), 2);
    let before = f.harness.rpc().get_account(&supplied).unwrap();
    assert_eq!(
        u64::from_le_bytes(before.data[64..72].try_into().unwrap()),
        85
    );
    let denied = f
        .harness
        .send(&[transfer(11)], &[f.harness.payer(), &f.investor]);
    assert_eq!(
        denied.error,
        Some(TransactionError::InstructionError(
            0,
            InstructionError::Custom(17)
        )),
        "Token-2022 must reject the frozen source with AccountFrozen: {denied:?}"
    );
    assert!(!denied.reached(&support::ids::GATE));
    assert_eq!(
        f.harness.rpc().get_account(&supplied).unwrap().data,
        before.data
    );
    assert_eq!(
        f.harness.rpc().get_account(&other).unwrap().data[108],
        1,
        "freezing the supplied account does not freeze every account of its owner"
    );
    gate_denied(&f.send_thaw(), GateError::Owner);
    assert_eq!(f.token_state(), 2);
    f.issue("DE", f.now - 1, f.now + 172800);
    assert_eq!(f.token_state(), 2, "renewal alone does not thaw");
    f.send_thaw().assert_success();
    f.harness
        .send(&[transfer(12)], &[f.harness.payer(), &f.investor])
        .assert_success();

    f.freeze();
    f.harness
        .send(
            &[f.status(&f.investor.pubkey(), Some([1, 0]), &payer)],
            &[f.harness.payer()],
        )
        .assert_success();
    f.revoke();
    f.issue("DE", f.now, f.now + 259200);
    gate_denied(&f.send_thaw(), GateError::Blocked);
    assert_eq!(f.token_state(), 2);
    gate_denied(
        &f.harness.send(
            &[f.status(&f.investor.pubkey(), Some([0, 0]), &f.investor.pubkey())],
            &[f.harness.payer(), &f.investor],
        ),
        GateError::Unauthorized,
    );
    gate_denied(&f.send_thaw(), GateError::Blocked);
    f.harness
        .send(
            &[f.status(&f.investor.pubkey(), Some([0, 0]), &payer)],
            &[f.harness.payer()],
        )
        .assert_success();
    f.send_thaw().assert_success();
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "builds the program with cargo build-sbf; run via `mise run integration`"]
async fn wallet_invalidation_survives_reissuance_until_authorized_clear() {
    use support::admission::Admission;
    use token_acl_sas_gate::GateError;
    let f = Admission::start().await;
    let payer = f.harness.payer().pubkey();
    f.send_thaw().assert_success();
    f.harness
        .send(
            &[f.status(&f.investor.pubkey(), Some([0, 1]), &payer)],
            &[f.harness.payer()],
        )
        .assert_success();
    assert_eq!(
        f.token_state(),
        1,
        "adapter invalidation is not an automatic freeze"
    );
    f.freeze();
    f.revoke();
    f.issue("DE", f.now, f.now + 172800);
    gate_denied(&f.send_thaw(), GateError::Invalidated);
    assert_eq!(f.token_state(), 2);
    f.harness
        .send(
            &[f.status(&f.investor.pubkey(), Some([0, 0]), &payer)],
            &[f.harness.payer()],
        )
        .assert_success();
    f.send_thaw().assert_success();
}

/// screening blocks: a simulated screening feed. A sanctions hit blocks the wallet and
/// freezes the supplied token account in one transaction; only an authorized
/// review lifts the block. A delisting has no instruction (the feed only reports
/// a review), so `app/tests/screening.spec.ts` covers it through the script.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "builds the program with cargo build-sbf; run via `mise run integration`"]
async fn sanctions_hit_blocks_and_freezes_until_authorized_review() {
    use support::admission::Admission;
    use token_acl_sas_gate::GateError;
    let f = Admission::start().await;
    let payer = f.harness.payer().pubkey();
    let investor = f.investor.pubkey();
    f.send_thaw().assert_success();
    assert_eq!(f.token_state(), 1);

    // An unauthorized hit fails at the status write; the freeze never lands.
    gate_denied(
        &f.harness.send(
            &f.sanctions_hit(&investor),
            &[f.harness.payer(), &f.investor],
        ),
        GateError::Unauthorized,
    );
    assert_eq!(f.wallet_flags(), [0, 0]);
    assert_eq!(f.token_state(), 1);

    // An authorized hit blocks the wallet and freezes the account atomically.
    let hit = f
        .harness
        .send(&f.sanctions_hit(&payer), &[f.harness.payer()]);
    hit.assert_success();
    assert!(
        hit.logs
            .iter()
            .any(|line| line.contains("blocked=1 invalidated=0"))
    );
    assert_eq!(f.wallet_flags(), [1, 0]);
    assert_eq!(f.token_state(), 2);

    // Renewed, valid evidence cannot clear the block.
    f.revoke();
    f.issue("DE", f.now, f.now + 172800);
    gate_denied(&f.send_thaw(), GateError::Blocked);
    assert_eq!(f.token_state(), 2);

    // Only the authorized reviewer lifts the block.
    gate_denied(
        &f.harness.send(
            &[f.lift_block(&investor)],
            &[f.harness.payer(), &f.investor],
        ),
        GateError::Unauthorized,
    );
    gate_denied(&f.send_thaw(), GateError::Blocked);
    f.harness
        .send(&[f.lift_block(&payer)], &[f.harness.payer()])
        .assert_success();
    assert_eq!(f.wallet_flags(), [0, 0]);
    f.send_thaw().assert_success();

    // A hit keeps an existing invalidation, and lifting the block does not clear it.
    f.harness
        .send(
            &[f.status(&investor, Some([0, 1]), &payer)],
            &[f.harness.payer()],
        )
        .assert_success();
    f.harness
        .send(&f.sanctions_hit(&payer), &[f.harness.payer()])
        .assert_success();
    assert_eq!(f.wallet_flags(), [1, 1]);
    assert_eq!(f.token_state(), 2);
    f.harness
        .send(&[f.lift_block(&payer)], &[f.harness.payer()])
        .assert_success();
    assert_eq!(f.wallet_flags(), [0, 1]);
    gate_denied(&f.send_thaw(), GateError::Invalidated);
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "builds the program with cargo build-sbf"]
async fn shared_evidence_and_independent_mint_policies() {
    use support::admission::{Admission, list_pda, policy_pda, status_pda};
    let mut f = Admission::start().await;
    let payer = f.harness.payer().pubkey();
    let first_mint = f.mint;
    let first_token = f.token;
    let evidence_before = f.harness.rpc().get_account(&f.evidence).unwrap().data;
    f.send_thaw().assert_success();
    assert_eq!(f.token_state(), 1);
    let mut second_policy = f.policy.clone();
    second_policy.jurisdictions = vec![*b"US"];
    f.add_fund(second_policy);
    let second_mint = f.mint;
    let second_token = f.token;
    assert_ne!(policy_pda(&first_mint), policy_pda(&second_mint));
    assert_ne!(list_pda(&first_mint), list_pda(&second_mint));
    assert_ne!(
        status_pda(&first_mint, &f.investor.pubkey()),
        status_pda(&second_mint, &f.investor.pubkey())
    );
    gate_denied(&f.send_thaw(), token_acl_sas_gate::GateError::Claim);
    assert_eq!(f.token_state(), 2);
    assert_eq!(
        f.harness.rpc().get_account(&first_token).unwrap().data[108],
        1
    );
    // A second-fund block cannot affect the first fund's admission.
    f.harness
        .send(
            &[f.status(&f.investor.pubkey(), Some([1, 0]), &payer)],
            &[f.harness.payer()],
        )
        .assert_success();
    f.mint = first_mint;
    f.token = first_token;
    f.freeze();
    f.send_thaw().assert_success();
    assert_eq!(f.token_state(), 1);
    // Updating only the second predicate permits the exact same evidence.
    f.mint = second_mint;
    f.token = second_token;
    f.policy.jurisdictions = vec![*b"DE"];
    f.harness
        .send(&[f.configure(&payer, &f.policy)], &[f.harness.payer()])
        .assert_success();
    gate_denied(&f.send_thaw(), token_acl_sas_gate::GateError::Blocked);
    f.harness
        .send(
            &[f.status(&f.investor.pubkey(), Some([0, 0]), &payer)],
            &[f.harness.payer()],
        )
        .assert_success();
    f.send_thaw().assert_success();
    assert_eq!(f.token_state(), 1);
    assert_eq!(
        f.harness.rpc().get_account(&f.evidence).unwrap().data,
        evidence_before
    );
}
