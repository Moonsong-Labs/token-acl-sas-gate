"use client";

import Link from "next/link";
import { Screen, PageTitle } from "@/components/Chrome";
import { ActionError, Unavailable } from "@/components/Notice";
import { TransactionLink } from "@/components/TransactionLink";
import { ChainDetails } from "@/components/ChainDetails";
import { useDemo, short } from "@/lib/client";

export default function Compliance() {
  const { state, busy, run, results } = useDemo();
  if (!state) return <Screen role="operator"><Unavailable /></Screen>;
  return <Screen role="operator">
    <PageTitle eyebrow="Fund operator" title="Compliance actions" />
    <ActionError />
    <p style={{ marginBottom: 20, color: "var(--ink2)", lineHeight: 1.5 }}>
      Freeze only the token account shown for each investor. Expiry, revocation and status
      updates do not freeze an active account automatically. A frozen account retains its balance.
      Compliance holds prevent permissionless re-admission under this fund's policy.
      They permit credential issuance and renewal, and leave active accounts usable until frozen.
    </p>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(330px, 100%), 1fr))", gap: 20 }}>
      {state.investors.map((investor) => {
        const result = results[investor.id];
        return <section key={investor.id} className="card" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 16 }}>
          <h2>{investor.name}</h2>
          <p>{investor.active ? "Active" : "Frozen"} · {investor.balance.toLocaleString("en-GB")} {state.fund.symbol}</p>
          <p className="mono" style={{ fontSize: 12 }} title={investor.token}>Account {short(investor.token)}</p>
          <p>Wallet compliance hold: {investor.walletStatus.blocked ? "On" : "Off"}<br />
            Wallet invalidation: {investor.walletStatus.invalidated ? "On" : "Off"}<br />
            Account compliance hold: {investor.tokenStatus.blocked ? "On" : "Off"}<br />
            Account invalidation: {investor.tokenStatus.invalidated ? "On" : "Off"}</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn" disabled={busy || !investor.active} onClick={() => run("freeze", investor.id)}>Freeze account</button>
            <button className="btn ghost" disabled={busy} onClick={() => run(investor.walletStatus.blocked ? "unblock" : "block", investor.id)}>
              {investor.walletStatus.blocked ? "Remove compliance hold" : "Add compliance hold"}</button>
            <button className="btn ghost" disabled={busy} onClick={() => run(investor.walletStatus.invalidated ? "validate" : "invalidate", investor.id)}>
              {investor.walletStatus.invalidated ? "Clear wallet invalidation" : "Invalidate wallet"}</button>
          </div>
          <p style={{ fontSize: 12, color: "var(--muted)" }}>Renewal cannot clear wallet invalidation. Clear it explicitly after reviewing replacement evidence.</p>
          {result && <p role="status">{result.message}<TransactionLink href={result.transaction} /></p>}
          <ChainDetails result={result ?? null} />
          <Link href={`/investor/${investor.id}`}>Open account and access timeline</Link>
        </section>;
      })}
    </div>
  </Screen>;
}
