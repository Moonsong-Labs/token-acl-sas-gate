"use client";

import Link from "next/link";
import { useState } from "react";
import { Screen, PageTitle } from "@/components/Chrome";
import { ChainDetails } from "@/components/ChainDetails";
import { Unavailable, ActionError } from "@/components/Notice";
import { TransactionLink } from "@/components/TransactionLink";
import { useDemo, regionList, short, ageLimit, type InvestorId } from "@/lib/client";
import { CODES } from "@/lib/gate";

export default function Funds() {
  const { state, busy, run, results, secondResults } = useDemo();
  const [who, setWho] = useState<InvestorId>("lena");
  const [selected, setSelected] = useState<"retail" | "us">("retail");
  const result = (selected === "retail" ? results : secondResults)[who];
  if (!state) return <Screen><Unavailable /></Screen>;
  const holder = state.investors.find((investor) => investor.id === who)!;
  const code = result?.decision && "code" in result.decision ? result.decision.code : null;

  return (
    <Screen role="investor" roleLabel={holder.name}>
      <ActionError />
      <PageTitle eyebrow="Investor" title="Two funds, one credential" />
      <p style={{ maxWidth: 720, color: "var(--ink2)", lineHeight: 1.6, marginBottom: 20 }}>
        One credential per investor, shared across both funds. EU Retail accepts Germany
        and France; Meridian US accepts the United States. Lena qualifies for EU Retail,
        and Mark qualifies for the US fund, when their credentials are current.
      </p>
      <section className="card" style={{ padding: 20, marginBottom: 20, display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 200px" }}>
          <label className="flab" htmlFor="fund-investor">Compare access for</label>
          <select id="fund-investor" className="fld" value={who} onChange={(event) => setWho(event.target.value as InvestorId)}>
            {state.investors.map((investor) => <option key={investor.id} value={investor.id}>{investor.name} · {investor.jurisdiction}</option>)}
          </select>
        </div>
        <div style={{ flex: "2 1 240px", display: "grid", gap: 6 }}>
          <h2 className="lbl">Shared credential</h2>
          <p style={{ fontSize: 13, color: "var(--ink2)" }}>
            {holder.credential ? `${holder.credential.jurisdiction} · ${short(holder.credential.address)}` : "No credential on file"}
          </p>
          <p style={{ fontSize: 12, color: "var(--muted)" }}>Same registry, schema, issuer and KYC age limit for both funds.</p>
        </div>
        <Link className="btn ghost" href="/issuer">Issue or renew credential</Link>
      </section>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: 20 }}>
        {[state, state.second].map((view, index) => {
          const investor = view.investors.find((item) => item.id === who)!;
          return (
            <section className="card" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 18 }} key={view.fund.mint}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div style={{ display: "grid", gap: 5 }}>
                  <span className="lbl">{view.fund.symbol}</span>
                  <h2 className="serif" style={{ fontSize: 23 }}>{view.fund.name}</h2>
                </div>
                <span className="chip" data-testid={`fund-state-${index}`} style={{ color: investor.active ? "var(--ok)" : "var(--warn)", background: investor.active ? "var(--okbg)" : "var(--warnbg)" }}>
                  {investor.active ? "Active" : "Frozen"}
                </span>
              </div>
              <div>
                <div className="kv"><span>Accepted regions</span><strong style={{ textAlign: "right" }}>{regionList(view.fund.policy.jurisdictions)}</strong></div>
                <div className="kv"><span>KYC age limit</span><strong>{ageLimit(view.fund.policy.maxAge) ?? "No limit"}</strong></div>
                <div className="kv"><span>Balance</span><strong>{investor.balance} {view.fund.symbol}</strong></div>
                <div className="kv"><span>Mint</span><span className="mono" title={view.fund.mint}>{short(view.fund.mint)}</span></div>
              </div>
              <button className="btn" style={{ justifyContent: "center", width: "100%", marginTop: "auto" }} disabled={busy || investor.active} onClick={() => {
                const fund = index ? "us" : "retail";
                setSelected(fund);
                void run("activate", who, undefined, fund);
              }}>Request access to {view.fund.name}</button>
            </section>
          );
        })}
      </div>
      {result && <div className="card" style={{ padding: 18, marginTop: 20, display: "grid", gap: 12 }}>
        <p role="status" style={{ color: result.ok ? "var(--ok)" : "var(--bad)", lineHeight: 1.5 }}>
          {result.message} {code != null ? `${CODES[code]?.name ?? "Gate"} · ${code}` : ""}
          <TransactionLink href={result.transaction} />
        </p>
        <ChainDetails result={result} />
      </div>}
    </Screen>
  );
}
