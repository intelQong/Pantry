import { useState, useEffect, useCallback } from "react";
import type { Category, Purchase } from "@shared/types";
import * as api from "../api";
import { parseQty, parseIntervalDays } from "../lib/numbers";
import { parseMoney, toInputValue, formatMoney, CURRENCY_SYMBOL } from "../lib/money";
import { Icon } from "./Icon";
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
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const { toast } = useToast();

  // Edit form state
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [unit, setUnit] = useState("pcs");
  const [defaultQty, setDefaultQty] = useState("1");
  const [brand, setBrand] = useState("");
  const [notes, setNotes] = useState("");
  const [interval, setInterval] = useState("7");
  const [locked, setLocked] = useState(false);
  const [isStaple, setIsStaple] = useState(true);
  const [price, setPrice] = useState("");

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
        setDefaultQty(String(found.defaultQty));
        setBrand(found.brand ?? "");
        setNotes(found.notes ?? "");
        setInterval(String(found.restockIntervalDays));
        setLocked(found.intervalLocked);
        setIsStaple(found.isStaple);
        setPrice(toInputValue(found.defaultPrice));
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
        defaultQty: parseQty(defaultQty, 1),
        brand: brand.trim() || null,
        notes: notes.trim() || null,
        restockIntervalDays: parseIntervalDays(interval, 7),
        intervalLocked: locked,
        isStaple,
        defaultPrice: parseMoney(price),
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
      toast(`${item?.name ?? "Item"} deleted`);
      onClose();
      onUpdated();
    } catch {
      toast("Failed to delete", "error");
    }
  }, [itemId, item, toast, onClose, onUpdated]);

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
              className="w-full mt-1 px-3 py-2 rounded-lg bg-surface-sunken border border-border text-sm text-text outline-none focus:border-accent-400"
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
                type="text"
                inputMode="decimal"
                value={defaultQty}
                onChange={(e) => setDefaultQty(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-lg bg-surface-sunken border border-border text-sm text-text outline-none"
              />
            </label>
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
                onChange={(e) => setInterval(e.target.value)}
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
              className="flex-1 py-2.5 rounded-xl bg-accent-500 text-text-on-accent text-sm font-semibold disabled:opacity-50"
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
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-tertiary">
              <span>{item.unit} × {item.defaultQty}</span>
              <span aria-hidden="true">•</span>
              <span>Every {item.restockIntervalDays} days</span>
              {item.intervalLocked && (
                <Icon name="lock" className="w-3.5 h-3.5" />
              )}
              {!item.isStaple && (
                <>
                  <span aria-hidden="true">•</span>
                  <span>Not a staple</span>
                </>
              )}
            </div>

            {item.defaultPrice !== null && (
              <p className="inline-flex items-center gap-1.5 text-sm font-medium text-text">
                <Icon name="tag" className="w-4 h-4 text-text-tertiary" />
                {formatMoney(item.defaultPrice)}
                <span className="text-xs font-normal text-text-tertiary">usually</span>
              </p>
            )}
            {item.notes && (
              <p className="text-sm text-text-secondary bg-surface-sunken rounded-lg px-3 py-2 mt-2">{item.notes}</p>
            )}
          </div>

          {/* Actions. Delete is confirmed in place: it now removes the row
              outright, and purchase.item_id cascades, so the item's spend and
              consumption history goes with it. That is worth one deliberate tap. */}
          {confirmingDelete ? (
            <div className="rounded-xl border border-danger/30 bg-danger-bg/40 p-3">
              <p className="text-sm text-text">
                Delete {item.name}?
              </p>
              <p className="text-xs text-text-secondary mt-1">
                {purchases.length > 0
                  ? `Its ${purchases.length} recorded ${purchases.length === 1 ? "purchase" : "purchases"} will go too, and stop counting towards Insights.`
                  : "It has no purchase history, so nothing else is lost."}
              </p>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => setConfirmingDelete(false)}
                  className="flex-1 py-2 rounded-lg bg-surface-raised border border-border text-sm font-medium text-text-secondary"
                >
                  Keep it
                </button>
                <button
                  onClick={handleDelete}
                  className="flex-1 py-2 rounded-lg bg-danger text-white text-sm font-semibold"
                >
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => setEditing(true)}
                className="flex-1 py-2 rounded-xl bg-surface-sunken text-sm font-medium text-text hover:bg-border transition-colors"
              >
                Edit
              </button>
              <button
                onClick={() => setConfirmingDelete(true)}
                className="py-2 px-4 rounded-xl text-sm font-medium text-danger hover:bg-danger-bg transition-colors"
              >
                Delete
              </button>
            </div>
          )}

          {/* Purchase history */}
          {purchases.length > 0 && (
            <div>
              <h4 className="eyebrow text-text-tertiary mb-2">
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
