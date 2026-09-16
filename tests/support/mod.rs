use solana_rpc_client::rpc_client::RpcClient;
use solana_sdk::{
    commitment_config::CommitmentConfig,
    pubkey::Pubkey,
    signature::{Keypair, Signature, Signer},
};
use std::{
    env,
    fs::{self, File},
    net::{TcpListener, UdpSocket},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant},
};
use tempfile::TempDir;

pub const SAS_PROGRAM_ID: Pubkey =
    solana_sdk::pubkey!("22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG");
const POLL_INTERVAL: Duration = Duration::from_millis(250);
const RPC_TIMEOUT: Duration = Duration::from_secs(2);
const WAIT_TIMEOUT: Duration = Duration::from_secs(60);

/// Owns only this test's validator. Normal completion and unwinding both stop it.
pub struct LocalValidator {
    pub rpc: RpcClient,
    pub payer: Keypair,
    pub doors_of_durin_id: Pubkey,
    process: Child,
    directory: Option<TempDir>,
}

impl LocalValidator {
    pub fn start() -> Self {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"));
        let directory = tempfile::tempdir().expect("create E2E directory");
        let work = directory.path();
        let sbf_tools_version = env::var("SBF_TOOLS_VERSION")
            .expect("run E2E through `mise run e2e` to select the pinned SBF toolchain");

        for tool in ["cargo-build-sbf", "solana", "solana-test-validator"] {
            run(
                Command::new(tool).arg("--version"),
                work,
                tool,
                Duration::from_secs(10),
            );
        }

        let programs = work.join("programs");
        fs::create_dir(&programs).expect("create program directory");
        run(
            Command::new("cargo")
                .current_dir(root)
                .args(["build-sbf", "--manifest-path"])
                .arg(root.join("Cargo.toml"))
                .arg("--sbf-out-dir")
                .arg(&programs)
                .args(["--tools-version", &sbf_tools_version])
                .args(["--", "--locked"]),
            work,
            "build-doors-of-durin",
            Duration::from_secs(600),
        );

        let sas = match env::var_os("SAS_PROGRAM_SO") {
            Some(path) => {
                let path = PathBuf::from(path)
                    .canonicalize()
                    .expect("SAS_PROGRAM_SO must point to an existing SAS binary");
                assert!(path.is_file(), "SAS_PROGRAM_SO must be a file");
                path
            }
            None => {
                let path = programs.join("sas.so");
                run(
                    Command::new("solana")
                        .args([
                            "--url",
                            "https://api.mainnet-beta.solana.com",
                            "program",
                            "dump",
                            &SAS_PROGRAM_ID.to_string(),
                        ])
                        .arg(&path),
                    work,
                    "download-sas",
                    Duration::from_secs(120),
                );
                path
            }
        };

        // Hold reservations until immediately before spawn. The validator needs
        // adjacent RPC/websocket ports, plus independent faucet and gossip ports.
        let (rpc_port, reservations) = reserve_rpc_ports();
        let faucet = TcpListener::bind("127.0.0.1:0").expect("reserve faucet port");
        let gossip = TcpListener::bind("127.0.0.1:0").expect("reserve gossip port");
        let gossip_udp =
            UdpSocket::bind(gossip.local_addr().unwrap()).expect("reserve gossip UDP port");
        let payer = Keypair::new();
        let doors_of_durin_id = Keypair::new().pubkey();
        // Explicitly set an unrelated genesis mint so the payer needs its airdrop,
        // and the validator never falls back to the user's configured wallet.
        let mint = Keypair::new().pubkey();
        let log = File::create(work.join("validator.log")).expect("create validator log");
        let mut command = Command::new("solana-test-validator");
        command
            .current_dir(work)
            .args([
                "--ledger",
                "ledger",
                "--bind-address",
                "127.0.0.1",
                "--rpc-port",
                &rpc_port.to_string(),
                "--faucet-port",
                &faucet.local_addr().unwrap().port().to_string(),
                "--gossip-port",
                &gossip.local_addr().unwrap().port().to_string(),
                "--mint",
                &mint.to_string(),
                "--bpf-program",
                &doors_of_durin_id.to_string(),
            ])
            .arg(programs.join("doors_of_durin.so"))
            .args(["--bpf-program", &SAS_PROGRAM_ID.to_string()])
            .arg(sas)
            .stdin(Stdio::null())
            .stdout(log.try_clone().expect("clone validator log"))
            .stderr(log);
        drop((reservations, faucet, gossip, gossip_udp));
        let process = command.spawn().expect("start solana-test-validator");
        let mut validator = Self {
            rpc: RpcClient::new_with_timeout_and_commitment(
                format!("http://127.0.0.1:{rpc_port}"),
                RPC_TIMEOUT,
                CommitmentConfig::confirmed(),
            ),
            payer,
            doors_of_durin_id,
            process,
            directory: Some(directory),
        };
        let deadline = Instant::now() + WAIT_TIMEOUT;
        loop {
            assert!(
                validator
                    .process
                    .try_wait()
                    .expect("check validator")
                    .is_none(),
                "validator exited during startup"
            );
            // Checking our fresh program ID also avoids accepting an unrelated RPC.
            if validator.rpc.get_health().is_ok()
                && validator.rpc.get_account(&doors_of_durin_id).is_ok()
            {
                break;
            }
            assert!(Instant::now() < deadline, "validator startup timed out");
            thread::sleep(POLL_INTERVAL);
        }
        validator
    }

    pub fn confirm(&self, signature: &Signature) {
        let deadline = Instant::now() + WAIT_TIMEOUT;
        loop {
            if let Some(result) = self
                .rpc
                .get_signature_status_with_commitment(signature, CommitmentConfig::confirmed())
                .expect("fetch transaction status")
            {
                result.expect("transaction must succeed");
                return;
            }
            assert!(
                Instant::now() < deadline,
                "timed out confirming transaction {signature}"
            );
            thread::sleep(POLL_INTERVAL);
        }
    }
}

impl Drop for LocalValidator {
    fn drop(&mut self) {
        let _ = self.process.kill();
        let _ = self.process.wait();
        if thread::panicking()
            && let Some(directory) = self.directory.take()
        {
            let path = directory.keep();
            eprintln!(
                "E2E failed; validator logs and ledger retained at {}",
                path.display()
            );
        }
    }
}

fn reserve_rpc_ports() -> (u16, [TcpListener; 2]) {
    for _ in 0..100 {
        let rpc = TcpListener::bind("127.0.0.1:0").expect("reserve RPC port");
        let port = rpc.local_addr().unwrap().port();
        if let Some(next) = port.checked_add(1)
            && let Ok(websocket) = TcpListener::bind(("127.0.0.1", next))
        {
            return (port, [rpc, websocket]);
        }
    }
    panic!("could not reserve adjacent RPC/websocket ports");
}

/// Bound setup commands too: an RPC outage or toolchain prompt must not hang tests.
fn run(command: &mut Command, directory: &Path, name: &str, timeout: Duration) {
    let log_path = directory.join(format!("{name}.log"));
    let log = File::create(&log_path).expect("create command log");
    eprintln!("E2E: {name}");
    let mut child = command
        .stdin(Stdio::null())
        .stdout(log.try_clone().expect("clone command log"))
        .stderr(log)
        .spawn()
        .unwrap_or_else(|error| {
            panic!("cannot run {name}: {error}; install Solana/Agave CLI tools")
        });
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return,
            Ok(None) if Instant::now() < deadline => thread::sleep(POLL_INTERVAL),
            outcome => {
                let _ = child.kill();
                let _ = child.wait();
                panic!(
                    "{name} failed or timed out ({outcome:?}):\n{}",
                    fs::read_to_string(&log_path).unwrap_or_default()
                );
            }
        }
    }
}
