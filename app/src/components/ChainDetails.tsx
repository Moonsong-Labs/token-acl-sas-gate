import type { ActionResult } from "@/lib/client";
import { TransactionLink } from "./TransactionLink";

/**
 * What the chain returned for the last action, collapsed by default. A confirmed
 * transaction shows its signature and a Studio link; a refused one never reached
 * the chain, so its error and the preflight program logs are the only record.
 */
export function ChainDetails({ result }: { result: ActionResult | null | undefined }) {
  if (!result || (!result.signature && !result.logs?.length)) return null;
  return (
    <details className="chain-details">
      <summary>Chain details</summary>
      {result.signature && (
        <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "var(--ink2)" }}>
          Signature{" "}
          <code className="mono" style={{ fontSize: 11.5, overflowWrap: "anywhere" }}>
            {result.signature}
          </code>
          <TransactionLink href={result.transaction} />
        </p>
      )}
      {result.logs && result.logs.length > 0 && (
        <pre aria-label="Program logs">{result.logs.join("\n")}</pre>
      )}
    </details>
  );
}
