// How the gate program decides, as the screens explain it.
//
// The decision itself is made on-chain by `can_thaw` in `src/lib.rs`; this file
// only turns its result into the ordered check list the investor sees. The gate
// returns a single custom error code, and it evaluates in a fixed order that
// short-circuits at the first failure, so one code is enough to say which checks
// passed, which one failed and which never ran. Keep STEPS in the order of
// `can_thaw` and CODES in step with `GateError` (docs/ADMISSION.md, "Denials").

/** Phase A authenticates every account the decision reads; Phase B decides. */
export type Phase = "inputs" | "policy";

export type StepId =
  | "inputs_authentic"
  | "no_block"
  | "schema_accepted"
  | "subject_bound"
  | "within_expiry"
  | "fresh"
  | "not_invalidated"
  | "credential_accepted"
  | "claims_satisfied";

export type StepStatus = "passed" | "failed" | "not_reached";

export interface Step {
  id: StepId;
  phase: Phase;
  label: string;
  status: StepStatus;
}

/** In `can_thaw` order. */
export const STEPS: { id: StepId; phase: Phase; label: string }[] = [
  { id: "inputs_authentic", phase: "inputs", label: "Genuine credential and fund records" },
  { id: "no_block", phase: "policy", label: "No compliance hold" },
  { id: "schema_accepted", phase: "policy", label: "Right credential type and version" },
  { id: "subject_bound", phase: "policy", label: "Belongs to this wallet, locked to its owner" },
  { id: "within_expiry", phase: "policy", label: "Not expired" },
  { id: "fresh", phase: "policy", label: "Verified recently enough" },
  { id: "not_invalidated", phase: "policy", label: "Not invalidated by the fund" },
  { id: "credential_accepted", phase: "policy", label: "Issued under the accepted credential" },
  { id: "claims_satisfied", phase: "policy", label: "Region accepted by this fund" },
];

/**
 * `GateError` custom codes (src/lib.rs), and the step each one fails. `null`
 * means the code is raised in more than one place, so the code alone cannot
 * say which checks ran: Malformed (3) comes from input authentication, but
 * also from the token account's extensions after the schema check and from
 * the claim after the expiry check; Context (14) concerns how the request
 * arrived, not the credential.
 */
export const CODES: Record<number, { name: string; step: StepId | null }> = {
  1: { name: "Address", step: "inputs_authentic" },
  2: { name: "Owner", step: "inputs_authentic" },
  3: { name: "Malformed", step: null },
  5: { name: "Blocked", step: "no_block" },
  6: { name: "Schema", step: "schema_accepted" },
  7: { name: "Subject", step: "subject_bound" },
  8: { name: "ImmutableOwner", step: "subject_bound" },
  9: { name: "Expired", step: "within_expiry" },
  10: { name: "Freshness", step: "fresh" },
  11: { name: "Invalidated", step: "not_invalidated" },
  12: { name: "Issuer", step: "credential_accepted" },
  13: { name: "Claim", step: "claims_satisfied" },
  14: { name: "Context", step: null },
};

/** The step a gate code fails, or `null` when the code cannot place it. */
export function locate(code: number): StepId | null {
  return CODES[code]?.step ?? null;
}

/** The investor-facing headline for a refusal. */
export const HEADLINES: Record<number, string> = {
  1: "Records could not be verified",
  2: "No genuine credential found",
  3: "Records could not be read",
  5: "Compliance hold in place",
  6: "Wrong credential type",
  7: "Credential belongs to another wallet",
  8: "Account not locked to its owner",
  9: "Credential expired",
  10: "Verification too old",
  11: "Invalidated by the fund",
  12: "Credential not accepted by this fund",
  13: "Region not accepted",
  14: "Request not made through Token ACL",
};

export type Decision =
  | { outcome: "admitted" }
  /** The gate evaluated the policy and refused at one step. */
  | { outcome: "denied"; code: number; name: string }
  /**
   * The gate refused while authenticating inputs, before any policy step.
   * `noCredential` marks the common case: no attestation exists for the wallet.
   */
  | { outcome: "unverified"; code: number; name: string; noCredential?: boolean }
  /** The gate refused with a code that does not identify one step. */
  | { outcome: "unplaced"; code: number; name: string }
  /** Rejected without a gate code: Token ACL, Token-2022 or the runtime. */
  | { outcome: "rejected"; detail: string };

/** Order the check list from a decision. */
export function steps(decision: Decision): Step[] {
  const failed =
    decision.outcome === "denied" || decision.outcome === "unverified"
      ? locate(decision.code)
      : null;
  const failedAt = failed ? STEPS.findIndex((s) => s.id === failed) : -1;
  return STEPS.map((step, index) => ({
    ...step,
    status:
      decision.outcome === "admitted" || index < failedAt
        ? "passed"
        : index === failedAt
          ? "failed"
          : "not_reached",
  }));
}
