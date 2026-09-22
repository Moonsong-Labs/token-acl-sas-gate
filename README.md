# doors-of-durin

A minimal Solana program built with [Pinocchio](https://docs.rs/pinocchio/0.11.2).
The entrypoint currently accepts all instructions and returns success without
reading or modifying accounts. No instruction format, state, or program ID is
defined yet.

## Prerequisites

Install [mise](https://mise.jdx.dev/getting-started.html) and the native build
prerequisites listed in [CONTRIBUTING.md](CONTRIBUTING.md). `mise.toml` pins
Rust (including rustfmt and Clippy), `prek`, the Solana/Agave CLI, the SBF build
command, and its separate platform-tools compiler.

Review the configuration, then initialize this checkout:

```sh
mise trust
mise install
mise run setup
```

Setup prepares the pinned SBF compiler and installs the Git hooks. No global
Rust default or Solana wallet/cluster configuration needs to be changed.

## Build and check

```sh
mise run check
mise run verify
```

`check` runs formatting checks, strict Clippy, and both unit-test configurations.
`verify` also runs the SBF build and the local-validator E2E test. Use `mise run
fmt` to format the Rust sources, and run the SAS spike probe on demand with
`mise run spike`. See [CONTRIBUTING.md](CONTRIBUTING.md) for Git hooks and the
shared review and contribution workflow.

To build the deployable artifact separately, run `mise run build`.
The deployable program is written to `target/deploy/doors_of_durin.so`. This is an
on-chain library, not a command-line executable; `cargo run` does not apply.
The unit test calls the processor directly, not through a Solana runtime.

## Local-validator E2E smoke test

The root `tests/e2e.rs` integration test builds doors-of-durin, downloads the deployed
Solana Attestation Service (SAS) binary from mainnet, and loads both into a fresh
`solana-test-validator` using `--bpf-program`. This loads programs at genesis;
it does not exercise deployment transactions or deploy anything to a public cluster.

After setup, run:

```sh
mise run e2e
```

The test is ignored by ordinary `cargo test`. It asserts both program accounts
are executable, then sends and confirms an empty doors-of-durin instruction. It does
not yet exercise SAS credential creation.

By default, every E2E run downloads SAS from mainnet, following the
[official Rust demo](https://github.com/solana-foundation/solana-attestation-service/tree/master/examples/rust/attestation-flow-guide#local-development).
This needs network access and is not pinned: a SAS upgrade can change the binary.
To reuse a known binary without contacting mainnet, set `SAS_PROGRAM_SO`:

```sh
SAS_PROGRAM_SO=/absolute/path/to/sas.so mise run e2e
```

On Windows, run these commands inside x86_64 WSL and use a Linux path for the
binary (for example, `/mnt/c/path/to/sas.so`), not a PowerShell environment
variable or Windows path. Building doors-of-durin may still need network access
for uncached dependencies.

The harness uses temporary files, locally selected ports, and an ephemeral payer;
it does not modify your Solana CLI configuration or use your wallet. It stops
its validator on success or panic. On failure after startup, it prints the path
to the retained validator logs and ledger. Setup commands and RPC waits have
timeouts; missing tools fail the explicitly requested test rather than skipping it.

## Layout

- `src/lib.rs`: program entrypoint and no-op instruction processor.
- `tests/e2e.rs`: opt-in local-validator smoke test.
- `tests/support/mod.rs`: program setup and validator lifecycle.
- `Cargo.toml`: library configuration and Pinocchio dependency.
- `mise.toml`: pinned tools, SBF compiler version, and development tasks.

The `no-entrypoint` feature allows other crates to depend on the processor
without exporting the Solana entrypoint.
