import { useState, useEffect, useMemo } from "react";
import type { Category, ItemWithStatus, InsightsResponse, SpendBucket } from "@shared/types";
import * as api from "../api";
import { Icon } from "../components/Icon";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { EmptyState } from "../components/EmptyState";
import { formatMoney } from "../lib/money";
import { isOffline } from "../lib/cache";

type Cadence = "week" | "month";

export function InsightsScreen({ categories }: { categories: Category[] }) {
  const [items, setItems] = useState<ItemWithStatus[] | null>(null);
  const [listItemIds, setListItemIds] = useState<Set<string>>(new Set());
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [cadence, setCadence] = useState<Cadence>("month");
  const [showBreakdown, setShowBreakdown] = useState(false);

  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [all, list, insights] = await Promise.all([
          api.getItems(),
          api.getList(),
          api.getInsights(),
        ]);
        setItems(all);
        setListItemIds(
          new Set(list.map((e) => e.itemId).filter((id): id is string => id !== null)),
        );
        setData(insights);
      } catch (err) {
        // Every figure on this screen is aggregated server-side over the whole
        // purchase history, so there is nothing meaningful to cache: a stale
        // spend total looks exactly like a current one and would be believed.
        // Saying the screen needs a connection is the only honest option.
        if (!isOffline(err)) throw err;
        setUnreachable(true);
      }
    };
    load();
  }, []);

  const stats = useMemo(() => {
    if (!items) return null;
    const active = items;
    const basket = active.filter((i) => listItemIds.has(i.id) || i.status !== "ok");
    const priced = basket.filter((i) => i.defaultPrice !== null);

    const byCategory = categories
      .map((c) => ({ ...c, count: active.filter((i) => i.categoryId === c.id).length }))
      .filter((c) => c.count > 0)
      .sort((a, b) => b.count - a.count);

    return {
      active,
      basket,
      priced,
      estimate: priced.reduce((sum, i) => sum + (i.defaultPrice ?? 0), 0),
      byCategory,
      maxCount: byCategory[0]?.count ?? 1,
      withPrice: active.filter((i) => i.defaultPrice !== null).length,
    };
  }, [items, listItemIds, categories]);

  // Oldest-first for the chart; the API returns newest-first for its own LIMIT.
  const buckets: SpendBucket[] = useMemo(() => {
    if (!data) return [];
    return [...(cadence === "week" ? data.byWeek : data.byMonth)].reverse();
  }, [data, cadence]);

  // All-time spend per item. Deliberately not scoped to the visible buckets:
  // the API returns per-item totals across all history, and silently showing
  // an all-time figure under a windowed heading would be worse than saying so.
  const spentByItem = useMemo(
    () =>
      (data?.topItems ?? [])
        .filter((u) => u.totalSpend > 0)
        .sort((a, b) => b.totalSpend - a.totalSpend),
    [data],
  );

  const peak = Math.max(1, ...buckets.map((b) => b.spend));
  const periodTotal = buckets.reduce((sum, b) => sum + b.spend, 0);

  if (unreachable) {
    return (
      <div className="safe-top">
        <header className="px-5 pt-7 pb-5">
          <h1 className="screen-title">Insights</h1>
        </header>
        <EmptyState
          icon="cloud-off"
          title="Insights need a connection"
          subtitle="Spending and consumption are worked out from your whole purchase history. Everything you buy offline is saved and counted once you're back on."
        />
      </div>
    );
  }

  if (!items || !data) return <LoadingSpinner />;

  if (stats && stats.active.length === 0) {
    return (
      <div className="safe-top">
        <header className="px-5 pt-7 pb-5">
          <h1 className="screen-title">Insights</h1>
        </header>
        <EmptyState
          icon="chart"
          title="Nothing to measure yet"
          subtitle="Add a few staples and start ticking them off. Patterns show up after a shop or two."
        />
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="safe-top pb-6">
      <header className="px-5 pt-7 pb-5">
        <h1 className="screen-title">Insights</h1>
        <p className="text-sm text-text-secondary mt-1">
          {stats.active.length} tracked · {data.totalPurchases}{" "}
          {data.totalPurchases === 1 ? "purchase" : "purchases"} logged
        </p>
      </header>

      <div className="px-4 space-y-3">
        {/* Spend ---------------------------------------------------------- */}
        <section className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="eyebrow">Spending</h2>

            <div className="flex rounded-lg bg-surface-sunken p-0.5" role="group">
              {(["week", "month"] as Cadence[]).map((c) => (
                <button
                  key={c}
                  onClick={() => setCadence(c)}
                  aria-pressed={cadence === c}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    cadence === c
                      ? "bg-surface-raised text-text shadow-sm"
                      : "text-text-tertiary hover:text-text-secondary"
                  }`}
                >
                  {c === "week" ? "Weekly" : "Monthly"}
                </button>
              ))}
            </div>
          </div>

          {!data.hasData ? (
            <p className="text-sm text-text-secondary">
              Nothing recorded yet. Tick an item off in Shop Mode and add what you paid —
              that's what fills this in.
            </p>
          ) : periodTotal === 0 ? (
            <p className="text-sm text-text-secondary">
              {data.totalPurchases} {data.totalPurchases === 1 ? "purchase" : "purchases"} logged,
              but none with a price yet. Add the amount when you tick something off and this
              starts tracking.
            </p>
          ) : (
            <>
              {/* The total is the obvious thing to interrogate, so it is the
                  control: tapping it breaks the figure down by item. */}
              <button
                onClick={() => setShowBreakdown((v) => !v)}
                aria-expanded={showBreakdown}
                className="text-left w-full group"
              >
                <span className="numeral block text-[2.25rem] leading-none font-semibold text-text">
                  {formatMoney(periodTotal)}
                </span>
                <span className="flex items-center gap-1 text-xs text-text-tertiary mt-1.5">
                  Across the last {buckets.length} {cadence === "week" ? "weeks" : "months"}
                  <Icon
                    name="chevron"
                    className={`w-3 h-3 transition-transform ${showBreakdown ? "rotate-90" : ""}`}
                  />
                </span>
              </button>

              {showBreakdown && (
                <ul className="mt-3 mb-1 space-y-1.5 animate-fade-in">
                  {spentByItem.length === 0 ? (
                    <li className="text-xs text-text-tertiary">
                      No priced purchases to break down yet.
                    </li>
                  ) : (
                    spentByItem.map((u) => (
                      <li key={u.itemId} className="flex items-baseline gap-3 text-sm">
                        <span className="flex-1 min-w-0 truncate text-text">{u.name}</span>
                        <span className="text-xs text-text-tertiary shrink-0">
                          {u.purchases}×
                        </span>
                        <span className="numeral shrink-0 text-text">
                          {formatMoney(u.totalSpend)}
                        </span>
                      </li>
                    ))
                  )}
                </ul>
              )}

              <div className="mb-4" />

              {/* Bars are scaled to the highest bucket, so the shape of the
                  spending reads even when the absolute amounts are small. */}
              <div className="flex items-end gap-1.5 h-24">
                {buckets.map((b) => (
                  <div key={b.key} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
                    <div className="w-full flex-1 flex items-end">
                      <div
                        className="w-full rounded-t-md bg-accent-400 transition-all"
                        style={{ height: `${Math.max(2, (b.spend / peak) * 100)}%` }}
                        title={`${b.label}: ${formatMoney(b.spend)}`}
                      />
                    </div>
                    <span className="text-[0.5625rem] text-text-tertiary truncate w-full text-center">
                      {b.label}
                    </span>
                  </div>
                ))}
              </div>

              {data.pricedPurchases < data.totalPurchases && (
                <p className="flex items-start gap-1.5 text-xs text-text-tertiary mt-3 pt-3 border-t border-border-subtle">
                  <Icon name="tag" className="w-3.5 h-3.5 shrink-0 mt-px" />
                  <span>
                    {data.totalPurchases - data.pricedPurchases} of {data.totalPurchases} purchases
                    had no price, so the real total is higher.
                  </span>
                </p>
              )}
            </>
          )}
        </section>

        {/* Usage ---------------------------------------------------------- */}
        {data.topItems.length > 0 && (
          <section className="card p-4">
            <h2 className="eyebrow mb-3">What you get through</h2>
            <ul className="space-y-2.5">
              {data.topItems.slice(0, 8).map((u) => (
                <li key={u.itemId} className="flex items-baseline gap-3">
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-text truncate">{u.name}</span>
                    <span className="block text-xs text-text-tertiary mt-0.5">
                      {u.qtyPerMonth !== null
                        ? `≈ ${u.qtyPerMonth} ${u.unit} a month`
                        : `${u.totalQty} ${u.unit} so far`}
                      {u.medianGapDays !== null && ` · every ~${u.medianGapDays}d`}
                    </span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className="numeral block text-sm text-text">
                      {u.totalSpend > 0 ? formatMoney(u.totalSpend) : "—"}
                    </span>
                    <span className="block text-xs text-text-tertiary">
                      {u.purchases}×
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Spend by category ---------------------------------------------- */}
        {data.byCategory.some((c) => c.spend > 0) && (
          <section className="card p-4">
            <h2 className="eyebrow mb-3">Where it goes</h2>
            <ul className="space-y-2">
              {data.byCategory
                .filter((c) => c.spend > 0)
                .map((c) => (
                  <li key={c.categoryId ?? "none"} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-xs text-text-secondary truncate">
                      {c.name}
                    </span>
                    <span className="flex-1 h-1.5 rounded-full bg-surface-sunken overflow-hidden">
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${(c.spend / Math.max(...data.byCategory.map((x) => x.spend), 1)) * 100}%`,
                          backgroundColor: c.color,
                        }}
                      />
                    </span>
                    <span className="numeral shrink-0 text-xs text-text">
                      {formatMoney(c.spend)}
                    </span>
                  </li>
                ))}
            </ul>
          </section>
        )}

        {/* Next shop estimate --------------------------------------------- */}
        <section className="card p-4">
          <h2 className="eyebrow mb-2">Next shop, roughly</h2>
          <p className="numeral text-[1.75rem] leading-none font-semibold text-text">
            {stats.priced.length > 0 ? formatMoney(stats.estimate) : "—"}
          </p>
          <p className="text-xs text-text-tertiary mt-2">
            {stats.basket.length === 0
              ? "Nothing due and nothing on the list."
              : stats.priced.length === stats.basket.length
                ? `Across ${stats.basket.length} ${stats.basket.length === 1 ? "item" : "items"}`
                : `From ${stats.priced.length} of ${stats.basket.length} items — the rest have no price yet`}
          </p>
        </section>

        {/* Pantry composition --------------------------------------------- */}
        {stats.byCategory.length > 0 && (
          <section className="card p-4">
            <h2 className="eyebrow mb-3">What's in the pantry</h2>
            <ul className="space-y-2">
              {stats.byCategory.map((c) => (
                <li key={c.id} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-xs text-text-secondary truncate">
                    {c.name}
                  </span>
                  <span className="flex-1 h-1.5 rounded-full bg-surface-sunken overflow-hidden">
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${(c.count / stats.maxCount) * 100}%`,
                        backgroundColor: c.color,
                      }}
                    />
                  </span>
                  <span className="numeral w-6 text-right text-xs text-text">{c.count}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
