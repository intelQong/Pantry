import { useState, useEffect, useCallback } from "react";
import type { Category, Purchase } from "@shared/types";
import * as api from "../api";
import { BottomSheet } from "../components/BottomSheet";
import { useToast } from "../components/Toast";

export function ItemDetailSheet({
  itemId,
  categories,
  open,
  onClose,
  onUpdated,
}: {
  itemId: string;
  categories: Category[];
  open: boolean;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [item, setItem] = useState<Awaited<ReturnType<typeof api.getItems>>[number] | null>(null);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  // Edit form state
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [unit, setUnit] = useState("pcs");
  const [defaultQty, setDefaultQty] = useState(1);
  const [brand, setBrand] = useState("");
  const [notes, setNotes] = useState("");
  const [interval, setInterval] = useState(7);
  const [locked, setLocked] = useState(false);
  const [isStaple, setIsStaple] = useState(true);

  useEffect(() => {
    if (!open) return;
    const load = async () => {
      const [allItems, history] = await Promise.all([
        api.getItems(),
        api.getItemPurchases(itemId),
      ]);
      const found = allItems.find((i) => i.id === itemId);
      if (found) {
        setItem(found);
        setName(found.name);
        setCategoryId(found.categoryId);
        setUnit(found.unit);
        setDefaultQty(found.defaultQty);
        setBrand(found.brand ?? "");
        setNotes(found.notes ?? "");
        setInterval(found.restockIntervalDays);
        setLocked(found.intervalLocked);
        setIsStaple(found.isStaple);
      }
      setPurchases(history);
    };
    load();
  }, [open, itemId]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await api.updateItem(itemId, {
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
      toast("Item updated");
      setEditing(false);
      onUpdated();
    } catch (err) {
      toast(err instanceof api.ApiRequestError ? err.body.message : "Failed to save", "error");
    } finally {
      setSaving(false);
    }
  }, [itemId, name, categoryId, unit, defaultQty, brand, notes, interval, locked, isStaple, toast, onUpdated]);

  const handleDelete = useCallback(async () => {
    try {
      await api.deleteItem(itemId);
      toast("Item archived");
      onClose();
      onUpdated();
    } catch {
      toast("Failed to delete", "error");
    }
  }, [itemId, toast, onClose, onUpdated]);

  return (
    <BottomSheet open={open} onClose={onClose} title={editing ? "Edit Item" : item?.name}>
      {!item ? (
        <div className="py-8 text-center text-text-tertiary text-sm">Loading…</div>
      ) : editing ? (
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-text-secondary">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-lg bg-surface-sunken border border-border text-sm text-text outline-none focus:border-accent-500"
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
            <span className="text-sm text-text">Track as staple (notify when due)</span>
          </label>

          <div className="flex gap-2 pt-2">
            <button
              onClick={() => setEditing(false)}
              className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium text-text-secondary hover:bg-surface-sunken transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="flex-1 py-2.5 rounded-xl gradient-accent text-text-on-accent text-sm font-semibold disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Item details */}
          <div className="space-y-2">
            {item.brand && (
              <p className="text-sm text-text-secondary">{item.brand}</p>
            )}
            <div className="flex flex-wrap gap-2 text-xs text-text-tertiary">
              <span>{item.unit} × {item.defaultQty}</span>
              <span>•</span>
              <span>Every {item.restockIntervalDays} days</span>
              {item.intervalLocked && <span>🔒</span>}
              {!item.isStaple && <span>• Not a staple</span>}
            </div>
            {item.notes && (
              <p className="text-sm text-text-secondary bg-surface-sunken rounded-lg px-3 py-2 mt-2">{item.notes}</p>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={() => setEditing(true)}
              className="flex-1 py-2 rounded-xl bg-surface-sunken text-sm font-medium text-text hover:bg-border transition-colors"
            >
              Edit
            </button>
            <button
              onClick={handleDelete}
              className="py-2 px-4 rounded-xl text-sm font-medium text-danger hover:bg-danger-bg transition-colors"
            >
              Archive
            </button>
          </div>

          {/* Purchase history */}
          {purchases.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">
                Purchase History
              </h4>
              <div className="space-y-1">
                {purchases.slice(0, 10).map((p) => (
                  <div key={p.id} className="flex items-center justify-between py-1.5 text-sm">
                    <span className="text-text-secondary">
                      {new Date(p.purchasedAt * 1000).toLocaleDateString()}
                    </span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-text-tertiary">
                        {p.qty} {p.unit}
                      </span>
                      {p.priceTotal !== null && (
                        <span className="text-text font-medium">
                          ৳{(p.priceTotal / 100).toFixed(0)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </BottomSheet>
  );
}
