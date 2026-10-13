# Use Cases — Token ACL Gate Program (rev 6)

**TL;DR:** A custom **Token ACL Gate Program** decides whether a wallet may **thaw** its token  
account — i.e. receive and transact a regulated Token-2022 token — based on a Solana Attestation  
Service (SAS) credential. Credentials are reusable, and subject to renewal, expiry and revocation.  
Companions: `SCOPE.md` (scope, MVP boundary, success criteria) · `IMPLEMENTATION.md` (toolchain,  
authoritative gate predicate §4, fixtures, test matrix, build order, risks).  
The demo implements credential admission, credential lifecycle, screening blocks,
and a second-mint policy fixture. Institutional onboarding and richer distribution
rules remain later extensions.

* * *

## Reference model

Token ACL (sRFC37) gates the **holder set**, not transfers.

1.  **Mint** — `DefaultAccountState = Frozen`; `MetadataPointer` + `TokenMetadata`  
    (`token_acl` = gate address) for **wallet/SDK discovery only, not enforcement**.
    
2.  **Bind** — `create-config` moves freeze authority to the Token ACL `MintConfig` PDA and names  
    our gate. `MintConfig` _selects_ the gate; **our program owns per-mint policy state**.
    
3.  **Setup** — our gate's **extra-metas account** is initialised at the interface-standard PDA  
    and **permissionless thaw** is enabled. Without both, the investor-facing path doesn't exist  
    (`IMPLEMENTATION.md` §2).
    
4.  **Issue** — approved issuer writes a SAS attestation (subject = investor wallet). SAS has no  
    `subject` field, so the subject is carried in the attestation's `nonce` — the issuer sets  
    `nonce = investor wallet` (`IMPLEMENTATION.md` §4.3).
    
5.  **Thaw** — investor (or a **relayer**) calls `thaw-permissionless`; Token ACL CPIs our gate,  
    which validates the evidence and allows or denies. Thawed accounts receive tokens and perform  
    ordinary token operations.
    
6.  **React** — sponsor runs `token-acl freeze` on an **explicitly supplied set of token**  
    **accounts** (freeze scope below).
    

**Subject binding, not caller restriction.** Permissionless thaw does not require the caller to  
own the account, so relayers are legitimate. The property we enforce is that the **evidence must**  
**belong to the target account's owner**. Owner-consent signing would be an additional product  
decision and is not assumed anywhere in these docs.  
**Two denial conditions — semantically separate, not necessarily both stored.**
| Condition | Meaning | Resolution |
| --- | --- | --- |
| **Credential invalidity** | expired / revoked / wrong schema / non-allowlisted issuer | valid replacement evidence restores eligibility |
| **Explicit compliance block** | wallet prohibited regardless of credentials | authorized actor removes the block |

Missed refresh ⇒ first. Sanctions hit ⇒ second. **Evaluate: block → credential validity.** Derive  
validity from current evidence where possible; persist invalidation state only where derivation  
isn't feasible. Duplicating evidence into policy storage creates stale copies.  
**Freeze scope.** The MVP freezes an **explicitly supplied account set**; the sponsor/compliance  
operator supplies it. Automatically discovering **every** account of a wallet across all mints is  
an indexer/monitoring extension — the MVP does not promise completeness there, and should not be  
described as "freezes everything".  
**Other boundaries**

*   The gate performs **no additional invocation on transfers between thawed accounts**. Not  
    "transfers are unrestricted": frozen accounts do block transfers.
    
*   Freezing stops **usage**; a frozen account can **retain an existing balance**.
    
*   Token ACL retains permissioned administrative freeze/thaw; "deny wins" describes **our gate's**  
    **decision**, not a limit on admin authority. sRFC37 also supports permissionless _freezing_;  
    this MVP implements the **thaw callback only**.
    
*   **Preserve the admitted-account ↔ credential-wallet binding.** Both parts are required and they  
    are not interchangeable: **require the** `ImmutableOwner` **extension** _and_ **verify the current  
    token-account owner matches the attestation subject**. Checking the current owner alone does  
    not prevent a later owner reassignment; `ImmutableOwner` is what prevents it. ATAs get the  
    extension automatically, **separately created accounts need explicit handling**. Never assume  
    every token account is an ATA.
    

* * *

## 1. Credential-based admission to a private fund — _MVP core_

**Story.** A manager tokenizes a private credit fund and wants admission decided by whether the  
wallet presents evidence the fund's policy accepts — one reusable credential across the fund  
family, issued by an existing compliance vendor, instead of a per-fund eligible-wallet  
spreadsheet.  
**Gate.** One explicit admission policy. Allow thaw iff the account is an **authentic SAS**  
**attestation account** (correct owning program) of an **accepted schema + version**; its  
**subject matches the current owner of the token account being thawed** and that account carries  
`ImmutableOwner`; it is within its **explicit** `expiry` **(Unix seconds, compared against**  
**on-chain Unix time)** _and_ any additional freshness limit measured from the policy-designated  
age field; applicable **revocation/invalidation** checks pass; the issuer is **allowlisted**  
(trust tiers are post-MVP); the policy account is **derived rather than trusted as supplied**; the  
**decoded claim values satisfy the mint's conditions** — schema membership alone suffices only  
where the schema's issuance semantics explicitly mean "qualification passed"; and **no explicit**  
**block** applies. Authoritative predicate: `IMPLEMENTATION.md` §4.  
Qualified-purchaser evidence is **not** an interchangeable alternative: Rule 506(c) accredited  
investor and QP status answer different regulatory questions. QP belongs to the second, stricter  
policy described in section 5.
**Why.** _Business:_ removes the hand-maintained list as the control of record. Defensible claim  
only: the gate **rejects permissionless admission without accepted evidence under the configured**  
**policy** — mis-admission via bad attestations, stale thawed accounts or admin override remains  
possible. _Engineering:_ proves the seam — extra metas, issuer allowlisting, schema matching,  
predicates.  
**MVP boundary.** Credential admission establishes the **first fund and its admission policy**: one policy, one
test issuer. The overall MVP then adds a **second mint as a deliberately simple policy fixture**  
(`IMPLEMENTATION.md` §6) so that policy is the only variable. Reg S / offshore eligibility
stays out until its evidence and limits are specified.

## 2. Credential lifecycle — renewal, expiry, revocation, re-gating — _demo centrepiece_

**Story.** Accreditation lapses, a refresh deadline is missed, or a wallet is sanctioned.  
Compliance wants to act within the hour and evidence when access was withdrawn and restored.  
**The one-hour figure is a business target, not an MVP guarantee:** with detection out of scope,  
event-to-enforcement timing depends on a human triggering the freeze.  
**Gate.** **Prospective validation + sponsor-initiated freezing.** Prospective: an invalid  
credential makes denial **non-re-thawable**. Active: `token-acl freeze` on the supplied accounts,  
since a thawed account otherwise keeps transacting. Renewal restores access with no issuer-side  
ticket — **unless an explicit block applies**. Implementing the lifecycle (issue, revoke/invalidate,  
renew, and the gate's validation of that state) is a build deliverable in its own right, separate  
from learning its semantics (`IMPLEMENTATION.md` §7 step 5).  
**Revocation has two possible sources — keep them distinct.** _Native SAS revocation/closure_ in  
the pinned version, and **adapter-published invalidation** in our program's state. An  
authenticated on-chain invalidation record can also block re-thaw, so losing native revocation  
would not reduce this to "just a freeze demo". Invalidation **granularity** — attestation  
instance vs claim vs wallet — is a spike decision with direct consequences for whether renewal  
can restore access (`IMPLEMENTATION.md` §9.1).  
**Four assertions — all tested, none substitutable** (matrix: `IMPLEMENTATION.md` §5).
| Test | Proves |
| --- | --- |
| revoked credential, account still thawed → transfer **succeeds** | gate does not run on transfers |
| account explicitly frozen → transfer **fails** | active enforcement works; freeze landed |
| frozen + revoked → re-thaw **fails** (fixture holds **no other qualifying evidence**) | holder cannot self-restore |
| valid renewal, no block → thaw **succeeds** | credential-based restoration works |

A fifth, distinct assertion — **explicit block + valid renewed evidence → thaw fails**, then  
**block removed → thaw succeeds** — is what demonstrates **block precedence**; renewal alone does  
not (`USE_CASES.md` demo steps 9–12).
**Why.** _Business:_ the moment that gets budget — access visibly withdrawn and restored, with  
distinguishable reasons. _Engineering:_ staleness tolerance, where revocation status is readable,  
block-vs-invalidation state, enforcement scope. **Out of scope:** automated monitoring that  
_detects_ events — the MVP enforces on demand, it does not watch.

## 3. Sanctions and screening-feed blocks _(state now, feed later)_

**Story.** A vendor returns a sanctions hit. Today a human notices, emails the transfer agent, and  
someone freezes accounts the next business day.  
**Gate.** Sets an **explicit compliance block** — checked first, immune to credential renewal,  
removable only by an authorized actor after review. Direction matters: a sanctions **hit** adds a  
block; **removal** from a list initiates review and normally _lifts_ it. The signal path must not  
treat both as one event.  
**Governance choice, not a guarantee.** Restricting block writes to an **authenticated,**  
**policy-bounded, logged writer** is **our** decision. That writer does not remove reliance on  
vendor data; the protection comes from its authentication, permissions and input validation. In  
the MVP the authorized writer is an **operator-controlled key or test adapter** holding the  
program's configured authority — production adapter services are a later milestone.  
**MVP vs extension.** MVP ships the **block mechanism with authorized add/remove**. The "simulated  
feed" is **a CLI/test fixture that invokes those authorized update instructions** — not a separate  
adapter service. Real screening-feed integration and production adapter operations are later.  
`AllowAllEoas` **— do not rely on it.** The guide still describes it while the current repo  
documents only `Allow` and `Block`. Pin the Token ACL version before depending on any such mode  
(`IMPLEMENTATION.md` §9.4). Separately: excluding PDAs excludes legitimate custody, multisig and  
escrow; address type proves nothing about beneficial owner; it clashes with the composability  
position in §6.

## 4. Reusable institutional onboarding with per-issuer trust tiers _(design now, build later)_

**Story.** A family office submits the same KYC pack to four platforms. A bank that already did  
diligence wants to attest once and have counterparties rely on it.  
**Gate.** `(attestation_type, issuer, verification_standard, age) → allowed?` with **configurable**  
**freshness**, where **age is measured from a policy-designated trusted timestamp** (issuance, a  
verification time, or a schema field) — and reissuing an attestation must not silently make old  
underlying verification fresh. Illustrative tiers — bank 24 months, KYC vendor 12, referral 90  
days — are **examples, not defaults**; freshness follows claim type, verification standard and the  
relying party's policy, not issuer prestige. A partner referral is **not** a cheaper form of  
verified KYC.  
**Why.** _Business:_ onboarding becomes a reusable asset instead of a sunk cost — the commercial  
reason SAS exists. _Engineering:_ issuer registry + per-(claim, issuer) TTL, the closest analogue  
to a compliance policy engine. _Caveat:_ on-chain issuer attribution is not a liability trail;  
reliance needs contracts and access to supporting evidence held by the **credential provider**,  
outside this system.

## 5. Per-mint distribution policy

**Story.** A tokenized MMF: retail in the EEA, professionals only in the UK. A tokenized bond on  
the same shelf: narrower class. Rules should be a property of the asset, not a signup form a  
secondary buyer never saw.  
**Gate.** Per-mint policy accounts in our program evaluate **shared** attestations against  
mint-specific **claim-value** predicates. Same credential passes the MMF, fails the bond. Investor  
categories are **membership in an explicitly accepted set** — **not** `class ≥ min`; there is no  
universal numerical ranking of investor types.  
**On the allowlist.** Credential admission rejects a whitelist as the _control of record_; an offering-specific list is **optional**
**product-specific approval layered on top** for gating one offering to a named cohort. Default  
posture: shared attestations + per-mint predicates, **no** wallet list.  
**Why.** _Business:_ matches how issuers think about a product shelf, and shows credentials are  
shared while policies are per-asset. _Engineering:_ one program, many mints, independent policy  
accounts — the multi-tenant production shape.  
**MVP vs extension.** MVP ships **two mints, one fixture** (`IMPLEMENTATION.md` §6): same schema,
same issuer, same validity, same claim value — **only the predicate differs**. Rich jurisdiction  
and classification rules, and the qualified-purchaser variant, are later. The EEA/UK split is a  
**hypothetical policy example**, not a legal classification.

## 6. Per-transfer trading controls — **NOT IN SCOPE**

Boundary: **no additional gate invocation occurs during transfers between thawed accounts.**

*   **Destination eligibility** is partly already enforced — an unapproved destination stays frozen  
    and cannot receive.
    
*   **Simple account-wide lockups** can sometimes be expressed via conditional thawing.
    
*   **Transaction-specific controls** (fresh counterparty checks, amount limits) need Transfer Hooks  
    **or another mandatory enforcement architecture**, e.g. constrained custody/settlement. Hooks  
    are natural, not unique.
    

Possible labelled contrast build later. Not this project.

* * *

## MVP demo arc

1.  Create mint (Frozen + TokenMetadata `token_acl`) → `create-config` → initialise our gate's  
    extra metas → enable permissionless thaw.
    
2.  Investor creates ATA — **this succeeds**; creating an account on a frozen-default mint is  
    allowed. The `thaw-permissionless` **attempt is what gets rejected** (no accepted evidence).
    
3.  Issue accepted attestation → thaw → **success** → receive tokens.
    
4.  Revoke/invalidate the attestation.
    
5.  Sponsor `token-acl freeze` the supplied account set.
    
6.  Transfer attempt → **fails** (freeze landed).
    
7.  `thaw-permissionless` → **fails** (no self-restoration).
    
8.  Renew valid evidence, no block → thaw → **success** (restoration).
    
9.  Sponsor freezes the account again, and the account **stays frozen while evidence is renewed**  
    (renewal alone never thaws an account).
    
10.  **Add an explicit block** (authorized actor) → `thaw-permissionless` → **fails despite valid,**  
     unexpired, accepted-schema evidence — **this is the block-precedence demonstration**.
     
11.  **Remove the block** (authorized actor) → thaw → **succeeds**. Precedence is reversible only by  
     an authorized block removal, not by re-issuing evidence.
     
12.  Same wallet, second mint with the opposite predicate → **rejected** (policy is the only  
     variable).
     

Steps 6, 7, 10 and 11 are what land in a meeting.  
**Extended demo (not core).** Explicit block + a renewed credential from a **different, weaker-tier**  
**issuer** → **still rejected**. Steps 9–11 above already establish core block precedence using the  
**same** issuer, so the core arc stays inside the single-issuer MVP; the different-issuer variant  
arrives with multi-issuer support.  
**Errors users see.** Denials evaluated by our gate return **distinct codes** per failing predicate  
step. Failures occurring before our gate executes — missing accounts, account-resolution or  
deserialization errors — surface as recognizable Token ACL / SDK / runtime errors instead, and  
must not be reported as policy decisions.

* * *

## Decisions to lock

1.  **Enforcement posture — fixed:** prospective validation + sponsor-initiated freeze on an  
    explicitly supplied account set. Detection/monitoring out of scope. No clawback, no  
    `Permanent Delegate` in v1.
    
2.  **State derivation.** Credential validity derived from current evidence where possible; persist  
    only explicit blocks and invalidation records that cannot be derived. Don't duplicate expiry or  
    revocation into policy state.
    
3.  **SAS lifecycle semantics — DECIDED (spike done, commit `5b64cf0`).** Public docs show  
    explicit `expiry` (Unix seconds) and schema-serialized `data`; the pinned version's  
    revoke/close, renewal/supersession and invalidation-granularity behaviour is now **verified**:  
    revocation = account closure (no flag/tombstone), **no** renewal instruction and **no** native  
    per-subject/per-claim invalidation, so reissuance does not auto-supersede and any per-subject  
    invalidation is **ours** to build; subject binding = attestation `nonce` (no `subject` field).  
    Full findings in `SAS_SPIKE.md`; predicate and risks in `IMPLEMENTATION.md` §3–§4, §9.
    

## Data policy — reading vs storage

**In SAS accounts:** the attestation itself (subject — carried in `nonce`, see  
`IMPLEMENTATION.md` §4.3 — schema/type, issuer, expiry, serialized  
claims). Readable on-chain; we do not copy or mirror it.  
**Read by the gate at thaw time:** those fields plus the decoded claim values needed to evaluate  
the mint predicate. Nothing is retained from that read.  
**Persisted by our program:** policy state only — issuer allowlists, per-mint predicates, explicit  
blocks, and any invalidation records that cannot be derived from evidence.  
**Supporting documents:** **not stored by the gate program, the SAS schemas this project uses, or**  
**the demo tooling.** Evidence storage at the **credential provider** is outside this project — and  
the institutional onboarding model explicitly anticipates needing access to it.
Claims under evaluation (wallet-linked jurisdiction, investor classification) are sensitive in  
themselves, so this is not "no sensitive attributes". Before launch, state exactly which claims are  
treated as publicly readable on-chain and which stay off-chain.