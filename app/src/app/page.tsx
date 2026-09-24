"use client";

import { useEffect, useState } from "react";
import { PROGRAMS } from "@/lib/ids";
import { RPC_URL, rpc } from "@/lib/rpc";

type Status = "checking…" | "executable" | "not a program" | "absent" | "error";

type Row = { name: string; id: string; status: Status };

function short(id: string): string {
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

export default function Home() {
  const [health, setHealth] = useState<string>("checking…");
  const [rows, setRows] = useState<Row[]>(
    PROGRAMS.map((p) => ({ name: p.name, id: p.id, status: "checking…" })),
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const h = await rpc.getHealth().send();
        if (!cancelled) setHealth(String(h));
      } catch {
        if (!cancelled) setHealth("unreachable — is `surfpool start` running?");
      }

      const next: Row[] = [];
      for (const p of PROGRAMS) {
        try {
          const { value } = await rpc
            .getAccountInfo(p.id, { encoding: "base64" })
            .send();
          const status: Status = !value
            ? "absent"
            : value.executable
              ? "executable"
              : "not a program";
          next.push({ name: p.name, id: p.id, status });
        } catch {
          next.push({ name: p.name, id: p.id, status: "error" });
        }
      }
      if (!cancelled) setRows(next);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "56px 24px" }}>
      <h1 style={{ marginBottom: 4 }}>Doors of Durin — demo skeleton</h1>
      <p style={{ color: "#41474f" }}>
        Surfnet RPC <code>{RPC_URL}</code> · health:{" "}
        <strong>{health}</strong>
      </p>

      <h2 style={{ marginTop: 32 }}>Programs</h2>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderTop: "1px solid #e6e3db" }}>
              <td style={{ padding: "8px 0" }}>{r.name}</td>
              <td style={{ padding: "8px 0", fontFamily: "monospace" }}>
                {short(r.id)}
              </td>
              <td style={{ padding: "8px 0", fontWeight: 600 }}>{r.status}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p style={{ marginTop: 32, color: "#727a85", fontSize: 13 }}>
        Wiring only. The gate (<code>doors-of-durin</code>) shows <em>absent</em>{" "}
        until deployed to the surfnet; SAS and Token ACL resolve once the surfnet
        forks them from mainnet. Role screens (per the mockups) and the real thaw
        flow land next.
      </p>
    </main>
  );
}
