# penguin

A minimal Solana program built with [Pinocchio](https://docs.rs/pinocchio/0.11.2).
The entrypoint currently accepts all instructions and returns success without
reading or modifying accounts. No instruction format, state, or program ID is
defined yet.

## Prerequisites

- Rust 1.89 or newer.
- The Solana/Agave CLI with `cargo build-sbf` and an SBF toolchain supporting
  Rust 1.89 or newer.

## Build and check

```sh
cargo fmt --check
cargo test
cargo build-sbf
```

The deployable program is written to `target/deploy/penguin.so`. This is an
on-chain library, not a command-line executable; `cargo run` does not apply.
The unit test calls the processor directly, not through a Solana runtime.

## Layout

- `src/lib.rs`: program entrypoint and no-op instruction processor.
- `Cargo.toml`: library configuration and Pinocchio dependency.

The `no-entrypoint` feature allows other crates to depend on the processor
without exporting the Solana entrypoint.
