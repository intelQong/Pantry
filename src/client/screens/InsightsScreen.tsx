import { useState, useEffect, useMemo } from "react";
import type { Category, ItemWithStatus } from "@shared/types";
import * as api from "../api";
import { Icon } from "../components/Icon";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { EmptyState } from "../components/EmptyState";
import { formatMoney } from "../lib/money";

export function InsightsScreen({ categories }: { categories: Category[] }) {
  const [items, setItems] = useState<ItemWithStatus[] | null>(null);
  const [listItemIds, setListItemIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const load = async () => {
      const [all, list] = await Promise.all([api.getItems(), api.getList()]);
      setItems(all);
      setListItemIds(
        new Set(list.map((e) => e.itemId).filter((id): id is string => id !== null)),
      );
    };
    load();
  }, []);

  const stats = useMemo(() => {
    if (!items) return null;

    const active = items.filter((i) => !i.archived);
    // What the next trip will probably cost: everything already on the list,
    // plus anything due that hasn't been added yet.
    const basket = active.filter((i) => listItemIds.has(i.id) || i.status !== "ok");
    const priced = basket.filter((i) => i.defaultPrice !== null);
    const estimate = priced.reduce((sum, i) => sum + (i.defaultPrice ?? 0), 0);

    const byCategory = categories
      .map((c) => ({ ...c, count: active.filter((i) => i.categoryId === c.id).length }))
      .filter((c) => c.count > 0)
      .sort((a, b) => b.count - a.count);

    return {
      active,
      basket,
      priced,
      estimate,
      byCategory,
      maxCount: byCategory[0]?.count ?? 1,
      withPrice: active.filter((i) => i.defaultPrice !== null).length,
    };
  }, [items, listItemIds, categories]);

  if (!items) return <LoadingSpinner />;

  if (stats && stats.active.length === 0) {
    return (
      <div className="safe-top">
        <header className="px-5 pt-7 pb-5">
          <h1 className="font-display text-[1.75rem] font-semibold text-text">Insights</h1>
        </header>
        <EmptyState
          icon="chart"
          title="Nothing to measure yet"
          subtitle="Add a few staples and start ticking things off. Patterns show up after a shop or two."
        />
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="safe-top pb-6">
      <header className="px-5 pt-7 pb-5">
        <h1 className="font-display text-[1.75rem] font-semibold text-text">Insights</h1>
        <p className="text-sm text-text-secondary mt-1">
          {stats.active.length} tracked · {stats.withPrice} with a price
        </p>
      </header>

      <div className="px-4 space-y-3">
        {/* Next shop estimate ------------------------------------------- */}
        <section className="rounded-2xl border border-border-subtle bg-surface-raised p-4">
          <h2 className="eyebrow text-text-tertiary mb-2">Next shop, roughly</h2>

          <p className="font-display text-[2.25rem] leading-none font-semibold text-text tabular-nums">
            {stats.priced.length > 0 ? formatMoney(stats.estimate) : "—"}
          </p>

          <p className="text-xs text-text-tertiary mt-2">
            {stats.basket.length === 0
              ? "Nothing due and nothing on the list."
              : stats.priced.length === stats.basket.length
                ? `Across ${stats.basket.length} ${stats.basket.length === 1 ? "item" : "items"}`
                : `From ${stats.priced.length} of ${stats.basket.length} items — the rest have no price yet`}
          </p>

          {stats.basket.length > stats.priced.length && (
            <p className="flex items-start gap-1.5 text-xs text-text-tertiary mt-2.5 pt-2.5 border-t border-border-subtle">
              <Icon name="tag" className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span>
                Add a usual price to an item and it starts counting towards this.
              </span>
            </p>
          )}
        </section>

        {/* Composition -------------------------------------------------- */}
        {stats.byCategory.length > 0 && (
          <section className="rounded-2xl border border-border-subtle bg-surface-raised p-4">
            <h2 className="eyebrow text-text-tertiary mb-3">What's in the pantry</h2>
            <ul className="space-y-2">
              {stats.byCategory.map((c) => (
                <li key={c.id} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-xs text-text-secondary truncate">
                    {c.name}
                  </span>
                  {/* Bars are proportional to the largest category, so the shape
                      of the pantry reads at a glance rather than the raw counts. */}
                  <span className="flex-1 h-1.5 rounded-full bg-surface-sunken overflow-hidden">
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${(c.count / stats.maxCount) * 100}%`,
                        backgroundColor: c.color,
                      }}
                    />
                  </span>
                  <span className="w-6 text-right text-xs tabular-nums text-text">{c.count}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="text-xs text-text-tertiary text-center px-6 pt-2">
          Spend history, consumption rhythms and price trends arrive once there are
          a few shops' worth of purchases to read.
        </p>
      </div>
    </div>
  );
}
