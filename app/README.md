# UC1 admission demo

The website demonstrates admission to one private fund on a local, offline
surfnet. The fund accepts DE and FR evidence from one approved SAS issuer.
Alice Adler has a DE jurisdiction; Bob Brooks has a US jurisdiction. Both begin with frozen
fund accounts and no credentials.

The presenter switches between issuer and investor views. Issuance and activation
submit real transactions. The page reads credential and token-account state from
the chain. The server pays fees as a relayer, so no wallet extension is required.

The fictional provider Aster Identity holds the SAS credential authority key.
It creates the `Aster Identity` credential and `investor-jurisdiction` schema,
and authorizes a separate Aster Verification Desk key to issue attestations.
The fund operator and fee payer use a third key. The issuer cannot create schemas,
and the credential authority is not in the authorized issuer list.
This follows the [SAS data flow](https://solana.com/docs/tools/attestations/overview#data-flow).

The authority key is used only during seeding and is not saved in the web session.
Existing sessions must be reseeded after this role separation change.

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

The seed command deploys the built gate and the committed SAS and Token ACL
binaries. It checks dependency hashes against `tests/support/ids.rs` before
loading them. Only deployment and fee funding use surfnet cheatcodes. All fund,
policy, schema, status-record, and investor-account setup uses real instructions.

The demo uses `http://127.0.0.1:8899` by default. To use another local port, set
`DEMO_RPC_URL` in `app/.env.local` and start surfnet on that port. Both seeding and
the server read this variable. Remote networks are outside this demo's scope.

## Present UC1

1. In **Investor view**, select Alice and click **Activate account**. Missing
   evidence denies admission, and the account stays frozen.
2. Switch to **Issuer view** and click **Issue credential**. Wait for confirmation.
3. Return to **Investor view** and click **Activate account**. The account becomes
   active after the transaction confirms and the page reloads chain state.
4. Select Bob, issue his US credential, and request activation. The fund rejects
   his jurisdiction, and his account remains frozen.

The expandable chain details contain the confirmed transaction signature or the
rejection logs. Missing-evidence and jurisdiction failures are rejected during
transaction preflight, so those requests have no confirmed signature.

To repeat the presentation, rerun `mise run seed` and refresh the page. This creates
a fresh fund and new demo identities on the same local surfnet. Earlier accounts
remain on that surfnet but are no longer selected by the website.

Demo signing keys stay in the server's ignored `.demo/session.json`, written with
owner-only permissions. Role selection is a presentation control, not production
user authentication. The website binds to localhost and accepts actions only from
the same local origin.

## Verify

Run these commands from `app/` after building the gate:

```sh
mise run typecheck
mise exec -- npx playwright install chromium
mise run e2e
```

The browser test builds and runs the production website, starts an isolated
surfnet on port 18999, and serves the test website on port 3300. It seeds a separate
session under `.demo/e2e`, exercises the presentation, and checks the raw on-chain
token states for both investors. It also checks that the API exposes no signing
keys and rejects unsupported actions and foreign origins. Test services stop when
the suite ends. The regular demo session is preserved.

Run `mise run check` and `mise run verify` from the repository root for the Rust
checks, SBF build, and surfnet integration suite.

## Scope

This change exposes credential issuance and admission only. It adds no renewal,
revocation, freeze controls, block management, policy editing, second fund, or
wallet integration. Freshness and expiry are enforced by the existing gate, with
24-hour fixture values. Active accounts are not automatically frozen when their
credentials later expire.

## Code

- `scripts/seed.ts` creates a session through the pinned on-chain programs.
- `src/lib/server/chain.ts` contains wire encodings, PDA derivation, and RPC submission.
- `src/lib/server/demo.ts` reads the session and exposes chain-derived view data.
- `src/app/api/demo/route.ts` permits only issuance and admission for the two investors.
- `src/app/page.tsx` implements the presenter views.
- `tests/admission.spec.ts` verifies the live browser walkthrough.
