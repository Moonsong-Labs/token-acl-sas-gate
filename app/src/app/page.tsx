"use client";
import { useEffect, useState } from "react";
import type { DemoSnapshot, ActionResult, InvestorId } from "@/lib/server/demo";
import "./demo.css";
const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-6)}`;
const date = (n: number) => new Date(n * 1000).toLocaleString();
export default function Home() {
  const [state, setState] = useState<DemoSnapshot | null>(null);
  const [role, setRole] = useState<"investor" | "issuer">("investor");
  const [id, setId] = useState<InvestorId>("alice");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/demo", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setState(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load demo");
      setState(null);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  async function act(action: "issue" | "activate") {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, investor: id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setResult(data);
      setState(data.state);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }
  const investor = state?.investors.find((i) => i.id === id);
  return (
    <main className="demo">
      <header>
        <div>
          <p className="eyebrow">DOORS OF DURIN / UC1</p>
          <h1>Credential-based admission</h1>
          <p className="intro">
            One fund. Reusable evidence. Admission decided on-chain.
          </p>
        </div>
        <span className="environment">Local surfnet · demo identities</span>
      </header>
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
      {!state ? (
        <section className="card">
          <h2>{busy ? "Connecting to the demo…" : "Demo unavailable"}</h2>
          <p>
            Start the local surfnet and run <code>mise run seed</code> from{" "}
            <code>app/</code>.
          </p>
          <button onClick={refresh} disabled={busy}>
            Retry connection
          </button>
        </section>
      ) : (
        <>
          <section className="card fund">
            <div>
              <p className="eyebrow">FUND ADMISSION POLICY</p>
              <h2>{state.fund.name}</h2>
              <p>
                The fund accepts a current credential from its approved issuer.
              </p>
            </div>
            <dl>
              <div>
                <dt>Accepted jurisdictions</dt>
                <dd>{state.fund.jurisdictions.join(" / ")}</dd>
              </div>
              <div>
                <dt>Verification age</dt>
                <dd>Less than {state.fund.maxAge / 3600} hours</dd>
              </div>
              <div>
                <dt>Approved issuer</dt>
                <dd title={state.fund.issuer}>{short(state.fund.issuer)}</dd>
              </div>
            </dl>
          </section>
          <div className="workspace">
            <aside className="card">
              <p className="eyebrow">PRESENTER CONTROLS</p>
              <h2>Demo role</h2>
              <div className="roles" aria-label="Demo role">
                <button
                  aria-pressed={role === "investor"}
                  onClick={() => setRole("investor")}
                  disabled={busy}
                >
                  Investor view
                </button>
                <button
                  aria-pressed={role === "issuer"}
                  onClick={() => setRole("issuer")}
                  disabled={busy}
                >
                  Issuer view
                </button>
              </div>
              <label htmlFor="investor">Investor</label>
              <select
                id="investor"
                value={id}
                disabled={busy}
                onChange={(e) => {
                  setId(e.target.value as InvestorId);
                  setResult(null);
                  setError("");
                }}
              >
                {state.investors.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} · {i.jurisdiction}
                  </option>
                ))}
              </select>
              <p className="hint">
                Alice has a DE jurisdiction. Bob has a US jurisdiction. Both
                start without credentials.
              </p>
              <button className="secondary" onClick={refresh} disabled={busy}>
                Refresh chain state
              </button>
            </aside>
            {investor && (
              <section className="card account">
                <div className="section-top">
                  <div>
                    <p className="eyebrow">
                      {role === "issuer"
                        ? "ISSUER WORKSPACE"
                        : "INVESTOR ACCOUNT"}
                    </p>
                    <h2>{investor.name}</h2>
                  </div>
                  <span
                    data-testid="account-state"
                    className={`badge ${investor.active ? "active" : ""}`}
                  >
                    {investor.active ? "Active" : "Frozen"}
                  </span>
                </div>
                <p>
                  {investor.active
                    ? "This account has been admitted to the fund."
                    : "This fund account is frozen until admission succeeds."}
                </p>
                <div className="credential">
                  <h3>SAS credential</h3>
                  {investor.credential ? (
                    <dl>
                      <div>
                        <dt>Jurisdiction</dt>
                        <dd>{investor.credential.jurisdiction}</dd>
                      </div>
                      <div>
                        <dt>Verified</dt>
                        <dd>{date(investor.credential.verifiedAt)}</dd>
                      </div>
                      <div>
                        <dt>Expires</dt>
                        <dd>{date(investor.credential.expiry)}</dd>
                      </div>
                    </dl>
                  ) : (
                    <p>No credential issued.</p>
                  )}
                </div>
                {role === "issuer" ? (
                  <>
                    <p>
                      Issue {investor.name}&apos;s verified jurisdiction,{" "}
                      <strong>{investor.jurisdiction}</strong>, using the demo
                      issuer. The fund evaluates whether that jurisdiction
                      qualifies.
                    </p>
                    <button
                      onClick={() => act("issue")}
                      disabled={busy || !!investor.credential}
                    >
                      {busy
                        ? "Submitting…"
                        : investor.credential
                          ? "Credential already issued"
                          : "Issue credential"}
                    </button>
                  </>
                ) : (
                  <>
                    <p>
                      Request admission using the credential bound to this
                      investor&apos;s wallet.
                    </p>
                    <button
                      onClick={() => act("activate")}
                      disabled={busy || investor.active}
                    >
                      {busy
                        ? "Checking admission…"
                        : investor.active
                          ? "Account is active"
                          : "Activate account"}
                    </button>
                  </>
                )}
                {result && (
                  <div
                    role="status"
                    className={`notice ${result.ok ? "success" : "denied"}`}
                  >
                    <strong>{result.message}</strong>
                    <p>
                      {result.ok
                        ? "Transaction confirmed by local surfnet."
                        : "The request was not admitted. No activation was confirmed."}
                    </p>
                    <details>
                      <summary>Chain details</summary>
                      {result.signature && (
                        <p>
                          Transaction: <code>{result.signature}</code>
                        </p>
                      )}
                      {result.logs && <pre>{result.logs.join("\n")}</pre>}
                    </details>
                  </div>
                )}
                <details className="addresses">
                  <summary>Account addresses</summary>
                  <dl>
                    <div>
                      <dt>Wallet</dt>
                      <dd>{investor.wallet}</dd>
                    </div>
                    <div>
                      <dt>Fund token account</dt>
                      <dd>{investor.token}</dd>
                    </div>
                    <div>
                      <dt>Fund mint</dt>
                      <dd>{state.fund.mint}</dd>
                    </div>
                  </dl>
                </details>
              </section>
            )}
          </div>
          <footer>
            Eligibility is checked at activation. Later expiry or revocation
            does not automatically freeze an active account.
          </footer>
        </>
      )}
    </main>
  );
}
