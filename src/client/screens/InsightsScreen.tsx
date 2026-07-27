import { useState, useEffect } from "react";
import * as api from "../api";
import { EmptyState } from "../components/EmptyState";

export function InsightsScreen() {
  const [stats, setStats] = useState<{
    totalItems: number;
    totalStaples: number;
    overdueCount: number;
  } | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const items = await api.getItems();
        setStats({
          totalItems: items.length,
          totalStaples: items.filter((i) => i.isStaple).length,
          overdueCount: items.filter((i) => i.status === "overdue" || i.status === "due").length,
        });
      } catch {
        // Non-critical
      }
    };
    load();
  }, []);

  return (
    <div className="safe-top">
      <header className="px-5 pt-6 pb-4">
        <h1 className="text-2xl font-bold text-text">Insights</h1>
      </header>

      {stats && (
        <div className="px-4 grid grid-cols-3 gap-3 mb-6">
          <div className="bg-surface-raised border border-border-subtle rounded-2xl p-4 text-center">
            <div className="text-2xl font-bold text-accent-600">{stats.totalItems}</div>
            <div className="text-xs text-text-secondary mt-1">Items</div>
          </div>
          <div className="bg-surface-raised border border-border-subtle rounded-2xl p-4 text-center">
            <div className="text-2xl font-bold text-accent-600">{stats.totalStaples}</div>
            <div className="text-xs text-text-secondary mt-1">Staples</div>
          </div>
          <div className="bg-surface-raised border border-border-subtle rounded-2xl p-4 text-center">
            <div className="text-2xl font-bold text-status-overdue">{stats.overdueCount}</div>
            <div className="text-xs text-text-secondary mt-1">Need Buy</div>
          </div>
        </div>
      )}

      <EmptyState
        icon="arrowUp"
        title="Full insights coming soon"
        subtitle="Consumption rhythms, monthly spend, spend by category, and price trends — all from your purchase history."
      />
    </div>
  );
}
