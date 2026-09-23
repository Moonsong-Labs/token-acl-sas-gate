//! Surfnet lifecycle and transaction submission.

use crate::support::{ids, ids::Program, sbf};
use sha2::{Digest, Sha256};
use solana_instruction::Instruction;
use solana_rpc_client_types::config::RpcSendTransactionConfig;
use solana_transaction::Transaction;
use solana_transaction_error::TransactionError;
use std::{env, fs, path::PathBuf, time::Duration};
use surfpool_sdk::{
    Cheatcodes, Keypair, Pubkey, RpcClient, Signer, SimnetEvent, Surfnet,
    cheatcodes::builders::DeployProgram,
};

const OUTCOME_TIMEOUT: Duration = Duration::from_secs(20);
const SLOT_TIME_MS: u64 = 1;
const PAYER_SOL: u64 = 1_000_000_000_000;

/// A running surfnet with our gate deployed at [`ids::GATE`].
pub struct Harness {
    surfnet: Surfnet,
    rpc: RpcClient,
}

impl Harness {
    /// Boots an offline surfnet with the gate and the pinned third-party
    /// programs deployed.
    ///
    /// No network and no RPC endpoint. SAS and Token ACL come from committed
    /// binaries under `tests/fixtures/programs`, verified against the hashes in
    /// [`ids::PINNED`], so the suite is reproducible and CI is not subject to a
    /// public endpoint's rate limits.
    pub async fn start() -> Self {
        Self::boot().await
    }

    async fn boot() -> Self {
        let binary = sbf::program_binary();
        let surfnet = Surfnet::builder()
            .offline(true)
            .slot_time_ms(SLOT_TIME_MS)
            .airdrop_sol(PAYER_SOL)
            .start()
            .await
            .expect("start surfnet");
        let rpc = surfnet.rpc_client();
        let cheats = surfnet.cheatcodes();
        cheats
            .deploy(DeployProgram::new(ids::GATE).so_path(binary))
            .expect("deploy the gate program");
        for program in ids::PINNED {
            cheats
                .deploy(DeployProgram::new(program.id).so_path(verified_path(&program)))
                .unwrap_or_else(|error| panic!("deploy {}: {error}", program.id));
        }
        Self { surfnet, rpc }
    }

    pub fn rpc(&self) -> &RpcClient {
        &self.rpc
    }

    pub fn payer(&self) -> &Keypair {
        self.surfnet.payer()
    }

    /// Entry point for account fabrication and clock control.
    ///
    /// Unused until the fixtures land, but it is the whole reason the harness
    /// can reach states no instruction can produce.
    #[allow(dead_code)]
    pub fn cheats(&self) -> Cheatcodes<'_> {
        self.surfnet.cheatcodes()
    }

    /// Submits `instructions` signed by `signers`, with the surfnet payer
    /// paying fees, and returns how it was decided.
    ///
    /// Preflight is skipped on purpose. With it on, a rejected transaction
    /// comes back as a client-side `Err` carrying simulation logs while an
    /// accepted one comes back as a signature plus an event — two shapes to
    /// parse. Skipping it puts every outcome, success or failure, on the event
    /// channel.
    ///
    /// # Panics
    ///
    /// Panics if the surfnet does not report the transaction within
    /// [`OUTCOME_TIMEOUT`].
    pub fn send(&self, instructions: &[Instruction], signers: &[&Keypair]) -> Outcome {
        let blockhash = self.rpc.get_latest_blockhash().expect("fetch blockhash");
        let payer = self.payer().pubkey();
        let transaction =
            Transaction::new_signed_with_payer(instructions, Some(&payer), signers, blockhash);
        let signature = self
            .rpc
            .send_transaction_with_config(
                &transaction,
                RpcSendTransactionConfig {
                    skip_preflight: true,
                    preflight_commitment: None,
                    encoding: None,
                    max_retries: None,
                    min_context_slot: None,
                },
            )
            .expect("submit transaction");

        let deadline = std::time::Instant::now() + OUTCOME_TIMEOUT;
        loop {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            assert!(
                !remaining.is_zero(),
                "surfnet did not report transaction {signature} within {OUTCOME_TIMEOUT:?}"
            );
            match self.surfnet.events().recv_timeout(remaining) {
                Ok(SimnetEvent::TransactionProcessed(_, metadata, error)) => {
                    if metadata.signature == signature {
                        return Outcome {
                            error,
                            logs: metadata.logs,
                        };
                    }
                }
                Ok(_) => continue,
                Err(error) => panic!("surfnet event channel closed awaiting {signature}: {error}"),
            }
        }
    }
}

/// What a transaction did.
///
/// `reached` and `compute_units_for` read the program logs because that is the
/// only place CPI depth survives: `TransactionError::InstructionError` carries
/// just the top-level instruction index, so a gate failure reached through
/// Token ACL's `thaw_permissionless` reports the same index as a Token ACL
/// failure.
#[derive(Debug, Clone)]
pub struct Outcome {
    pub error: Option<TransactionError>,
    pub logs: Vec<String>,
}

impl Outcome {
    /// Asserts the transaction succeeded, printing logs when it did not.
    ///
    /// # Panics
    ///
    /// Panics if the transaction carried an error.
    pub fn assert_success(&self) -> &Self {
        assert_eq!(
            self.error,
            None,
            "transaction failed unexpectedly; logs:\n{}",
            self.logs.join("\n")
        );
        self
    }

    /// Whether `program` was invoked at all. The absence of an `invoke` line is
    /// the cleanest evidence that a rejection happened upstream of it, which is
    /// the observable form of the `docs/IMPLEMENTATION.md` §2 invariant.
    pub fn reached(&self, program: &Pubkey) -> bool {
        let needle = format!("Program {program} invoke [");
        self.logs.iter().any(|line| line.starts_with(&needle))
    }

    /// Compute units consumed by `program` alone, including when it ran as a
    /// CPI. The runtime emits one `consumed` line per invocation and this sums
    /// them, so a transaction that reaches the gate twice reports both — which
    /// is the total `docs/IMPLEMENTATION.md` §9.3 asks about.
    ///
    /// `None` means `program` never ran, as distinct from `Some(0)`.
    pub fn compute_units_for(&self, program: &Pubkey) -> Option<u64> {
        let prefix = format!("Program {program} consumed ");
        let mut invocations = self.logs.iter().filter_map(|line| {
            line.strip_prefix(&prefix)?
                .split_whitespace()
                .next()?
                .parse::<u64>()
                .ok()
        });
        let first = invocations.next()?;
        Some(first + invocations.sum::<u64>())
    }
}

/// Path to a pinned program binary, after checking it against its hash.
///
/// # Panics
///
/// Panics if the file is missing or its hash does not match [`ids::PINNED`].
/// A mismatch means the binary was refreshed without updating the pin, so the
/// suite would silently start testing different bytecode.
fn verified_path(program: &Program) -> PathBuf {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/programs")
        .join(program.file);
    let bytes = fs::read(&path).unwrap_or_else(|error| {
        panic!(
            "{} is missing ({error}); refresh it with `mise run sync-programs`",
            path.display()
        )
    });
    let actual = hex(&Sha256::digest(&bytes));
    assert_eq!(
        actual,
        program.sha256,
        "{} does not match its pin. If this refresh is intentional, update \
         `sha256` in tests/support/ids.rs",
        path.display()
    );
    path
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
