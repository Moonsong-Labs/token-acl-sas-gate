# Admission and credential lifecycle demo

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
<http://127.0.0.1:18488>. Every confirmed action (issuance, renewal, revocation,
freeze, status updates, admission, allocation) links to its transaction there: **View transaction** opens Studio
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
| `/issuer` | 3 · Issue, renew or revoke a credential | Issuer |
| `/compliance` | 7 · Sponsor freeze and wallet status controls | Fund operator |
| `/investor/lena` | 2 · Frozen → 4 · Granted → 5 · Withdrawn, with 8 · Access timeline | Investor |
| `/investor/mark` | 6 · Access denied | Investor |
| `/status` | Surfnet, programs and session | — |

The numbered screens follow the UC1 mockups. The credential authority screen is
not in the mockups; it shows the role split above. Withdrawal, compliance
actions, and the access timeline implement UC2.
Screen 9, the second fund, belongs to a later use case.

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

There is one credential per investor. Renewing an existing credential closes
and reissues its SAS account in one atomic transaction. The selected KYC date
sets the underlying verification time, so reissuance with old KYC can still be
denied for freshness. After revocation, use **Issue credential** to replace it.
To start the entire presentation over, rerun `mise run seed` and refresh the page.
This creates a fresh fund and new demo identities on the same
local surfnet. Earlier accounts remain on that surfnet but are no longer selected.

Demo signing keys stay in the server's ignored `.demo/session.json`, written with
owner-only permissions. Role screens are a presentation device, not production
user authentication. The website binds to localhost and accepts actions only from
the same local origin.

## Present UC2

Continue after Lena has been admitted and allocated MERID:

1. On `/issuer`, select Lena and click **Revoke credential**. Her SAS attestation
   closes. Her account stays active until the sponsor acts.
2. On `/compliance`, click Lena's **Freeze account**. Only the displayed token
   account freezes. Its balance remains, and Token-2022 refuses transfers.
3. On `/investor/lena`, request access. The closed evidence fails authentication.
4. On `/issuer`, issue replacement evidence. The account stays frozen until Lena
   requests access again. Valid evidence permits admission.
5. Freeze Lena again, then click **Add compliance hold**. Renew her credential on
   `/issuer`, then request access. The gate denies it with `Blocked · 5`.
6. Remove the compliance hold on `/compliance`, then request access. The gate admits
   the account if the evidence meets every other rule.

For expiry, issue or renew with **Valid until** set to two minutes, wait for it
on the network clock, then freeze and request access. The gate returns
`Expired · 9`. Expiry alone does not freeze an active account.

**Invalidate wallet** publishes a separate operator status under this fund.
It persists across reissuance. After reviewing replacement evidence, use
**Clear wallet invalidation** before requesting admission. Removing a compliance hold
preserves invalidation, and clearing invalidation preserves a compliance hold. The gate
returns `Invalidated · 11` when invalidation is the first failing status check.
A compliance hold prevents permissionless re-admission. It permits credential
issuance and renewal, and leaves active accounts usable until explicitly frozen.
The API action names `block` and `unblock`, the `blocked` state flag, and the
on-chain `Blocked` error code retain their protocol names.
Native SAS closure and wallet invalidation are distinct revocation sources.

The investor's access timeline reconstructs recent confirmed lifecycle actions
from RPC transaction history and links to Surfpool Studio. It survives page and
server reloads while the surfnet retains its history. It reads at most the most
recent 30 signatures for each of the token, evidence and wallet status accounts,
then examines the newest 30 unique successful transactions. It is not a complete
audit log. Refused preflight requests and expiry have no confirmed transaction.
If a history RPC read fails, the timeline shows an unavailable message. Current
account reads and enforcement actions remain available. Actions do not read
transaction history before submission. Refresh retries the optional timeline.
No detection service or one-hour enforcement guarantee is provided.

## Simulate a screening feed (UC3)

`mise run screen <hit|delist|lift> <lena|mark>` plays a screening feed from the
terminal, with the website running. It calls the gate's authorized status
instruction and Token ACL freeze, signed by the fund operator's key, which is the
authority in the mint's Token ACL config. It is a fixture, not a production adapter
service. The `/compliance` screen from UC2 writes the same wallet block by hand; the
feed is the scripted path to it.

After Lena is admitted (Present UC1, steps 1 to 4):

1. `mise run screen hit lena`: one transaction blocks her wallet and freezes her
   supplied token account. Refresh `/investor/lena`: the account is frozen, and the
   access timeline shows the screening hit.
2. Click **Request access**. The gate denies it with `Blocked · 5`, although her
   credential is genuine and current, and renewing it on `/issuer` does not help.
   Running `hit` again sends nothing.
3. `mise run screen delist lena`: she is off the list. This writes nothing; it only
   reports that a review is due. Requesting access is still denied.
4. `mise run screen lift lena`: the review outcome lifts the block. The account
   stays frozen until she requests access again, which now succeeds.

A hit and a delisting are separate events: only an authorized lift clears a block.
The block is on the wallet under this fund, so it also covers any new token account
she opens. The invalidation flag is preserved by every write. The script reads it
and writes it back, so do not run it while a website action is in flight. Only the
supplied token account freezes; discovering every account of a wallet is out of scope.

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

The browser test builds and runs the production website, starts an isolated
surfnet on port 18999, and serves the test website on port 3300. It seeds a
separate session under `.demo/e2e` and walks both presentations above across the
operator, authority, issuer and investor screens. It checks the seeded roles on-chain (the
credential's authority, its single authorized signer, and each attestation's
signer), the raw token states for both investors, that no screen scrolls horizontally at phone
width, that the API exposes no signing keys, and that it rejects unsupported
actions and foreign origins. A test-only RPC proxy on port 19001 injects failures
in `getSignaturesForAddress` and `getTransaction`. Two regression cases verify
that current state, sponsor freeze, revocation, compliance-hold updates and
re-admission still work, and that Refresh restores the timeline after recovery.
`tests/screening.spec.ts` runs the UC3 screening script against the same session
and checks, through the demo API, that a hit holds and freezes in one transaction,
repeats and delistings send nothing, renewal cannot clear the hold, only a lift
does, a lift reports whether the account stays frozen or active, and the
invalidation flag is preserved.
Test services stop when the suite ends. The Rust
integration suite also checks real transfers before revocation, after
revocation, after sponsor freeze, and after restoration, including the retained
balance and a second account outside the supplied freeze scope. The regular
demo session is preserved.

Run `mise run check` and `mise run verify` from the repository root for the Rust
checks, SBF build, and surfnet integration suite.

## Scope

The demo exposes UC1 admission and UC2 lifecycle controls. It adds no automated
monitoring, screening-feed integration, policy editing, issuer management, second
fund, or wallet integration. The operator manually supplies the displayed account
for freezing. Role screens remain local presentation controls, not production
authentication. Active accounts are not automatically frozen when their
credentials later expire.

## Code

- `scripts/seed.ts` creates a session through the pinned on-chain programs.
- `src/lib/server/chain.ts` contains wire encodings, PDA derivation, and RPC submission.
- `src/lib/server/accounts.ts` decodes the mint, Token ACL config, token accounts,
  SAS credential, schema and attestation, and the gate policy.
- `src/lib/server/demo.ts` reads the session, builds the chain-derived snapshot and
  runs the demo actions.
- `src/app/api/demo/route.ts` permits only the listed lifecycle, admission and
  allocation actions for the two investors; `src/app/api/status/route.ts` reports network status.
- `src/lib/gate.ts` maps a gate error code onto its ordered checks.
- `src/lib/client.tsx` holds the snapshot for the screens; `src/app/*` are the screens.
- `tests/admission.spec.ts` verifies the live browser walkthrough.
