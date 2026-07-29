/**
 * Owns the offline queue and decides when to drain it.
 *
 * Lives at the app root, above the screens, because two of them write to the
 * same queue — Shop Mode queues buys, the shop list queues adds — and the nav
 * needs the pending count. Same shape as ToastProvider, and it sits inside it
 * so a finished sync can report itself.
 *
 * The rules for what to send and what to do with each reply are in
 * src/client/lib/outbox.ts and tested there. This file is only the plumbing:
 * React state, the sender, and the triggers.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ListEntry } from "@shared/types";
import * as api from "../api";
import { useToast } from "./Toast";
import {
  describeRequest,
  drain,
  enqueue,
  isResolvedLocally,
  loadQueue,
  removeOp,
  saveQueue,
  type OutboxOp,
  type SendResult,
} from "../lib/outbox";

interface QueueAddInput {
  itemId?: string | null;
  customName?: string | null;
  qty?: number | null;
}

interface OutboxValue {
  online: boolean;
  queue: OutboxOp[];
  pending: number;
  syncing: boolean;
  queueBuy: (entryId: string, qty: number | null, priceTotal: number | null) => void;
  queueSkip: (entryId: string) => void;
  /** Returns the operation, whose id is also the entry's id until it syncs. */
  queueAdd: (input: QueueAddInput) => OutboxOp;
  hasQueuedResolution: (entryId: string) => boolean;
  /** Drops a queued operation that has not been sent — undo for an offline add. */
  cancelQueued: (id: string) => void;
  sync: () => Promise<void>;
}

const OutboxContext = createContext<OutboxValue>({
  online: true,
  queue: [],
  pending: 0,
  syncing: false,
  queueBuy: () => {},
  queueSkip: () => {},
  queueAdd: () => ({ kind: "add", id: "", createdAt: 0, attempts: 0, itemId: null, customName: null, qty: null }),
  hasQueuedResolution: () => false,
  cancelQueued: () => {},
  sync: async () => {},
});

export const useOutbox = () => useContext(OutboxContext);

const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * Sends one queued operation.
 *
 * What each operation asks for lives in describeRequest, where it can be
 * asserted without a network; this only performs it.
 */
async function send(op: OutboxOp): Promise<SendResult> {
  const { method, path, body } = describeRequest(op);
  const res = await api.rawRequest(method, path, body);

  return {
    status: res.status,
    body: res.body as SendResult["body"],
    // Only an add creates a row whose id the rest of the queue may be waiting on.
    entryId: op.kind === "add" ? (res.body as ListEntry | null)?.id : undefined,
  };
}

export function OutboxProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<OutboxOp[]>(() => loadQueue());
  const [online, setOnline] = useState(() => navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const { toast } = useToast();

  // The queue is read inside async work that outlives the render it started in,
  // so state alone would hand a drain the array as it was when the trigger was
  // registered. The ref is what `sync` actually reads.
  const queueRef = useRef(queue);
  const syncingRef = useRef(false);

  const commit = useCallback((next: OutboxOp[]) => {
    queueRef.current = next;
    setQueue(next);
    saveQueue(next);
  }, []);

  const push = useCallback(
    (op: OutboxOp) => {
      commit(enqueue(queueRef.current, op));
      return op;
    },
    [commit],
  );

  const sync = useCallback(async () => {
    // Two triggers can fire together — coming back online usually also makes
    // the tab visible — and a queue drained twice at once would send the head
    // operation twice. Harmless thanks to the server's guards, but pointless.
    if (syncingRef.current || queueRef.current.length === 0) return;
    syncingRef.current = true;
    setSyncing(true);

    try {
      const { queue: left, summary } = await drain(queueRef.current, send);
      commit(left);

      if (summary.dropped.length > 0) {
        toast(summary.dropped[0]!.reason, "error");
      } else if (summary.synced > 0 && summary.already > 0) {
        toast(
          `Synced ${summary.synced}. ${summary.already} already bought.`,
          "info",
        );
      } else if (summary.synced > 0) {
        toast(`Synced ${summary.synced} item${summary.synced === 1 ? "" : "s"}`);
      } else if (summary.already > 0) {
        toast(`${summary.already} already bought`, "info");
      }
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [commit, toast]);

  // Background Sync would be the textbook answer here and is deliberately not
  // used: it is Chrome-only and absent on iOS Safari, so half this household
  // would silently never sync. These four triggers work on both phones.
  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      sync();
    };
    const goOffline = () => setOnline(false);
    const onVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine) sync();
    };

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    document.addEventListener("visibilitychange", onVisible);
    if (navigator.onLine) sync();

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [sync]);

  const value: OutboxValue = {
    online,
    queue,
    pending: queue.length,
    syncing,
    queueBuy: (entryId, qty, priceTotal) => {
      push({ kind: "buy", id: crypto.randomUUID(), createdAt: nowSeconds(), attempts: 0, entryId, qty, priceTotal });
      if (navigator.onLine) sync();
    },
    queueSkip: (entryId) => {
      push({ kind: "skip", id: crypto.randomUUID(), createdAt: nowSeconds(), attempts: 0, entryId });
      if (navigator.onLine) sync();
    },
    queueAdd: (input) => {
      const op = push({
        kind: "add",
        id: crypto.randomUUID(),
        createdAt: nowSeconds(),
        attempts: 0,
        itemId: input.itemId ?? null,
        customName: input.customName ?? null,
        qty: input.qty ?? null,
      });
      if (navigator.onLine) sync();
      return op;
    },
    hasQueuedResolution: (entryId) => isResolvedLocally(queue, entryId),
    cancelQueued: (id) => commit(removeOp(queueRef.current, id)),
    sync,
  };

  return <OutboxContext value={value}>{children}</OutboxContext>;
}
