import { useState, useEffect, useCallback } from "react";
import type { ItemWithStatus, Category } from "@shared/types";
import * as api from "../api";
import { StatusBadge } from "../components/StatusBadge";
import { CategoryBadge } from "../components/CategoryBadge";
import { EmptyState } from "../components/EmptyState";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { useToast } from "../components/Toast";

type UrgencyGroup = "overdue" | "due" | "due_soon";

const GROUP_CONFIG: Record<UrgencyGroup, { title: string; emoji: string }> = {
  overdue:  { title: "Overdue",        emoji: "🔴" },
  due:      { title: "Due Now",        emoji: "🟡" },
  due_soon: { title: "Coming Up Soon", emoji: "🟢" },
};

export function TodayScreen({ categories }: { categories: Category[] }) {
  const [items, setItems] = useState<ItemWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  const catMap = new Map(categories.map((c) => [c.id, c]));

  const fetchItems = useCallback(async () => {
    try {
      const data = await api.getToday();
      setItems(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const handleAddToList = useCallback(
    async (item: ItemWithStatus) => {
      setAdding((prev) => new Set(prev).add(item.id));
      try {
        await api.addToList({ itemId: item.id });
        // Mark as on-list locally
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, onList: true } : i)),
        );
        toast(`${item.name} added to list`);
      } catch {
        toast("Failed to add", "error");
      } finally {
        setAdding((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
      }
    },
    [toast],
  );

  if (loading) return <LoadingSpinner />;

  // Only show items that need attention
  const urgent = items.filter((i) => i.status !== "ok");

  if (urgent.length === 0) {
    return (
      <div className="pt-safe">
        <header className="px-5 pt-6 pb-4">
          <h1 className="text-2xl font-bold text-text">Today</h1>
        </header>
        <EmptyState
          icon="🎉"
          title="All stocked up!"
          subtitle="Nothing needs restocking right now. Enjoy your day."
        />
      </div>
    );
  }

  // Group by urgency level
  const groups: Record<string, ItemWithStatus[]> = {};
  for (const item of urgent) {
    const key = item.status as string;
    if (!groups[key]) groups[key] = [];
    groups[key]!.push(item);
  }

  return (
    <div className="safe-top">
      <header className="px-5 pt-6 pb-2">
        <h1 className="text-2xl font-bold text-text">Today</h1>
        <p className="text-sm text-text-secondary mt-0.5">
          {urgent.length} item{urgent.length !== 1 ? "s" : ""} need attention
        </p>
      </header>

      <div className="px-4 space-y-5 pb-4">
        {(["overdue", "due", "due_soon"] as UrgencyGroup[]).map((groupKey) => {
          const groupItems = groups[groupKey];
          if (!groupItems?.length) return null;
          const cfg = GROUP_CONFIG[groupKey];

          return (
            <section key={groupKey} className="animate-fade-in">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-text-secondary px-1 mb-2">
                <span>{cfg.emoji}</span> {cfg.title}
                <span className="text-xs text-text-tertiary">({groupItems.length})</span>
              </h2>
              <div className="space-y-2">
                {groupItems.map((item) => {
                  const cat = item.categoryId ? catMap.get(item.categoryId) : null;
                  return (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 p-3 rounded-2xl bg-surface-raised border border-border-subtle shadow-sm hover:shadow-md transition-shadow"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-sm text-text truncate">{item.name}</span>
                          <StatusBadge status={item.status} />
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {cat && <CategoryBadge name={cat.name} color={cat.color} />}
                          <span className="text-xs text-text-tertiary">
                            {item.daysSince !== null
                              ? `${item.daysSince}d since last buy`
                              : "Never purchased"}
                          </span>
                        </div>
                      </div>

                      {item.onList ? (
                        <span className="shrink-0 w-9 h-9 rounded-full bg-status-ok-bg flex items-center justify-center text-status-ok">
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                          </svg>
                        </span>
                      ) : (
                        <button
                          onClick={() => handleAddToList(item)}
                          disabled={adding.has(item.id)}
                          className="shrink-0 w-9 h-9 rounded-full bg-accent-100 text-accent-600 flex items-center justify-center hover:bg-accent-200 active:scale-90 transition-all disabled:opacity-50"
                          title="Add to list"
                        >
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                          </svg>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
