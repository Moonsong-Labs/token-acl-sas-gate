# doors-of-durin

A Solana [Token ACL](https://github.com/solana-foundation/token-acl) (sRFC37) gate
program, built with [Pinocchio](https://docs.rs/pinocchio/0.11.2), that admits
investors to a regulated Token-2022 token based on a
[Solana Attestation Service](https://solana.com/docs/tools/attestations/overview)
(SAS) credential. Token ACL calls the gate before a permissionless thaw; the gate
allows the thaw only when the token account's owner holds current SAS evidence
that meets the mint's policy.

![Live demo: Lena R.'s account admitted, with every gate check passed](docs/images/screenshots/06-investor-lena-admitted.png)

*The UC1 demo running against a local surfnet: Lena R.'s account was admitted
after the gate passed each check, in the order it runs them.*

## The problem

A tokenized private fund must restrict who can hold its token. The usual control
is a per-fund list of eligible wallets, maintained by hand. This project replaces
that list, as the control of record, with a policy check against a reusable KYC
credential the investor already holds. One credential can serve a family of
funds, while each fund keeps its own rules.

The defensible claim is narrow: the gate rejects permissionless admission without
accepted evidence under the configured policy. Mis-admission through bad
attestations, stale thawed accounts, or administrative override remains possible.

## How it works

The project integrates two existing primitives and invents neither:

- **Token ACL** holds the mint's freeze authority. New token accounts start
  frozen (`DefaultAccountState = Frozen`). Token ACL lets anyone request a
  permissionless thaw, and calls the mint's configured gate program to decide.
- **SAS** holds the credential: an attestation under a credential and schema,
  with an expiry and serialized claims. Revocation closes the attestation.
- **The gate** (this program) stores each mint's policy and decides the thaw.
  It reads the attestation at thaw time and copies nothing from it.

```mermaid
sequenceDiagram
    participant C as Investor or relayer
    participant ACL as Token ACL
    participant G as Gate (this program)
    participant SAS as SAS attestation
    participant T as Token-2022
    C->>ACL: ThawPermissionless(token account)
    ACL->>ACL: Resolve the gate's discovery list
    ACL->>G: CanThawPermissionless
    G->>SAS: Read the attestation for the current owner
    G->>G: Check status flags, schema, subject, expiry, freshness, issuer, claims
    G-->>ACL: Allow, or deny with a distinct error code
    ACL->>T: Thaw the account (only when allowed)
```

**Subject binding.** SAS has no subject field, so the issuer sets the
attestation's `nonce` to the investor wallet. The gate derives the attestation
address from the policy's credential, schema, and the token account's current
owner, and requires the account to carry the `ImmutableOwner` extension, so a
later owner change cannot carry the admission to another wallet. The caller does
not need to be the owner: a relayer can submit the thaw.

**Policy.** Each mint accepts one SAS credential and one schema version, a set of
one to eight jurisdictions, and an optional maximum age measured from the
credential's `verified_at` field. The gate also reads two status records, for the
wallet and for the token account, which carry an explicit block flag and an
invalidation flag set by the mint's current Token ACL authority. A missing record
denies admission.

**Decisions on thaw only.** The gate decides permissionless thaw and nothing
else; it rejects the freeze callback. It performs no additional invocation on
transfers between thawed accounts. That does not make transfers unrestricted: a
frozen account cannot send or receive, and Token ACL's permissioned
administrative freeze and thaw remain available to the freeze authority. An
account that is already active is not re-checked, and is not frozen
automatically when its credential later expires.

Every policy denial returns a distinguishable error code. Failures that are not
policy decisions surface as Token ACL or runtime errors instead: for example, an
omitted discovery-list entry fails during Token ACL's account resolution, before
the gate runs. The full protocol is in [docs/ADMISSION.md](docs/ADMISSION.md).

## Roles

| Role | In the demo | Does |
| --- | --- | --- |
| Credential authority | KYC Trust Registry | Creates the SAS credential and schema, and authorizes issuers as its signers |
| Issuer | Acme KYC | Verifies the investor off-chain and writes the attestation, with `nonce` set to the investor wallet |
| Fund operator | Meridian EU Retail (MERID) | Creates the mint, hands its freeze authority to Token ACL, configures the gate's policy, and sets status flags |
| Investor | Lena R. (DE), Mark T. (US) | Holds the token account and requests admission, directly or through a relayer |

A policy accepts the authority's credential, so it accepts evidence from any
issuer the authority has authorized. The gate does not check which signer
created the attestation, because SAS supports signer rotation.

## Status

**UC1, credential-based admission to a private fund, is implemented.** The gate
configures per-mint policies, maintains block and invalidation status records,
publishes the standard thaw discovery list, and decides permissionless thaw. It
denies expired, stale, closed (revoked), wrong-schema, wrong-subject,
wrong-credential, and out-of-region evidence. The integration suite exercises it
with real SAS issuance and Token ACL thaws on a local surfnet, and the web demo
in [`app/`](app/README.md) presents the same flow.

**UC2, the credential lifecycle, is implemented.** The demo supports native SAS
revocation, atomic close-and-reissue renewal, sponsor freeze of a supplied token
account, compliance hold and invalidation controls, and re-admission. A recent
transaction timeline records withdrawal and restoration from chain history.
Integration tests prove that revocation alone permits transfers, sponsor freeze
stops them while retaining the balance, and valid renewal restores admission
only after compliance holds and wallet invalidation are cleared.

**Later use cases are not implemented.** These include screening-feed
integration, multi-issuer trust tiers, and the second-mint policy fixture. The schema
is a test fixture; no external compliance provider integration or cluster
deployment is configured. See [docs/USE_CASES.md](docs/USE_CASES.md) and
[docs/SCOPE.md](docs/SCOPE.md) for the planned scope.

## Demo

The demo website runs the real gate, SAS, and Token ACL programs on an offline
local surfnet. Every fact on its screens is read from chain state, and every
decision is the gate's own. The fund accepts investors from Germany or France
whose KYC was completed within the last 365 days. Setup and run instructions are
in [app/README.md](app/README.md).

| Fund setup | Mark T. denied on region |
| --- | --- |
| ![Fund setup screen: four readiness steps complete, the fund's policy, and MERID allocation](docs/images/screenshots/02-operator-fund-setup.png) | ![Mark T.'s account stays frozen: every check passes except the region check, code Claim 13](docs/images/screenshots/08-investor-mark-denied-region.png) |
| The operator's view of Meridian EU Retail, read from chain. | A genuine, current US credential refused by the fund's region rule (`Claim · 13`). |

<details>
<summary>More screenshots of the demo</summary>

| Screenshot | Shows |
| --- | --- |
| ![Overview screen of the demo](docs/images/screenshots/01-overview.png) | **Overview** (`/`): the roles and screens. |
| ![Credential authority screen listing Acme KYC as an authorized issuer](docs/images/screenshots/03-authority.png) | **Credential authority** (`/authority`): the KYC Trust Registry credential, schema, and authorized issuers. |
| ![Lena R.'s request refused because no credential is on file](docs/images/screenshots/04-investor-lena-refused-no-credential.png) | **Investor, before issuance** (`/investor/lena`): no genuine credential for the wallet (`Owner · 2`); the account stays frozen. |
| ![Issuer screen after issuing Lena R. a credential](docs/images/screenshots/05-issuer-credential-issued.png) | **Issue credential** (`/issuer`): Acme KYC issues Lena R. a DE credential, valid 12 months. |
| ![Fund setup screen after 25,000 MERID were allocated to Lena R.](docs/images/screenshots/07-operator-allocation-received.png) | **Allocation** (`/operator`): once admitted, Lena R.'s account receives 25,000 MERID. |
| ![Network status screen](docs/images/screenshots/09-network-status.png) | **Network status** (`/status`): surfnet, deployed programs, and session. |
| ![Lena R.'s admitted account at phone width](docs/images/screenshots/10-phone-investor-lena.png) | **Phone width** (390 px): Lena R.'s active account holding 25,000 MERID. |

</details>

### Mockups

The demo screens follow a set of UI mockups covering the full MVP arc. Screens 1
to 8 are built. Screen 9, the second fund, describes planned behavior.

![Mockup of the screen flow, from fund setup to admission, denial, and the later compliance loop](docs/images/mockups/00-screen-flow.png)

*Mockup: screen flow. Withdrawal, compliance actions, and the access timeline
are part of UC2. The two-fund screen is a later use case.*

<details>
<summary>All mockups</summary>

| Mockup | Title | Status |
| --- | --- | --- |
| ![Mockup: overview by role](docs/images/mockups/00-overview.png) | Overview | Built |
| ![Mockup: fund setup](docs/images/mockups/01-fund-setup.png) | 1 · Fund setup | Built |
| ![Mockup: account locked](docs/images/mockups/02-account-locked.png) | 2 · Account locked | Built |
| ![Mockup: issue and withdraw credential](docs/images/mockups/03-issue-and-withdraw-credential.png) | 3 · Issue & withdraw credential | Built |
| ![Mockup: access granted](docs/images/mockups/04-access-granted.png) | 4 · Access granted | Built |
| ![Mockup: access withdrawn](docs/images/mockups/05-access-withdrawn.png) | 5 · Access withdrawn | Built |
| ![Mockup: access denied](docs/images/mockups/06-access-denied.png) | 6 · Access denied | Built |
| ![Mockup: compliance actions](docs/images/mockups/07-compliance-actions.png) | 7 · Compliance actions | Built for UC2; feed integration later |
| ![Mockup: access timeline](docs/images/mockups/08-access-timeline.png) | 8 · Access timeline | Built |
| ![Mockup: two funds, one credential](docs/images/mockups/09-two-funds-one-credential.png) | 9 · Two funds, one credential | Later (UC5) |

</details>

## Documentation

| Document | Contents |
| --- | --- |
| [docs/ADMISSION.md](docs/ADMISSION.md) | UC1 protocol reference: fund setup steps, policy and evidence rules, PDAs and account layouts, instructions, and error codes |
| [docs/SCOPE.md](docs/SCOPE.md) | Project goal, what the primitive does and does not do, MVP boundary, and success criteria |
| [docs/USE_CASES.md](docs/USE_CASES.md) | Business use cases UC1 to UC6, the reference model, the MVP demo arc, and the data policy |
| [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) | Toolchain pins, discovery-list design, the gate predicate, test matrix, build order, and risks |
| [docs/SAS_SPIKE.md](docs/SAS_SPIKE.md) | SAS findings: account layouts, expiry and revocation semantics, authenticity checks, and the subject-binding decision |
| [app/README.md](app/README.md) | The UC1 and UC2 web demo: parties, local setup, screens, presentation script, and browser tests |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Prerequisites, required checks, Git hooks, review and landing, and commit conventions |

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

The program has no baked-in deployment address. The integration suite and the
demo deploy it at a test-only address defined in `tests/support/ids.rs`.

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
Solana CLI configuration. Executable instruction builders for the complete UC1
setup and admission flow are in `tests/support/admission.rs`.

## Layout

- `src/lib.rs`: instruction dispatch, authority checks, state setup, and thaw callback.
- `src/state.rs`: policy, SAS schema, attestation, and claim decoding.
- `src/metas.rs`: standard Token ACL account discovery list.
- `tests/e2e.rs`: opt-in surfnet integration suite.
- `tests/support/`: harness — surfnet lifecycle, cheatcodes, outcome
  attribution, pinned program IDs, SAS instruction builders, and UC1 setup.
- `tests/fixtures/programs/`: pinned SAS and Token ACL binaries.
- `app/`: the admission and lifecycle demo website, with its own `mise.toml`; see
  [app/README.md](app/README.md).
- `docs/`: scope, use cases, implementation notes, SAS findings, the UC1
  protocol reference, and the README images.
- `Cargo.toml`: library configuration and Pinocchio dependency.
- `mise.toml`: pinned tools, SBF compiler version, and development tasks.

The `no-entrypoint` feature allows other crates to depend on the processor
without exporting the Solana entrypoint.

## License

Licensed under the [MIT License](LICENSE). Copyright (c) 2026 Moonsong Labs Inc.
