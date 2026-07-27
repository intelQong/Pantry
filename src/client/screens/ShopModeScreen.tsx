import { useState, useEffect, useCallback, useRef } from "react";
import type { ListEntry, Category } from "@shared/types";
import * as api from "../api";
import { PriceInput } from "../components/PriceInput";
import { Icon } from "../components/Icon";
import { formatMoney } from "../lib/money";
import { parseQty } from "../lib/numbers";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { useToast } from "../components/Toast";

interface ShopItem extends ListEntry {
  bought: boolean;
  priceTotal: number | null;
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
  const [buying, setBuying] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  // Fetch list and request wake lock
  useEffect(() => {
    const load = async () => {
      try {
        const entries = await api.getList();
        setItems(entries.map((e) => ({ ...e, bought: false, priceTotal: null })));
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

  const boughtCount = items.filter((i) => i.bought).length;
  const totalItems = items.length;
  const runningTotal = items.reduce((sum, i) => sum + (i.priceTotal ?? 0), 0);
  const progress = totalItems > 0 ? (boughtCount / totalItems) * 100 : 0;
  const allDone = totalItems > 0 && boughtCount === totalItems;

  const handleBuy = useCallback(
    async (item: ShopItem, price: number | null = null, qtyRaw = "") => {
      if (buying.has(item.id)) return;
      setBuying((prev) => new Set(prev).add(item.id));
      setPriceInputId(null);

      try {
        // Blank falls back to whatever quantity was put on the list, and only
        // then to one -- so confirming without typing changes nothing.
        await api.buyListEntry(item.id, {
          priceTotal: price,
          qty: parseQty(qtyRaw, item.qty ?? 1),
        });
        setItems((prev) =>
          prev.map((i) =>
            i.id === item.id ? { ...i, bought: true, priceTotal: price } : i,
          ),
        );
      } catch {
        toast("Failed to mark as bought", "error");
      } finally {
        setBuying((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
      }
    },
    [buying, toast],
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
          <h1 className="font-display text-lg font-semibold text-text">Shop Mode</h1>
          <div className="text-right">
            {runningTotal > 0 && (
              <div className="numeral text-base font-semibold text-accent-600">
                {formatMoney(runningTotal)}
              </div>
            )}
            <div className="text-xs text-text-tertiary">
              {boughtCount}/{totalItems}
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full h-1.5 bg-border rounded-full overflow-hidden">
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
                      if (item.bought) return;
                      // Show price input on tap
                      if (priceInputId === item.id) {
                        handleBuy(item, pendingPrice, pendingQty);
                      } else {
                        setPriceInputId(item.id);
                        setPendingPrice(null);
                        setPendingQty("");
                      }
                    }}
                    disabled={item.bought || buying.has(item.id)}
                    className={`w-full text-left p-4 rounded-2xl border transition-all ${
                      item.bought
                        ? "bg-status-ok-bg border-status-ok/30 opacity-70"
                        : "bg-surface-raised border-border-subtle shadow-sm hover:shadow-md active:scale-[0.99]"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {/* Checkbox circle */}
                      <div
                        className={`w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                          item.bought
                            ? "bg-status-ok border-status-ok text-white animate-check"
                            : "border-border"
                        }`}
                      >
                        {item.bought && (
                          <Icon name="check" className="w-4 h-4" strokeWidth={3} />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <span
                          className={`text-base font-medium ${
                            item.bought ? "line-through text-text-tertiary" : "text-text"
                          }`}
                        >
                          {item.displayName}
                        </span>
                        {item.qty && (
                          <span className="text-sm text-text-tertiary ml-2">×{item.qty}</span>
                        )}
                      </div>

                      {item.bought && item.itemId === null && !tracked.has(item.id) && (
                        <button
                          onClick={() => handleTrack(item)}
                          className="shrink-0 px-2.5 py-1 rounded-full bg-accent-50 text-accent-700 text-xs font-medium hover:bg-accent-100 transition-colors"
                        >
                          Track it
                        </button>
                      )}

                      {tracked.has(item.id) && (
                        <span className="shrink-0 text-xs text-status-ok font-medium">Tracked</span>
                      )}

                      {item.priceTotal !== null && (
                        <span className="text-sm font-medium text-text-secondary">
                          ৳{(item.priceTotal / 100).toFixed(0)}
                        </span>
                      )}

                      {buying.has(item.id) && (
                        <div className="w-5 h-5 rounded-full border-2 border-accent-300 border-t-accent-600 shrink-0" style={{ animation: "spin 0.7s linear infinite" }} />
                      )}
                    </div>
                  </button>

                  {/* Price input (shown when tapped) */}
                  {priceInputId === item.id && !item.bought && (
                    <div className="mt-1.5 flex items-center gap-2 animate-fade-in">
                      <div className="flex-1">
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
                      <button
                        onClick={() => handleBuy(item, pendingPrice, pendingQty)}
                        className="px-4 py-2 rounded-lg bg-accent-500 text-text-on-accent text-sm font-semibold active:scale-95 transition-transform"
                      >
                        Done
                      </button>
                      <button
                        onClick={() => {
                          setPriceInputId(null);
                          handleBuy(item, null, "");
                        }}
                        className="px-3 py-2 rounded-lg bg-surface-raised border border-border text-sm text-text-secondary hover:text-text transition-colors"
                      >
                        Skip
                      </button>
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
