import { useState, useEffect, useCallback, useRef } from "react";
import type { ListEntry, Category, ItemWithStatus } from "@shared/types";
import * as api from "../api";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { EmptyState } from "../components/EmptyState";
import { useToast } from "../components/Toast";

export function ListScreen({
  categories,
  navigate,
}: {
  categories: Category[];
  navigate: (path: string) => void;
}) {
  const [entries, setEntries] = useState<ListEntry[]>([]);
  const [items, setItems] = useState<ItemWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const catMap = new Map(categories.map((c) => [c.id, c]));

  const fetchAll = useCallback(async () => {
    try {
      const [listData, itemsData] = await Promise.all([api.getList(), api.getItems()]);
      setEntries(listData);
      setItems(itemsData);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Filter items for quick-add suggestions
  const suggestions = query.trim().length >= 1
    ? items
        .filter(
          (i) =>
            i.name.toLowerCase().includes(query.toLowerCase()) &&
            !entries.some((e) => e.itemId === i.id),
        )
        .slice(0, 5)
    : [];

  const handleAddItem = useCallback(
    async (itemId: string) => {
      setShowSuggestions(false);
      setQuery("");
      try {
        const entry = await api.addToList({ itemId });
        setEntries((prev) => [...prev, entry]);
        toast("Added to list");
      } catch {
        toast("Failed to add", "error");
      }
    },
    [toast],
  );

  const handleAddCustom = useCallback(async () => {
    const name = query.trim();
    if (!name) return;
    setShowSuggestions(false);
    setQuery("");
    try {
      const entry = await api.addToList({ customName: name });
      setEntries((prev) => [...prev, entry]);
      toast("Added to list");
    } catch {
      toast("Failed to add", "error");
    }
  }, [query, toast]);

  const handleDelete = useCallback(
    async (id: string) => {
      setEntries((prev) => prev.filter((e) => e.id !== id));
      try {
        await api.deleteListEntry(id);
      } catch {
        toast("Failed to remove", "error");
        fetchAll();
      }
    },
    [toast, fetchAll],
  );

  if (loading) return <LoadingSpinner />;

  // Group entries by category
  const grouped: { cat: Category | null; entries: ListEntry[] }[] = [];
  const byCategory = new Map<string | null, ListEntry[]>();
  for (const e of entries) {
    const key = e.categoryId ?? "__none__";
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key)!.push(e);
  }
  // Categories in aisle order, then uncategorised
  for (const cat of categories) {
    const catEntries = byCategory.get(cat.id);
    if (catEntries?.length) grouped.push({ cat, entries: catEntries });
  }
  const uncategorised = byCategory.get("__none__");
  if (uncategorised?.length) grouped.push({ cat: null, entries: uncategorised });

  return (
    <div className="safe-top">
      <header className="px-5 pt-6 pb-2">
        <h1 className="text-2xl font-bold text-text">Shop List</h1>
        <p className="text-sm text-text-secondary mt-0.5">
          {entries.length} item{entries.length !== 1 ? "s" : ""} to buy
        </p>
      </header>

      {/* Quick add bar */}
      <div className="px-4 mb-3 relative">
        <div className="flex items-center gap-2 bg-surface-sunken rounded-xl border border-border px-3 py-2 focus-within:border-accent-500 focus-within:ring-2 focus-within:ring-accent-500/20 transition-all">
          <svg className="w-4 h-4 text-text-tertiary shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddCustom();
            }}
            placeholder="Add an item…"
            className="flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-tertiary"
          />
        </div>

        {/* Suggestions dropdown */}
        {showSuggestions && query.trim() && (
          <div className="absolute left-4 right-4 top-full mt-1 bg-surface-raised border border-border rounded-xl shadow-lg z-10 overflow-hidden">
            {suggestions.map((item) => (
              <button
                key={item.id}
                onClick={() => handleAddItem(item.id)}
                className="w-full text-left px-4 py-2.5 text-sm text-text hover:bg-surface-sunken transition-colors flex items-center gap-2"
              >
                <span className="flex-1">{item.name}</span>
                {item.categoryId && catMap.get(item.categoryId) && (
                  <span className="text-xs text-text-tertiary">
                    {catMap.get(item.categoryId)!.name}
                  </span>
                )}
              </button>
            ))}
            {query.trim() && (
              <button
                onClick={handleAddCustom}
                className="w-full text-left px-4 py-2.5 text-sm font-medium text-accent-600 hover:bg-surface-sunken transition-colors border-t border-border-subtle"
              >
                Add "{query.trim()}" as custom item
              </button>
            )}
          </div>
        )}
      </div>

      {entries.length === 0 ? (
        <EmptyState
          icon="📋"
          title="List is empty"
          subtitle="Add items from Today or type something above"
        />
      ) : (
        <>
          <div className="px-4 space-y-4 pb-4">
            {grouped.map(({ cat, entries: groupEntries }) => (
              <section key={cat?.id ?? "none"}>
                <h3 className="flex items-center gap-2 text-xs font-semibold text-text-secondary uppercase tracking-wide px-1 mb-2">
                  {cat && (
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />
                  )}
                  {cat?.name ?? "Other"}
                </h3>
                <div className="space-y-1.5">
                  {groupEntries.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-surface-raised border border-border-subtle"
                    >
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-text">{entry.displayName}</span>
                        {entry.qty && (
                          <span className="text-xs text-text-tertiary ml-2">×{entry.qty}</span>
                        )}
                        {entry.note && (
                          <p className="text-xs text-text-tertiary mt-0.5 truncate">{entry.note}</p>
                        )}
                      </div>
                      <button
                        onClick={() => handleDelete(entry.id)}
                        className="shrink-0 w-7 h-7 rounded-full text-text-tertiary hover:text-danger hover:bg-danger-bg flex items-center justify-center transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>

          {/* Enter Shop Mode button */}
          <div className="fixed bottom-20 left-0 right-0 px-4 pb-2 z-30">
            <button
              onClick={() => navigate("shop")}
              className="w-full py-3.5 rounded-2xl gradient-accent text-text-on-accent font-semibold text-sm shadow-lg hover:shadow-xl active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
              </svg>
              Enter Shop Mode
            </button>
          </div>
        </>
      )}

      {/* Click away to close suggestions */}
      {showSuggestions && (
        <div className="fixed inset-0 z-0" onClick={() => setShowSuggestions(false)} />
      )}
    </div>
  );
}
