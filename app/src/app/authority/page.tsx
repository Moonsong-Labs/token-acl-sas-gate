"use client";

import Link from "next/link";
import { PageTitle, Screen } from "@/components/Chrome";
import { Unavailable } from "@/components/Notice";
import { short, useDemo } from "@/lib/client";

/**
 * The SAS credential authority. In the SAS model it is independent of both the
 * funds and the issuers: it owns the credential, creates its schema, and
 * registers issuers as the credential's authorized signers. Read-only here —
 * nothing in UC1 changes the issuer set.
 */
export default function AuthorityScreen() {
  const { state } = useDemo();
  if (!state)
    return (
      <Screen role="authority">
        <Unavailable />
      </Screen>
    );

  const { registry, fund } = state;

  return (
    <Screen role="authority" roleLabel={`Credential authority · ${registry.name}`}>
      <PageTitle eyebrow="Credential authority" title={registry.name} />

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
            style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 12 }}
          >
            <h2 className="lbl">Who does what</h2>
            <ul
              style={{
                margin: 0,
                paddingLeft: 18,
                fontSize: 13.5,
                color: "var(--ink2)",
                lineHeight: 1.6,
              }}
            >
              <li>
                <strong>{registry.name}</strong> owns the KYC credential, defines its schema,
                and decides which issuers may write under it.
              </li>
              <li>
                <strong>Authorized issuers</strong> confirm an investor&rsquo;s KYC and write
                the credential to the chain.
              </li>
              <li>
                <strong>{fund.name}</strong> chooses which credential its policy accepts. It
                does not maintain a list of investors.
              </li>
            </ul>
            <p
              style={{
                fontSize: 11.5,
                color: "var(--muted)",
                borderTop: "1px solid var(--line)",
                paddingTop: 9,
                lineHeight: 1.45,
              }}
            >
              These are three separate keys on-chain. The authority&rsquo;s key signs only when
              the credential, its schema or its issuer set changes.
            </p>
          </section>

          <section
            className="card"
            style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 10 }}
          >
            <h2 className="lbl">Authorized issuers</h2>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {registry.issuers.map((issuer) => (
                <li
                  key={issuer.address}
                  className="kv"
                  style={{ alignItems: "center" }}
                >
                  <span style={{ fontWeight: 600 }}>{issuer.name ?? "Unnamed issuer"}</span>
                  <span className="mono" style={{ fontSize: 12 }} title={issuer.address}>
                    {short(issuer.address)}
                  </span>
                </li>
              ))}
            </ul>
            <p
              style={{
                fontSize: 12.5,
                color: "var(--ink2)",
                borderTop: "1px solid var(--line)",
                paddingTop: 10,
                lineHeight: 1.5,
              }}
            >
              <strong>What a fund trusts.</strong>{" "}
              {registry.acceptedByFund
                ? `${fund.name} accepts this credential, so it accepts a credential from any issuer listed here.`
                : `${fund.name} does not accept this credential.`}{" "}
              The gate checks which credential a record was written under, not which issuer
              signed it. Removing an issuer stops it writing new records; records it already
              wrote are unaffected.
            </p>
          </section>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <section
            className="card"
            style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 4 }}
          >
            <h2 className="lbl" style={{ marginBottom: 6 }}>
              Credential
            </h2>
            <div className="kv">
              <span style={{ color: "var(--ink2)" }}>Name</span>
              <span className="mono" style={{ fontSize: 12 }}>
                {registry.credentialName}
              </span>
            </div>
            <div className="kv">
              <span style={{ color: "var(--ink2)" }}>Address</span>
              <span className="mono" style={{ fontSize: 12 }} title={registry.credential}>
                {short(registry.credential)}
              </span>
            </div>
            <div className="kv">
              <span style={{ color: "var(--ink2)" }}>Authority</span>
              <span className="mono" style={{ fontSize: 12 }} title={registry.authority}>
                {short(registry.authority)}
              </span>
            </div>
            <div className="kv">
              <span style={{ color: "var(--ink2)" }}>Accepted by {fund.name}</span>
              <span
                className="chip"
                style={
                  registry.acceptedByFund
                    ? { background: "var(--okbg)", borderColor: "#BFDDC9", color: "var(--ok)" }
                    : { background: "var(--badbg)", borderColor: "#E4C4C2", color: "var(--bad)" }
                }
              >
                {registry.acceptedByFund ? "Yes" : "No"}
              </span>
            </div>
          </section>

          <section
            className="card"
            style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 4 }}
          >
            <h2 className="lbl" style={{ marginBottom: 6 }}>
              Schema
            </h2>
            <div className="kv">
              <span style={{ color: "var(--ink2)" }}>Name</span>
              <span className="mono" style={{ fontSize: 12 }}>
                {registry.schema.name} · v{registry.schema.version}
              </span>
            </div>
            {registry.schema.fields.map((field) => (
              <div className="kv" key={field.name}>
                <span style={{ color: "var(--ink2)" }}>Field</span>
                <span className="mono" style={{ fontSize: 12 }}>
                  {field.name}: {field.type}
                </span>
              </div>
            ))}
            <div className="kv">
              <span style={{ color: "var(--ink2)" }}>Accepting new records</span>
              <span style={{ fontWeight: 600 }}>{registry.schema.paused ? "Paused" : "Yes"}</span>
            </div>
            <p
              style={{
                fontSize: 11.5,
                color: "var(--muted)",
                borderTop: "1px solid var(--line)",
                paddingTop: 9,
                marginTop: 6,
                lineHeight: 1.45,
              }}
            >
              <code>jurisdiction</code> is what the fund&rsquo;s region rule reads.{" "}
              <code>verified_at</code> is when the issuer completed KYC; the fund&rsquo;s age
              limit is measured from it. The subject is not a field: each record is keyed to
              the investor&rsquo;s wallet. <Link href="/issuer">Issue a credential</Link>.
            </p>
          </section>
        </div>
      </div>
    </Screen>
  );
}
