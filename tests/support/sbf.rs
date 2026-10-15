//! Builds the deployable program once per test process.
//!
//! `AGENTS.md` forbids substituting host tests for the SBF build, so the
//! harness invokes `cargo build-sbf` itself rather than trusting a previous
//! `mise run build`.

use std::{
    env,
    fs::{self, File},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::OnceLock,
    thread,
    time::{Duration, Instant},
};

const POLL_INTERVAL: Duration = Duration::from_millis(250);
const BUILD_TIMEOUT: Duration = Duration::from_secs(600);
const VERSION_TIMEOUT: Duration = Duration::from_secs(10);

/// Path to `token_acl_sas_gate.so`, building it on first call.
///
/// # Panics
///
/// Panics if `SBF_TOOLS_VERSION` is unset, if `cargo-build-sbf` is missing, or
/// if the build fails or exceeds [`BUILD_TIMEOUT`].
pub fn program_binary() -> &'static Path {
    static BINARY: OnceLock<PathBuf> = OnceLock::new();
    BINARY.get_or_init(build).as_path()
}

fn build() -> PathBuf {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let sbf_tools_version = env::var("SBF_TOOLS_VERSION").expect(
        "SBF_TOOLS_VERSION is unset; run the suite through `mise run integration` or \
         `mise run build` so the pinned SBF toolchain is selected",
    );
    let logs = root.join("target/sbf-build-logs");
    fs::create_dir_all(&logs).expect("create SBF build log directory");

    run(
        Command::new("cargo-build-sbf").arg("--version"),
        &logs,
        "cargo-build-sbf-version",
        VERSION_TIMEOUT,
    );
    let out = root.join("target/deploy");
    // Separate target dir: this compiler's proc-macro ABI differs from the
    // host's, and mixing them in one cache confuses rust-analyzer.
    run(
        Command::new("cargo")
            .current_dir(root)
            .env("CARGO_TARGET_DIR", root.join("target/sbf"))
            .args(["build-sbf", "--manifest-path"])
            .arg(root.join("Cargo.toml"))
            .arg("--sbf-out-dir")
            .arg(&out)
            .args(["--tools-version", &sbf_tools_version])
            .args(["--", "--locked"]),
        &logs,
        "build-token-acl-sas-gate",
        BUILD_TIMEOUT,
    );

    let binary = out.join("token_acl_sas_gate.so");
    assert!(
        binary.is_file(),
        "cargo build-sbf reported success but {} is missing",
        binary.display()
    );
    binary
}

/// Runs a setup command under a deadline, capturing output to a log file.
///
/// Bound setup commands too: a toolchain prompt or a stalled download must not
/// hang the suite.
fn run(command: &mut Command, directory: &Path, name: &str, timeout: Duration) {
    let log_path = directory.join(format!("{name}.log"));
    let log = File::create(&log_path).expect("create command log");
    eprintln!("harness: {name}");
    let mut child = command
        .stdin(Stdio::null())
        .stdout(log.try_clone().expect("clone command log"))
        .stderr(log)
        .spawn()
        .unwrap_or_else(|error| {
            panic!("cannot run {name}: {error}; install the pinned Solana/Agave CLI tools")
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
