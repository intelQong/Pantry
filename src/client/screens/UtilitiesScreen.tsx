import { useState, useEffect, useCallback, useMemo } from "react";
import type { ItemWithStatus, Category, PurchaseWithItem } from "@shared/types";
import * as api from "../api";
import { Icon } from "../components/Icon";
import { StatusBadge } from "../components/StatusBadge";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { EmptyState } from "../components/EmptyState";
import { LoadFailed } from "../components/LoadFailed";
import { BottomSheet } from "../components/BottomSheet";
import { PriceInput } from "../components/PriceInput";
import { useToast } from "../components/Toast";
import { formatMoney } from "../lib/money";
import { isOffline } from "../lib/cache";
import {
  dateInputToEpochSeconds,
  epochSecondsToDateInput,
  getMonthName,
  groupMonthlyBills,
} from "../lib/utilities";

/** What the primary button on each card says, keyed by the item's unit. */
const LOG_LABEL: Record<string, string> = {
  cylinder: "Log refill",
  recharge: "Log recharge",
  month: "Log payment",
};

export function UtilitiesScreen({ categories }: { categories: Category[] }) {
  const [items, setItems] = useState<ItemWithStatus[]>([]);
  const [allPurchases, setAllPurchases] = useState<PurchaseWithItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<"offline" | "error" | null>(null);
  const [logging, setLogging] = useState<ItemWithStatus | null>(null);
  const [showCurrentItems, setShowCurrentItems] = useState(false);
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);
  const { toast } = useToast();

  const category = categories.find((c) => c.name === "Utilities") ?? null;

  const fetchAll = useCallback(async () => {
    setFailure(null);
    try {
      const [allItems, rawPurchases] = await Promise.all([
        api.getItems(),
        api.getPurchases({ all: true }).catch(() => []),
      ]);
      const utilities = allItems.filter((i) => i.isUtility);
      setItems(utilities);
      setAllPurchases(rawPurchases);
    } catch (err) {
      // Every figure here -- status, last-paid, the log -- is a live server
      // computation or a full history list, so there is nothing honest to show
      // from a cache the way Pantry does for its read-only browse.
      setFailure(isOffline(err) ? "offline" : "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const utilityIdSet = useMemo(() => new Set(items.map((i) => i.id)), [items]);
  const currentMonthKey = useMemo(() => epochSecondsToDateInput(Date.now() / 1000).slice(0, 7), []);

  // Newest purchase per item, for the "last amount" line on each card.
  const lastAmountByItem = useMemo(() => {
    const newest = new Map<string, PurchaseWithItem>();
    for (const p of allPurchases) {
      if (!utilityIdSet.has(p.itemId)) continue;
      const current = newest.get(p.itemId);
      if (!current || p.purchasedAt > current.purchasedAt) newest.set(p.itemId, p);
    }
    return new Map([...newest].map(([id, p]) => [id, p.priceTotal]));
  }, [allPurchases, utilityIdSet]);

  const monthlyBills = useMemo(
    () => groupMonthlyBills(allPurchases, utilityIdSet, currentMonthKey),
    [allPurchases, utilityIdSet, currentMonthKey],
  );

  const currentMonthBill = useMemo(
    () => monthlyBills.find((b) => b.key === currentMonthKey) ?? monthlyBills[0] ?? null,
    [monthlyBills, currentMonthKey],
  );

  const unpricedCount = useMemo(
    () => (currentMonthBill ? currentMonthBill.groceryPurchases.filter((p) => p.priceTotal === null).length : 0),
    [currentMonthBill],
  );

  if (loading) return <LoadingSpinner />;

  if (failure) {
    return (
      <div>
        <header className="px-5 pt-6 pb-2">
          <h1 className="screen-title">Bills</h1>
        </header>
        <LoadFailed offline={failure === "offline"} onRetry={fetchAll} />
      </div>
    );
  }

  if (!category || items.length === 0) {
    return (
      <div>
        <header className="px-5 pt-6 pb-2">
          <h1 className="screen-title">Bills</h1>
        </header>
        <EmptyState
          icon="zap"
          title="No utilities set up"
          subtitle="Gas, electricity and wifi are seeded automatically for a new household."
        />
      </div>
    );
  }

  return (
    <div className="pb-6">
      <header className="px-5 pt-6 pb-2">
        <h1 className="screen-title">Bills</h1>
      </header>

      {/* This month's shop bill -- groceries bought on account this month and
          settled the next. Worded as what it is, so it doesn't read as one of
          the utility bills listed below it. */}
      <div className="px-4 pb-3">
        <section className="card p-5 border border-accent-400/40 bg-gradient-to-br from-surface-raised to-surface shadow-xs">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-accent-50 text-accent-text flex items-center justify-center">
                <Icon name="basket" className="w-4 h-4" strokeWidth={2} />
              </span>
              <h2 className="eyebrow text-accent-text font-semibold">Grocery bill</h2>
            </div>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-accent-50 text-accent-text whitespace-nowrap">
              Pay in {currentMonthBill?.nextMonthLabel ?? "next month"}
            </span>
          </div>

          <div className="mt-3">
            <span className="numeral block text-[2.25rem] leading-none font-bold text-text">
              {formatMoney(currentMonthBill?.groceryTotal ?? 0)}
            </span>
            <p className="text-xs text-text-secondary mt-2 flex items-center gap-1.5">
              <span>
                Groceries bought in {getMonthName(currentMonthKey)}
              </span>
              <span>·</span>
              <span className="font-semibold text-text">
                {currentMonthBill?.groceryPurchases.length ?? 0}{" "}
                {currentMonthBill?.groceryPurchases.length === 1 ? "item" : "items"}
              </span>
            </p>

            {unpricedCount > 0 && (
              <p className="flex items-center gap-1 text-[0.6875rem] text-text-tertiary mt-1.5">
                <Icon name="tag" className="w-3 h-3 shrink-0" />
                <span>
                  {unpricedCount} {unpricedCount === 1 ? "item has" : "items have"} no price recorded yet.
                </span>
              </p>
            )}
          </div>

          {currentMonthBill && currentMonthBill.groceryPurchases.length > 0 && (
            <div className="mt-4 pt-3 border-t border-border-subtle">
              <button
                onClick={() => setShowCurrentItems((v) => !v)}
                className="w-full flex items-center justify-between text-xs font-medium text-text-secondary hover:text-text transition-colors py-1"
              >
                <span>
                  {showCurrentItems
                    ? "Hide items"
                    : `View ${currentMonthBill.groceryPurchases.length} ${currentMonthBill.groceryPurchases.length === 1 ? "item" : "items"} on this bill`}
                </span>
                <Icon
                  name="chevron"
                  className={`w-3.5 h-3.5 text-text-tertiary transition-transform ${
                    showCurrentItems ? "rotate-90" : ""
                  }`}
                  strokeWidth={2}
                />
              </button>

              {showCurrentItems && (
                <ul className="mt-2.5 divide-y divide-border-subtle/50 text-xs">
                  {currentMonthBill.groceryPurchases.map((p) => (
                    <li key={p.id} className="py-2 flex items-baseline justify-between">
                      <div className="min-w-0 flex-1 pr-2 truncate">
                        <span className="font-medium text-text">{p.itemName}</span>
                        <span className="text-text-tertiary text-[0.6875rem] ml-1.5">
                          {p.qty} {p.unit} · {epochSecondsToDateInput(p.purchasedAt)}
                        </span>
                      </div>
                      <span className="numeral font-medium text-text shrink-0">
                        {p.priceTotal !== null ? formatMoney(p.priceTotal) : "Unpriced"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      </div>

      <div className="px-4 space-y-3 pb-4">
        <div className="flex items-center justify-between px-1">
          <h3 className="eyebrow">Utilities & Subscriptions</h3>
          <span className="text-xs text-text-tertiary">{items.length} tracked</span>
        </div>

        {items.map((item) => {
          const lastAmount = lastAmountByItem.get(item.id) ?? null;
          return (
            <div key={item.id} className="p-4 card-row space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-medium text-text">{item.name}</span>
                <StatusBadge status={item.status} />
              </div>

              <div className="flex items-center justify-between text-sm text-text-secondary">
                <span>
                  {item.daysSince === null
                    ? "Never logged"
                    : `Last paid ${item.daysSince}d ago`}
                </span>
                <span>
                  {item.daysUntilDue === null
                    ? ""
                    : item.daysUntilDue < 0
                      ? `Overdue by ${Math.abs(item.daysUntilDue)}d`
                      : `Due in ${item.daysUntilDue}d`}
                </span>
              </div>

              {lastAmount !== null && (
                <div className="text-sm text-text-tertiary">
                  Last amount: {formatMoney(lastAmount)}
                </div>
              )}

              <button
                onClick={() => setLogging(item)}
                className="w-full min-h-11 py-2.5 rounded-xl bg-accent-500 text-text-on-accent text-sm font-semibold"
              >
                {LOG_LABEL[item.unit] ?? "Log purchase"}
              </button>
            </div>
          );
        })}
      </div>

      {/* Monthly History ---------------------------------------------- */}
      {monthlyBills.length > 0 && (
        <div className="px-4 space-y-3 pb-24">
          <div className="flex items-center justify-between px-1">
            <h3 className="eyebrow">Monthly History</h3>
            <span className="text-xs text-text-tertiary">Grocery bills & utilities</span>
          </div>

          {monthlyBills.map((m) => {
            const isExpanded = expandedMonth === m.key;
            return (
              <section key={m.key} className="card overflow-hidden">
                <button
                  onClick={() => setExpandedMonth(isExpanded ? null : m.key)}
                  className="w-full p-4 flex items-center justify-between text-left hover:bg-surface-sunken/40 transition-colors"
                  aria-expanded={isExpanded}
                >
                  <div className="min-w-0 flex-1 pr-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-text">{m.label}</span>
                      {m.key === currentMonthKey && (
                        <span className="px-1.5 py-0.5 rounded text-[0.6875rem] font-medium bg-accent-50 text-accent-text">
                          Current
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-text-tertiary mt-1">
                      Grocery bill (due {m.nextMonthLabel}):{" "}
                      <span className="font-semibold text-text-secondary">{formatMoney(m.groceryTotal)}</span>
                      {" · "}
                      Utilities:{" "}
                      <span className="font-semibold text-text-secondary">{formatMoney(m.utilityTotal)}</span>
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="numeral text-sm font-bold text-text">
                      {formatMoney(m.totalSpend)}
                    </span>
                    <Icon
                      name="chevron"
                      className={`w-3.5 h-3.5 text-text-tertiary transition-transform ${isExpanded ? "rotate-90" : ""}`}
                      strokeWidth={2}
                    />
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 pt-1 border-t border-border-subtle bg-surface-sunken/30 space-y-3">
                    {/* Grocery items summary */}
                    <div>
                      <h4 className="text-[0.6875rem] font-semibold uppercase tracking-wider text-text-tertiary mb-1.5">
                        Grocery Items ({m.groceryPurchases.length}) · Paid in {m.nextMonthLabel}
                      </h4>
                      {m.groceryPurchases.length === 0 ? (
                        <p className="text-xs text-text-tertiary">No groceries bought in this month.</p>
                      ) : (
                        <ul className="divide-y divide-border-subtle/50 text-xs">
                          {m.groceryPurchases.map((p) => (
                            <li key={p.id} className="py-1.5 flex items-baseline justify-between">
                              <div className="min-w-0 flex-1 pr-2 truncate">
                                <span className="font-medium text-text">{p.itemName}</span>
                                <span className="text-text-tertiary text-[0.6875rem] ml-1.5">
                                  {p.qty} {p.unit} · {epochSecondsToDateInput(p.purchasedAt)}
                                </span>
                              </div>
                              <span className="numeral text-text shrink-0">
                                {p.priceTotal !== null ? formatMoney(p.priceTotal) : "Unpriced"}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* Utility payments summary */}
                    <div className="pt-2 border-t border-border-subtle">
                      <h4 className="text-[0.6875rem] font-semibold uppercase tracking-wider text-text-tertiary mb-1.5">
                        Utility Payments ({m.utilityPurchases.length})
                      </h4>
                      {m.utilityPurchases.length === 0 ? (
                        <p className="text-xs text-text-tertiary">No utility payments in this month.</p>
                      ) : (
                        <ul className="divide-y divide-border-subtle/50 text-xs">
                          {m.utilityPurchases.map((p) => (
                            <li key={p.id} className="py-1.5 flex items-baseline justify-between">
                              <div className="min-w-0 flex-1 pr-2 truncate">
                                <span className="font-medium text-text">{p.itemName}</span>
                                {p.note && (
                                  <span className="text-text-tertiary text-[0.6875rem] ml-1.5">
                                    · {p.note}
                                  </span>
                                )}
                              </div>
                              <span className="numeral text-text shrink-0">
                                {p.priceTotal !== null ? formatMoney(p.priceTotal) : "Unpriced"}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {logging && (
        <LogPaymentSheet
          item={logging}
          onClose={() => setLogging(null)}
          onSaved={() => {
            setLogging(null);
            toast("Logged");
            fetchAll();
          }}
        />
      )}
    </div>
  );
}

export function LogPaymentSheet({
  item,
  onClose,
  onSaved,
}: {
  item: ItemWithStatus;
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = epochSecondsToDateInput(Date.now() / 1000);
  const [date, setDate] = useState(today);
  const [price, setPrice] = useState<number | null>(null);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await api.addPurchase({
        itemId: item.id,
        purchasedAt: dateInputToEpochSeconds(date),
        qty,
        unit: item.unit,
        priceTotal: price,
        note: note.trim() || null,
      });
      onSaved();
    } catch {
      // Sheet stays open with everything the user typed intact -- there is no
      // outbox for this write, so the only recourse is to retry from here.
      toast("Couldn't save -- check your connection", "error");
    } finally {
      setSaving(false);
    }
  }, [date, qty, price, note, item, onSaved, toast]);

  return (
    <BottomSheet open onClose={onClose} title={LOG_LABEL[item.unit] ?? "Log purchase"}>
      <div className="space-y-4">
        <label className="block">
          <span className="text-xs text-text-tertiary">Date</span>
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 w-full min-h-11 bg-surface-sunken rounded-lg px-3 py-2 text-sm text-text outline-none"
          />
        </label>

        <label className="block">
          <span className="text-xs text-text-tertiary">Amount</span>
          <div className="mt-1">
            <PriceInput value={price} onChange={setPrice} />
          </div>
        </label>

        <label className="block">
          <span className="text-xs text-text-tertiary">Quantity</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            value={qty}
            onChange={(e) => setQty(Number(e.target.value) || 0)}
            className="mt-1 w-full min-h-11 bg-surface-sunken rounded-lg px-3 py-2 text-sm text-text outline-none"
          />
        </label>

        <label className="block">
          <span className="text-xs text-text-tertiary">Note (optional)</span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note"
            className="mt-1 w-full min-h-11 bg-surface-sunken rounded-lg px-3 py-2 text-sm text-text outline-none placeholder:text-text-tertiary"
          />
        </label>

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full min-h-11 py-2.5 rounded-xl bg-accent-500 text-text-on-accent text-sm font-semibold disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </BottomSheet>
  );
}
