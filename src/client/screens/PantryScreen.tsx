import { useState, useEffect, useCallback, useMemo } from "react";
import type { ItemWithStatus, Category } from "@shared/types";
import * as api from "../api";
import { Icon } from "../components/Icon";
import { StatusBadge } from "../components/StatusBadge";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { EmptyState } from "../components/EmptyState";
import { ItemDetailSheet } from "../components/ItemDetailSheet";
import { AddItemSheet } from "../components/AddItemSheet";

export function PantryScreen({ categories }: { categories: Category[] }) {
  const [items, setItems] = useState<ItemWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const catMap = new Map(categories.map((c) => [c.id, c]));

  const fetchItems = useCallback(async () => {
    try {
      setItems(await api.getItems());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const filtered = useMemo(
    () =>
      search.trim()
        ? items.filter((i) =>
            i.name.toLowerCase().includes(search.toLowerCase()) ||
            (i.brand && i.brand.toLowerCase().includes(search.toLowerCase())),
          )
        : items,
    [items, search],
  );

  if (loading) return <LoadingSpinner />;

  return (
    <div className="safe-top">
      <header className="px-5 pt-6 pb-2">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-[1.75rem] font-semibold text-text">Pantry</h1>
          <span className="text-sm text-text-secondary">{items.length} items</span>
        </div>
      </header>

      {/* Search */}
      <div className="px-4 mb-3">
        <div className="flex items-center gap-2 bg-surface-sunken rounded-xl border border-border px-3 py-2 focus-within:border-accent-400 transition-all">
<Icon name="search" className="w-4 h-4 text-text-tertiary shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search items…"
            className="flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-tertiary"
          />
          {search && (
            <button onClick={() => setSearch("")} className="text-text-tertiary hover:text-text">
              <Icon name="close" className="w-4 h-4" strokeWidth={1.5} />
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon="box"
          title={search ? "No matches" : "No items yet"}
          subtitle={search ? "Try a different search" : "Add your first pantry item"}
          action={
            !search && (
              <button
                onClick={() => setShowAdd(true)}
                className="px-5 py-2 rounded-xl bg-accent-500 text-text-on-accent text-sm font-semibold"
              >
                Add Item
              </button>
            )
          }
        />
      ) : (
        <div className="px-4 space-y-1.5 pb-4">
          {filtered.map((item) => {
            const cat = item.categoryId ? catMap.get(item.categoryId) : null;
            return (
              <button
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                className="w-full text-left flex items-center gap-3 p-3 card-row hover:shadow-sm active:scale-[0.99] transition-all"
              >
                {/* Status dot */}
                <div
                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                    item.status === "overdue"  ? "bg-status-overdue" :
                    item.status === "due"      ? "bg-status-due" :
                    item.status === "due_soon" ? "bg-status-due-soon" :
                                                 "bg-status-ok"
                  }`}
                />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-text truncate">{item.name}</span>
                    {item.brand && (
                      <span className="text-xs text-text-tertiary truncate">{item.brand}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {cat && (
                      <span className="text-xs text-text-tertiary flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: cat.color }} />
                        {cat.name}
                      </span>
                    )}
                    <span className="text-xs text-text-tertiary">
                      Every {item.restockIntervalDays}d
                    </span>
                  </div>
                </div>

                <StatusBadge status={item.status} />
              </button>
            );
          })}
        </div>
      )}

      {/* FAB */}
      <button
        onClick={() => setShowAdd(true)}
        className="fixed bottom-24 right-4 w-14 h-14 rounded-full bg-accent-500 text-text-on-accent shadow-lg hover:shadow-xl active:scale-90 transition-all flex items-center justify-center z-30"
      >
        <Icon name="plus" className="w-7 h-7" strokeWidth={2} />
      </button>

      {/* Sheets */}
      {selectedId && (
        <ItemDetailSheet
          itemId={selectedId}
          categories={categories}
          open={!!selectedId}
          onClose={() => setSelectedId(null)}
          onUpdated={fetchItems}
        />
      )}
      <AddItemSheet
        categories={categories}
        existingNames={items.map((i) => i.name)}
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onAdded={fetchItems}
      />
    </div>
  );
}
