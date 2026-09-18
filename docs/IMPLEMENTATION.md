# Implementation Appendix — Token ACL Gate Program (rev 3)

Companion to `SCOPE.md` (scope, MVP boundary, success criteria) and `USE_CASES.md` (business  
cases). Toolchain, gate predicate, fixtures, test matrix, build order and risks live here.

> **Terminology.** **ABL = Allow Block List**, the Token ACL gate library (`token-acl-gate`  
> repository). It is **not** an Agave build tool. Toolchain requirements attributed below come  
> from the `token-acl-gate` repo, not from any Agave build library.

* * *

## 1. Toolchain: specify a verified combination

The Token ACL README lists a **mainnet program address**; that does not independently verify  
the deployment or audit status of every dependency we choose, and each pinned dependency is  
verified separately.
The `token-acl-gate` repository specifies **Agave 3.x with CI pinned to 3.1.11**. The older  
"Solana CLI 2.x vs 3.x TokenMetadata" note in the Token ACL guide is historical context, not a  
current general build requirement.
Record the verified combination here and treat it as the single source of truth:
| Item | Value (fill in and pin) |
| --- | --- |
| Token ACL version / commit |  |
| SAS version / commit |  |
| Token ACL program IDs (devnet / mainnet) |  |
| SAS program IDs (devnet / mainnet) |  |
| Our gate program ID (devnet / mainnet) |  |
| Target cluster per milestone |  |
| Rust / `cargo-build-sbf` / SDK crate versions |  |
| Local validator version (Agave) |  |
| Local dependency-loading method |  |

**Local dependency loading — two viable approaches; choose one and record it.**

*   **Clone from a cluster:** `--clone <program-id>` (or clone-from-url) for already-deployed  
    programs. Good for smoke tests against real deployments.
    
*   **Load locally built binaries:** build our gate plus pinned Token ACL / SAS programs into a  
    fresh local validator. Better for reproducible CI, exact-commit pinning, and testing  
    unreleased fixes.
    

ABL is not a required dependency. If we use ABL helpers, pin them and list which ones, so an  
upstream change cannot silently break the gate.

## 2. Extra metas — discovery convention is fixed; contents and setup are ours

**The standard discovery address is specified by the sRFC37 interface.** The thaw extra-metas  
PDA is derived under **our gate program's address** from:

```text
["thaw-extra-account-metas", mint_address]
```

The wallet owner is **not** an additional seed for the standard list account. Wallet-specific  
and record-specific accounts are **entries inside that metas list**, each with its own  
address/lookup metadata. So: the discovery convention is **not** ours to invent; the list  
**contents**, the record layouts behind those entries, and the **instruction that initializes  
and updates them** are ours.
**Two helpers, distinct roles — do not conflate them.**
| Helper | Role |
| --- | --- |
| `findThawExtraMetasAccountPda` | **Token ACL SDK** address-derivation helper. Applicable to custom gates; use it so wallets and Token ACL find our list. The guide imports it from the Token ACL SDK. |
| `getSetupExtraMetasInstruction` | **ABL-specific** initialization instruction. Not automatically applicable to our gate — our gate defines its own setup instruction and metas layout. The guide imports it from the ABL SDK. |

Design questions to settle in code:

*   Which accounts does our gate need during thaw — attestation account, attestation type,  
    issuer record, per-mint policy, block/invalidation record — and which are read-only vs  
    PDAs owned by our program?
    
*   How are record PDAs derived (mint, wallet, issuer seeds), and how does the metas list point  
    at them?
    
*   **Who may initialize and update the list?** Our setup instruction must be **authority-gated**.  
    Separately, **permissionless thaw must be enabled in** `MintConfig` for the investor-facing  
    path to exist — confirm whether the pinned implementation exposes any additional "metas  
    enabled" flag of its own. sRFC37 fixes the **discovery address convention** and the  
    **permissionless-operation flags**; it does not fix our behaviour when accounts are absent.
    

**Design invariant (ours to enforce, ours to test) — not an interface guarantee.**  
A **missing or malformed metas list**, or **missing required evidence / policy / block accounts**,  
**must never result in successful admission**. Rejection may occur in account resolution, in  
Token ACL, or in the gate — which of those fires is a property of the pinned implementation, to be  
recorded in step 1 (§3), not assumed here. In particular, whether Token ACL passes **no** extra  
accounts when the list account is missing or uninitialized is a **behavior to verify**, not an  
established guarantee. Either way the outcome we require is the same: **never treat an absent  
account as an absent policy.**

## 3. SAS spike — questions to settle before building eligibility

Public SAS documentation already shows an example with an **explicit** `expiry` and  
**schema-serialized attestation** `data`. Expiry and schema-defined data are therefore not  
open questions; what remains version-specific:

1.  **Fields and encodings** exposed on the attestation account in the pinned version (issuer,  
    subject, schema/type, data, expiry, state flags) and how `data` is decoded.
    
2.  **Wallet binding:** subject-field semantics and PDA derivation for the investor wallet, and  
    whether `data` is needed at all for binding.
    
3.  **Revocation / closure** in the pinned version: status field, close-account, separate  
    record — and what is observable to a gate reading the account afterwards.
    
4.  **Renewal / reissuance:** whether renewal replaces one canonical account or creates another;  
    how earlier evidence is invalidated; whether invalidation targets an **attestation instance**,  
    a **claim**, or a **wallet**; and whether another independently valid attestation may satisfy  
    the policy. **Reissuance does not by itself establish supersession** — the chosen design must  
    identify which evidence remains valid.
    
5.  **Freshness clock:** which trusted timestamp establishes age — issuance time, an on-account  
    verification time, or a schema field such as `verified_at`. Policy must name the age-bearing  
    field explicitly. If the schema does not carry a verification timestamp, either restrict  
    freshness to the attestation's own expiry or require a schema revision that adds one.  
    **Reissuing an attestation must not silently make old underlying verification fresh** unless  
    that is the intended policy — test it either way.
    
6.  **Provider support:** which schemas and lifecycle operations intended providers actually  
    support. Schema names elsewhere are placeholders until confirmed.
    

**Time units.** The public SAS example uses a **Unix timestamp in seconds**. Compare expiry with  
`Clock.unix_timestamp` (seconds) — **not** with slot numbers. Confirm the pinned version's  
comparison boundary (`>` vs `>=` at expiry == now) and any **sentinel value meaning "does not  
expire"**.
**Verification model.** Do not assume a CPI into SAS is required. The gate can validate a  
supplied SAS account by **reading and decoding it** — verifying the owning program is the pinned  
SAS program, checking identity and account relationships — because Solana's account-ownership  
rules prevent other programs from modifying that state. A CPI may add no security and costs CU.  
The spike must establish: **account resolution, authenticated decoding, lifecycle semantics, and  
measured resource usage** (CU, instruction size, account data size, plus CU cost of extra-metas  
loading).

## 4. Gate predicate (authoritative)

Allow thaw iff **all** hold:

1.  **Authentic evidence account** — verified owning program is the pinned SAS program; the  
    account resolves and decodes under the expected layout.
    
2.  **Accepted schema and version**, taken from the per-mint policy.
    
3.  **Subject binding — both parts required, and they are not interchangeable.** The attestation  
    subject **matches the current owner of the token account being thawed**, **and** that token  
    account carries the `ImmutableOwner` extension. Verifying the current owner alone does  
    **not** prevent a later owner change; `ImmutableOwner` is specifically what prevents  
    reassignment. ATAs get `ImmutableOwner` automatically; separately created accounts need  
    explicit handling.
    
4.  **Validity in time** — within the attestation's explicit `expiry` (Unix seconds vs  
    `Clock.unix_timestamp`) **and** within any additional policy freshness limit measured from the  
    policy-designated age field (§3.5).
    
5.  **Revocation / invalidation** — applicable checks pass, for both native SAS semantics in the  
    pinned version and adapter-published invalidation records.
    
6.  **Issuer is in the mint's allowlist.** For the MVP this is a plain allowlist check; **trust  
    tiers are a post-MVP extension** (with multi-issuer support), so no tier condition appears in  
    the MVP predicate.
    
7.  **Claim values satisfy the mint's policy predicates** — jurisdiction set membership, accepted  
    investor-classification set, limits, etc. **Schema membership alone is sufficient only if the  
    schema's issuance semantics explicitly mean "qualification passed."**
    
8.  **Policy resolution is verified, not supplied** — the per-mint policy account is derived  
    (or otherwise authenticated); a caller cannot substitute another mint's policy.
    
9.  **No explicit block** applies to the wallet or token account.
    

**Evaluation order — account authentication first, then policy decisions.**
_Phase A — authenticate the inputs (no policy decision is read until this passes):_ every required  
account matches its **expected derived address**, has the **expected owning program**, and decodes  
under the **expected layout** — evidence account, per-mint policy account, block/invalidation  
records. Fail closed on any mismatch (§2 invariant).
_Phase B — policy decisions, in this order:_ **explicit block** → policy resolution → accepted  
**schema and version** → subject + `ImmutableOwner` + owner match → **validity in time** →  
**revocation/invalidation** → **issuer allowlist** → **claim values**.
Block precedence applies **within** the policy decisions — it is not licence to act on an  
unauthenticated block record. Short-circuit with a distinct code at the first failing step.
Investor categories are **membership in an explicitly accepted set**, never `class ≥ min`:  
there is no universal numerical ranking of investor types.

## 5. Test matrix

**Evidence validation**

*   valid evidence, correct subject → allowed
    
*   **expiry boundary:** `expiry == Clock.unix_timestamp` → deterministic documented result  
    (boundary semantics per §3)
    
*   expired, revoked-but-unexpired (per pinned SAS semantics) → denied
    
*   wrong schema / wrong schema version → denied
    
*   non-allowlisted issuer → denied
    
*   **forged or non-SAS account** presented as evidence → denied (owning-program check)
    
*   attestation of the correct type for the **wrong subject** → denied
    
*   **wrong mint policy account** supplied → denied
    
*   data decodes but **claim values fail** the mint predicate (e.g. jurisdiction outside the  
    accepted set) → denied with a claim-value code distinct from schema/issuer denials
    

**Freshness**

*   attestation reissued with an **unchanged underlying verification timestamp** → must **not**  
    reset the freshness window (unless the policy explicitly says so)
    

**Enforcement semantics**

*   revoked evidence, account **still thawed** → transfer **succeeds** (no gate on transfers)
    
*   account **explicitly frozen** → transfer **fails**
    
*   **frozen + revoked → re-thaw fails.** The fixture must contain **no other qualifying  
    evidence** for that wallet, so the denial is attributable and the test stays meaningful once  
    multiple issuers exist
    
*   valid renewal, no block → thaw **succeeds**
    
*   **renew while frozen, then add an explicit block → thaw fails despite valid evidence**
    
*   **remove the block → thaw succeeds** (block precedence is reversible only by an authorized  
    block removal)
    

**Caller and binding**
| Target account's owner | Submitted evidence | Caller | Expected |
| --- | --- | --- | --- |
| Eligible investor | Valid evidence for that investor | Investor | **Allow** |
| Eligible investor | Same valid evidence | Relayer / third party | **Allow** |
| Ineligible investor | Evidence belonging to someone else | Anyone | **Reject** |
| Explicitly blocked investor | Otherwise valid evidence | Anyone | **Reject** |

**Address derivation — absence and substitution must not bypass a block**

*   block/invalidation record **omitted** while the metas list should carry it → **must not result  
    in successful admission**; where the rejection surfaces (account resolution, Token ACL, or the  
    gate) is recorded per the pinned implementation (§2 invariant)
    
*   **unrelated empty account** supplied in place of the expected record → **reject**; the gate  
    derives the expected address and verifies account address, owner and data, so a lookalike at  
    the wrong address is a mismatch
    
*   same expectation for the **per-mint policy account** and invalidation records
    
*   **missing** `ImmutableOwner`, or current owner **not** matching the attestation subject →  
    rejected (non-ATA fixture)
    

**Governance**

*   unauthorized caller updates policy → rejected
    
*   unauthorized caller adds/removes a block → rejected
    
*   **unauthorized extra-metas initialization or update → rejected**; only the configured authority  
    (per-mint owner or designated program authority) may write the list
    
*   authorized adapter/operator adds/removes block → accepted, event emitted
    

**Derivation rule.** Credential validity is derived from current evidence. Assert that superseded  
or reissued attestations cannot be used per the §3.4 design, and that policy storage holds no  
stale duplicate of expiry or revocation state.

## 6. Second-mint fixture — one concrete example, one variable

The second-mint demonstration must vary **only the predicate**. Fixture:
| Field | Mint A ("EU retail") | Mint B ("US-only") |
| --- | --- | --- |
| Schema | `kyc-basic` (placeholder) | `kyc-basic` — **same schema** |
| Issuer | `issuer-test-1` | `issuer-test-1` — **same issuer** |
| Expiry | valid | valid — **same validity** |
| Claim value | `jurisdiction = "DE"` | `jurisdiction = "DE"` — **same claim value** |
| Policy predicate | accepts `{DE, FR}` | accepts `{US}` |
| Expected | **thaw allowed** | **denied**, claim-value code |

Same wallet, same attestation account, same evidence bytes — the only difference is which mint's  
policy is being evaluated. Anything that varies issuer, schema or expiry turns this into a  
different test and should be a separate case.
The **qualified-purchaser** example stays in the later-extension narrative (multiple schemas and  
trust tiers), not in this fixture: Rule 506(c) accredited-investor and QP status answer  
different regulatory questions and are not interchangeable evidence.

## 7. Build order

1.  **Spike.** Inspect the pinned SAS and Token ACL versions for field layout, encodings,  
    expiry units and boundary, revocation/closure semantics, and renewal/reissuance behaviour;  
    record measured decode costs. Findings are labelled as findings, assumptions as assumptions.
    
2.  **Plumbing stub.** Mint + `create-config` + our extra-metas setup + enable permissionless  
    thaw, with a **permissive stub gate** that accepts a marker. Labelled a stub: it proves  
    wiring only. **Never treat it as an eligibility validator**, and never ship it as one.
    
3.  **Real eligibility validator:** authentic owning program, accepted schema/version, explicit  
    expiry (Unix seconds vs `Clock`), subject binding, `ImmutableOwner` + current-owner match.  
    (This step needs the **step 1 / §3 spike findings**, which is why the spike precedes it.)
    
4.  Issuer allowlist, freshness limit with a designated age field, **claim-value predicates**.
    
5.  **Implement the SAS lifecycle path.** Knowing the semantics (step 1) and implementing the  
    lifecycle are **separate deliverables** — the demo cannot pass without both. This step ships:
    *   **issue, revoke/invalidate and renew** through the lifecycle chosen in §3;
        
    *   **gate validation of that lifecycle state** — revoked/invalidated evidence must not admit,  
        a valid renewal must, per the §3.4 supersession rule;
        
    *   **any invalidation-record update instruction this requires**, with its authorization  
        (who may write it, and the event it emits).
        
6.  **Block state** with authorized add/remove and block precedence per §4 Phase B; extra-metas  
    authority gating; sponsor `freeze` on an **explicitly supplied account set**.
    
7.  **Second mint** per §6. **The demo arc in** `USE_CASES.md` **now passes end to end** — including  
    the block-precedence steps, which depend on steps 5 and 6, not just on renewal.
    
8.  Error codes, event emission, full §5 matrix, README.
    

**Post-MVP milestones:** trust tiers, real screening feeds, richer jurisdiction/classification  
rules, indexer-based account enumeration, named DEX integration.
**MVP governance path.** Production adapter services are a later milestone, so the MVP's  
authorized write path is an **operator-controlled key or test adapter** holding the configured  
authority. The governance tests target the **authority check in the program**, not the presence  
of an external adapter service — which is why an adapter's existence is never treated as a  
security property.

## 8. Composability — deferred

**Deferred.** There is **no additional gate invocation during transfers between thawed  
accounts.** Token ACL program support and any vault/custody eligibility are the integration's  
own concern. No composability claim is made beyond the first sentence, and **named-DEX  
integration is a post-MVP milestone, not an MVP acceptance criterion.**

## 9. Risks and open items

1.  **SAS revoke/close and renewal semantics in the pinned version are unverified — highest.**  
    Native SAS revocation and adapter-published invalidation are different mechanisms. Decide  
    invalidation **granularity** in the spike: if adapter-published invalidation is effectively a  
    **permanent wallet-level marker**, renewal will **not** restore access as documented, and the  
    restoration story must be revised.
    
2.  **Supersession design gap.** Reissuance does not by itself supersede prior evidence. Without  
    an explicit rule, a revoked or stale attestation can remain valid — or a valid renewal can be  
    ignored — while policy storage silently disagrees with the evidence.
    
3.  **Resource usage of resolving and decoding evidence during thaw.** Read-and-decode is likely  
    sufficient (account ownership protects the state) but unmeasured: CU, instruction size,  
    account data size, extra-metas loading cost.
    
4.  **Version drift.** Token ACL gate modes differ between guide and repo (`AllowAllEoas` is  
    described in the guide while the current repo documents only `Allow` and `Block`); "accredited"  
    means different things per provider schema. Pin and version everything; do not rely on  
    `AllowAllEoas`.
    
5.  **Authority gaps.** Extra-metas setup, policy updates and block writes each need authenticated  
    authorities. An unauthenticated write path invalidates every predicate above.
    
6.  **Overclaiming.** Follow the framing rules in `USE_CASES.md`.