# doors-of-durin

A Solana credential-admission gate built with [Pinocchio](https://docs.rs/pinocchio/0.11.2).
Token ACL calls the gate before permissionless thaw of a Token-2022 account.
The first use case accepts SAS evidence under a per-mint policy, with issuer,
schema, wallet binding, expiry, freshness, jurisdiction, and block checks.
Unknown instructions fail closed.

See [the UC1 protocol reference](docs/ADMISSION.md) for setup instructions,
account layouts, policy semantics, and error codes. The schema is a test fixture;
no external compliance provider integration or cluster deployment is configured.

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
`verify` also runs the SBF build and the integration suite. Use `mise run fmt`
to format the Rust sources. See [CONTRIBUTING.md](CONTRIBUTING.md) for Git hooks
and the shared review and contribution workflow.

To build the deployable artifact separately, run `mise run build`.
The deployable program is written to `target/deploy/doors_of_durin.so`. This is an
on-chain library, not a command-line executable; `cargo run` does not apply.
Unit tests exercise decoding and validation directly. Integration tests execute
the deployed SBF program through Token ACL.

## Surfnet integration tests

Integration tests run against an in-process [surfnet](https://surfpool.run),
booted by the `surfpool-sdk` crate. It executes real SBF bytecode through
LiteSVM and exposes cheatcodes for account fabrication and clock control, which
the gate's test matrix needs and `solana-test-validator` cannot provide.

```sh
mise run integration
```

No network, no RPC endpoint. The Solana Attestation Service and Token ACL are
deployed from binaries committed under `tests/fixtures/programs`, each pinned by
SHA-256 in `tests/support/ids.rs` and verified before it is loaded. Token-2022
and the Associated Token Account program come from LiteSVM's vendored copies.

The tests build the program with `cargo build-sbf` first, so they are
`#[ignore]`d and skipped by ordinary `cargo test`. They run in the pre-push
gate.

To pick up a new upstream release:

```sh
mise run sync-programs
```

That re-dumps both programs from mainnet and prints their hashes. If the
bytecode changed, `git diff` shows it and the suite fails with a pin mismatch
until the `sha256` values in `tests/support/ids.rs` are updated — so an upstream
change is always a reviewed diff rather than a silent behaviour shift.

Writing a test:

```rust
#[tokio::test(flavor = "multi_thread")]
#[ignore = "builds the program with cargo build-sbf"]
async fn my_case() {
    let harness = Harness::start().await;
    let outcome = harness.send(&[instruction], &[harness.payer()]);
    outcome.assert_success();
}
```

The `multi_thread` flavor is required: the blocking `RpcClient` calls
`block_in_place`, which tokio permits only on the multi-threaded scheduler, and
the panic names solana-rpc-client rather than the attribute.

The harness deploys the gate at a fixed test-only address so PDAs derived under
it stay reproducible across runs. It holds no wallet and does not touch your
Solana CLI configuration.

## Layout

- `src/lib.rs`: instruction dispatch, authority checks, state setup, and thaw callback.
- `src/state.rs`: policy, SAS schema, attestation, and claim decoding.
- `src/metas.rs`: standard Token ACL account discovery list.
- `tests/e2e.rs`: opt-in surfnet integration suite.
- `tests/support/`: harness — surfnet lifecycle, cheatcodes, and outcome
  attribution.
- `Cargo.toml`: library configuration and Pinocchio dependency.
- `mise.toml`: pinned tools, SBF compiler version, and development tasks.

The `no-entrypoint` feature allows other crates to depend on the processor
without exporting the Solana entrypoint.
