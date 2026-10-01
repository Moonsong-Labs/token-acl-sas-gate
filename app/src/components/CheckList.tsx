import type { Step } from "@/lib/gate";

const ICON: Record<Step["status"], { glyph: string; bg: string; fg: string }> = {
  passed: { glyph: "✓", bg: "var(--ok)", fg: "#fff" },
  failed: { glyph: "✕", bg: "var(--bad)", fg: "#fff" },
  not_reached: { glyph: "·", bg: "#E7E4DC", fg: "#6E6A61" },
};

const SPOKEN: Record<Step["status"], string> = {
  passed: "passed",
  failed: "failed",
  not_reached: "not checked",
};

function PhaseHeading({ children }: { children: string }) {
  return (
    <div
      style={{
        fontSize: 10.5,
        letterSpacing: ".07em",
        textTransform: "uppercase",
        color: "var(--muted)",
        fontWeight: 600,
        margin: "10px 0 3px",
      }}
    >
      {children}
    </div>
  );
}

function Row({ step }: { step: Step }) {
  const icon = ICON[step.status];
  const failed = step.status === "failed";
  return (
    <li
      style={{
        display: "flex",
        gap: 10,
        alignItems: "center",
        fontSize: 13,
        padding: "5px 0",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          flex: "none",
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: icon.bg,
          color: icon.fg,
          fontSize: 11,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {icon.glyph}
      </span>
      <span
        style={{
          fontWeight: failed ? 600 : 400,
          color: failed
            ? "var(--bad)"
            : step.status === "not_reached"
              ? "var(--muted)"
              : "var(--ink)",
        }}
      >
        {step.label}
      </span>
      <span className="sr-only">{SPOKEN[step.status]}</span>
    </li>
  );
}

const list = { listStyle: "none", margin: 0, padding: 0 } as const;

/**
 * The gate's checks in the order it runs them: inputs first, then the policy
 * steps, stopping at the first failure.
 */
export function CheckList({
  steps,
  heading,
  note,
}: {
  steps: Step[];
  heading: string;
  note?: string;
}) {
  return (
    <div
      className="card"
      style={{ padding: "18px 20px", display: "flex", flexDirection: "column" }}
    >
      <h2 className="lbl" style={{ margin: 0 }}>
        {heading}{" "}
        <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
          (in the order the gate runs them)
        </span>
      </h2>
      <PhaseHeading>First — are the inputs genuine?</PhaseHeading>
      <ul style={list}>
        {steps
          .filter((s) => s.phase === "inputs")
          .map((step) => (
            <Row key={step.id} step={step} />
          ))}
      </ul>
      <PhaseHeading>Then — does the fund&rsquo;s policy allow it?</PhaseHeading>
      <ul style={list}>
        {steps
          .filter((s) => s.phase === "policy")
          .map((step) => (
            <Row key={step.id} step={step} />
          ))}
      </ul>
      {note && (
        <div
          style={{
            fontSize: 11.5,
            color: "var(--muted)",
            borderTop: "1px solid var(--line)",
            paddingTop: 9,
            marginTop: 10,
            lineHeight: 1.45,
          }}
        >
          {note}
        </div>
      )}
    </div>
  );
}
