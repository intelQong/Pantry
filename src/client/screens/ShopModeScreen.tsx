import { useState, useEffect, useCallback, useRef } from "react";
import type { ListEntry, Category } from "@shared/types";
import * as api from "../api";
import { PriceInput } from "../components/PriceInput";
import { Icon } from "../components/Icon";
import { formatMoney } from "../lib/money";
import { parseQty } from "../lib/numbers";
import { readSnapshot, writeSnapshot, isOffline } from "../lib/cache";
import type { OutboxOp } from "../lib/outbox";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { useToast } from "../components/Toast";
import { useOutbox } from "../components/Outbox";

interface ShopItem extends ListEntry {
  bought: boolean;
  /**
   * Decided against, rather than bought.
   *
   * A distinct state and not just "bought with no price": skipping resolves the
   * list entry without writing a purchase, so it leaves last_purchased_at and
   * the learned interval alone. Recording a skip as a purchase would teach the
   * engine you restock things you deliberately walked past.
   */
  skipped: boolean;
  priceTotal: number | null;
}

/** Decided, either way — what the progress bar and the card state key off. */
const isResolved = (item: ShopItem) => item.bought || item.skipped;

/**
 * An item added while offline, shown alongside the fetched list.
 *
 * The queued operation's own id stands in as the entry id until it syncs, which
 * is what lets it be ticked off in the same trip: the buy queues against this
 * id, and the drain repoints it once the add comes back with a real one.
 */
function pendingAddToEntry(op: Extract<OutboxOp, { kind: "add" }>): ListEntry {
  return {
    id: op.id,
    itemId: op.itemId,
    customName: op.customName,
    displayName: op.customName ?? "New item",
    categoryId: null,
    qty: op.qty,
    note: null,
    addedBy: null,
    addedAt: op.createdAt,
    status: "pending",
    clientId: op.id,
  };
}

/** Merges the fetched (or cached) list with anything still sitting in the queue. */
function toShopItems(entries: ListEntry[], queuedAdds: Extract<OutboxOp, { kind: "add" }>[]): ShopItem[] {
  const known = new Set(entries.map((e) => e.clientId).filter(Boolean));
  const extra = queuedAdds.filter((op) => !known.has(op.id)).map(pendingAddToEntry);
  return [...entries, ...extra].map((e) => ({ ...e, bought: false, skipped: false, priceTotal: null }));
}

export function ShopModeScreen({
  categories,
  navigate,
}: {
  categories: Category[];
  navigate: (path: string) => void;
}) {
  const [items, setItems] = useState<ShopItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [priceInputId, setPriceInputId] = useState<string | null>(null);
  const [pendingQty, setPendingQty] = useState("");
  const [pendingPrice, setPendingPrice] = useState<number | null>(null);
  const [tracked, setTracked] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  const { online, queue, queueBuy, queueSkip, hasQueuedResolution } = useOutbox();
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  // Read once when the list loads rather than tracked as a dependency: the
  // queue changes on every tick, and re-running the fetch on each one would
  // fight the optimistic state this screen is holding.
  const queuedAddsRef = useRef(queue);
  queuedAddsRef.current = queue;

  // Fetch list and request wake lock
  useEffect(() => {
    const queuedAdds = queuedAddsRef.current.filter(
      (op): op is Extract<OutboxOp, { kind: "add" }> => op.kind === "add",
    );
    const load = async () => {
      try {
        const entries = await api.getList();
        writeSnapshot("list", entries);
        setItems(toShopItems(entries, queuedAdds));
      } catch (err) {
        // The list is the one thing this screen cannot do without, and this is
        // the screen most likely to be opened with no signal. Fall back to
        // whatever the last successful fetch saw rather than showing 0/0.
        if (!isOffline(err)) throw err;
        const cached = readSnapshot<ListEntry[]>("list");
        setItems(toShopItems(cached?.value ?? [], queuedAdds));
      } finally {
        setLoading(false);
      }
    };
    load();

    // Keep screen on while shopping
    const acquireWakeLock = async () => {
      try {
        if ("wakeLock" in navigator) {
          wakeLockRef.current = await navigator.wakeLock.request("screen");
        }
      } catch {
        // Wake lock not supported or denied — not critical
      }
    };
    acquireWakeLock();

    return () => {
      wakeLockRef.current?.release().catch(() => {});
    };
  }, []);

  /**
   * Turns a free-text entry into a tracked pantry item.
   *
   * A custom entry has no item_id, so buying it resolves the row and records
   * nothing -- correct, but it means anything added as free text never feeds
   * the restock engine or the spend history. This closes that gap at the one
   * moment the intent is obvious: just after buying it.
   *
   * This one still needs the network. It creates a pantry item and backfills a
   * purchase against it, which is two dependent writes rather than a single
   * replayable operation, so it is offered only when there is a connection to
   * do it over -- the buy itself is already safely queued either way.
   */
  const handleTrack = useCallback(
    async (item: ShopItem) => {
      const name = item.displayName;
      try {
        const created = await api.createItem({ name, isStaple: true });
        await api.addPurchase({
          itemId: created.id,
          qty: item.qty ?? 1,
          priceTotal: item.priceTotal,
        });
        setTracked((prev) => new Set(prev).add(item.id));
        toast(`Now tracking ${name}`);
      } catch (err) {
        // The commonest failure is a name that already exists in the pantry,
        // which the API rejects on its unique index. Say so rather than "failed".
        toast(
          err instanceof api.ApiRequestError ? err.body.message : `Couldn't track ${name}`,
          "error",
        );
      }
    },
    [toast],
  );

  const resolvedCount = items.filter(isResolved).length;
  const totalItems = items.length;
  const runningTotal = items.reduce((sum, i) => sum + (i.priceTotal ?? 0), 0);
  const progress = totalItems > 0 ? (resolvedCount / totalItems) * 100 : 0;
  // Counts skips too: the trip is over when every line has been decided, not
  // when every line has been bought.
  const allDone = totalItems > 0 && resolvedCount === totalItems;

  /**
   * Marks an item bought.
   *
   * The tick lands immediately and the request is queued behind it, rather than
   * the other way round. Shopping is a sequence of taps in a place with bad
   * signal: waiting on a round-trip per item made the screen unusable exactly
   * where it was needed, and a failed request used to lose the tap entirely.
   *
   * Double-tapping is safe at both ends -- the queue ignores an entry it has
   * already resolved, and the server's buy endpoint no-ops on a repeat.
   */
  const handleBuy = useCallback(
    (item: ShopItem, price: number | null = null, qtyRaw = "") => {
      if (isResolved(item) || hasQueuedResolution(item.id)) return;
      setPriceInputId(null);

      // Blank falls back to whatever quantity was put on the list, and only
      // then to one -- so confirming without typing changes nothing.
      queueBuy(item.id, parseQty(qtyRaw, item.qty ?? 1), price);
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, bought: true, priceTotal: price } : i)),
      );
    },
    [queueBuy, hasQueuedResolution],
  );

  /**
   * Puts an item back without buying it.
   *
   * This button used to call handleBuy with no price, so "Skip" silently
   * recorded a purchase: it stamped last_purchased_at, fed the median that sets
   * the restock interval, and counted toward the item's history. Skipping now
   * resolves the entry and writes no purchase at all, which is what the
   * /list/:id/skip endpoint has always done.
   */
  const handleSkip = useCallback(
    (item: ShopItem) => {
      if (isResolved(item) || hasQueuedResolution(item.id)) return;
      setPriceInputId(null);
      queueSkip(item.id);
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, skipped: true, priceTotal: null } : i)),
      );
    },
    [queueSkip, hasQueuedResolution],
  );

  const handleExit = useCallback(() => {
    wakeLockRef.current?.release().catch(() => {});
    navigate("list");
  }, [navigate]);

  if (loading) {
    return (
      <div className="min-h-dvh bg-surface-sunken flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  // Group by category in aisle order
  const grouped: { cat: Category | null; items: ShopItem[] }[] = [];
  const byCategory = new Map<string | null, ShopItem[]>();
  for (const item of items) {
    const key = item.categoryId ?? "__none__";
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key)!.push(item);
  }
  for (const cat of categories) {
    const catItems = byCategory.get(cat.id);
    if (catItems?.length) grouped.push({ cat, items: catItems });
  }
  const uncategorised = byCategory.get("__none__");
  if (uncategorised?.length) grouped.push({ cat: null, items: uncategorised });

  return (
    <div className="min-h-dvh bg-surface-sunken flex flex-col safe-top">
      {/* Top bar */}
      <header className="sticky top-0 z-20 glass border-b border-border px-4 pt-3 pb-3">
        <div className="flex items-center justify-between mb-2">
          <button
            onClick={handleExit}
            className="flex items-center gap-1 text-sm text-text-secondary hover:text-text transition-colors"
          >
<Icon name="chevron" className="w-4 h-4 rotate-180" strokeWidth={2} />
            Back
          </button>
          <h1 className="font-display text-xl font-bold tracking-tight text-text">Shop Mode</h1>
          <div className="text-right">
            {runningTotal > 0 && (
              <div className="numeral text-xl font-bold text-accent-text">
                {formatMoney(runningTotal)}
              </div>
            )}
            <div className="numeral text-sm font-semibold text-text-secondary">
              {resolvedCount}/{totalItems}
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full h-2.5 bg-border rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-accent-500 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </header>

      {/* Items */}
      <div className="flex-1 px-4 py-3 space-y-4 pb-24">
        {grouped.map(({ cat, items: groupItems }) => (
          <section key={cat?.id ?? "none"}>
            <h3 className="flex items-center gap-2 text-xs font-semibold text-text-secondary uppercase tracking-wide px-1 mb-2">
              {cat && (
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />
              )}
              {cat?.name ?? "Other"}
            </h3>
            <div className="space-y-2">
              {groupItems.map((item) => (
                <div key={item.id}>
                  <button
                    onClick={() => {
                      if (isResolved(item)) return;
                      // Show price input on tap
                      if (priceInputId === item.id) {
                        handleBuy(item, pendingPrice, pendingQty);
                      } else {
                        setPriceInputId(item.id);
                        setPendingPrice(null);
                        setPendingQty("");
                      }
                    }}
                    disabled={isResolved(item)}
                    className={`w-full text-left p-4 rounded-2xl border transition-all ${
                      item.bought
                        ? "bg-status-ok-bg border-status-ok/30 opacity-70"
                        : item.skipped
                          ? "bg-surface-sunken border-border opacity-60"
                          : "bg-surface-raised border-border-subtle shadow-sm hover:shadow-md active:scale-[0.99]"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {/* Checkbox circle */}
                      <div
                        className={`w-9 h-9 rounded-full border-[2.5px] flex items-center justify-center shrink-0 transition-all ${
                          item.bought
                            ? "bg-status-ok border-status-ok text-white animate-check"
                            : item.skipped
                              ? "border-border text-text-tertiary"
                              : "border-border"
                        }`}
                      >
                        {item.bought && (
                          <Icon name="check" className="w-5 h-5" strokeWidth={3.5} />
                        )}
                        {item.skipped && (
                          <Icon name="close" className="w-4 h-4" strokeWidth={3} />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <span
                          className={`text-lg font-semibold tracking-tight ${
                            isResolved(item) ? "line-through text-text-tertiary" : "text-text"
                          }`}
                        >
                          {item.displayName}
                        </span>
                        {item.qty && (
                          <span className="numeral text-base text-text-secondary ml-2">×{item.qty}</span>
                        )}
                      </div>

                      {online && item.bought && item.itemId === null && !tracked.has(item.id) && (
                        <button
                          onClick={() => handleTrack(item)}
                          className="shrink-0 px-2.5 py-1 rounded-full bg-accent-50 text-accent-text text-xs font-medium hover:bg-accent-100 transition-colors"
                        >
                          Track it
                        </button>
                      )}

                      {tracked.has(item.id) && (
                        <span className="shrink-0 text-xs text-status-ok font-medium">Tracked</span>
                      )}

                      {item.skipped && (
                        <span className="shrink-0 text-xs font-semibold text-text-tertiary">
                          Skipped
                        </span>
                      )}

                      {item.priceTotal !== null && (
                        <span className="numeral text-base font-semibold text-text">
                          {formatMoney(item.priceTotal)}
                        </span>
                      )}

                      {/* Ticked, but still sitting in the queue. Says the tap
                          was recorded without pretending the server has it. */}
                      {isResolved(item) && hasQueuedResolution(item.id) && (
                        <Icon
                          name="cloud-off"
                          className="w-4 h-4 text-text-tertiary shrink-0"
                          strokeWidth={1.75}
                        />
                      )}
                    </div>
                  </button>

                  {/* Price input (shown when tapped) */}
                  {priceInputId === item.id && !isResolved(item) && (
                    <div className="mt-1.5 space-y-2 animate-fade-in">
                      {/* Two rows, not four controls across. Price, quantity,
                          Bought and Skip on one line overflowed the card on a
                          phone and pushed the buttons off the edge. */}
                      <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <PriceInput value={pendingPrice} onChange={setPendingPrice} />
                        </div>
                        <div className="flex items-center gap-1.5 bg-surface-sunken rounded-lg px-3 py-2 shrink-0">
                          <span className="text-text-tertiary text-sm">×</span>
                          <input
                            value={pendingQty}
                            onChange={(e) => setPendingQty(e.target.value)}
                            inputMode="decimal"
                            placeholder={String(item.qty ?? 1)}
                            aria-label="Quantity bought"
                            className="w-10 bg-transparent text-sm text-text outline-none placeholder:text-text-tertiary"
                          />
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleBuy(item, pendingPrice, pendingQty)}
                          className="flex-1 py-3 rounded-lg bg-accent-500 text-text-on-accent text-sm font-bold active:scale-[0.98] transition-transform"
                        >
                          Bought
                        </button>
                        <button
                          onClick={() => handleSkip(item)}
                          className="px-4 py-3 rounded-lg bg-surface-raised border border-border text-sm font-semibold text-text-secondary hover:text-text transition-colors shrink-0"
                        >
                          Skip
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* Done floating button */}
      {allDone && (
        <div className="fixed bottom-6 left-4 right-4 z-30 animate-slide-up">
          <button
            onClick={handleExit}
            className="w-full py-4 rounded-2xl bg-status-ok text-white font-bold text-base shadow-xl active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
          >
            <Icon name="check" className="w-5 h-5" strokeWidth={2.5} />
            All Done!
          </button>
        </div>
      )}
    </div>
  );
}
