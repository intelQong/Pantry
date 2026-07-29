/**
 * The offline queue.
 *
 * Shopping happens in shops, and shops are where the phone loses signal. Every
 * mutation made while shopping is appended here first and sent later, so a tap
 * never depends on there being a network at the moment it happens.
 *
 * The rules live in pure functions over a plain array so they can be tested
 * without a browser: `drain` takes the sender as an argument rather than
 * calling `fetch` itself, and nothing in this file touches localStorage except
 * `loadQueue`/`saveQueue`.
 *
 * Replay safety is the server's doing, not ours. `POST /list/:id/bought` is
 * guarded so a repeat is a no-op that reports `alreadyResolved`, and `POST
 * /list` matches on the `clientId` we stamp here. That is what makes it safe to
 * retry anything whose response we never saw.
 */

export type OutboxOp =
  | {
      kind: "buy";
      id: string;
      createdAt: number;
      attempts: number;
      entryId: string;
      qty: number | null;
      priceTotal: number | null;
    }
  | {
      kind: "skip";
      id: string;
      createdAt: number;
      attempts: number;
      entryId: string;
    }
  | {
      kind: "add";
      id: string;
      createdAt: number;
      attempts: number;
      itemId: string | null;
      customName: string | null;
      qty: number | null;
    };

/** What happened to one operation, and therefore what to do with it. */
export type Outcome =
  | { type: "synced" }
  /** The server had already resolved it — usually the other phone got there first. */
  | { type: "already" }
  /** Unfixable by retrying. Discard so it cannot wedge the queue behind it. */
  | { type: "dropped"; reason: string }
  /** Network or server trouble. Keep it, and stop draining to preserve order. */
  | { type: "retry" };

export interface SendResult {
  /** HTTP status, or null when the request never got a response at all. */
  status: number | null;
  body?: { alreadyResolved?: boolean; message?: string } | null;
  /**
   * For a successful `add`, the id the server gave the entry.
   *
   * An item added offline and then ticked off in the same trip produces a buy
   * pointing at the *local* id, because that is all that existed at the time.
   * Reporting the real id here lets the drain rewrite those references as it
   * goes, so the buy lands on the row the add just created.
   */
  entryId?: string;
}

export interface DrainSummary {
  synced: number;
  already: number;
  dropped: { op: OutboxOp; reason: string }[];
  /** True when draining stopped early because the network is still down. */
  stalled: boolean;
}

/* ------------------------------------------------------------------ */
/* Pure rules                                                          */
/* ------------------------------------------------------------------ */

/**
 * How a response maps onto what to do with the operation.
 *
 * The 404 rule is the subtle one. `POST /list/:id/skip` 404s when the entry is
 * no longer pending, and buying 404s when the entry is gone entirely — both
 * mean the queue's intent is already satisfied, so treating them as failures
 * would retry forever against a row that will never come back.
 */
export function classify(result: SendResult): Outcome {
  const { status, body } = result;

  // No status at all: the request never reached a server. Worth retrying, and
  // the only case where the queue must stop and preserve its order.
  if (status === null) return { type: "retry" };

  if (status >= 200 && status < 300) {
    return body?.alreadyResolved ? { type: "already" } : { type: "synced" };
  }

  if (status === 404) return { type: "already" };

  // The server is having trouble, which is not something this operation can fix
  // by being rewritten. Keep it and come back.
  if (status >= 500) return { type: "retry" };

  // Any other 4xx is a request this server will never accept — a validation
  // error, a deleted item, a lost session. Retrying it forever would block
  // every operation queued behind it.
  return { type: "dropped", reason: body?.message ?? `Rejected with ${status}` };
}

export function enqueue(queue: OutboxOp[], op: OutboxOp): OutboxOp[] {
  return [...queue, op];
}

export function removeOp(queue: OutboxOp[], id: string): OutboxOp[] {
  return queue.filter((op) => op.id !== id);
}

/**
 * Repoints every queued buy/skip from a local entry id to the real one.
 *
 * Exported for the tests; `drain` calls it as soon as an add comes back.
 */
export function remapEntryId(queue: OutboxOp[], from: string, to: string): OutboxOp[] {
  return queue.map((op) =>
    (op.kind === "buy" || op.kind === "skip") && op.entryId === from ? { ...op, entryId: to } : op,
  );
}

/** True if the entry already has a queued buy or skip — used to avoid double-tapping. */
export function isResolvedLocally(queue: OutboxOp[], entryId: string): boolean {
  return queue.some(
    (op) => (op.kind === "buy" || op.kind === "skip") && op.entryId === entryId,
  );
}

/* ------------------------------------------------------------------ */
/* What each operation asks the server for                             */
/* ------------------------------------------------------------------ */

export interface QueuedRequest {
  method: "POST";
  path: string;
  body: Record<string, unknown>;
}

/**
 * The request one queued operation turns into.
 *
 * Split out from the sending so it can be asserted without a network. This is
 * exactly the seam the Skip button got wrong: it called the buy handler, so
 * "Skip" quietly wrote a purchase, stamped last_purchased_at and fed the median
 * that sets the restock interval. A skip must reach /skip and nothing else.
 */
export function describeRequest(op: OutboxOp): QueuedRequest {
  if (op.kind === "buy") {
    return {
      method: "POST",
      path: `/list/${op.entryId}/bought`,
      body: {
        // Only send a quantity when one was chosen; otherwise the server falls
        // back to the entry's own qty and then to the item default.
        ...(op.qty !== null ? { qty: op.qty } : {}),
        priceTotal: op.priceTotal,
        // The shop happened when the tap happened, not when the signal came back.
        purchasedAt: op.createdAt,
      },
    };
  }

  if (op.kind === "skip") {
    return { method: "POST", path: `/list/${op.entryId}/skip`, body: {} };
  }

  return {
    method: "POST",
    path: "/list",
    body: {
      clientId: op.id,
      ...(op.itemId ? { itemId: op.itemId } : { customName: op.customName }),
      ...(op.qty !== null ? { qty: op.qty } : {}),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Draining                                                            */
/* ------------------------------------------------------------------ */

/**
 * Sends what it can, in order, and returns the queue that is left.
 *
 * Strictly sequential and stops at the first retryable failure. Order matters:
 * an add has to reach the server before the buy that resolves the entry it
 * created, and firing them together would let the buy arrive first.
 */
export async function drain(
  queue: OutboxOp[],
  send: (op: OutboxOp) => Promise<SendResult>,
): Promise<{ queue: OutboxOp[]; summary: DrainSummary }> {
  const summary: DrainSummary = { synced: 0, already: 0, dropped: [], stalled: false };
  let remaining = [...queue];

  while (remaining.length > 0) {
    const op = remaining[0]!;
    let outcome: Outcome;
    let result: SendResult | null = null;
    try {
      result = await send(op);
      outcome = classify(result);
    } catch {
      // A sender that threw rather than returning a status is a dead network.
      outcome = { type: "retry" };
    }

    if (outcome.type === "retry") {
      summary.stalled = true;
      remaining = [{ ...op, attempts: op.attempts + 1 }, ...remaining.slice(1)];
      break;
    }

    if (outcome.type === "synced") summary.synced++;
    else if (outcome.type === "already") summary.already++;
    else summary.dropped.push({ op, reason: outcome.reason });

    remaining = remaining.slice(1);

    // An add that just became a real row hands its server id to everything
    // queued behind it that was still pointing at the local one.
    if (op.kind === "add" && result?.entryId && result.entryId !== op.id) {
      remaining = remapEntryId(remaining, op.id, result.entryId);
    }
  }

  return { queue: remaining, summary };
}

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

const QUEUE_KEY = "pantry-outbox-v1";

export function loadQueue(): OutboxOp[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OutboxOp[]) : [];
  } catch {
    // Unreadable queue: better an empty one than a screen that will not load.
    return [];
  }
}

export function saveQueue(queue: OutboxOp[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // Storage full or blocked (Safari private browsing). The in-memory queue
    // still works for this session; only surviving a reload is lost.
  }
}
