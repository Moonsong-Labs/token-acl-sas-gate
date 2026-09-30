"use client";

import { useDemo } from "@/lib/client";

/**
 * Shown in place of a screen's content until chain state is available. The
 * screens have nothing to show without it: every fact on them is read from the
 * surfnet, so a missing surfnet or seed is stated plainly rather than papered over.
 */
export function Unavailable() {
  const { error, busy, refresh } = useDemo();
  return (
    <section
      className="card"
      style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12, maxWidth: 640 }}
    >
      <h2 className="serif" style={{ fontSize: 22 }}>
        {busy && !error ? "Reading the local network…" : "Demo unavailable"}
      </h2>
      {error && (
        <p role="alert" style={{ color: "var(--bad)", fontSize: 13.5 }}>
          {error}
        </p>
      )}
      <p style={{ fontSize: 13.5, color: "var(--ink2)", lineHeight: 1.55 }}>
        Start the surfnet with <code>mise run surfnet</code>, then seed it with{" "}
        <code>mise run seed</code>, both from <code>app/</code>.
      </p>
      <div>
        <button className="btn ghost" type="button" onClick={refresh} disabled={busy}>
          Retry
        </button>
      </div>
    </section>
  );
}

/** An action error that is not a chain outcome, e.g. a precondition. */
export function ActionError() {
  const { state, error } = useDemo();
  if (!state || !error) return null;
  return (
    <div
      role="alert"
      className="card"
      style={{
        padding: "12px 16px",
        marginBottom: 16,
        background: "var(--warnbg)",
        borderColor: "#EAD9A8",
        color: "#6C4E12",
        fontSize: 13,
      }}
    >
      {error}
    </div>
  );
}
