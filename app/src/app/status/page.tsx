"use client";

import { useCallback, useEffect, useState } from "react";
import { PageTitle, Screen } from "@/components/Chrome";
import { short } from "@/lib/client";
import type { NetworkStatus } from "@/lib/server/demo";

type ProgramState = NetworkStatus["programs"][number]["state"];

const TONE: Record<ProgramState, { color: string; background: string; border: string }> = {
  executable: { color: "var(--ok)", background: "var(--okbg)", border: "#BFDDC9" },
  "not a program": { color: "var(--warn)", background: "var(--warnbg)", border: "#EAD9A8" },
  absent: { color: "var(--bad)", background: "var(--badbg)", border: "#E4C4C2" },
};

export default function StatusScreen() {
  const [status, setStatus] = useState<NetworkStatus | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/status", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setStatus(data);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Status unavailable");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen subtitle="Network status">
      <PageTitle
        eyebrow="Environment"
        title="Surfnet and programs"
        aside={
          <button className="btn ghost" type="button" onClick={load}>
            Refresh
          </button>
        }
      />
      {error && (
        <p role="alert" style={{ color: "var(--bad)", marginBottom: 16 }}>
          {error}
        </p>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))",
          gap: 18,
          alignItems: "start",
        }}
      >
        <section className="card" style={{ padding: "20px 22px", display: "flex", flexDirection: "column" }}>
          <h2 className="lbl" style={{ marginBottom: 8 }}>
            Connection
          </h2>
          <div className="kv">
            <span style={{ color: "var(--ink2)" }}>RPC endpoint</span>
            <span className="mono" style={{ fontSize: 12 }}>
              {status?.endpoint ?? "…"}
            </span>
          </div>
          <div className="kv">
            <span style={{ color: "var(--ink2)" }}>Health</span>
            <span style={{ fontWeight: 600 }}>
              {!status ? "checking…" : status.healthy ? "ok" : "unreachable — start the surfnet"}
            </span>
          </div>
          <div className="kv">
            <span style={{ color: "var(--ink2)" }}>Network time</span>
            <span style={{ fontWeight: 600 }}>
              {status?.now
                ? new Date(status.now * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC"
                : "—"}
            </span>
          </div>
          <div className="kv">
            <span style={{ color: "var(--ink2)" }}>Demo session</span>
            <span style={{ fontWeight: 600 }}>
              {!status ? "…" : status.seeded ? "seeded" : "not seeded — run mise run seed"}
            </span>
          </div>
          <p
            style={{
              fontSize: 11.5,
              color: "var(--muted)",
              borderTop: "1px solid var(--line)",
              paddingTop: 10,
              marginTop: 8,
              lineHeight: 1.45,
            }}
          >
            Credential expiry and KYC age are judged against network time, the same clock the
            gate reads — not your computer&rsquo;s.
          </p>
        </section>

        <section className="card" style={{ padding: "20px 22px", display: "flex", flexDirection: "column" }}>
          <h2 className="lbl" style={{ marginBottom: 8 }}>
            Programs
          </h2>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <tbody>
              {(status?.programs ?? []).map((program) => {
                const tone = TONE[program.state];
                return (
                  <tr key={program.id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: "9px 0", fontSize: 13 }}>{program.name}</td>
                    <td className="mono" style={{ padding: "9px 0", fontSize: 12, color: "var(--muted)" }}>
                      {short(program.id)}
                    </td>
                    <td style={{ padding: "9px 0", textAlign: "right" }}>
                      <span
                        className="chip"
                        style={{ background: tone.background, borderColor: tone.border, color: tone.color, fontWeight: 600 }}
                      >
                        {program.state}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p
            style={{
              fontSize: 11.5,
              color: "var(--muted)",
              borderTop: "1px solid var(--line)",
              paddingTop: 10,
              marginTop: 8,
              lineHeight: 1.45,
            }}
          >
            The seed deploys all three: SAS and Token ACL from the hash-pinned binaries under{" "}
            <code>tests/fixtures/programs</code>, and the gate from <code>target/deploy</code>.
          </p>
        </section>
      </div>
    </Screen>
  );
}
