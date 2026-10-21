import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import type { ItemWithStatus, PurchaseWithItem } from "@shared/types";
import * as api from "../api";
import { BottomSheet } from "./BottomSheet";
import { PriceInput } from "./PriceInput";
import { Icon } from "./Icon";
import { useToast } from "./Toast";
import { formatMoney } from "../lib/money";
import {
  dateInputToEpochSeconds,
  epochSecondsToDateInput,
  findDuplicatePurchases,
} from "../lib/utilities";

export function LogSpendSheet({
  open,
  onClose,
  onSaved,
  items,
  defaultDate,
  existingPurchases = [],
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  items: ItemWithStatus[];
  defaultDate?: string;
  existingPurchases?: PurchaseWithItem[];
}) {
  const today = useMemo(() => epochSecondsToDateInput(Date.now() / 1000), []);
  const yesterday = useMemo(
    () => epochSecondsToDateInput(Date.now() / 1000 - 86400),
    [],
  );
  const minDate = useMemo(
    () => epochSecondsToDateInput(Date.now() / 1000 - 30 * 86400),
    [],
  );

  const [date, setDate] = useState(defaultDate ?? today);
  const [query, setQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState<ItemWithStatus | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [qty, setQty] = useState<number>(1);
  const [unit, setUnit] = useState<string>("pcs");
  const [note, setNote] = useState("");
  const [showItemSuggestions, setShowItemSuggestions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<{
    count: number;
    sampleItems: string[];
  } | null>(null);
  const { toast } = useToast();

  const inputRef = useRef<HTMLInputElement>(null);

  // Sync date when defaultDate changes
  useEffect(() => {
    if (defaultDate) setDate(defaultDate);
  }, [defaultDate]);

  // Reset form when reopened
  useEffect(() => {
    if (open) {
      setDate(defaultDate ?? today);
      setQuery("");
      setSelectedItem(null);
      setPrice(null);
      setQty(1);
      setUnit("pcs");
      setNote("");
      setShowItemSuggestions(false);
      setDuplicateWarning(null);
    }
  }, [open, defaultDate, today]);

  // Clear duplicate warning if date, price, or item query changes
  useEffect(() => {
    setDuplicateWarning(null);
  }, [date, price, query]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 8);
    return items
      .filter((i) => i.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [items, query]);

  const handleSelectItem = useCallback((item: ItemWithStatus) => {
    setSelectedItem(item);
    setQuery(item.name);
    setUnit(item.unit || "pcs");
    setQty(item.defaultQty || 1);
    if (item.defaultPrice) {
      setPrice(item.defaultPrice);
    }
    setShowItemSuggestions(false);
  }, []);

  const handleSave = useCallback(
    async (confirmedDuplicate = false) => {
      const name = query.trim();
      if (price === null || price <= 0) {
        toast("Please enter a valid amount", "error");
        return;
      }

      // Duplicate detection: check if there's already an entry on the same date with the same amount
      if (!confirmedDuplicate && existingPurchases.length > 0) {
        const matches = findDuplicatePurchases(existingPurchases, date, price);
        if (matches.length > 0) {
          const itemNames = Array.from(
            new Set(
              matches
                .map((m) => m.itemName || items.find((i) => i.id === m.itemId)?.name || "")
                .filter(Boolean),
            ),
          );
          setDuplicateWarning({
            count: matches.length,
            sampleItems: itemNames,
          });
          return;
        }
      }

      setSaving(true);
      try {
        await api.addPurchase({
          itemId: selectedItem?.id,
          itemName: selectedItem ? undefined : (name || undefined),
          purchasedAt: dateInputToEpochSeconds(date),
          priceTotal: price,
          qty: qty > 0 ? qty : 1,
          unit: unit.trim() || "pcs",
          note: note.trim() || null,
        });

        const displayLabel = selectedItem?.name ?? (name || null);
        toast(displayLabel ? `Logged ${displayLabel}` : `Logged ${formatMoney(price)} spending`);
        onSaved();
        onClose();
      } catch {
        toast("Couldn't save spending — check your connection", "error");
      } finally {
        setSaving(false);
      }
    },
    [
      query,
      selectedItem,
      price,
      date,
      qty,
      unit,
      note,
      existingPurchases,
      items,
      toast,
      onSaved,
      onClose,
    ],
  );

  return (
    <BottomSheet open={open} onClose={onClose} title="Log spending">
      <div className="space-y-4 pt-1">
        {/* Date -------------------------------------------------------- */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-text-secondary">Date</label>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setDate(today)}
                className={`text-[0.6875rem] px-2 py-0.5 rounded-md font-medium transition-colors ${
                  date === today
                    ? "bg-accent-50 text-accent-text"
                    : "text-text-tertiary hover:text-text-secondary"
                }`}
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => setDate(yesterday)}
                className={`text-[0.6875rem] px-2 py-0.5 rounded-md font-medium transition-colors ${
                  date === yesterday
                    ? "bg-accent-50 text-accent-text"
                    : "text-text-tertiary hover:text-text-secondary"
                }`}
              >
                Yesterday
              </button>
            </div>
          </div>
          <input
            type="date"
            value={date}
            min={minDate}
            max={today}
            onChange={(e) => setDate(e.target.value)}
            className="w-full min-h-11 bg-surface-sunken border border-border-subtle rounded-xl px-3 py-2 text-sm text-text outline-none focus:border-accent-400"
          />
        </div>

        {/* Item Name / Picker ----------------------------------------- */}
        <div className="relative">
          <label className="block text-xs font-medium text-text-secondary mb-1.5">
            Item <span className="text-text-tertiary font-normal">(optional)</span>
          </label>
          <div className="relative">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedItem(null);
                setShowItemSuggestions(true);
              }}
              onFocus={() => setShowItemSuggestions(true)}
              placeholder="Search staple or type item name (optional)..."
              className="w-full min-h-11 bg-surface-sunken border border-border-subtle rounded-xl px-3 py-2 text-sm text-text outline-none focus:border-accent-400 pr-10"
            />
            {selectedItem ? (
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                <span className="text-status-ok">
                  <Icon name="check" className="w-4 h-4" strokeWidth={2.5} />
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedItem(null);
                    setQuery("");
                  }}
                  className="p-1 text-text-tertiary hover:text-text transition-colors rounded"
                  title="Clear item selection"
                >
                  <Icon name="close" className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-text-tertiary hover:text-text transition-colors rounded"
                title="Clear input"
              >
                <Icon name="close" className="w-3.5 h-3.5" />
              </button>
            ) : null}
          </div>

          {/* Autocomplete suggestions dropdown */}
          {showItemSuggestions && (
            <div className="absolute left-0 right-0 top-full mt-1 bg-surface-raised border border-border-subtle rounded-xl shadow-lg z-30 max-h-48 overflow-y-auto divide-y divide-border-subtle/50">
              {filteredItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectItem(item)}
                  className="w-full px-3 py-2 text-left flex items-center justify-between hover:bg-surface-sunken transition-colors"
                >
                  <span className="text-sm font-medium text-text truncate">{item.name}</span>
                  <span className="text-xs text-text-tertiary shrink-0 ml-2">
                    {item.unit}
                  </span>
                </button>
              ))}

              {query.trim() && !items.some((i) => i.name.toLowerCase() === query.trim().toLowerCase()) && (
                <button
                  type="button"
                  onClick={() => setShowItemSuggestions(false)}
                  className="w-full px-3 py-2 text-left text-xs text-accent-text hover:bg-surface-sunken transition-colors font-medium flex items-center gap-1.5"
                >
                  <Icon name="plus" className="w-3.5 h-3.5" />
                  <span>Log as new item "{query.trim()}"</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Amount ----------------------------------------------------- */}
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">
            Amount spent
          </label>
          <PriceInput
            value={price}
            onChange={setPrice}
            placeholder="Amount (e.g. 250)"
          />
        </div>

        {/* Quantity & Unit -------------------------------------------- */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Quantity
            </label>
            <input
              type="number"
              inputMode="decimal"
              min={0.01}
              step="any"
              value={qty || ""}
              onChange={(e) => setQty(Number(e.target.value) || 1)}
              className="w-full min-h-11 bg-surface-sunken border border-border-subtle rounded-xl px-3 py-2 text-sm text-text outline-none focus:border-accent-400"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Unit
            </label>
            <input
              type="text"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="pcs, kg..."
              className="w-full min-h-11 bg-surface-sunken border border-border-subtle rounded-xl px-3 py-2 text-sm text-text outline-none focus:border-accent-400"
            />
          </div>
        </div>

        {/* Note (optional) -------------------------------------------- */}
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">
            Note (optional)
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Local shop, bazaar, brand..."
            className="w-full min-h-11 bg-surface-sunken border border-border-subtle rounded-xl px-3 py-2 text-sm text-text outline-none focus:border-accent-400 placeholder:text-text-tertiary"
          />
        </div>

        {/* Submit or Duplicate Prompt ------------------------------- */}
        <div className="pt-2">
          {duplicateWarning ? (
            <div className="p-4 rounded-xl bg-status-due-bg/90 border border-status-due-border space-y-3 animate-in fade-in duration-200">
              <div className="flex items-start gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-status-due/20 text-status-due flex items-center justify-center shrink-0 mt-0.5">
                  <Icon name="alert" className="w-4 h-4" strokeWidth={2.5} />
                </span>
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-text">Possible duplicate detected</p>
                  <p className="text-xs text-text-secondary leading-relaxed">
                    A purchase of <strong className="text-text font-semibold">{formatMoney(price!)}</strong>{" "}
                    was already logged on this date
                    {duplicateWarning.sampleItems.length > 0 ? (
                      <>
                        {" "}for <strong className="text-text font-semibold">{duplicateWarning.sampleItems.join(", ")}</strong>
                      </>
                    ) : null}
                    . Is this a duplicate entry, or did you make another purchase for this amount?
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setDuplicateWarning(null)}
                  className="min-h-11 px-3 rounded-xl border border-border-subtle bg-surface hover:bg-surface-sunken text-xs font-medium text-text-secondary hover:text-text transition-colors"
                >
                  Cancel (edit)
                </button>
                <button
                  type="button"
                  onClick={() => handleSave(true)}
                  disabled={saving}
                  className="min-h-11 px-3 rounded-xl bg-accent-500 hover:bg-accent-600 text-text-on-accent text-xs font-semibold transition-colors disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Log anyway"}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => handleSave(false)}
              disabled={saving || price === null || price <= 0}
              className="w-full min-h-12 py-3 rounded-xl bg-accent-500 text-text-on-accent text-sm font-semibold hover:bg-accent-600 active:scale-[0.99] transition-all disabled:opacity-50 disabled:pointer-events-none shadow-sm"
            >
              {saving ? "Saving…" : "Save spending"}
            </button>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}
