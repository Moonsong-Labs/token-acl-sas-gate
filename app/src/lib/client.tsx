"use client";

// The screens' view of the demo. Chain state lives on the local surfnet and is
// read through `/api/demo`; nothing is simulated in the browser. One provider
// holds the latest snapshot and the last action's results across screens. The
// snapshot is re-read when moving between screens and on Refresh, so a screen
// catches up with network time (e.g. a credential that has since expired).

import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  ActionResult,
  Action,
  DemoSnapshot,
  InvestorId,
  IssueOptions,
} from "@/lib/server/demo";

export type { ActionResult, DemoSnapshot, InvestorId, IssueOptions };
export type Investor = DemoSnapshot["investors"][number];

interface Demo {
  state: DemoSnapshot | null;
  /** Why the snapshot could not be loaded, e.g. the surfnet is down or unseeded. */
  error: string;
  busy: boolean;
  /** The last action's outcome, keyed by investor so each screen shows its own. */
  results: Partial<Record<InvestorId, ActionResult & { action: Action }>>;
  secondResults: Demo["results"];
  refresh: () => Promise<void>;
  run: (action: Action, investor: InvestorId, options?: IssueOptions, fund?: "retail" | "france") => Promise<void>;
}

const DemoContext = createContext<Demo | null>(null);

export function DemoProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DemoSnapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Demo["results"]>({});
  const [secondResults, setSecondResults] = useState<Demo["results"]>({});
  // Snapshots come from reads and from actions, and must only ever move the
  // screen forward. An action's own result is the newest state when it lands,
  // so: no navigation read starts while an action runs; `epoch` changes when an
  // action starts and when it settles, so a read that spans either is dropped;
  // and of overlapping reads, only the most recently started one applies.
  const epoch = useRef(0);
  const inFlight = useRef(0);
  const lastRead = useRef(0);
  const loaded = useRef(false);
  const pathname = usePathname();

  /** A snapshot, or `undefined` if a newer source superseded it in flight. */
  const read = useCallback(async (): Promise<DemoSnapshot | undefined> => {
    const id = ++lastRead.current;
    const startedIn = epoch.current;
    const response = await fetch("/api/demo", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    return epoch.current === startedIn && lastRead.current === id ? data : undefined;
  }, []);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const data = await read();
      if (data) setState(data);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load the demo.");
    } finally {
      setBusy(false);
    }
  }, [read]);

  // On navigation, re-read without disabling the screen or flashing an error:
  // a failed read leaves the last snapshot, and Refresh shows any error.
  const quietRefresh = useCallback(async () => {
    if (inFlight.current > 0) return;
    try {
      const data = await read();
      if (data) setState(data);
    } catch {}
  }, [read]);

  // The first load shows progress and errors; later screens re-read quietly.
  // An error belongs to the screen it happened on, so moving on clears it.
  useEffect(() => {
    if (loaded.current) {
      setError("");
      void quietRefresh();
    } else {
      loaded.current = true;
      void refresh();
    }
  }, [pathname, refresh, quietRefresh]);

  const run = useCallback(
    async (action: Action, investor: InvestorId, options?: IssueOptions, fund?: "retail" | "france") => {
      inFlight.current += 1;
      epoch.current += 1;
      setBusy(true);
      // One ID per click. If the response is lost in transit, the same request
      // is sent once more under the same ID, and the server returns the
      // original outcome rather than sending the transaction again.
      const body = JSON.stringify({ action, investor, options, fund, requestId: crypto.randomUUID() });
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
        (fund === "france" ? setSecondResults : setResults)((current) => ({ ...current, [investor]: { ...data, action } }));
        setError("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Action failed.");
        // The previous outcome for this investor no longer describes the last
        // thing that happened; leave only the error.
        (fund === "france" ? setSecondResults : setResults)(({ [investor]: _previous, ...rest }) => rest);
      } finally {
        inFlight.current -= 1;
        epoch.current += 1;
        setBusy(false);
      }
    },
    [],
  );

  return (
    <DemoContext.Provider value={{ state, error, busy, results, secondResults, refresh, run }}>
      {children}
    </DemoContext.Provider>
  );
}

export function useDemo(): Demo {
  const value = useContext(DemoContext);
  if (!value) throw new Error("useDemo must be used inside <DemoProvider>");
  return value;
}

// Pure formatting helpers live in ./format so they can be tested without React.
export {
  short,
  formatDate,
  formatDuration,
  ageLimit,
  REGION_NAMES,
  regionName,
  regionList,
} from "./format";
