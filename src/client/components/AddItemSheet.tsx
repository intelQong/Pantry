import { useState, useCallback } from "react";
import type { Category } from "@shared/types";
import * as api from "../api";
import { BottomSheet } from "../components/BottomSheet";
import { useToast } from "../components/Toast";

export function AddItemSheet({
  categories,
  open,
  onClose,
  onAdded,
}: {
  categories: Category[];
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
  const [saving, setSaving] = useState(false);
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
  }, [name, categoryId, unit, defaultQty, brand, notes, interval, locked, isStaple, toast, onClose, onAdded]);

  return (
    <BottomSheet open={open} onClose={onClose} title="Add Item">
      <div className="space-y-3">
        <label className="block">
          <span className="text-xs font-medium text-text-secondary">Name *</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            className="w-full mt-1 px-3 py-2 rounded-lg bg-surface-sunken border border-border text-sm text-text outline-none focus:border-accent-500"
            placeholder="e.g. Rice"
          />
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
          className="w-full py-2.5 rounded-xl gradient-accent text-text-on-accent text-sm font-semibold disabled:opacity-50 mt-2"
        >
          {saving ? "Adding…" : "Add Item"}
        </button>
      </div>
    </BottomSheet>
  );
}
