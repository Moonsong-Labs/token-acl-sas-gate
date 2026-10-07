"use client";

import Link from "next/link";
import { CheckList } from "@/components/CheckList";
import { PageTitle, Screen } from "@/components/Chrome";
import { ActionError, Unavailable } from "@/components/Notice";
import { ChainDetails } from "@/components/ChainDetails";
import { TransactionLink } from "@/components/TransactionLink";
import { HEADLINES, steps, type Decision } from "@/lib/gate";
import {
  formatDate,
  formatDuration,
  regionList,
  regionName,
  short,
  useDemo,
  type InvestorId,
} from "@/lib/client";

function LockIcon({ open, color }: { open: boolean; color: string }) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" stroke={color} strokeWidth="1.7" />
      <path
        d={open ? "M8 10.5V8a4 4 0 0 1 7.5-1.8" : "M8 10.5V8a4 4 0 0 1 8 0v2.5"}
        stroke={color}
        strokeWidth="1.7"
      />
    </svg>
  );
}

/**
 * The outcome of the last access request, as the gate returned it.
 *
 * A policy denial and a failure to authenticate the inputs are rendered
 * differently on purpose: the first is a decision about this investor under the
 * fund's policy, the second means the policy was never reached
 * (docs/SCOPE.md, "Errors").
 */
function Outcome({ decision, message }: { decision: Decision; message: string }) {
  if (decision.outcome === "admitted") return null;
  const tone =
    decision.outcome === "denied"
      ? { bg: "var(--badbg)", border: "#E4C4C2", ink: "#7C2222", body: "#6E2A2A" }
      : { bg: "var(--warnbg)", border: "#EAD9A8", ink: "#6C4E12", body: "#6C4E12" };
  const code = decision.outcome === "rejected" ? null : decision.code;
  const headline =
    decision.outcome === "rejected"
      ? "Request rejected before the gate decided"
      : code === 2 && message.startsWith("No credential")
        ? "No credential on file"
        : HEADLINES[code!];
  const explanation =
    decision.outcome === "denied"
      ? "The gate evaluated this request against the fund’s policy and refused it at the step marked below."
      : decision.outcome === "unverified"
        ? "The gate could not authenticate a genuine credential for this wallet, so none of the fund’s rules were checked."
        : "Token ACL or the token program refused the request; the gate did not return a decision.";

  return (
    <div
      role="status"
      className="card"
      style={{ padding: "15px 16px", background: tone.bg, borderColor: tone.border }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: tone.ink }}>{headline}</div>
        {decision.outcome !== "rejected" && (
          <span
            className="chip mono"
            style={{ background: "#fff", borderColor: tone.border, color: tone.ink, fontSize: 11 }}
            title="The gate program's error code"
          >
            {decision.name} · {decision.code}
          </span>
        )}
      </div>
      <p style={{ fontSize: 13, color: tone.body, marginTop: 7, lineHeight: 1.5 }}>
        {message} {explanation}
      </p>
    </div>
  );
}

export function InvestorScreen({ who }: { who: InvestorId }) {
  const { state, busy, results, run } = useDemo();
  if (!state)
    return (
      <Screen role="investor">
        <Unavailable />
      </Screen>
    );

  const { fund, registry } = state;
  const investor = state.investors.find((i) => i.id === who)!;
  const result = results[who]?.action === "activate" ? results[who] : null;
  const decision = result?.decision ?? null;
  const { active, credential } = investor;
  const expired = credential && credential.expiry !== 0 && state.now >= credential.expiry;
  // Admission is a decision the gate made when access was requested; it does not
  // re-check an active account. So an active account can hold a credential that
  // has since expired, or none at all, and the screen must not imply otherwise.
  const stale = credential && fund.policy.maxAge !== 0 &&
    (credential.verifiedAt > state.now || state.now - credential.verifiedAt >= fund.policy.maxAge);
  const restricted = investor.walletStatus.blocked || investor.walletStatus.invalidated ||
    investor.tokenStatus.blocked || investor.tokenStatus.invalidated;
  const lapsed = active && (!credential || expired || stale || restricted);

  const tone = active
    ? { color: "var(--ok)", bg: "var(--okbg)", border: "#BFDDC9", wash: "#EEF6F0" }
    : { color: "var(--ice)", bg: "var(--icebg)", border: "#CFE0E8", wash: "#F1F6F9" };

  return (
    <Screen role="investor" roleLabel={`Investor · ${investor.name}`}>
      <PageTitle
        eyebrow="Your account"
        title={active ? "Admitted — account active" : investor.balance > 0 ? "Access withdrawn — account frozen" : "Frozen — not yet admitted"}
        aside={
          <nav aria-label="Investor" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {state.investors.map((i) => (
              <Link
                key={i.id}
                className="chip"
                href={`/investor/${i.id}`}
                aria-current={i.id === who ? "page" : undefined}
                style={
                  i.id === who
                    ? { background: "#EEF2F8", borderColor: "#D3DEEC", color: "var(--accent2)", fontWeight: 600 }
                    : { color: "var(--ink2)" }
                }
              >
                {i.name}
              </Link>
            ))}
          </nav>
        }
      />
      <ActionError />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(330px, 100%), 1fr))",
          gap: 20,
          alignItems: "start",
        }}
      >
        <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div
            className="card"
            style={{
              padding: 24,
              borderColor: tone.border,
              background: `linear-gradient(180deg, ${tone.wash}, #FFFFFF)`,
              display: "flex",
              flexDirection: "column",
              gap: 15,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <span
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 14,
                  background: tone.bg,
                  border: `1px solid ${tone.border}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <LockIcon open={active} color={tone.color} />
              </span>
              <div>
                <div className="lbl" style={{ color: tone.color }}>
                  {fund.name}
                </div>
                <div style={{ fontSize: 18, fontWeight: 600 }} data-testid="account-state">
                  {active ? "Active" : "Frozen"}
                </div>
              </div>
            </div>

            <p style={{ fontSize: 14.5, color: "var(--ink2)", lineHeight: 1.5 }}>
              {active ? (
                <>
                  This account was admitted when its credential met the fund&rsquo;s policy. It is
                  active — you can receive and transact <strong>{fund.symbol}</strong>.
                </>
              ) : (
                <>
                  Your account is frozen and cannot send or receive <strong>{fund.symbol}</strong>.
                  Any existing balance remains in the account.
                  This fund admits investors by checking a credential they already hold —
                  there&rsquo;s no eligible-investor spreadsheet to be added to.
                </>
              )}
            </p>

            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <div className="card" style={{ flexGrow: 1, padding: "14px 16px" }}>
                <div className="lbl">Balance</div>
                <div style={{ fontSize: 22, fontWeight: 600, marginTop: 3 }}>
                  {investor.balance.toLocaleString("en-GB")}{" "}
                  <span style={{ fontSize: 13, color: "var(--muted)" }}>{fund.symbol}</span>
                </div>
              </div>
              <div className="card" style={{ flexGrow: 1, padding: "14px 16px" }}>
                <div className="lbl">Credential</div>
                <div style={{ fontSize: 15, fontWeight: 600, marginTop: 5 }}>
                  {credential ? (expired ? "Expired" : "On file") : "None"}
                </div>
              </div>
            </div>

            {lapsed && (
              <div
                data-testid="lapsed-admission"
                className="card"
                style={{
                  padding: "13px 15px",
                  background: "var(--warnbg)",
                  borderColor: "#EAD9A8",
                  fontSize: 13,
                  color: "#6C4E12",
                  lineHeight: 1.5,
                }}
              >
                <strong>
                  {!credential ? "Your credential is no longer on file." : expired ? "Your credential has since expired." : stale ? "Your KYC no longer meets the freshness rule." : "Your account has a compliance hold or invalidation."}
                </strong>{" "}
                The gate checks a credential only when access is requested, so this does not freeze
                the account on its own. It stays active until the fund&rsquo;s sponsor freezes it.
              </div>
            )}

            {decision && result && <Outcome decision={decision} message={result.message} />}
            {decision?.outcome === "admitted" && (
              <p role="status" style={{ fontSize: 13, color: "var(--ok)" }}>
                {result?.message}
                <TransactionLink href={result?.transaction} />
              </p>
            )}
            <ChainDetails result={result} />

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button
                className="btn"
                type="button"
                disabled={busy || active}
                onClick={() => run("activate", who)}
              >
                Request access
              </button>
              {!credential && (
                <Link className="btn ghost" href="/issuer">
                  Get a credential
                </Link>
              )}
              <Link className="btn ghost" href="/compliance">Compliance actions</Link>
              {active && (
                <Link className="btn ghost" href="/operator">
                  Receive {fund.symbol}
                </Link>
              )}
            </div>
          </div>

          <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
            Anyone can submit the request on your behalf — the gate checks the credential
            against the account&rsquo;s owner, not who submits it.
          </p>
        </section>

        <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card" style={{ padding: 20 }}>
            <h2 className="lbl">Access timeline</h2>
            <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>Recent confirmed lifecycle transactions. Refused requests and passage of time have no transaction here.</p>
            {investor.timelineUnavailable ? (
              <p data-testid="timeline-unavailable" style={{ marginTop: 12, fontSize: 13, color: "var(--ink2)" }}>
                Transaction history is unavailable. Current account state and compliance actions
                remain available. Press Refresh to retry the timeline.
              </p>
            ) : <ol data-testid="access-timeline" style={{ paddingLeft: 20, fontSize: 13, lineHeight: 1.6 }}>
              {investor.timeline.map((event) => <li key={event.signature}>
                {event.message}<br />
                <span style={{ color: "var(--muted)" }}>{event.time ? new Date(event.time * 1000).toLocaleString("en-GB") : `Slot ${event.slot}`}</span>
                <TransactionLink href={event.transaction} />
              </li>)}
            </ol>}
          </div>
          {decision && decision.outcome !== "rejected" ? (
            <CheckList
              steps={steps(decision)}
              heading={
                decision.outcome === "admitted"
                  ? "Admission checks — all passed when requested"
                  : "How the check ran"
              }
              note={
                decision.outcome === "admitted"
                  ? undefined
                  : "The gate stops at the first failure, so the checks after it never ran."
              }
            />
          ) : active ? (
            <div
              className="card"
              style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 9 }}
            >
              <h2 className="lbl">Admission</h2>
              <p style={{ fontSize: 13.5, color: "var(--ink2)", lineHeight: 1.55 }}>
                The gate admitted this account when access was requested. It does not re-check an
                active account: its checks run again only when a frozen account asks for access.
              </p>
            </div>
          ) : (
            <div
              className="card"
              style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 11 }}
            >
              <h2 className="lbl">To be admitted, you need</h2>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, color: "var(--ink2)", lineHeight: 1.7 }}>
                <li>
                  A <strong>{registry.schema.name}</strong> credential issued to{" "}
                  <strong>your wallet</strong>
                </li>
                <li>
                  Written under the <strong>{registry.name}</strong> credential, by one of its
                  authorized issuers
                </li>
                <li>
                  Showing an <strong>accepted region</strong> ({regionList(fund.policy.jurisdictions)})
                </li>
                <li>
                  With KYC completed within the last{" "}
                  <strong>{formatDuration(fund.policy.maxAge)}</strong>, and not expired
                </li>
              </ul>
              <p
                style={{
                  fontSize: 11.5,
                  color: "var(--muted)",
                  borderTop: "1px solid var(--line)",
                  paddingTop: 10,
                  lineHeight: 1.45,
                }}
              >
                Request access at any time — a refusal names the condition that was not met.
              </p>
            </div>
          )}

          <div className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 4 }}>
            <h2 className="lbl" style={{ marginBottom: 6 }}>
              Account
            </h2>
            <div className="kv">
              <span style={{ color: "var(--ink2)" }}>Held by</span>
              <span style={{ fontWeight: 600 }}>{investor.name}</span>
            </div>
            <div className="kv">
              <span style={{ color: "var(--ink2)" }}>Wallet</span>
              <span className="mono" style={{ fontSize: 12 }} title={investor.wallet}>
                {short(investor.wallet)}
              </span>
            </div>
            <div className="kv">
              <span style={{ color: "var(--ink2)" }}>Token account</span>
              <span className="mono" style={{ fontSize: 12 }} title={investor.token}>
                {short(investor.token)}
              </span>
            </div>
            <div className="kv" style={{ alignItems: "center" }}>
              <span style={{ color: "var(--ink2)" }}>Owner can&rsquo;t be changed</span>
              <span
                className="chip"
                style={
                  investor.immutableOwner
                    ? { background: "var(--okbg)", borderColor: "#BFDDC9", color: "var(--ok)" }
                    : { background: "var(--badbg)", borderColor: "#E4C4C2", color: "var(--bad)" }
                }
              >
                {investor.immutableOwner ? "Yes" : "No"}
              </span>
            </div>
            {credential && (
              <>
                <div className="kv">
                  <span style={{ color: "var(--ink2)" }}>Credential region</span>
                  <span style={{ fontWeight: 600 }}>{regionName(credential.jurisdiction)}</span>
                </div>
                <div className="kv">
                  <span style={{ color: "var(--ink2)" }}>KYC completed</span>
                  <span style={{ fontWeight: 600 }}>{formatDate(credential.verifiedAt)}</span>
                </div>
                <div className="kv">
                  <span style={{ color: "var(--ink2)" }}>Valid until</span>
                  <span style={{ fontWeight: 600, color: expired ? "var(--bad)" : undefined }}>
                    {credential.expiry === 0
                      ? "No expiry"
                      : new Date(credential.expiry * 1000).toLocaleString("en-GB")}
                  </span>
                </div>
                <div className="kv">
                  <span style={{ color: "var(--ink2)" }}>Issued by</span>
                  <span style={{ fontWeight: 600 }}>
                    {credential.issuerName ?? short(credential.signer)}
                  </span>
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </Screen>
  );
}
