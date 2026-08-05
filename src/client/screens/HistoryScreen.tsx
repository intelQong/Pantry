import { useState, useEffect, useMemo } from "react";
import type { PurchaseWithItem } from "@shared/types";
import * as api from "../api";
import { Icon } from "../components/Icon";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { EmptyState } from "../components/EmptyState";
import { formatMoney } from "../lib/money";
import { isOffline } from "../lib/cache";
import { groupByDay } from "../lib/utilities";

/**
 * Every shop, in the order it happened.
 *
 * This is the one screen that reads the purchase table as a diary rather than
 * as statistics: Insights answers "how much on groceries this month", this
 * answers "what did I actually buy on Saturday, and what did it cost".
 */
export function HistoryScreen({ navigate }: { navigate: (path: string) => void }) {
  const [purchases, setPurchases] = useState<PurchaseWithItem[] | null>(null);
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    api
      .getPurchases()
      .then(setPurchases)
      .catch((err) => {
        // A past shop never changes, so unlike Insights this would be honest to
        // cache. It is not cached yet only because nothing else writes it --
        // worth doing the day someone wants to check a price in the aisle.
        if (!isOffline(err)) throw err;
        setUnreachable(true);
      });
  }, []);

  const days = useMemo(() => groupByDay(purchases ?? []), [purchases]);
  const total = useMemo(
    () => days.reduce((sum, d) => sum + d.total, 0),
    [days],
  );

  if (unreachable) {
    return (
      <div className="safe-top">
        <Header count={null} total={0} navigate={navigate} />
        <EmptyState
          icon="cloud-off"
          title="History needs a connection"
          subtitle="It lives on the server so both phones see the same trips."
        />
      </div>
    );
  }

  if (!purchases) return <LoadingSpinner />;

  if (purchases.length === 0) {
    return (
      <div className="safe-top">
        <Header count={0} total={0} navigate={navigate} />
        <EmptyState
          icon="clock"
          title="No shops recorded yet"
          subtitle="Tick things off in Shop Mode and every trip shows up here, by date."
        />
      </div>
    );
  }

  return (
    <div className="safe-top pb-6">
      <Header count={purchases.length} total={total} navigate={navigate} />

      <div className="px-4 space-y-3">
        {days.map((day) => (
          <section key={day.key} className="card p-4">
            <div className="flex items-baseline justify-between gap-3 mb-2.5">
              <h2 className="text-sm font-semibold text-text">{day.label}</h2>
              <span className="text-sm font-medium text-text-secondary tabular-nums">
                {/* An unpriced trip would read as a free one, so say nothing
                    rather than a confident ৳0. */}
                {day.total > 0 ? formatMoney(day.total) : ""}
              </span>
            </div>

            <ul className="divide-y divide-border-subtle">
              {day.purchases.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2">
                  <button
                    onClick={() => navigate(`items/${p.itemId}`)}
                    className="flex-1 min-w-0 text-left text-sm text-text truncate hover:text-accent-text transition-colors"
                  >
                    {p.itemName}
                  </button>
                  <span className="text-xs text-text-tertiary shrink-0 tabular-nums">
                    {p.qty} {p.unit}
                  </span>
                  <span className="text-sm text-text shrink-0 tabular-nums w-16 text-right">
                    {p.priceTotal !== null ? (
                      formatMoney(p.priceTotal)
                    ) : (
                      <span className="text-text-tertiary">—</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function Header({
  count,
  total,
  navigate,
}: {
  count: number | null;
  total: number;
  navigate: (path: string) => void;
}) {
  return (
    <header className="px-5 pt-6 pb-4">
      <button
        onClick={() => navigate("insights")}
        className="flex items-center gap-1 -ml-1 mb-1 text-xs font-medium text-text-tertiary hover:text-text-secondary transition-colors"
      >
        <Icon name="chevron" className="w-3.5 h-3.5 rotate-180" strokeWidth={2} />
        Insights
      </button>
      <h1 className="screen-title">History</h1>
      {count !== null && count > 0 && (
        <p className="text-sm text-text-secondary mt-0.5">
          {count} {count === 1 ? "purchase" : "purchases"}
          {total > 0 && ` · ${formatMoney(total)} in total`}
        </p>
      )}
    </header>
  );
}
