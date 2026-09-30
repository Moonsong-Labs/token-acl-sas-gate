/**
 * Opens a confirmed transaction in Surfpool Studio, the surfnet's local
 * explorer. Refused requests fail in preflight and never reach the chain, so
 * they have no transaction to link.
 */
export function TransactionLink({ href }: { href?: string }) {
  if (!href) return null;
  return (
    <>
      {" "}
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        style={{ fontWeight: 600, whiteSpace: "nowrap" }}
      >
        View transaction ↗<span className="sr-only"> in Surfpool Studio (opens in a new tab)</span>
      </a>
    </>
  );
}
