import { useState, useEffect, useCallback, useRef } from "react";
import type { ListEntry, Category, Item } from "@shared/types";
import * as api from "../api";
import { Icon } from "../components/Icon";
import { suggest } from "../lib/catalog";
import { parseQty } from "../lib/numbers";
import { readSnapshot, writeSnapshot, isOffline } from "../lib/cache";
import type { OutboxOp } from "../lib/outbox";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { EmptyState } from "../components/EmptyState";
import { useToast } from "../components/Toast";
import { useOutbox } from "../components/Outbox";

export function ListScreen({
  categories,
  navigate,
}: {
  categories: Category[];
  navigate: (path: string) => void;
}) {
  const [entries, setEntries] = useState<ListEntry[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const { toast } = useToast();
  const { online, queue, queueAdd, cancelQueued } = useOutbox();
  const inputRef = useRef<HTMLInputElement>(null);

  const catMap = new Map(categories.map((c) => [c.id, c]));

  const fetchAll = useCallback(async () => {
    try {
      const [listData, itemsData] = await Promise.all([api.getList(), api.getItems()]);
      writeSnapshot("list", listData);
      writeSnapshot("items", itemsData);
      setEntries(listData);
      setItems(itemsData);
    } catch (err) {
      if (!isOffline(err)) throw err;
      setEntries(readSnapshot<ListEntry[]>("list")?.value ?? []);
      setItems(readSnapshot<Item[]>("items")?.value ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  // Refetches when the queue empties, which covers both the first load and the
  // moment a sync finishes -- that is when the server first has rows for the
  // adds this screen has been showing from the queue.
  useEffect(() => {
    if (online && queue.length === 0) fetchAll();
  }, [fetchAll, online, queue.length]);

  // Adds that have not reached the server yet, shown alongside the real ones.
  // Matched on clientId so a synced entry replaces its queued twin instead of
  // appearing twice in the gap before the refetch lands.
  const synced = new Set(entries.map((e) => e.clientId).filter(Boolean));
  const pendingAdds: ListEntry[] = queue
    .filter((op): op is Extract<OutboxOp, { kind: "add" }> => op.kind === "add")
    .filter((op) => !synced.has(op.id))
    .map((op) => ({
      id: op.id,
      itemId: op.itemId,
      customName: op.customName,
      displayName:
        op.customName ?? items.find((i) => i.id === op.itemId)?.name ?? "New item",
      categoryId: op.itemId ? (items.find((i) => i.id === op.itemId)?.categoryId ?? null) : null,
      qty: op.qty,
      note: null,
      addedBy: null,
      addedAt: op.createdAt,
      status: "pending",
      clientId: op.id,
    }));

  const allEntries = [...entries, ...pendingAdds];

  // A row is still unsent while the add that created it is in the queue. Keyed
  // on the operation id rather than on which list the row came from, because an
  // optimistic row lives in `entries` and a row restored after a reload lives
  // in `pendingAdds` -- both are equally not-yet-on-the-server.
  const queuedAddIds = new Set(
    queue.filter((op) => op.kind === "add").map((op) => op.id),
  );
  const isPending = (id: string) => queuedAddIds.has(id);

  // Filter items for quick-add suggestions
  const suggestions = query.trim().length >= 1
    ? items
        .filter(
          (i) =>
            i.name.toLowerCase().includes(query.toLowerCase()) &&
            !allEntries.some((e) => e.itemId === i.id),
        )
        .slice(0, 5)
    : [];

  // Common grocery names, offered after the pantry's own items. These take the
  // same path as anything else typed here: the item is created and tracked.
  const catalogSuggestions =
    query.trim().length >= 2
      ? suggest(
          query,
          new Set([
            ...items.map((i) => i.name.toLowerCase()),
            ...allEntries.map((e) => e.displayName.toLowerCase()),
          ]),
          4,
        )
      : [];

  // Both add paths go through the queue rather than straight to the API. It
  // sends immediately when there is a connection, so online behaviour is
  // unchanged, and holds the add until there is one when there isn't --
  // which is the point, since half of what goes on this list gets remembered
  // standing in the aisle.
  /**
   * Shows the row straight away, keyed to the operation that will create it.
   *
   * Without this the row would blink: the queued add disappears from the queue
   * the moment it is sent, and the refetch that brings back the real row lands
   * a moment later. Carrying it in `entries` under its clientId means the
   * refetch replaces it in place instead of the row vanishing in between.
   */
  const showOptimistically = useCallback(
    (op: OutboxOp & { kind: "add" }, displayName: string, categoryId: string | null) => {
      setEntries((prev) => [
        ...prev,
        {
          id: op.id,
          itemId: op.itemId,
          customName: op.customName,
          displayName,
          categoryId,
          qty: op.qty,
          note: null,
          addedBy: null,
          addedAt: op.createdAt,
          status: "pending",
          clientId: op.id,
        },
      ]);
    },
    [],
  );

  const handleAddItem = useCallback(
    (itemId: string) => {
      setShowSuggestions(false);
      setQuery("");
      const item = items.find((i) => i.id === itemId);
      const op = queueAdd({ itemId });
      if (op.kind === "add") {
        showOptimistically(op, item?.name ?? "New item", item?.categoryId ?? null);
      }
      toast("Added to list");
    },
    [items, queueAdd, showOptimistically, toast],
  );

  const handleAddCustom = useCallback(
    (override?: string) => {
      const name = (override ?? query).trim();
      if (!name) return;

      setShowSuggestions(false);
      setQuery("");
      const op = queueAdd({ customName: name });
      if (op.kind === "add") showOptimistically(op, name, null);
      toast(`${name} added to list`);
    },
    [query, queueAdd, showOptimistically, toast],
  );

  /** Commits the quantity typed on a row. Blank clears it back to unspecified. */
  const handleSaveQty = useCallback(
    async (id: string, raw: string, previous: number | null) => {
      const trimmed = raw.trim();
      const qty = trimmed === "" ? null : parseQty(trimmed, 1);
      if (qty === previous) return; // nothing typed, or typed back to the same

      // A row that has not synced has no server id to PATCH. Editing it is not
      // worth a queued operation of its own -- it can just be removed and
      // re-added -- so say what is true rather than dropping the keystrokes.
      if (isPending(id)) {
        toast("Set the quantity once this has synced", "info");
        return;
      }

      setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, qty } : e)));
      try {
        await api.updateListEntry(id, { qty });
      } catch (err) {
        toast(isOffline(err) ? "Quantities need a connection" : "Couldn't save the quantity", "error");
        fetchAll();
      }
    },
    [toast, fetchAll, isPending],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      // Removing something added moments ago and not yet sent just drops the
      // queued operation -- there is nothing on the server to delete.
      if (isPending(id)) {
        cancelQueued(id);
        return;
      }

      setEntries((prev) => prev.filter((e) => e.id !== id));
      try {
        await api.deleteListEntry(id);
      } catch (err) {
        toast(isOffline(err) ? "Removing needs a connection" : "Failed to remove", "error");
        fetchAll();
      }
    },
    [toast, fetchAll, isPending, cancelQueued],
  );

  if (loading) return <LoadingSpinner />;

  // Group entries by category
  const grouped: { cat: Category | null; entries: ListEntry[] }[] = [];
  const byCategory = new Map<string | null, ListEntry[]>();
  for (const e of allEntries) {
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
        <h1 className="screen-title">Shop List</h1>
        <p className="text-sm text-text-secondary mt-0.5">
          {allEntries.length} item{allEntries.length !== 1 ? "s" : ""} to buy
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
                <span className="text-xs text-text-tertiary">new</span>
              </button>
            ))}

            {query.trim() && (
              <button
                onClick={() => handleAddCustom()}
                className="w-full text-left px-4 py-2.5 text-sm font-medium text-accent-text hover:bg-surface-sunken transition-colors border-t border-border-subtle"
              >
                Add "{query.trim()}"
              </button>
            )}
          </div>
        )}
      </div>

      {allEntries.length === 0 ? (
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
                <h3 className="flex items-center gap-2 eyebrow px-1 mb-2">
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
                        <span className="flex items-center gap-1.5">
                          <span className="block text-sm font-medium text-text truncate">
                            {entry.displayName}
                          </span>
                          {/* On the list, but not yet on the server. */}
                          {isPending(entry.id) && (
                            <Icon
                              name="cloud-off"
                              className="w-3.5 h-3.5 text-text-tertiary shrink-0"
                              strokeWidth={1.75}
                            />
                          )}
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
