# Token ACL Gate Program — Scope (rev 6)

**Goal.** A custom **Token ACL Gate Program** (sRFC37) that resolves a Solana Attestation
Service (SAS) credential for a wallet and decides whether that wallet may **thaw** its token
account — i.e. receive and transact a regulated Token-2022 token. Integration between two
existing primitives; we invent neither side.

**The seam.** Token ACL gives gate programs an extension point for on-chain identity/KYC; SAS
gives reusable KYC and accreditation credentials. Wiring them into working admission control
is the project. Value does not depend on being first.

Detail lives in `IMPLEMENTATION.md` (toolchain, full gate predicate, test matrix, second-mint
fixture, build order, risks) and the business rationale in `USE_CASES.md`.

---

## What the primitive does and does not do

- Gate logic runs on **freeze/thaw only**, never per transfer. This MVP implements the **thaw
  callback**; sRFC37 also supports permissionless freezing, and Token ACL retains permissioned
  administrative freeze/thaw for the freeze authority.
- `create-config` moves the mint's **freeze authority to the `MintConfig` PDA** and names our
  gate. `MintConfig` *selects/configures* the gate; **our program owns per-mint policy state**.
- Required: **`DefaultAccountState = Frozen`**. `MetadataPointer` + `TokenMetadata`
  (`token_acl` = gate address) is for **wallet/SDK discovery, not enforcement**.
- Setup must also **initialise the extra-metas account** and **enable permissionless thaw**.
  sRFC37 fixes the discovery address convention and the permissionless-operation flags;
  initialisation itself is left to the gate implementation (`IMPLEMENTATION.md` §2).
- Freezing stops **usage**; a frozen account can **retain a balance**. Accurate claim: **the
  gate performs no additional invocation on transfers between thawed accounts.**
- **Correct subject binding, not caller restriction.** Permissionless thaw does not require the
  caller to own the account, so relayers are valid. The security property is that the evidence
  must belong to the **target account's owner** — which requires the **`ImmutableOwner`**
  extension, since checking the current owner alone does not prevent a later reassignment
  (`IMPLEMENTATION.md` §4). Owner-consent signing would be a further product decision; nothing
  here assumes it. **Mechanism (spike):** SAS has no `subject` field, so the subject is the
  attestation's `nonce` (issuer sets `nonce = subject wallet`). `token_account` is **not** the
  subject and **not** an asset restriction — it is the recipient of a tokenized attestation
  (zeros otherwise), and must not be compared against the thawed account. See
  `IMPLEMENTATION.md` §4.3 / `SAS_SPIKE.md` §7.

**Two denial conditions — semantically separate, not necessarily both stored.**

| Condition | Meaning | Resolution |
| --- | --- | --- |
| **Credential invalidity** | expired / revoked / wrong schema / non-allowlisted issuer | valid replacement evidence restores eligibility |
| **Explicit compliance block** | wallet prohibited regardless of credentials | authorized actor removes the block |

Evaluate block → validity, after authenticating the accounts the decision reads. **Derive
credential validity from current evidence where possible**; persist separate invalidation state
only where derivation is impossible or too expensive. Duplicating evidence into policy storage
creates stale copies that drift.

**Freeze scope.** The MVP freezes an **explicitly supplied account set**, supplied by the
sponsor/compliance operator. Discovering every account of a wallet across all mints is a later
indexer extension — so "freezes everything" is not a claim we make.

## MVP boundary (identical in `USE_CASES.md`)

| MVP | Later extensions |
| --- | --- |
| One accepted schema and test issuer | Multiple provider schemas and trust tiers |
| Two mints with deliberately different simple policies | Rich jurisdiction/classification rules |
| Issue, invalidate/revoke, renew — implemented, not just understood | Real screening-feed integration |
| Explicit block with authorized add/remove | Production adapter operations |
| Sponsor-triggered freeze | Automated detection and account monitoring |
| Core lifecycle and binding tests | Named DEX integration |

**Data policy.** The SAS account holds the attestation; it is readable on-chain, and we do not
copy it. Our program persists only **policy state**: issuer allowlists, per-mint predicates,
explicit blocks, and any invalidation records that cannot be derived from evidence. The gate
**reads** claim values at thaw time and retains nothing from them. **Supporting documents are
not stored by the gate program, the SAS schemas this project uses, or the demo tooling**;
evidence storage at the **credential provider** sits outside this project (and the
institutional-reliance use case explicitly depends on reaching it). Claims under evaluation
(jurisdiction, investor classification) are sensitive in themselves; before launch, state which
are treated as publicly readable on-chain and which stay off-chain.

**Errors.** Policy denials **handled by our gate** return distinguishable codes. Failures that
occur before our gate runs — missing accounts, account-resolution and deserialization errors —
surface as recognizable Token ACL / SDK / runtime errors instead. Matrix: `IMPLEMENTATION.md` §5.

**Out of scope.** Deciding who qualifies (the issuer's determination) · automated detection or
monitoring of adverse events · off-chain revocation oracles (interface only) · Transfer Hook or
custody-based trading controls · regulator reporting · primary-offer allocation · non-Token-2022
standards · clawback / `Permanent Delegate` · Reg S / offshore eligibility until evidence and
limits are specified · **DEX integration (post-MVP milestone)**.

## Success criteria

- Eligibility changes because **credentials, time (expiry compared against on-chain Unix time),
  policy or blocks** changed — with **no manually maintained investor allowlist**, though
  freeze/thaw transactions remain the enforcement mechanism.
- Identical credentials **succeed on mint A and fail on mint B**, differing only in policy predicate.
- An explicit block **survives a valid renewed credential from the same issuer**, and is lifted
  only by an authorized block removal. (A different-issuer precedence test belongs to the
  multi-issuer extension.)
- Every denial our gate evaluates carries a **distinguishable code**.
- **No additional gate invocation occurs during transfers between thawed accounts.** No
  composability claim is made beyond that sentence; named-DEX integration is deferred.

**Risks.** The SAS spike is **done** — it resolved the **SAS version and lifecycle questions**
(layout, expiry, revocation-by-closure, no native supersession) and measured account size. The
**Token ACL** spike and **authority correctness** remain — the latter established by
implementation and testing, not by the spike. Highest items: `IMPLEMENTATION.md` §9.
