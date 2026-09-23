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

use solana_instruction::Instruction;
use support::{Harness, Outcome, ids};

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
