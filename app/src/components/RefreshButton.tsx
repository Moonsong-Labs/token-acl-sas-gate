"use client";

import { useDemo } from "@/lib/client";

/**
 * Re-reads chain state on demand. Screens otherwise refresh when you move
 * between them and after an action, not as network time passes.
 */
export function RefreshButton() {
  const { busy, refresh } = useDemo();
  return (
    <button
      type="button"
      className="chip"
      onClick={refresh}
      disabled={busy}
      title="Reload chain state from the local network"
      style={{
        background: "var(--panel)",
        color: "var(--accent2)",
        cursor: busy ? "progress" : "pointer",
        font: "inherit",
        fontSize: 12,
        fontWeight: 500,
      }}
    >
      <span aria-hidden="true">↻</span> Refresh
    </button>
  );
}
