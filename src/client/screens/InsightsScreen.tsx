import { useState, useEffect, useMemo, useCallback } from "react";
import type { Category, ItemWithStatus, InsightsResponse, PurchaseWithItem } from "@shared/types";
import * as api from "../api";
import { Icon } from "../components/Icon";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { EmptyState } from "../components/EmptyState";
import { LoadFailed } from "../components/LoadFailed";
import { formatMoney } from "../lib/money";
import { isOffline } from "../lib/cache";
import { groupByDay, groupByWeek, groupByMonth } from "../lib/utilities";
import { LogSpendSheet } from "../components/LogSpendSheet";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/ConfirmSheet";

type Cadence = "day" | "week" | "month";

function getChartBarLabel(cadence: Cadence, key: string, defaultLabel?: string): string {
  if (cadence === "month") {
    const [y, m] = key.split("-").map(Number);
    if (!y || !m) return defaultLabel ?? key;
    const d = new Date(y, m - 1, 1);
    return d.toLocaleDateString(undefined, { month: "short" });
  }
  if (cadence === "week" || cadence === "day") {
    const [y, m, d] = key.split("-").map(Number);
    if (!y || !m || !d) return defaultLabel ?? key;
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }
  return defaultLabel ?? key;
}

export function InsightsScreen({ categories, navigate }: { categories: Category[]; navigate: (path: string) => void }) {
  const [items, setItems] = useState<ItemWithStatus[] | null>(null);
  const [listItemIds, setListItemIds] = useState<Set<string>>(new Set());
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [purchases, setPurchases] = useState<PurchaseWithItem[]>([]);
  const [cadence, setCadence] = useState<Cadence>("month");
  const [selectedPeriodKey, setSelectedPeriodKey] = useState<string | null>(null);
  const [expandedPeriod, setExpandedPeriod] = useState<string | null>(null);
  const [logSpendOpen, setLogSpendOpen] = useState(false);
  const [logSpendDate, setLogSpendDate] = useState<string | undefined>(undefined);

  const { toast } = useToast();
  const confirm = useConfirm();
  const [failure, setFailure] = useState<"offline" | "error" | null>(null);

  const load = useCallback(async () => {
    setFailure(null);
    try {
      const [all, list, insights, allPurchases] = await Promise.all([
        api.getItems(),
        api.getList(),
        api.getInsights(),
        api.getPurchases({ all: true }).catch(() => []),
      ]);
      setItems(all);
      setListItemIds(
        new Set(list.map((e) => e.itemId).filter((id): id is string => id !== null)),
      );
      setData(insights);
      setPurchases(allPurchases);
    } catch (err) {
      // Every figure on this screen is aggregated server-side over the whole
      // purchase history, so there is nothing meaningful to cache: a stale
      // spend total looks exactly like a current one and would be believed.
      // Saying so is the only honest option -- and rethrowing here used to
      // leave the screen on its spinner for good.
      setFailure(isOffline(err) ? "offline" : "error");
    }
  }, []);

  const handleDeletePurchase = useCallback(
    async (p: PurchaseWithItem) => {
      const ok = await confirm({
        title: `Delete this purchase of ${p.itemName}?`,
        message: "It will no longer count toward spending or restock timing.",
        action: "Delete Purchase",
      });
      if (!ok) return;
      try {
        await api.deletePurchase(p.id);
        toast(`Deleted ${p.itemName}`);
        load();
      } catch (err) {
        toast(err instanceof api.ApiRequestError ? err.body.message : "Couldn't delete purchase", "error");
      }
    },
    [toast, load, confirm],
  );

  useEffect(() => {
    load();
  }, [load]);

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

  const detailedPeriods = useMemo(() => {
    if (cadence === "day") return groupByDay(purchases);
    if (cadence === "week") return groupByWeek(purchases);
    return groupByMonth(purchases);
  }, [purchases, cadence]);

  const activePeriod = useMemo(() => {
    if (detailedPeriods.length === 0) return null;
    if (selectedPeriodKey) {
      const found = detailedPeriods.find((p) => p.key === selectedPeriodKey);
      if (found) return found;
    }
    return detailedPeriods[0];
  }, [detailedPeriods, selectedPeriodKey]);

  // Chart bars: derived from detailedPeriods so dates and timezones match
  // the local calendar and accordion perfectly. Oldest-first for left-to-right.
  const chartPeriods = useMemo(() => {
    if (detailedPeriods.length > 0) {
      const reversed = [...detailedPeriods].reverse();
      if (cadence === "day" && reversed.length > 14) return reversed.slice(-14);
      if (cadence === "week" && reversed.length > 12) return reversed.slice(-12);
      if (cadence === "month" && reversed.length > 12) return reversed.slice(-12);
      return reversed;
    }

    // Fallback to server buckets if purchases list is empty
    if (!data) return [];
    const b =
      cadence === "day"
        ? [...data.byDay].reverse()
        : cadence === "week"
          ? [...data.byWeek].reverse()
          : [...data.byMonth].reverse();
    const sliced = cadence === "day" && b.length > 14 ? b.slice(-14) : b.slice(-12);
    return sliced.map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      total: bucket.spend,
      purchases: [],
    }));
  }, [detailedPeriods, data, cadence]);

  const peak = Math.max(1, ...chartPeriods.map((p) => p.total));

  const handleOpenLogSpend = useCallback((date?: string) => {
    if (date) {
      setLogSpendDate(date);
    } else if (cadence === "day" && selectedPeriodKey && /^\d{4}-\d{2}-\d{2}$/.test(selectedPeriodKey)) {
      setLogSpendDate(selectedPeriodKey);
    } else {
      setLogSpendDate(undefined);
    }
    setLogSpendOpen(true);
  }, [cadence, selectedPeriodKey]);

  if (failure) {
    return (
      <div>
        <header className="px-5 pt-7 pb-5">
          <h1 className="screen-title">Stats</h1>
        </header>
        <LoadFailed offline={failure === "offline"} onRetry={load} />
      </div>
    );
  }

  if (!items || !data) return <LoadingSpinner />;

  if (stats && stats.active.length === 0) {
    return (
      <div>
        <header className="px-5 pt-7 pb-5">
          <h1 className="screen-title">Stats</h1>
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
    <div className="pb-6">
      <header className="px-5 pt-7 pb-5 flex items-start justify-between">
        <div>
          <h1 className="screen-title">Stats</h1>
          <p className="text-sm text-text-secondary mt-1">
            {stats.active.length} tracked · {data.totalPurchases}{" "}
            {data.totalPurchases === 1 ? "purchase" : "purchases"} logged
          </p>
        </div>
        <button
          onClick={() => handleOpenLogSpend()}
          className="px-3.5 py-2 rounded-xl bg-accent-500 text-text-on-accent text-xs font-semibold hover:bg-accent-600 active:scale-95 transition-all flex items-center gap-1.5 shadow-sm shrink-0"
        >
          <Icon name="plus" className="w-3.5 h-3.5" strokeWidth={2.5} />
          <span>Log spend</span>
        </button>
      </header>

      <div className="px-4 pb-3">
        <button
          onClick={() => navigate("history")}
          className="w-full flex items-center justify-between px-3.5 py-3 card text-left hover:border-accent-400 transition-colors group"
        >
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-lg bg-surface-sunken text-text-secondary flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <Icon name="clock" className="w-4 h-4" strokeWidth={1.8} />
            </span>
            <div>
              <span className="block text-xs font-semibold text-text">Trip history</span>
              <span className="block text-[0.6875rem] text-text-tertiary mt-0.5">
                View and edit past shops by date
              </span>
            </div>
          </div>
          <Icon name="chevron" className="w-4 h-4 text-text-tertiary group-hover:translate-x-0.5 transition-transform shrink-0" strokeWidth={2} />
        </button>
      </div>

      <div className="px-4 space-y-3">
        {/* Spend ---------------------------------------------------------- */}
        <section className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="eyebrow">Spending</h2>

            <div className="flex rounded-lg bg-surface-sunken p-0.5" role="group">
              {(["day", "week", "month"] as Cadence[]).map((c) => (
                <button
                  key={c}
                  onClick={() => {
                    setCadence(c);
                    setSelectedPeriodKey(null);
                    setExpandedPeriod(null);
                  }}
                  aria-pressed={cadence === c}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    cadence === c
                      ? "bg-surface-raised text-text shadow-sm"
                      : "text-text-tertiary hover:text-text-secondary"
                  }`}
                >
                  {c === "day" ? "Day" : c === "week" ? "Week" : "Month"}
                </button>
              ))}
            </div>
          </div>

          {!data.hasData || (detailedPeriods.length === 0 && data.totalSpend === 0) ? (
            <p className="text-sm text-text-secondary">
              Nothing recorded yet. Tick an item off in Shop Mode and add what you paid —
              that's what fills this in.
            </p>
          ) : data.totalSpend === 0 ? (
            <p className="text-sm text-text-secondary">
              {data.totalPurchases} {data.totalPurchases === 1 ? "purchase" : "purchases"} logged,
              but none with a price yet. Add the amount when you tick something off and this
              starts tracking.
            </p>
          ) : (
            <>
              {/* Spend Headline */}
              <div className="flex items-baseline justify-between mb-4">
                <div className="min-w-0 flex-1 pr-3">
                  <span className="numeral block text-[2.25rem] leading-none font-semibold text-text">
                    {formatMoney(activePeriod ? activePeriod.total : 0)}
                  </span>
                  <span className="block text-xs text-text-tertiary mt-1.5 truncate">
                    {activePeriod ? (
                      <>
                        <span className="font-semibold text-text-secondary">{activePeriod.label}</span>
                        {" · "}
                        {activePeriod.purchases.length} {activePeriod.purchases.length === 1 ? "item" : "items"} bought
                      </>
                    ) : (
                      "No spend recorded"
                    )}
                  </span>
                </div>

                <div className="text-right shrink-0">
                  <span className="block text-[0.6875rem] uppercase tracking-wider text-text-tertiary font-medium">
                    All-time total
                  </span>
                  <span className="numeral text-sm font-semibold text-text-secondary">
                    {formatMoney(data.totalSpend)}
                  </span>
                  <span className="block text-[0.6875rem] text-text-tertiary">
                    {data.totalPurchases} {data.totalPurchases === 1 ? "buy" : "buys"}
                  </span>
                </div>
              </div>

              {/* Bars scaled to the highest bucket */}
              <div className="flex items-end gap-1.5 h-24 pt-2">
                {chartPeriods.map((p, idx) => {
                  const isActive = p.key === activePeriod?.key;
                  const hideLabel =
                    chartPeriods.length > 10 &&
                    idx % 2 === 1 &&
                    idx !== chartPeriods.length - 1;
                  const barLabel = getChartBarLabel(cadence, p.key, p.label);

                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => {
                        setSelectedPeriodKey(p.key);
                        setExpandedPeriod(p.key);
                      }}
                      className="flex-1 flex flex-col items-center gap-1.5 min-w-0 h-full group focus:outline-none"
                      title={`${p.label}: ${formatMoney(p.total)}`}
                    >
                      <div className="w-full flex-1 flex items-end">
                        <div
                          className={`w-full rounded-t-md transition-all ${
                            isActive
                              ? "bg-accent-500 shadow-sm ring-2 ring-accent-400/50"
                              : "bg-accent-400/60 group-hover:bg-accent-400"
                          }`}
                          style={{ height: `${Math.max(4, (p.total / peak) * 100)}%` }}
                        />
                      </div>
                      <span
                        className={`text-[0.6875rem] truncate w-full text-center transition-colors ${
                          isActive ? "font-semibold text-text" : "text-text-tertiary"
                        } ${hideLabel ? "opacity-0" : ""}`}
                      >
                        {barLabel}
                      </span>
                    </button>
                  );
                })}
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

              {/* Detailed Spend Breakdown ------------------------------------ */}
              <div className="mt-4 pt-4 border-t border-border-subtle">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="eyebrow text-text">
                    Detailed Spend · {cadence === "day" ? "Day by Day" : cadence === "week" ? "Week by Week" : "Month by Month"}
                  </h3>
                  <span className="text-xs text-text-tertiary">
                    {detailedPeriods.length} {detailedPeriods.length === 1 ? "period" : "periods"}
                  </span>
                </div>

                {detailedPeriods.length === 0 ? (
                  <p className="text-xs text-text-tertiary">No purchases recorded for this cadence.</p>
                ) : (
                  <div className="space-y-2">
                    {detailedPeriods.map((period) => {
                      const isExpanded = expandedPeriod === period.key;
                      const isSelected = activePeriod?.key === period.key;
                      return (
                        <div
                          key={period.key}
                          className={`rounded-xl border overflow-hidden transition-all ${
                            isSelected
                              ? "border-accent-400/50 bg-surface-raised shadow-xs"
                              : "border-border-subtle bg-surface-sunken"
                          }`}
                        >
                          <button
                            onClick={() => {
                              setSelectedPeriodKey(period.key);
                              setExpandedPeriod(isExpanded ? null : period.key);
                            }}
                            className="w-full flex items-center justify-between p-3 text-left hover:bg-surface-raised/50 transition-colors"
                            aria-expanded={isExpanded}
                          >
                            <div className="min-w-0 flex-1 pr-2">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-text block truncate">
                                  {period.label}
                                </span>
                                {isSelected && (
                                  <span className="px-1.5 py-0.5 rounded text-[0.6875rem] font-medium bg-accent-400/20 text-accent-text shrink-0">
                                    Selected
                                  </span>
                                )}
                              </div>
                              <span className="text-xs text-text-tertiary">
                                {period.purchases.length} {period.purchases.length === 1 ? "item" : "items"} bought
                              </span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="numeral text-sm font-semibold text-text">
                                {formatMoney(period.total)}
                              </span>
                              <Icon
                                name="chevron"
                                className={`w-3.5 h-3.5 text-text-tertiary transition-transform ${
                                  isExpanded ? "rotate-90" : ""
                                }`}
                                strokeWidth={2}
                              />
                            </div>
                          </button>

                          {isExpanded && (
                            <div className="px-3 pb-3 pt-1 border-t border-border-subtle/50 bg-surface/50">
                              <ul className="divide-y divide-border-subtle/40">
                                {period.purchases.map((p) => (
                                  <li key={p.id} className="py-2 flex items-center justify-between text-xs">
                                    <div className="min-w-0 flex-1 pr-2">
                                      <span className="font-medium text-text block truncate">{p.itemName}</span>
                                      <span className="text-text-tertiary">
                                        {p.qty} {p.unit}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      <span className="numeral font-medium text-text">
                                        {p.priceTotal !== null ? formatMoney(p.priceTotal) : "Unpriced"}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => handleDeletePurchase(p)}
                                        title={`Delete ${p.itemName}`}
                                        className="p-1 -mr-1 text-text-tertiary hover:text-danger rounded transition-colors"
                                      >
                                        <Icon name="close" className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </li>
                                ))}
                              </ul>

                              {cadence === "day" && (
                                <div className="pt-2 mt-1 border-t border-border-subtle/50 flex justify-end">
                                  <button
                                    onClick={() => handleOpenLogSpend(period.key)}
                                    className="text-xs text-accent-text font-medium hover:underline flex items-center gap-1 py-1"
                                  >
                                    <Icon name="plus" className="w-3.5 h-3.5" strokeWidth={2.25} />
                                    <span>Log spend on this day</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
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

      <LogSpendSheet
        open={logSpendOpen}
        onClose={() => setLogSpendOpen(false)}
        onSaved={load}
        items={items ?? []}
        defaultDate={logSpendDate}
        existingPurchases={purchases}
      />
    </div>
  );
}
