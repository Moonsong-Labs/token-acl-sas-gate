"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Screen } from "@/components/Chrome";
import { useDemo } from "@/lib/client";

function Persona({
  tag,
  tagBackground,
  tagColor,
  blurb,
  children,
}: {
  tag: string;
  tagBackground: string;
  tagColor: string;
  blurb: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className="card"
      style={{ padding: "16px 17px", display: "flex", flexDirection: "column", gap: 11 }}
    >
      <h2
        style={{
          fontSize: 11,
          fontWeight: 700,
          padding: "2px 9px",
          borderRadius: 6,
          alignSelf: "flex-start",
          background: tagBackground,
          color: tagColor,
        }}
      >
        {tag}
      </h2>
      <p style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.45 }}>{blurb}</p>
      {children}
    </div>
  );
}

function Nav({ n, href, children }: { n: ReactNode; href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 11px",
        border: "1px solid var(--line)",
        borderRadius: 9,
        background: "#FCFBF8",
        fontSize: 13,
        fontWeight: 500,
        color: "var(--ink)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          flex: "none",
          width: 22,
          height: 22,
          borderRadius: 6,
          background: "#EEF2F8",
          color: "var(--accent2)",
          fontSize: 12,
          fontWeight: 600,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {n}
      </span>
      {children}
    </Link>
  );
}

export default function Overview() {
  const { state } = useDemo();
  const fund = state?.fund.name ?? "the fund";
  const registry = state?.registry.name ?? "the credential authority";
  const issuer = state?.issuer.name ?? "the issuer";
  const [lena, mark] = state?.investors ?? [];

  return (
    <Screen showBack={false}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))",
          gap: 24,
          alignItems: "start",
        }}
      >
        <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div className="lbl">Live demo · use cases 1, 2 and 5</div>
            <h1
              className="serif"
              style={{ fontSize: 33, fontWeight: 700, lineHeight: 1.1, letterSpacing: "-.01em" }}
            >
              Access to a regulated token, decided by credentials
            </h1>
          </div>
          <p style={{ fontSize: 14.5, color: "var(--ink2)", lineHeight: 1.55 }}>
            Instead of an eligible-investor spreadsheet, the fund accepts a reusable KYC
            credential the investor already holds. When access is requested, the gate program
            reads that credential on-chain and admits the account only if it meets the
            fund&rsquo;s policy. Every refusal names the check that failed.
          </p>

          <div
            className="card"
            style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}
          >
            <h2 className="lbl">What this build covers</h2>
            {[
              "A locked account, and an access request refused with a named reason",
              "An issuer writing a credential bound to the investor's own wallet",
              "Admission the moment the credential meets the fund's policy — and only admitted accounts can receive the fund's token",
            ].map((line, index) => (
              <div
                key={line}
                style={{
                  display: "flex",
                  gap: 9,
                  alignItems: "flex-start",
                  fontSize: 13.5,
                  color: "var(--ink2)",
                  lineHeight: 1.45,
                }}
              >
                <span style={{ color: "var(--ok)", fontWeight: 700 }}>{index + 1}</span>
                <span>{line}</span>
              </div>
            ))}
            <p
              style={{
                fontSize: 11.5,
                color: "var(--muted)",
                borderTop: "1px solid var(--line)",
                paddingTop: 9,
                lineHeight: 1.45,
              }}
            >
              Revoke or renew a credential, freeze the supplied account, and request admission
              again. Compliance holds survive renewal. Compare admission to two funds using the same credential.
            </p>
          </div>

          <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
            Runs against a local test network with the real gate, Solana Attestation Service
            and Token ACL programs. No real funds and no mainnet transactions.
          </p>
        </section>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))",
            gap: 16,
          }}
        >
          <Persona
            tag="Fund operator"
            tagBackground="#FBF6E9"
            tagColor="#7A5F17"
            blurb={`Sets up ${fund} and the policy for who may hold it.`}
          >
            <Nav n={1} href="/operator">
              Fund setup
            </Nav>
            <Nav n={7} href="/compliance">Compliance actions</Nav>
          </Persona>

          <Persona
            tag="Credential authority"
            tagBackground="var(--icebg)"
            tagColor="#2B5468"
            blurb={`${registry} owns the KYC credential and its schema, and decides which issuers may write under it.`}
          >
            <Nav n="·" href="/authority">
              Credential &amp; issuers
            </Nav>
          </Persona>

          <Persona
            tag="Issuer"
            tagBackground="#F1ECF7"
            tagColor="#4E3E77"
            blurb={`${issuer} confirms an investor's KYC and issues the credential, as an authorized issuer of ${registry}.`}
          >
            <Nav n={3} href="/issuer">
              Issue, renew or revoke credential
            </Nav>
          </Persona>

          <Persona
            tag="Investor"
            tagBackground="#EEF2F8"
            tagColor="var(--accent2)"
            blurb="Requests access and holds the fund's token once admitted."
          >
            <div style={{ display: "grid", gap: 9 }}>
              <Nav n={2} href="/investor/lena">
                {lena ? `${lena.name} — account` : "First investor"}
              </Nav>
              <Nav n={9} href="/funds">Two funds, one credential</Nav>
              <Nav n={6} href="/investor/mark">
                {mark ? `${mark.name} — account` : "Second investor"}
              </Nav>
            </div>
          </Persona>

          <Persona
            tag="Environment"
            tagBackground="#EEEBE3"
            tagColor="var(--ink2)"
            blurb="Surfnet connectivity and the programs the demo runs."
          >
            <Nav n="·" href="/status">
              Network status
            </Nav>
          </Persona>
        </section>
      </div>
    </Screen>
  );
}
