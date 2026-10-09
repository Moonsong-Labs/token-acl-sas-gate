"use client";

import Link from "next/link";
import { useState } from "react";
import { Screen, PageTitle } from "@/components/Chrome";
import { ChainDetails } from "@/components/ChainDetails";
import { Unavailable, ActionError } from "@/components/Notice";
import { TransactionLink } from "@/components/TransactionLink";
import { useDemo, regionList, short } from "@/lib/client";
import { CODES } from "@/lib/gate";

export default function Funds() {
  const { state, busy, run, results, secondResults } = useDemo();
  const [selected, setSelected] = useState<"retail" | "france">("retail");
  const result = (selected === "retail" ? results : secondResults).lena;
  if (!state) return <Screen><Unavailable /></Screen>;
  const credential = state.investors[0].credential;
  const code = result?.decision && "code" in result.decision ? result.decision.code : null;

  return (
    <Screen role="investor" roleLabel="Lena R.">
      <ActionError />
      <PageTitle eyebrow="Use case 5" title="Two funds, one credential" />
      <p style={{ marginBottom: 20 }}>
        Both funds accept the same registry, schema, issuer and KYC age. Only their
        accepted regions differ. Lena&apos;s DE credential can admit her to Meridian
        EU Retail, while Meridian France refuses it.
      </p>
      <Link className="btn ghost" href="/issuer">Issue or renew credential</Link>
      <p style={{ marginBottom: 20 }}>
        Shared evidence: {credential ? short(credential.address) : "No credential on file. Issue Lena a credential on the issuer screen."}
      </p>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))",
        gap: 20,
      }}>
        {[state, state.second].map((view, index) => {
          const investor = view.investors[0];
          return (
            <section className="card" style={{ padding: 20 }} key={view.fund.mint}>
              <h2>{view.fund.name}</h2>
              <p>Accepted regions: {regionList(view.fund.policy.jurisdictions)}</p>
              <p>KYC age limit: {view.fund.policy.maxAge / 86400} days</p>
              <p data-testid={`fund-state-${index}`}>{investor.active ? "Active" : "Frozen"}</p>
              <p>Balance: {investor.balance} {view.fund.symbol}</p>
              <p className="mono">Mint: {short(view.fund.mint)}</p>
              <button
                className="btn"
                disabled={busy || investor.active}
                onClick={() => {
                  const fund = index ? "france" : "retail";
                  setSelected(fund);
                  void run("activate", "lena", undefined, fund);
                }}
              >
                Request access to {view.fund.name}
              </button>
            </section>
          );
        })}
      </div>
      {result && (
        <p role="status" style={{ marginTop: 20 }}>
          {result.message} {code != null ? `${CODES[code]?.name ?? "Gate"} · ${code}` : ""}
          <TransactionLink href={result.transaction} />
        </p>
      )}
      <ChainDetails result={result} />
    </Screen>
  );
}
