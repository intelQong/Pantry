import { useState, useMemo, useCallback } from "react";
import type { PurchaseWithItem } from "@shared/types";
import * as api from "../api";
import { BottomSheet } from "./BottomSheet";
import { Icon } from "./Icon";
import { useToast } from "./Toast";
import { parseQty } from "../lib/numbers";
import { parseMoney, formatMoney, toInputValue, allocateTotal, CURRENCY_SYMBOL } from "../lib/money";

/**
 * Correcting one shop after the fact.
 *
 * Two jobs, deliberately in one sheet because they are the same moment: fixing
 * a quantity or a price you got wrong, and dividing a receipt total across a
 * trip whose individual prices nobody wrote down.
 *
 * The pinning rule is what makes the second one useful. A price you type is
 * taken as known and held; everything you leave blank shares what is left of
 * the total. Remember one more price, type it, and the rest re-divides — the
 * guess narrows every time instead of being all-or-nothing. Prices already
 * recorded arrive pinned, so entering a total only fills in the gaps.
 */
export function PurchaseDaySheet({
  label,
  purchases,
  open,
  onClose,
  onSaved,
}: {
  label: string;
  purchases: PurchaseWithItem[];
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const recorded = useMemo(
    () =>
      Object.fromEntries(
        purchases.filter((p) => p.priceTotal !== null).map((p) => [p.id, toInputValue(p.priceTotal)]),
      ),
    [purchases],
  );

  const [total, setTotal] = useState("");
  /** Only what is actually known: typed now, or already on record. */
  const [prices, setPrices] = useState<Record<string, string>>(recorded);
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const ids = purchases.map((p) => p.id);

  const pinned = useMemo(() => {
    const out: Record<string, number> = {};
    for (const id of ids) {
      const typed = prices[id];
      if (typed === undefined || typed.trim() === "") continue;
      const parsed = parseMoney(typed);
      if (parsed !== null) out[id] = parsed;
    }
    return out;
  }, [prices, purchases]);

  const billTotal = parseMoney(total);
  const pinnedSum = Object.values(pinned).reduce((n, v) => n + v, 0);
  const overshoot = billTotal !== null && pinnedSum > billTotal;

  /** What each row will be saved as: the price you typed, or its share. */
  const allocated = useMemo(
    () => (billTotal === null ? pinned : allocateTotal(billTotal, ids, pinned)),
    [billTotal, pinned, purchases],
  );

  const unpinnedCount = ids.filter((id) => pinned[id] === undefined).length;

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const updates = purchases.map((p) => {
        const qtyText = qtys[p.id];
        const price = allocated[p.id];
        // Emptying a field that had a price is a deliberate "I don't know
        // what this cost", so it clears the record rather than being ignored.
        // A row that was blank and stayed blank sends nothing, so opening this
        // sheet and closing it still cannot wipe anything.
        const cleared =
          prices[p.id] !== undefined && prices[p.id]!.trim() === "" && p.priceTotal !== null;

        return {
          id: p.id,
          ...(qtyText !== undefined && qtyText.trim() !== ""
            ? { qty: parseQty(qtyText, p.qty) }
            : {}),
          ...(cleared ? { priceTotal: null } : price !== undefined ? { priceTotal: price } : {}),
        };
      });

      await api.updatePurchases(updates);
      toast("Shop updated");
      onClose();
      onSaved();
    } catch (err) {
      toast(err instanceof api.ApiRequestError ? err.body.message : "Couldn't save", "error");
    } finally {
      setSaving(false);
    }
  }, [purchases, qtys, prices, allocated, toast, onClose, onSaved]);

  return (
    <BottomSheet open={open} onClose={onClose} title={label}>
      <div className="space-y-4">
        <label className="block">
          <span className="text-xs font-medium text-text-secondary">
            Bill total <span className="text-text-tertiary font-normal">· optional</span>
          </span>
          <div className="relative mt-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-tertiary pointer-events-none">
              {CURRENCY_SYMBOL}
            </span>
            <input
              value={total}
              onChange={(e) => setTotal(e.target.value)}
              inputMode="decimal"
              placeholder="What the whole shop came to"
              className="w-full pl-7 pr-3 py-2 rounded-lg bg-surface-sunken border border-border text-sm text-text outline-none focus:border-accent-400"
            />
          </div>
          <span className="block text-xs text-text-tertiary mt-1.5">
            {billTotal === null
              ? "Enter it and the prices you haven't filled in will share it."
              : overshoot
                ? `The prices you've entered already come to ${formatMoney(pinnedSum)} — more than the total.`
                : unpinnedCount === 0
                  ? "Every price is filled in, so there is nothing left to divide."
                  : `${formatMoney(billTotal - pinnedSum)} shared between ${unpinnedCount} ${
                      unpinnedCount === 1 ? "item" : "items"
                    }.`}
          </span>
        </label>

        <div>
          <div className="flex items-baseline justify-between mb-2">
            <h4 className="eyebrow">This shop</h4>
            <span className="text-xs text-text-tertiary">qty · price</span>
          </div>

          <ul className="space-y-1.5">
            {purchases.map((p) => {
              const isPinned = pinned[p.id] !== undefined;
              const share = allocated[p.id];
              return (
                <li key={p.id} className="flex items-center gap-2">
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-text truncate">{p.itemName}</span>
                    {!isPinned && share !== undefined && (
                      <span className="flex items-center gap-1 text-xs text-text-tertiary mt-0.5">
                        <Icon name="spark" className="w-3 h-3" strokeWidth={1.75} />
                        share of the total
                      </span>
                    )}
                  </span>

                  <input
                    value={qtys[p.id] ?? String(p.qty)}
                    onChange={(e) => setQtys((q) => ({ ...q, [p.id]: e.target.value }))}
                    inputMode="decimal"
                    aria-label={`Quantity of ${p.itemName}`}
                    className="w-12 shrink-0 px-2 py-1.5 rounded-lg bg-surface-sunken border border-border text-sm text-text text-center outline-none focus:border-accent-400"
                  />
                  <span className="text-xs text-text-tertiary shrink-0 w-8 truncate">{p.unit}</span>

                  <input
                    value={prices[p.id] ?? (share !== undefined ? toInputValue(share) : "")}
                    onChange={(e) => setPrices((v) => ({ ...v, [p.id]: e.target.value }))}
                    inputMode="decimal"
                    placeholder="—"
                    aria-label={`Price of ${p.itemName}`}
                    className={`w-20 shrink-0 px-2 py-1.5 rounded-lg border text-sm text-right outline-none focus:border-accent-400 ${
                      isPinned
                        ? "bg-surface-sunken border-border text-text font-medium"
                        : "bg-transparent border-border-subtle text-text-secondary"
                    }`}
                  />
                </li>
              );
            })}
          </ul>
        </div>

        {/* Blocked while the pins exceed the bill, because allocateTotal gives
            every unpinned row zero in that case -- and a saved ৳0 is
            indistinguishable from something that was genuinely free. The
            banner above already says what is wrong. */}
        <button
          onClick={handleSave}
          disabled={saving || overshoot}
          className="w-full py-2.5 rounded-xl bg-accent-500 text-text-on-accent text-sm font-semibold disabled:opacity-50"
        >
          {saving ? "Saving…" : overshoot ? "Total is too low" : "Save this shop"}
        </button>
      </div>
    </BottomSheet>
  );
}
