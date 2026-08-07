import { useState, useEffect, useCallback, useMemo } from "react";
import type { ItemWithStatus, Category, RestockStatus } from "@shared/types";
import * as api from "../api";
import { Icon } from "../components/Icon";
import { Jar, JarClipDef } from "../components/Jar";
import { StatusStrip } from "../components/StatusStrip";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { EmptyState } from "../components/EmptyState";
import { LoadFailed } from "../components/LoadFailed";
import { ItemDetailSheet } from "../components/ItemDetailSheet";
import { AddItemSheet } from "../components/AddItemSheet";
import { readSnapshot, writeSnapshot, isOffline } from "../lib/cache";
import { jarFill, jarCaption } from "../lib/jar";

/**
 * The jar's colour. Nothing here is colour-only: the fill height and the
 * caption under each jar say the same thing without it.
 */
const TONE: Record<RestockStatus, string> = {
  overdue: "text-status-overdue",
  due: "text-status-due",
  due_soon: "text-status-due-soon",
  ok: "text-status-ok",
};

export function PantryScreen({ categories }: { categories: Category[] }) {
  const [items, setItems] = useState<ItemWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const fetchItems = useCallback(async () => {
    setFailed(false);
    try {
      // Gas, electricity and wifi are items so they can ride the purchase loop,
      // but the pantry is a grocery browse -- they belong on Bills. Filtered
      // before the snapshot so the offline copy agrees with the live one.
      const fetched = (await api.getItems()).filter((i) => !i.isUtility);
      writeSnapshot("items", fetched);
      setItems(fetched);
    } catch (err) {
      // Read-only offline. Editing an item, or adding one, still needs the
      // network -- those sheets say so themselves when their save fails.
      // A failure that is not the network is the server erroring. Falling back
      // to the cache there would show a stale list as though it were live, and
      // rethrowing (as this used to) escapes the effect as an unhandled
      // rejection and leaves the screen claiming the pantry is empty.
      if (!isOffline(err)) {
        setFailed(true);
        return;
      }
      setItems(readSnapshot<ItemWithStatus[]>("items")?.value ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  /**
   * The shelves: one section per category, in the aisle order the API already
   * sorts categories into, uncategorised last.
   *
   * Search filters *within* a shelf and drops shelves that end up empty, rather
   * than collapsing everything into one flat grid. A browse screen is worth
   * using because things stay where you left them, and items are deliberately
   * not re-sorted by how empty they are for the same reason.
   */
  const shelves = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matching = q
      ? items.filter(
          (i) =>
            i.name.toLowerCase().includes(q) ||
            (i.brand !== null && i.brand.toLowerCase().includes(q)),
        )
      : items;

    const byCategory = new Map<string, ItemWithStatus[]>();
    for (const item of matching) {
      const key = item.categoryId ?? "__none__";
      const bucket = byCategory.get(key);
      if (bucket) bucket.push(item);
      else byCategory.set(key, [item]);
    }

    const out: Array<{ cat: Category | null; rows: ItemWithStatus[] }> = [];
    for (const cat of categories) {
      const rows = byCategory.get(cat.id);
      if (rows?.length) out.push({ cat, rows });
    }
    const uncategorised = byCategory.get("__none__");
    if (uncategorised?.length) out.push({ cat: null, rows: uncategorised });
    return out;
  }, [items, search, categories]);

  const matchCount = shelves.reduce((n, s) => n + s.rows.length, 0);

  if (loading) return <LoadingSpinner />;
  if (failed) return <LoadFailed offline={false} onRetry={fetchItems} />;

  return (
    <div className="safe-top">
      {/* One clip path for every jar on the screen. */}
      <JarClipDef />

      <header className="px-5 pt-6 pb-3">
        <h1 className="screen-title">Pantry</h1>
      </header>

      {items.length > 0 && (
        <div className="card mx-4 mb-4 p-4">
          <StatusStrip items={items} />
        </div>
      )}

      {/* Search */}
      <div className="px-4 mb-4">
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

      {matchCount === 0 ? (
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
        <div className="px-4 pb-4">
          {shelves.map(({ cat, rows }) => (
            <section key={cat?.id ?? "none"} className="mb-5">
              <h3 className="flex items-center gap-2 eyebrow px-1 mb-2">
                {cat && (
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: cat.color }}
                  />
                )}
                {cat?.name ?? "Other"}
              </h3>

              {/* No column gap: each cell draws its own shelf rule, and with
                  the cells touching those rules join into one line per row. */}
              <div className="grid grid-cols-3 gap-y-1">
                {rows.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                    aria-label={`${item.name}, ${jarCaption(item)}`}
                    /* The shelf rule is this button's own bottom border. With
                       no column gap the cells touch, so the rules join into one
                       line running the width of the shelf. */
                    className={`flex flex-col items-center pt-2 pb-1.5 border-b border-border active:scale-95 transition-transform ${TONE[item.status]}`}
                  >
                    <Jar fill={jarFill(item)} urgent={item.status !== "ok"} className="w-14" />
                    <span className="mt-1.5 w-full truncate px-1 text-xs font-medium text-text">
                      {item.name}
                    </span>
                    {/* Anything but "stocked" says so in its own colour: the
                        jar art alone is too quiet at this size to be the only
                        carrier of urgency. */}
                    <span
                      className={`w-full truncate px-1 text-xs numeral ${
                        item.status === "ok" ? "text-text-tertiary" : "font-medium"
                      }`}
                    >
                      {jarCaption(item)}
                    </span>
                  </button>
                ))}

                {/* Empty cells finishing the last row, so its shelf rule runs
                    the full width instead of stopping under the last jar. */}
                {Array.from({ length: (3 - (rows.length % 3)) % 3 }, (_, i) => (
                  <span key={`pad-${i}`} className="border-b border-border" aria-hidden="true" />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* FAB */}
      <button
        onClick={() => setShowAdd(true)}
        aria-label="Add item"
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
