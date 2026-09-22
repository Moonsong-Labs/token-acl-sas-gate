# Contributing

## Review and landing

Review changes together in Delta, resolve feedback, and explicitly approve the
intended scope before landing. We land reviewed work directly on `main`; we do
not use GitHub PRs. Agent-specific authorization, checkout setup, and handoff
instructions live in [AGENTS.md](AGENTS.md).

Inspect remotes and verify the source repository before pushing. Never publish
to the `local` backlink or assume `origin` exists. If no source remote is
configured, stop and ask. Fetch `main`, review every outgoing commit and the
combined diff, and integrate upstream changes without rewriting published
history. Only team-reviewed work may be included; preserve unrelated edits
and use a clean candidate rather than pushing unrelated ancestor commits.

Re-review changes introduced by integration and rerun the full checks. Push
only the exact reviewed, checked candidate using
`git push <remote> HEAD:refs/heads/main`. On rejection, fetch and revalidate;
never force-push, skip hooks, or use `--no-verify`. Stop if branch protections
require a PR; do not bypass them or create a PR under this workflow. Verify the
landed SHA on remote `main` and report actual results, not assumed success.

## Prerequisites and checks

`mise.toml` is the source of truth for development tool versions. It pins host
Rust 1.89.0 with rustfmt and Clippy, `prek`, Solana/Agave, the SBF build
command, and the separate SBF compiler (`SBF_TOOLS_VERSION`).

Install [mise](https://mise.jdx.dev/getting-started.html) (at least the
`min_version` in `mise.toml`) and Git first. Native system prerequisites remain
outside mise: use Xcode Command Line Tools on macOS; on Linux, install a C/C++
build toolchain, `pkg-config`, and OpenSSL development headers (for example,
`build-essential pkg-config libssl-dev` on Ubuntu). Archive extraction also
requires `tar` with bzip2 support. The pinned Agave assets support Apple Silicon
macOS and x86_64 glibc Linux. Use x86_64 WSL on Windows, not native PowerShell,
for the Solana toolchain and local validator.

On macOS, mise sets `SDKROOT` from the SDK paired with the active Xcode
developer directory. This prevents the compiler from accidentally combining a
newer standalone Command Line Tools SDK with an older Xcode linker. If setup
cannot find that SDK, select a valid Xcode installation before continuing.

Review the configuration and initialize each checkout:

```sh
mise trust
mise install
mise run setup
```

`setup` prepares the pinned SBF platform-tools and installs both Git hook stages.
Initialize each checkout before contributing. Installation may download public
tool releases; it does not install OS packages or change your wallet/cluster
configuration. Local hooks are not server-side enforcement.

No shell activation is required for `mise run` or `mise exec`. Hooks invoke
`mise exec` explicitly, so commits made from a non-activated shell still use the
project's pinned tools. Keep mise itself available on `PATH`.

Before landing, run both mandatory gates, including for documentation changes:

```sh
mise run check
mise run verify
```

The pre-commit checks run these commands inside `mise exec`:

```sh
cargo fmt --all -- --check
cargo clippy --locked --all-targets --all-features -- -D warnings
cargo test --locked
cargo test --locked --features no-entrypoint
```

These checks also run at pre-push, alongside:

```sh
cargo test --locked --test e2e -- --ignored --nocapture
```

The ignored E2E test builds the SBF program with `-- --locked` and runs a local
validator; host tests alone do not exercise it. It downloads SAS from mainnet
unless `SAS_PROGRAM_SO` points to an existing, known SAS program binary. The SAS
spike probe (`mise run spike`) is a separate, opt-in check that issues a
credential/schema/attestation and validates the decoder and lifecycle; it is
**not** a required gate while its SAS binary is unpinned (see `docs/SAS_SPIKE.md`
§5).
Set that environment variable before running the gates to avoid the SAS
download (other missing dependencies or toolchains may still require network
access). See `README.md` for E2E setup details.

Hooks do not fix files automatically. If formatting fails, run
`mise run fmt` manually, review the diff, and stage only intended changes.
After any change or upstream integration, rerun both final gates on the clean
committed candidate. Missing prerequisites or failing checks block landing;
do not disable hooks or report incomplete verification as passing.

Use `mise run build` for the deployable artifact and `mise run e2e` for just the
validator smoke test. To run an individual Cargo command with the same tools,
use `mise exec -- cargo ...`. Update tool versions in `mise.toml` and rerun
installation, setup, and both gates together when upgrading the environment.

## Commit subjects

Use Conventional Commits:

```text
<type>[optional scope][!]: <imperative summary>
```

Choose the type that best describes the change:

| Type | Purpose |
| --- | --- |
| `feat` | New behavior or capability |
| `fix` | Correct existing behavior |
| `refactor` | Restructure code without changing behavior |
| `test` | Add or improve tests |
| `docs` | Documentation only |
| `build` | Dependencies, toolchains, or build configuration |
| `ci` | CI workflows |
| `chore` | Maintenance that does not fit another type |

### Writing rules

- Use lowercase types and scopes.
- Omit scope by default. Include it in parentheses only when it identifies a
  meaningful subsystem, such as `program`.
- Use an imperative summary: “add,” “fix,” or “remove,” not “added” or “adds.”
- Start the summary lowercase, omit the trailing period, and aim for a subject
  of 72 characters or fewer, including the type and scope.
- Describe the actual change. Avoid vague subjects such as “update code,”
  “address feedback,” or “misc fixes.”
- Mark breaking changes with `!` immediately before the colon and explain the
  incompatibility in a `BREAKING CHANGE:` commit footer.
- Each commit describes one coherent change. Exclude secrets, temporary files,
  and generated build artifacts.

### Examples

```text
feat(program): add minimal Pinocchio entrypoint
test(program): cover empty instruction data
build: update Pinocchio to 0.11.2
docs: document Solana build prerequisites
chore: add direct-to-main landing skill
feat(program)!: require a versioned instruction header
```
