"use client";

import Link from "next/link";
import { PageTitle, Screen } from "@/components/Chrome";
import { ActionError, Unavailable } from "@/components/Notice";
import { TransactionLink } from "@/components/TransactionLink";
import { formatDuration, regionList, short, useDemo } from "@/lib/client";

function Mark({ ok }: { ok: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        flex: "none",
        width: 20,
        height: 20,
        borderRadius: "50%",
        background: ok ? "var(--ok)" : "var(--bad)",
        color: "#fff",
        fontSize: 12,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {ok ? "✓" : "✕"}
    </span>
  );
}

export default function OperatorScreen() {
  const { state, busy, results, run } = useDemo();
  if (!state)
    return (
      <Screen role="operator">
        <Unavailable />
      </Screen>
    );

  const { fund, registry } = state;
  const { readiness, policy } = fund;
  // The four setup steps sRFC37 requires before an investor-facing path exists
  // (docs/ADMISSION.md, "Configure a fund"). Each is read from chain state.
  const rows = [
    {
      ok: readiness.frozenByDefault,
      title: "Fund token created",
      detail: "New holders start frozen by default",
    },
    {
      ok: readiness.gated,
      title: "Access handed to the eligibility gate",
      detail: "Token ACL holds the freeze authority and names the gate program",
    },
    {
      ok: readiness.wired,
      title: "Eligibility checks wired in",
      detail: "The fund's policy and account-discovery list are on-chain",
    },
    {
      ok: readiness.permissionlessThaw,
      title: "Investors can request access",
      detail: "Directly, or through a helper acting on their behalf",
    },
  ];

  return (
    <Screen role="operator">
      <PageTitle
        eyebrow="Fund setup"
        title={fund.name}
        aside={
          <span
            className="chip"
            style={{ background: "var(--icebg)", borderColor: "#CFE0E8", color: "var(--ice)" }}
          >
            {fund.symbol} · new holders start frozen until admitted
          </span>
        }
      />
      <ActionError />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 18,
          alignItems: "start",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <section
            className="card"
            style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 14 }}
          >
            <h2 className="lbl">Fund readiness</h2>
            {rows.map((row) => (
              <div key={row.title} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <Mark ok={row.ok} />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>
                    {row.title}
                    <span className="sr-only">{row.ok ? " — done" : " — not done"}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.45 }}>
                    {row.detail}
                  </div>
                </div>
              </div>
            ))}
            <p
              style={{
                fontSize: 11.5,
                color: "var(--muted)",
                borderTop: "1px solid var(--line)",
                paddingTop: 10,
                lineHeight: 1.45,
              }}
            >
              All four are required. Without the last two there is no investor-facing path
              at all — requests fail before the fund&rsquo;s policy is ever consulted.
            </p>
          </section>

          <section
            className="card"
            style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 10 }}
          >
            <h2 className="lbl">Allocate {fund.symbol}</h2>
            <p style={{ fontSize: 13, color: "var(--ink2)", lineHeight: 1.5 }}>
              Only admitted accounts can receive the fund&rsquo;s token. A frozen account is
              refused by the token program itself, not by this screen.
            </p>
            {state.investors.map((investor) => {
              const result = results[investor.id];
              const shown = result?.action === "allocate" ? result : null;
              return (
                <div key={investor.id} style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600, fontSize: 13.5, minWidth: 80 }}>
                      {investor.name}
                    </span>
                    <span
                      className="chip"
                      style={
                        investor.active
                          ? { background: "var(--okbg)", borderColor: "#BFDDC9", color: "var(--ok)" }
                          : { background: "var(--icebg)", borderColor: "#CFE0E8", color: "var(--ice)" }
                      }
                    >
                      {investor.active ? "Active" : "Frozen"}
                    </span>
                    <span style={{ fontSize: 13, color: "var(--ink2)" }}>
                      {investor.balance.toLocaleString("en-GB")} {fund.symbol}
                    </span>
                    <span style={{ flexGrow: 1 }} />
                    <button
                      className="btn ghost"
                      type="button"
                      disabled={busy}
                      onClick={() => run("allocate", investor.id)}
                    >
                      Allocate 25,000
                    </button>
                  </div>
                  {shown && (
                    <p
                      role="status"
                      style={{
                        fontSize: 12.5,
                        marginTop: 6,
                        color: shown.ok ? "var(--ok)" : "var(--bad)",
                      }}
                    >
                      {shown.message}
                      <TransactionLink href={shown.transaction} />
                    </p>
                  )}
                </div>
              );
            })}
          </section>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <section
            className="card"
            style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 12 }}
          >
            <h2 className="lbl">Who can be admitted</h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <span
                className="chip"
                style={{ background: "#EEF2F8", borderColor: "#D3DEEC", color: "var(--accent2)" }}
              >
                Credential · {registry.schema.name} v{policy.schemaVersion}
              </span>
              <span
                className="chip"
                style={{ background: "#EEF2F8", borderColor: "#D3DEEC", color: "var(--accent2)" }}
              >
                Accepted credential · {registry.name}
              </span>
            </div>
            <div>
              <div className="kv">
                <span style={{ color: "var(--ink2)" }}>Accepted regions</span>
                <span style={{ fontWeight: 600 }}>{regionList(policy.jurisdictions)}</span>
              </div>
              <div className="kv">
                <span style={{ color: "var(--ink2)" }}>KYC completed within</span>
                <span style={{ fontWeight: 600 }}>
                  {policy.maxAge === 0 ? "No age limit" : `the last ${formatDuration(policy.maxAge)}`}
                </span>
              </div>
              <div className="kv">
                <span style={{ color: "var(--ink2)" }}>Must still be valid</span>
                <span style={{ fontWeight: 600 }}>Before the issuer&rsquo;s expiry date</span>
              </div>
              <div className="kv">
                <span style={{ color: "var(--ink2)" }}>Bound to</span>
                <span style={{ fontWeight: 600 }}>The investor&rsquo;s own wallet</span>
              </div>
            </div>
            <p
              style={{
                fontSize: 11.5,
                color: "var(--muted)",
                borderTop: "1px solid var(--line)",
                paddingTop: 9,
                lineHeight: 1.45,
              }}
            >
              The fund accepts the {registry.name} credential, so it accepts every issuer that
              authority has authorized — see{" "}
              <Link href="/authority">the credential authority</Link>.
            </p>
          </section>

          <section
            className="card"
            style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 4 }}
          >
            <h2 className="lbl" style={{ marginBottom: 6 }}>
              On-chain
            </h2>
            <div className="kv">
              <span style={{ color: "var(--ink2)" }}>Fund token</span>
              <span className="mono" style={{ fontSize: 12 }} title={fund.mint}>
                {short(fund.mint)}
              </span>
            </div>
            <div className="kv">
              <span style={{ color: "var(--ink2)" }}>Token ACL config</span>
              <span className="mono" style={{ fontSize: 12 }} title={fund.config}>
                {short(fund.config)}
              </span>
            </div>
            <div className="kv">
              <span style={{ color: "var(--ink2)" }}>Config authority (operator)</span>
              <span className="mono" style={{ fontSize: 12 }} title={fund.configAuthority}>
                {short(fund.configAuthority)}
              </span>
            </div>
            <div className="kv">
              <span style={{ color: "var(--ink2)" }}>Real funds moved</span>
              <span style={{ fontWeight: 600 }}>None — local network</span>
            </div>
          </section>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 20 }}>
        <Link className="btn" href="/investor/lena">
          Open investor view
        </Link>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          To start over, reseed the network with <code>mise run seed</code>.
        </span>
      </div>
    </Screen>
  );
}
