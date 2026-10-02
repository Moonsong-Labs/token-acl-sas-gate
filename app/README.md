# UC1 admission demo

The website demonstrates admission to one private fund, **Meridian EU Retail**
(MERID), on a local, offline surfnet. It runs the real gate, Solana Attestation
Service (SAS) and Token ACL programs. Every fact on the screens is read from chain
state, and every decision is the gate's own.

The fund accepts investors from Germany or France whose KYC was completed within
the last 365 days. Lena R. has a DE jurisdiction; Mark T. has a US jurisdiction.
Both begin with frozen fund accounts and no credentials.

## Parties

The demo keeps four roles on separate keys, following the SAS model:

| Role | Who | Signs |
| --- | --- | --- |
| Credential authority | KYC Trust Registry | Creates the SAS credential and schema, and registers issuers as the credential's authorized signers |
| Issuer | Acme KYC | Creates attestations, as an authorized signer of the credential |
| Fund operator | The seed's payer | Owns the mint and the Token ACL config; configures the gate policy; mints MERID |
| Investors | Lena R., Mark T. | Hold the token accounts being admitted |

The fund's policy accepts the registry's **credential**. It therefore accepts a
record from any issuer the registry authorizes; the gate does not check which
issuer signed. The authority's key signs once, during seeding, and is not stored.
The server keeps the operator and issuer keys so it can relay their actions.

This follows the [SAS data flow](https://solana.com/docs/tools/attestations/overview#data-flow).
SAS itself enforces the split: the issuer cannot create schemas, and the
authority is not an authorized issuer, so it cannot sign attestations.
`uc1_separates_credential_authority_and_attestation_issuer` in `tests/e2e.rs`
checks both against the pinned SAS program.

Sessions seeded before this role separation must be reseeded with
`mise run seed`. The app says so when it loads one.

## Run locally

Build the gate from the repository root:

```sh
mise run build
```

From `app/`, install the pinned toolchain and web dependencies:

```sh
mise install
mise run deps
```

Start the offline surfnet in a separate terminal from `app/`:

```sh
mise run surfnet
```

Then create a demo session and start the website, also from `app/`:

```sh
mise run seed
mise run dev
```

Open <http://127.0.0.1:3000>.

The surfnet also serves **Surfpool Studio**, its local explorer, at
<http://127.0.0.1:18488>. Every confirmed action (issuance, admission,
allocation) links to its transaction there: **View transaction** opens Studio
on that signature, with the instructions, compute units, account changes and
logs. Refused requests have no link, because they fail in preflight and never
reach the chain. If Studio runs elsewhere, set `DEMO_STUDIO_URL` in
`app/.env.local`.

The seed command deploys the built gate and the committed SAS and Token ACL
binaries. It checks dependency hashes against `tests/support/ids.rs` before
loading them. Only deployment and fee funding use surfnet cheatcodes. All fund,
policy, credential, schema, status-record, and investor-account setup uses real
instructions.

The demo uses `http://127.0.0.1:8899` for the RPC by default. To use another local port, set
`DEMO_RPC_URL` in `app/.env.local` and start surfnet on that port. Both seeding and
the server read this variable. Remote networks are outside this demo's scope.

## Screens

| Route | Screen | Role |
| --- | --- | --- |
| `/` | Overview | — |
| `/operator` | 1 · Fund setup, and MERID allocation | Fund operator |
| `/authority` | Credential, schema and authorized issuers | Credential authority |
| `/issuer` | 3 · Issue a credential | Issuer |
| `/investor/lena` | 2 · Account frozen → 4 · Access granted | Investor |
| `/investor/mark` | 6 · Access denied | Investor |
| `/status` | Surfnet, programs and session | — |

The numbered screens follow the UC1 mockups. The credential authority screen is
not in the mockups; it shows the role split above. Screens 5, 7, 8 and 9 of the
mockups (withdrawal, compliance actions, the access timeline and the second fund)
belong to later use cases and are not in this build.

The investor screen's check list shows the gate's checks in the order `can_thaw`
runs them. The gate returns a single error code and stops at the first failure,
so one code is enough to show which checks passed, which failed and which never
ran (`src/lib/gate.ts`). A refusal while authenticating the inputs, such as having
no credential at all, is shown separately from a policy denial: in that case none
of the fund's rules were checked.

## Present UC1

1. **`/operator`**: all four setup steps read from chain, and the fund's policy.
   Click **Allocate 25,000** for Lena. Token-2022 refuses: a frozen account cannot
   receive tokens.
2. **`/investor/lena`**: click **Request access**. The gate finds no genuine
   credential for the wallet (`Owner · 2`), and the account stays frozen.
3. **`/issuer`**: issue Lena a credential (KYC completed today, valid 12 months).
4. **`/investor/lena`**: request access again. Every check passes and the account
   becomes active. Allocate on `/operator` now succeeds.
5. **`/issuer`** then **`/investor/mark`**: issue Mark's US credential and request
   access. The credential is genuine and current, but the gate refuses it on
   region (`Claim · 13`).

Other outcomes, all from the issuer screen after reseeding:

| To show | Issue with | Gate code |
| --- | --- | --- |
| Stale KYC | **KYC completed** 2 years ago | `Freshness · 10` |
| Expired credential | **Valid until** 2 minutes, then request access after it lapses | `Expired · 9` |

SAS refuses an attestation whose expiry has already passed, so an expired
credential has to lapse on the network's clock. That clock is roughly wall time.

There is one credential per investor. Renewal (close and reissue) belongs to the
lifecycle use case, so to repeat the presentation, rerun `mise run seed` and
refresh the page. This creates a fresh fund and new demo identities on the same
local surfnet. Earlier accounts remain on that surfnet but are no longer selected.

Demo signing keys stay in the server's ignored `.demo/session.json`, written with
owner-only permissions. Role screens are a presentation device, not production
user authentication. The website binds to localhost and accepts actions only from
the same local origin.

## Verify

Run these commands from `app/` after building the gate:

```sh
mise run typecheck
mise exec -- npx playwright install --with-deps chromium
mise run e2e
```

`--with-deps` also installs the system libraries Chromium needs on Linux
(`libnss3`, `libnspr4`, `libasound2`), which requires `sudo`. Without them the
browser fails to start.

The browser tests build and run the production website, start an isolated
surfnet on port 18999, and serve the test website on port 3300. The website
reaches the surfnet through a test-only proxy on port 18998 that can be told to
fail chosen RPC calls. The tests seed a separate session under `.demo/e2e`.

- `tests/admission.spec.ts` walks the presentation above across the operator,
  authority, issuer and investor screens. It checks the seeded roles on-chain
  (the credential's authority, its single authorized signer, and each
  attestation's signer), the raw token states for both investors, that no screen
  scrolls horizontally at phone width, that the API exposes no signing keys, and
  that it rejects unsupported actions and foreign origins.
- `tests/resilience.spec.ts` uses the proxy to check how outcomes are reported
  when the RPC misbehaves: an error on sending is only a rejection when its
  code says the node refused the transaction; otherwise, as when its
  confirmation cannot be read, the outcome is confirmed by polling or reported
  as unconfirmed with its signature, never as rejected. A gate denial survives
  a failed read after it, and errors do not linger.
- `tests/units.spec.ts` checks the pure helpers without a browser.

Test services stop when the suite ends. The regular demo session is preserved.

Run `mise run check` and `mise run verify` from the repository root for the Rust
checks, SBF build, and surfnet integration suite.

## Scope

This change exposes the UC1 screens: fund setup, the credential authority,
issuance, admission and allocation. It adds no renewal, revocation, freeze
controls, block management, policy editing, issuer management, second fund, or
wallet integration. Active accounts are not automatically frozen when their
credentials later expire.

## Code

- `scripts/seed.ts` creates a session through the pinned on-chain programs.
- `src/lib/server/chain.ts` contains wire encodings, PDA derivation, and RPC submission.
- `src/lib/server/accounts.ts` decodes the mint, Token ACL config, token accounts,
  SAS credential, schema and attestation, and the gate policy.
- `src/lib/server/demo.ts` reads the session, builds the chain-derived snapshot and
  runs the demo actions.
- `src/app/api/demo/route.ts` permits only issuance, admission and allocation for
  the two investors; `src/app/api/status/route.ts` reports network status.
- `src/lib/gate.ts` maps a gate error code onto its ordered checks.
- `src/lib/client.tsx` holds the snapshot for the screens; `src/app/*` are the screens.
- `tests/admission.spec.ts` verifies the live browser walkthrough.
