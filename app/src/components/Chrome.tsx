import Link from "next/link";
import type { ReactNode } from "react";
import { RefreshButton } from "./RefreshButton";

export type Role = "operator" | "authority" | "issuer" | "investor" | "none";

const ROLE_STYLE: Record<
  Exclude<Role, "none">,
  { label: string; background: string; border: string; color: string; dot: string }
> = {
  operator: {
    label: "Fund operator",
    background: "#FBF6E9",
    border: "#EAD9A8",
    color: "#7A5F17",
    dot: "var(--gold)",
  },
  authority: {
    label: "Credential authority",
    background: "var(--icebg)",
    border: "#CFE0E8",
    color: "#2B5468",
    dot: "var(--ice)",
  },
  issuer: {
    label: "Issuer",
    background: "#F1ECF7",
    border: "#DBCFEC",
    color: "#4E3E77",
    dot: "var(--violet)",
  },
  investor: {
    label: "Investor",
    background: "#EEF2F8",
    border: "#D3DEEC",
    color: "var(--accent2)",
    dot: "var(--accent)",
  },
};

function Mark() {
  return (
    <svg width="24" height="24" viewBox="0 0 26 26" fill="none" aria-hidden="true">
      <path d="M6 24V11a7 7 0 0 1 14 0v13" stroke="#2B4C7E" strokeWidth="1.6" />
      <path d="M6 24h14" stroke="#2B4C7E" strokeWidth="1.6" />
      <circle cx="13" cy="8.4" r="1.7" fill="#9A7B2E" />
      <path d="M13 12v9" stroke="#2B4C7E" strokeWidth="1.2" opacity=".5" />
    </svg>
  );
}

export function Chrome({
  role = "none",
  roleLabel,
  subtitle = "Tokenized fund access",
  showBack = true,
  showRefresh = true,
}: {
  role?: Role;
  /** Overrides the role chip's text, e.g. to name the investor. */
  roleLabel?: string;
  subtitle?: string;
  showBack?: boolean;
  /** Off for screens that read something other than the demo state. */
  showRefresh?: boolean;
}) {
  const style = role === "none" ? null : ROLE_STYLE[role];

  return (
    <header
      style={{
        minHeight: 60,
        padding: "10px 26px",
        display: "flex",
        alignItems: "center",
        gap: 14,
        flexWrap: "wrap",
        background: "var(--panel)",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <Mark />
        <span style={{ fontWeight: 600, fontSize: 15 }}>Doors of Durin</span>
        <span
          style={{
            fontSize: 12,
            color: "var(--muted)",
            borderLeft: "1px solid var(--line)",
            paddingLeft: 10,
          }}
        >
          {subtitle}
        </span>
      </span>
      <span style={{ flexGrow: 1 }} />
      {showBack && (
        <Link className="chip" href="/" style={{ color: "var(--accent2)" }}>
          ← Overview
        </Link>
      )}
      {showRefresh && <RefreshButton />}
      <Link
        className="chip mono"
        href="/status"
        style={{ fontSize: 11.5, color: "var(--ink2)", fontWeight: 500 }}
      >
        <span className="dot" style={{ background: "var(--ok)" }} />
        Local demo
      </Link>
      {style && (
        <span
          className="chip"
          style={{
            background: style.background,
            borderColor: style.border,
            color: style.color,
          }}
        >
          <span className="dot" style={{ background: style.dot }} />
          {roleLabel ?? style.label}
        </span>
      )}
    </header>
  );
}

/** The page frame every screen sits in: chrome on top, content below. */
export function Screen({
  children,
  ...chrome
}: Parameters<typeof Chrome>[0] & { children: ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <Chrome {...chrome} />
      <main
        style={{
          flexGrow: 1,
          width: "100%",
          maxWidth: 1280,
          margin: "0 auto",
          padding: "26px 24px 40px",
        }}
      >
        {children}
      </main>
    </div>
  );
}

export function PageTitle({
  eyebrow,
  title,
  aside,
}: {
  eyebrow: string;
  title: string;
  aside?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 14,
        flexWrap: "wrap",
        marginBottom: 18,
      }}
    >
      <div>
        <div className="lbl">{eyebrow}</div>
        <h1
          className="serif"
          style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-.01em" }}
        >
          {title}
        </h1>
      </div>
      {aside && (
        <>
          <span style={{ flexGrow: 1 }} />
          {aside}
        </>
      )}
    </div>
  );
}
