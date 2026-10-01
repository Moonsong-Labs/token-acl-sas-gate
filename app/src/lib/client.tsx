"use client";

// The screens' view of the demo. Chain state lives on the local surfnet and is
// read through `/api/demo`; nothing is simulated in the browser. One provider
// holds the latest snapshot so moving between screens does not refetch or lose
// the last action's result.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type {
  ActionResult,
  DemoSnapshot,
  InvestorId,
  IssueOptions,
} from "@/lib/server/demo";

export type { ActionResult, DemoSnapshot, InvestorId, IssueOptions };
export type Investor = DemoSnapshot["investors"][number];
type Action = "issue" | "activate" | "allocate";

interface Demo {
  state: DemoSnapshot | null;
  /** Why the snapshot could not be loaded, e.g. the surfnet is down or unseeded. */
  error: string;
  busy: boolean;
  /** The last action's outcome, keyed by investor so each screen shows its own. */
  results: Partial<Record<InvestorId, ActionResult & { action: Action }>>;
  refresh: () => Promise<void>;
  run: (action: Action, investor: InvestorId, options?: IssueOptions) => Promise<void>;
}

const DemoContext = createContext<Demo | null>(null);

export function DemoProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DemoSnapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Demo["results"]>({});

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/demo", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setState(data);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load the demo.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(
    async (action: Action, investor: InvestorId, options?: IssueOptions) => {
      setBusy(true);
      // One ID per click. If the response is lost in transit, the same request
      // is sent once more under the same ID, and the server returns the
      // original outcome rather than sending the transaction again.
      const body = JSON.stringify({ action, investor, options, requestId: crypto.randomUUID() });
      const post = () =>
        fetch("/api/demo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
      try {
        const response = await post().catch(post);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (data.state) setState(data.state);
        setResults((current) => ({ ...current, [investor]: { ...data, action } }));
        setError("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Action failed.");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return (
    <DemoContext.Provider value={{ state, error, busy, results, refresh, run }}>
      {children}
    </DemoContext.Provider>
  );
}

export function useDemo(): Demo {
  const value = useContext(DemoContext);
  if (!value) throw new Error("useDemo must be used inside <DemoProvider>");
  return value;
}

export function short(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function formatDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDuration(seconds: number): string {
  const days = Math.round(seconds / 86_400);
  if (days >= 365 && days % 365 === 0) return `${days / 365} year${days === 365 ? "" : "s"}`;
  if (days >= 1) return `${days} day${days === 1 ? "" : "s"}`;
  return `${Math.round(seconds / 60)} minutes`;
}

export const REGION_NAMES: Record<string, string> = {
  DE: "Germany",
  FR: "France",
  US: "United States",
};

export function regionName(code: string): string {
  return REGION_NAMES[code] ?? code;
}

export function regionList(codes: string[]): string {
  const names = codes.map(regionName);
  return names.length <= 1
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
