import { useState, useEffect, useCallback, useRef } from "react";
import type { ListEntry, Category, ItemWithStatus } from "@shared/types";
import * as api from "../api";
import { Icon } from "../components/Icon";
import { suggest } from "../lib/catalog";
import { parseQty } from "../lib/numbers";
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

  // Common grocery names, offered only after the pantry's own items. These add
  // as one-off entries rather than tracked staples -- the shop list is not the
  // place to silently create something the restock engine will then chase.
  const catalogSuggestions =
    query.trim().length >= 2
      ? suggest(
          query,
          new Set([
            ...items.map((i) => i.name.toLowerCase()),
            ...entries.map((e) => e.displayName.toLowerCase()),
          ]),
          4,
        )
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

  // Takes an explicit name for the catalogue suggestions: setQuery hasn't
  // flushed by the time the handler runs, so reading state would add the
  // half-typed query instead of the suggestion that was tapped.
  /**
   * Adds a name that isn't yet a pantry item.
   *
   * Creates the item first, then puts *that* on the list. Free text used to be
   * the default here, which was a quiet trap: a free-text entry has no item_id,
   * so buying it records no purchase, never updates last_purchased_at, and
   * never reaches Pantry or Insights. Everything typed straight into this box
   * vanished the moment it was ticked off.
   *
   * `oneOff` keeps the old behaviour for things genuinely not worth tracking,
   * but it now has to be asked for rather than being what happens by default.
   */
  const handleAddCustom = useCallback(
    async (override?: string, oneOff = false) => {
      const name = (override ?? query).trim();
      if (!name) return;

      setShowSuggestions(false);
      setQuery("");
      const qty = 1;

      try {
        if (oneOff) {
          const entry = await api.addToList({ customName: name, qty });
          setEntries((prev) => [...prev, entry]);
          toast(`${name} added just this once`);
          return;
        }

        const item = await api.createItem({ name, isStaple: true, defaultQty: qty });
        const entry = await api.addToList({ itemId: item.id, qty });
        setEntries((prev) => [...prev, entry]);
        setItems((prev) => [...prev, item as (typeof prev)[number]]);
        toast(`${name} added and now tracked`);
      } catch (err) {
        // The usual failure is a name that already exists in the pantry, which
        // the API rejects on its unique index. Say which, rather than "failed".
        toast(
          err instanceof api.ApiRequestError ? err.body.message : `Couldn't add ${name}`,
          "error",
        );
      }
    },
    [query, toast],
  );

  /** Commits the quantity typed on a row. Blank clears it back to unspecified. */
  const handleSaveQty = useCallback(
    async (id: string, raw: string, previous: number | null) => {
      const trimmed = raw.trim();
      const qty = trimmed === "" ? null : parseQty(trimmed, 1);
      if (qty === previous) return; // nothing typed, or typed back to the same

      setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, qty } : e)));
      try {
        await api.updateListEntry(id, { qty });
      } catch {
        toast("Couldn't save the quantity", "error");
        fetchAll();
      }
    },
    [toast, fetchAll],
  );

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
        <h1 className="font-display text-[1.75rem] font-semibold text-text">Shop List</h1>
        <p className="text-sm text-text-secondary mt-0.5">
          {entries.length} item{entries.length !== 1 ? "s" : ""} to buy
        </p>
      </header>

      {/* Quick add bar */}
      <div className="px-4 mb-3 relative">
        <div className="flex items-center gap-2 bg-surface-sunken rounded-xl border border-border px-3 py-2 focus-within:border-accent-400 transition-all">
          <Icon name="plus" className="w-4 h-4 text-text-tertiary shrink-0" strokeWidth={1.5} />
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
            {catalogSuggestions.map((sg) => (
              <button
                key={sg.name}
                onClick={() => handleAddCustom(sg.name)}
                className="w-full text-left px-4 py-2.5 text-sm text-text hover:bg-surface-sunken transition-colors flex items-center gap-2 border-t border-border-subtle"
              >
                <Icon name="plus" className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
                <span className="flex-1">{sg.name}</span>
                <span className="text-xs text-text-tertiary">one-off</span>
              </button>
            ))}

            {query.trim() && (
              <button
                onClick={() => handleAddCustom(undefined, true)}
                className="w-full text-left px-4 py-2 text-xs text-text-tertiary hover:bg-surface-sunken transition-colors border-t border-border-subtle"
              >
                Just this once — don't track it
              </button>
            )}

            {query.trim() && (
              <button
                onClick={() => handleAddCustom()}
                className="w-full text-left px-4 py-2.5 text-sm font-medium text-accent-600 hover:bg-surface-sunken transition-colors border-t border-border-subtle"
              >
                Add "{query.trim()}" to the pantry
              </button>
            )}
          </div>
        )}
      </div>

      {entries.length === 0 ? (
        <EmptyState
          icon="basket"
          title="List is empty"
          subtitle="Add items from Today or type something above"
        />
      ) : (
        <>
          <div className="px-4 space-y-4 pb-4">
            {grouped.map(({ cat, entries: groupEntries }) => (
              <section key={cat?.id ?? "none"}>
                <h3 className="flex items-center gap-2 eyebrow text-text-tertiary px-1 mb-2">
                  {cat && (
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />
                  )}
                  {cat?.name ?? "Other"}
                </h3>
                <div className="space-y-1.5">
                  {groupEntries.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center gap-3 px-3 py-2.5 card-row"
                    >
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium text-text truncate">
                          {entry.displayName}
                        </span>
                        {entry.note && (
                          <span className="block text-xs text-text-tertiary mt-0.5 truncate">
                            {entry.note}
                          </span>
                        )}
                      </span>

                      {/* Always present rather than revealed on tap. The reveal
                          relied on autoFocus, which iOS frequently ignores for
                          an input mounted after the gesture, so the field could
                          appear and close again before it was ever usable.
                          Uncontrolled, so there is no per-row draft state and
                          nothing to race: the key resets it if the value
                          changes underneath. */}
                      <span className="flex items-center gap-1 shrink-0 bg-surface-sunken rounded-lg px-2 py-1">
                        <span className="text-text-tertiary text-xs">×</span>
                        <input
                          key={`${entry.id}:${entry.qty ?? ""}`}
                          defaultValue={entry.qty === null ? "" : String(entry.qty)}
                          onBlur={(e) => handleSaveQty(entry.id, e.target.value, entry.qty)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                          }}
                          inputMode="decimal"
                          placeholder="1"
                          aria-label={`Quantity for ${entry.displayName}`}
                          className="w-8 bg-transparent text-sm text-text text-center outline-none placeholder:text-text-tertiary"
                        />
                      </span>

                      <button
                        onClick={() => handleDelete(entry.id)}
                        className="shrink-0 w-7 h-7 rounded-full text-text-tertiary hover:text-danger hover:bg-danger-bg flex items-center justify-center transition-colors"
                      >
                        <Icon name="close" className="w-4 h-4" strokeWidth={1.5} />
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
              className="w-full py-3.5 rounded-2xl bg-accent-500 text-text-on-accent font-semibold text-sm shadow-lg hover:shadow-xl active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              <Icon name="basket" className="w-5 h-5" strokeWidth={2} />
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
