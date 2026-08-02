import { useState, useEffect, useCallback, useMemo } from "react";
import type { ItemWithStatus, Category, Purchase } from "@shared/types";
import * as api from "../api";
import { StatusBadge } from "../components/StatusBadge";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { EmptyState } from "../components/EmptyState";
import { BottomSheet } from "../components/BottomSheet";
import { PriceInput } from "../components/PriceInput";
import { useToast } from "../components/Toast";
import { formatMoney } from "../lib/money";
import { isOffline } from "../lib/cache";
import { dateInputToEpochSeconds, epochSecondsToDateInput, groupByMonth } from "../lib/utilities";

/** What the primary button on each card says, keyed by the item's unit. */
const LOG_LABEL: Record<string, string> = {
  cylinder: "Log refill",
  recharge: "Log recharge",
  month: "Log payment",
};

export function UtilitiesScreen({ categories }: { categories: Category[] }) {
  const [items, setItems] = useState<ItemWithStatus[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreachable, setUnreachable] = useState(false);
  const [logging, setLogging] = useState<ItemWithStatus | null>(null);
  const { toast } = useToast();

  const category = categories.find((c) => c.name === "Utilities") ?? null;

  const fetchAll = useCallback(async () => {
    try {
      const allItems = await api.getItems();
      const utilities = allItems.filter((i) => i.isUtility);
      setItems(utilities);

      // Each card's history and the combined log below both need the full
      // purchase list, so it is fetched once here rather than per card.
      const histories = await Promise.all(
        utilities.map((i) => api.getItemPurchases(i.id)),
      );
      setPurchases(histories.flat());
    } catch (err) {
      // Every figure here -- status, last-paid, the log -- is a live server
      // computation or a full history list, so there is nothing honest to show
      // from a cache the way Pantry does for its read-only browse.
      if (!isOffline(err)) throw err;
      setUnreachable(true);
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  // Newest purchase per item, for the "last amount" line on each card.
  const lastAmountByItem = useMemo(() => {
    const newest = new Map<string, Purchase>();
    for (const p of purchases) {
      const current = newest.get(p.itemId);
      if (!current || p.purchasedAt > current.purchasedAt) newest.set(p.itemId, p);
    }
    return new Map([...newest].map(([id, p]) => [id, p.priceTotal]));
  }, [purchases]);

  const months = useMemo(() => groupByMonth(purchases), [purchases]);

  if (loading) return <LoadingSpinner />;

  if (unreachable) {
    return (
      <div className="safe-top">
        <header className="px-5 pt-6 pb-2">
          <h1 className="screen-title">Bills</h1>
        </header>
        <EmptyState
          icon="zap"
          title="Needs a connection"
          subtitle="Bills and payment history load fresh from the server."
        />
      </div>
    );
  }

  if (!category || items.length === 0) {
    return (
      <div className="safe-top">
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
    <div className="safe-top">
      <header className="px-5 pt-6 pb-2">
        <h1 className="screen-title">Bills</h1>
      </header>

      <div className="px-4 space-y-3 pb-4">
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

      {/* Payment history, grouped by month across all three utilities. */}
      {months.length > 0 && (
        <div className="px-4 space-y-4 pb-8">
          <h3 className="eyebrow px-1">History</h3>
          {months.map((m) => (
            <section key={m.key}>
              <div className="flex items-center justify-between px-1 mb-2">
                <span className="text-sm font-medium text-text">{m.label}</span>
                <span className="text-sm text-text-secondary">{formatMoney(m.total)}</span>
              </div>
              <div className="space-y-1.5">
                {m.purchases.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 px-3 py-2.5 card-row">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-text truncate">
                        {itemsById.get(p.itemId)?.name ?? "Utility"}
                      </div>
                      <div className="text-xs text-text-tertiary truncate">
                        {epochSecondsToDateInput(p.purchasedAt)}
                        {p.note ? ` · ${p.note}` : ""}
                      </div>
                    </div>
                    <span className="text-sm text-text-secondary shrink-0">
                      {formatMoney(p.priceTotal)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))}
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

function LogPaymentSheet({
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
