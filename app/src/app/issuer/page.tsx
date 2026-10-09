"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { PageTitle, Screen } from "@/components/Chrome";
import { ActionError, Unavailable } from "@/components/Notice";
import { ChainDetails } from "@/components/ChainDetails";
import { TransactionLink } from "@/components/TransactionLink";
import {
  formatDate,
  ageLimit,
  regionName,
  short,
  useDemo,
  type InvestorId,
  type IssueOptions,
} from "@/lib/client";

const VERIFIED: { value: IssueOptions["verified"]; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "six-months", label: "6 months ago" },
  { value: "two-years", label: "2 years ago" },
];

/**
 * Forward-looking only: SAS refuses an attestation whose expiry has already
 * passed, so the short window is how the demo reaches an expired credential.
 */
const VALIDITY: { value: IssueOptions["validity"]; label: string }[] = [
  { value: "year", label: "12 months from today" },
  { value: "two-minutes", label: "2 minutes — to watch it expire" },
];

export default function IssuerScreen() {
  const { state, busy, results, run } = useDemo();
  const ids = { subject: useId(), type: useId(), region: useId(), verified: useId(), validity: useId(), by: useId() };
  const [who, setWho] = useState<InvestorId>("lena");
  const [verified, setVerified] = useState<IssueOptions["verified"]>("today");
  const [validity, setValidity] = useState<IssueOptions["validity"]>("year");

  if (!state)
    return (
      <Screen role="issuer">
        <Unavailable />
      </Screen>
    );

  const { issuer, registry, fund } = state;
  const investor = state.investors.find((i) => i.id === who)!;
  const onFile = investor.credential;
  const result = ["issue", "renew", "revoke"].includes(results[who]?.action ?? "") ? results[who] : null;
  const maxAge = fund.policy.maxAge;

  return (
    <Screen role="issuer" roleLabel={`Issuer · ${issuer.name}`}>
      <PageTitle
        eyebrow={`Issuer · authorized by ${registry.name}`}
        title="Issue, renew or revoke KYC"
      />
      <ActionError />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(340px, 100%), 1fr))",
          gap: 22,
          alignItems: "start",
        }}
      >
        <section
          className="card"
          style={{ padding: 22, display: "flex", flexDirection: "column", gap: 16 }}
        >
          <div>
            <label className="flab" htmlFor={ids.subject}>
              Investor wallet — who this credential is for
            </label>
            <select
              id={ids.subject}
              className="fld"
              value={who}
              onChange={(e) => setWho(e.target.value as InvestorId)}
            >
              {state.investors.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} · {short(i.wallet)}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(150px, 100%), 1fr))", gap: 14 }}>
            <div>
              <label className="flab" htmlFor={ids.type}>
                Credential type
              </label>
              <input
                id={ids.type}
                className="fld"
                readOnly
                value={`${registry.schema.name} · v${registry.schema.version}`}
              />
            </div>
            <div>
              <label className="flab" htmlFor={ids.region}>
                Region (from KYC)
              </label>
              <input id={ids.region} className="fld" readOnly value={regionName(investor.jurisdiction)} />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(150px, 100%), 1fr))", gap: 14 }}>
            <div>
              <label className="flab" htmlFor={ids.verified}>
                KYC completed
              </label>
              <select
                id={ids.verified}
                className="fld"
                value={verified}
                onChange={(e) => setVerified(e.target.value as IssueOptions["verified"])}
              >
                {VERIFIED.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="flab" htmlFor={ids.validity}>
                Valid until
              </label>
              <select
                id={ids.validity}
                className="fld"
                value={validity}
                onChange={(e) => setValidity(e.target.value as IssueOptions["validity"])}
              >
                {VALIDITY.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.45 }}>
            {ageLimit(maxAge) === null
              ? `${fund.name} sets no KYC age limit, but requires a credential that has not expired.`
              : `${fund.name} requires KYC completed within the last ${ageLimit(maxAge)}, and a credential that has not expired.`}{" "}
            Dates are set from network time. Renewal replaces evidence atomically, preserves
            compliance holds and invalidation, and does not thaw a frozen account.
          </p>

          <div>
            <label className="flab" htmlFor={ids.by}>
              Issued by
            </label>
            <input
              id={ids.by}
              className="fld"
              readOnly
              value={`${issuer.name} — ${issuer.authorized ? "authorized" : "not authorized"} by ${registry.name}`}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <button
              className="btn violet"
              type="button"
              disabled={busy || !issuer.authorized}
              onClick={() => run(onFile ? "renew" : "issue", who, { verified, validity })}
            >
              {onFile ? "Renew credential" : "Issue credential"}
            </button>
            {onFile && (
              <button className="btn ghost" disabled={busy || !issuer.authorized} onClick={() => run("revoke", who)}>Revoke credential</button>
            )}
          </div>
          {result && (
            <p role="status" style={{ fontSize: 13, color: result.ok ? "var(--ok)" : "var(--bad)" }}>
              {result.message}
              <TransactionLink href={result.transaction} />
            </p>
          )}
          <ChainDetails result={result} />
        </section>

        <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 13 }}>
            <h2 className="lbl">What this creates</h2>
            <p style={{ fontSize: 13.5, color: "var(--ink2)", lineHeight: 1.55 }}>
              A KYC credential written to the chain under the {registry.name} credential and{" "}
              <strong>keyed to {investor.name}&rsquo;s wallet</strong>. The fund reads it when
              they request access. {issuer.name} keeps the underlying documents; only the
              region and the KYC date go on-chain.
            </p>
            <div
              className="card"
              style={{
                padding: "11px 13px",
                background: "var(--okbg)",
                borderColor: "#BFDDC9",
                fontSize: 12.5,
                color: "#155C36",
                lineHeight: 1.45,
              }}
            >
              <strong>Bound to the investor.</strong> The record&rsquo;s address is derived from
              the wallet it was issued to, and the gate checks that wallet owns the account being
              admitted. No one else can present it as their own.
            </div>
          </div>

          <div className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 4 }}>
            <h2 className="lbl" style={{ marginBottom: 6 }}>
              {onFile ? `On file for ${investor.name}` : "Nothing on file yet"}
            </h2>
            {onFile ? (
              <>
                <div className="kv">
                  <span style={{ color: "var(--ink2)" }}>Region</span>
                  <span style={{ fontWeight: 600 }}>{regionName(onFile.jurisdiction)}</span>
                </div>
                <div className="kv">
                  <span style={{ color: "var(--ink2)" }}>KYC completed</span>
                  <span style={{ fontWeight: 600 }}>{formatDate(onFile.verifiedAt)}</span>
                </div>
                <div className="kv">
                  <span style={{ color: "var(--ink2)" }}>Valid until</span>
                  <span style={{ fontWeight: 600 }}>
                    {onFile.expiry === 0 ? "No expiry" : new Date(onFile.expiry * 1000).toLocaleString("en-GB")}
                  </span>
                </div>
                <div className="kv">
                  <span style={{ color: "var(--ink2)" }}>Signed by</span>
                  <span style={{ fontWeight: 600 }}>{onFile.issuerName ?? short(onFile.signer)}</span>
                </div>
                <div className="kv">
                  <span style={{ color: "var(--ink2)" }}>Reference</span>
                  <span className="mono" style={{ fontSize: 12 }} title={onFile.address}>
                    {short(onFile.address)}
                  </span>
                </div>
              </>
            ) : (
              <p style={{ fontSize: 13, color: "var(--ink2)", lineHeight: 1.5 }}>
                {investor.name} has no credential. An active account remains active until the
                sponsor freezes it. <Link href={`/investor/${investor.id}`}>Open the account</Link>
                {" "}to see its current state.
              </p>
            )}
          </div>

          <Link className="btn ghost" href={`/investor/${investor.id}`} style={{ alignSelf: "flex-start" }}>
            Open {investor.name}&rsquo;s account →
          </Link>
        </section>
      </div>
    </Screen>
  );
}
