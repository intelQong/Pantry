import { useState, useCallback, useMemo } from "react";
import type { Category } from "@shared/types";
import * as api from "../api";
import { parseMoney, CURRENCY_SYMBOL } from "../lib/money";
import { suggest, matchCategory } from "../lib/catalog";
import { BottomSheet } from "../components/BottomSheet";
import { useToast } from "../components/Toast";

export function AddItemSheet({
  categories,
  existingNames: existing,
  open,
  onClose,
  onAdded,
}: {
  categories: Category[];
  /** Names already in the pantry, so suggestions never offer a duplicate. */
  existingNames: string[];
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [unit, setUnit] = useState("pcs");
  const [defaultQty, setDefaultQty] = useState(1);
  const [brand, setBrand] = useState("");
  const [notes, setNotes] = useState("");
  const [interval, setInterval] = useState(7);
  const [locked, setLocked] = useState(false);
  const [isStaple, setIsStaple] = useState(true);
  const [price, setPrice] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [saving, setSaving] = useState(false);

  // Existing names are excluded so the list never offers something already
  // tracked -- the API would reject it on the unique-name index anyway.
  const existingNames = useMemo(
    () => new Set(existing.map((n) => n.toLowerCase())),
    [existing],
  );
  const suggestions = useMemo(
    () => (showSuggestions ? suggest(name, existingNames) : []),
    [name, existingNames, showSuggestions],
  );
  const { toast } = useToast();

  const reset = () => {
    setName("");
    setCategoryId(null);
    setUnit("pcs");
    setDefaultQty(1);
    setBrand("");
    setNotes("");
    setInterval(7);
    setLocked(false);
    setIsStaple(true);
  };

  const handleSave = useCallback(async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api.createItem({
        name: name.trim(),
        categoryId,
        unit,
        defaultQty,
        brand: brand.trim() || null,
        notes: notes.trim() || null,
        restockIntervalDays: interval,
        intervalLocked: locked,
        isStaple,
        defaultPrice: parseMoney(price),
      });
      toast("Item created");
      reset();
      onClose();
      onAdded();
    } catch (err) {
      toast(err instanceof api.ApiRequestError ? err.body.message : "Failed to create", "error");
    } finally {
      setSaving(false);
    }
  }, [name, categoryId, unit, defaultQty, brand, notes, interval, locked, isStaple, price, toast, onClose, onAdded]);

  return (
    <BottomSheet open={open} onClose={onClose} title="Add Item">
      <div className="space-y-3">
        <div className="block">
          <span className="text-xs font-medium text-text-secondary">Name *</span>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setShowSuggestions(true);
            }}
            autoFocus
            autoComplete="off"
            autoCapitalize="words"
            spellCheck
            lang="en"
            className="w-full mt-1 px-3 py-2 rounded-lg bg-surface-sunken border border-border text-sm text-text outline-none focus:border-accent-400"
            placeholder="Start typing — e.g. Rice"
          />

          {suggestions.length > 0 && (
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {suggestions.map((sg) => (
                <li key={sg.name}>
                  <button
                    type="button"
                    onClick={() => {
                      // Filling in the interval and category is the real value
                      // here: those are the two fields nobody wants to guess.
                      setName(sg.name);
                      setInterval(sg.days);
                      const match = matchCategory(categories, sg.category);
                      if (match) setCategoryId(match.id);
                      setShowSuggestions(false);
                    }}
                    className="px-2.5 py-1 rounded-full bg-accent-50 text-accent-700 text-xs font-medium hover:bg-accent-100 transition-colors"
                  >
                    {sg.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <label className="block">
          <span className="text-xs font-medium text-text-secondary">
            Usual price <span className="text-text-tertiary font-normal">· optional</span>
          </span>
          <div className="relative mt-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-tertiary pointer-events-none">
              {CURRENCY_SYMBOL}
            </span>
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal"
              className="w-full pl-7 pr-3 py-2 rounded-lg bg-surface-sunken border border-border text-sm text-text outline-none focus:border-accent-400"
              placeholder="0"
            />
          </div>
        </label>

        <label className="block">
          <span className="text-xs font-medium text-text-secondary">Category</span>
          <select
            value={categoryId ?? ""}
            onChange={(e) => setCategoryId(e.target.value || null)}
            className="w-full mt-1 px-3 py-2 rounded-lg bg-surface-sunken border border-border text-sm text-text outline-none"
          >
            <option value="">None</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium text-text-secondary">Unit</span>
            <input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-lg bg-surface-sunken border border-border text-sm text-text outline-none"
              placeholder="pcs, kg, L…"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-text-secondary">Default Qty</span>
            <input
              type="number"
              value={defaultQty}
              onChange={(e) => setDefaultQty(Number(e.target.value) || 1)}
              className="w-full mt-1 px-3 py-2 rounded-lg bg-surface-sunken border border-border text-sm text-text outline-none"
            />
          </label>
        </div>

        <label className="block">
          <span className="text-xs font-medium text-text-secondary">Brand</span>
          <input
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            className="w-full mt-1 px-3 py-2 rounded-lg bg-surface-sunken border border-border text-sm text-text outline-none"
            placeholder="Optional"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-text-secondary">Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full mt-1 px-3 py-2 rounded-lg bg-surface-sunken border border-border text-sm text-text outline-none resize-none"
            placeholder="Optional"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium text-text-secondary">Restock every (days)</span>
            <input
              type="number"
              min={1}
              max={365}
              value={interval}
              onChange={(e) => setInterval(Number(e.target.value) || 7)}
              className="w-full mt-1 px-3 py-2 rounded-lg bg-surface-sunken border border-border text-sm text-text outline-none"
            />
          </label>
          <div className="flex flex-col justify-end">
            <label className="flex items-center gap-2 py-2 cursor-pointer">
              <input
                type="checkbox"
                checked={locked}
                onChange={(e) => setLocked(e.target.checked)}
                className="w-4 h-4 accent-accent-500"
              />
              <span className="text-xs text-text-secondary">Lock interval</span>
            </label>
          </div>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isStaple}
            onChange={(e) => setIsStaple(e.target.checked)}
            className="w-4 h-4 accent-accent-500"
          />
          <span className="text-sm text-text">Track as staple</span>
        </label>

        <button
          onClick={handleSave}
          disabled={saving || !name.trim()}
          className="w-full py-2.5 rounded-xl bg-accent-500 text-text-on-accent text-sm font-semibold disabled:opacity-50 mt-2"
        >
          {saving ? "Adding…" : "Add Item"}
        </button>
      </div>
    </BottomSheet>
  );
}
