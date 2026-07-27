import { useState, useEffect, useCallback, useMemo } from "react";
import type { ItemWithStatus, Category, RestockStatus } from "@shared/types";
import * as api from "../api";
import { Icon, type IconName } from "../components/Icon";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { useToast } from "../components/Toast";
import { pickSplash, greeting } from "../lib/splashes";

type UrgencyGroup = "overdue" | "due" | "due_soon";

/**
 * Urgency is carried by a coloured rule down the left edge of each row and by
 * the ordering, not by a badge on every line. With four states and a list this
 * dense, badges turn the screen into confetti and stop meaning anything.
 */
const GROUPS: Record<UrgencyGroup, { label: string; icon: IconName; tone: string; bar: string }> = {
  overdue:  { label: "Overdue",   icon: "alert", tone: "text-status-overdue",  bar: "bg-status-overdue" },
  due:      { label: "Due now",   icon: "clock", tone: "text-status-due",      bar: "bg-status-due" },
  due_soon: { label: "Coming up", icon: "spark", tone: "text-status-due-soon", bar: "bg-status-due-soon" },
};

const TALLY: Array<{ status: RestockStatus; label: string; bar: string; dot: string }> = [
  { status: "overdue",  label: "overdue", bar: "bg-status-overdue",  dot: "bg-status-overdue" },
  { status: "due",      label: "due",     bar: "bg-status-due",      dot: "bg-status-due" },
  { status: "due_soon", label: "soon",    bar: "bg-status-due-soon", dot: "bg-status-due-soon" },
  { status: "ok",       label: "stocked", bar: "bg-status-ok",       dot: "bg-status-ok" },
];

export function TodayScreen({
  categories,
  memberName,
  onNavigate,
}: {
  categories: Category[];
  memberName: string;
  onNavigate: (path: string) => void;
}) {
  const [items, setItems] = useState<ItemWithStatus[]>([]);
  const [listCount, setListCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  // Rerolled once per mount, the way Minecraft rerolls per launch.
  const splash = useMemo(() => pickSplash(), []);
  const hello = useMemo(() => greeting(), []);

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const load = useCallback(async () => {
    try {
      const [today, list] = await Promise.all([api.getToday(), api.getList()]);
      setItems(today);
      setListCount(list.length);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleAdd = useCallback(
    async (item: ItemWithStatus) => {
      setAdding((prev) => new Set(prev).add(item.id));
      try {
        await api.addToList({ itemId: item.id });
        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, onList: true } : i)));
        setListCount((n) => n + 1);
        toast(`${item.name} added to list`);
      } catch {
        toast("Couldn't add that one", "error");
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

  const counts = TALLY.map((t) => items.filter((i) => i.status === t.status).length);
  const total = items.length;
  const urgent = items.filter((i) => i.status !== "ok");

  const grouped = (["overdue", "due", "due_soon"] as UrgencyGroup[])
    .map((key) => ({ key, cfg: GROUPS[key], rows: urgent.filter((i) => i.status === key) }))
    .filter((g) => g.rows.length > 0);

  return (
    <div className="safe-top pb-6">
      {/* Greeting ------------------------------------------------------- */}
      <header className="px-5 pt-7 pb-6">
        <p className="eyebrow text-text-tertiary mb-2">
          {new Date().toLocaleDateString(undefined, {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </p>
        <h1 className="font-display text-[1.75rem] leading-tight font-bold text-text">
          {hello},{" "}
          <span className="text-accent-500">{memberName}</span>
        </h1>
        <p className="splash mt-2.5">{splash}</p>
      </header>

      <div className="px-4 space-y-3">
        {/* Pantry tally ------------------------------------------------- */}
        <section className="rounded-2xl border border-border-subtle bg-surface-raised p-4">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="eyebrow text-text-tertiary">Pantry</h2>
            <span className="font-display text-sm text-text-secondary tabular-nums">
              {total} {total === 1 ? "staple" : "staples"}
            </span>
          </div>

          {total === 0 ? (
            <p className="text-sm text-text-secondary">
              Nothing tracked yet.{" "}
              <button
                onClick={() => onNavigate("pantry")}
                className="text-accent-500 font-medium underline underline-offset-2"
              >
                Add your staples
              </button>{" "}
              and Pantry starts watching them.
            </p>
          ) : (
            <>
              {/* Proportional strip: one glance tells you how the pantry sits. */}
              <div className="flex gap-1 h-2 mb-3" role="img" aria-label={
                TALLY.map((t, i) => `${counts[i]} ${t.label}`).join(", ")
              }>
                {TALLY.map((t, i) =>
                  counts[i]! > 0 ? (
                    <div
                      key={t.status}
                      className={`${t.bar} rounded-full`}
                      style={{ flexGrow: counts[i] }}
                    />
                  ) : null,
                )}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {TALLY.map((t, i) =>
                  counts[i]! > 0 ? (
                    <span key={t.status} className="flex items-center gap-1.5 text-xs text-text-secondary">
                      <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} />
                      <span className="tabular-nums font-medium text-text">{counts[i]}</span>
                      {t.label}
                    </span>
                  ) : null,
                )}
              </div>
            </>
          )}
        </section>

        {/* Shop list ---------------------------------------------------- */}
        <button
          onClick={() => onNavigate("list")}
          className="w-full flex items-center gap-3 rounded-2xl border border-border-subtle bg-surface-raised p-4 text-left hover:border-border transition-colors active:scale-[0.99]"
        >
          <span className="shrink-0 w-9 h-9 rounded-xl bg-accent-50 text-accent-600 flex items-center justify-center">
            <Icon name="basket" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-medium text-text">
              {listCount === 0 ? "Shop list is empty" : `${listCount} on the shop list`}
            </span>
            <span className="block text-xs text-text-tertiary mt-0.5">
              {listCount === 0 ? "Add what you need before the next trip" : "Ready when you are"}
            </span>
          </span>
          <Icon name="chevron" className="w-4 h-4 shrink-0 text-text-tertiary" />
        </button>

        {/* Needs attention ---------------------------------------------- */}
        {grouped.length === 0 ? (
          total > 0 && (
            <section className="rounded-2xl border border-border-subtle bg-surface-raised px-4 py-8 text-center">
              <span className="inline-flex w-10 h-10 rounded-xl bg-status-ok-bg text-status-ok items-center justify-center mb-3">
                <Icon name="leaf" />
              </span>
              <p className="text-sm font-medium text-text">Everything's stocked</p>
              <p className="text-xs text-text-tertiary mt-1">
                Nothing's due. Pantry will nudge you when that changes.
              </p>
            </section>
          )
        ) : (
          <section className="pt-2">
            <h2 className="eyebrow text-text-tertiary px-1 mb-2">
              Needs attention · {urgent.length}
            </h2>

            <div className="space-y-4">
              {grouped.map(({ key, cfg, rows }) => (
                <div key={key}>
                  <h3 className={`flex items-center gap-1.5 text-xs font-semibold ${cfg.tone} px-1 mb-1.5`}>
                    <Icon name={cfg.icon} className="w-3.5 h-3.5" strokeWidth={2} />
                    {cfg.label}
                  </h3>

                  <ul className="space-y-1.5">
                    {rows.map((item) => {
                      const cat = item.categoryId ? catMap.get(item.categoryId) : null;
                      return (
                        <li
                          key={item.id}
                          className="relative flex items-center gap-3 rounded-xl border border-border-subtle bg-surface-raised py-2.5 pl-4 pr-2.5 overflow-hidden"
                        >
                          {/* The rule is the status. No badge needed. */}
                          <span className={`absolute left-0 inset-y-0 w-1 ${cfg.bar}`} />

                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-text truncate">{item.name}</p>
                            <p className="text-xs text-text-tertiary mt-0.5 flex items-center gap-1.5">
                              {cat && (
                                <>
                                  <span style={{ color: cat.color }}>{cat.name}</span>
                                  <span aria-hidden="true">·</span>
                                </>
                              )}
                              <span className="tabular-nums">
                                {item.daysSince === null
                                  ? "never bought"
                                  : `${item.daysSince}d since last buy`}
                              </span>
                            </p>
                          </div>

                          {item.onList ? (
                            <span
                              className="shrink-0 w-9 h-9 rounded-lg bg-status-ok-bg text-status-ok flex items-center justify-center"
                              title="On the shop list"
                            >
                              <Icon name="check" className="w-4 h-4" strokeWidth={2.25} />
                            </span>
                          ) : (
                            <button
                              onClick={() => handleAdd(item)}
                              disabled={adding.has(item.id)}
                              aria-label={`Add ${item.name} to shop list`}
                              className="shrink-0 w-9 h-9 rounded-lg bg-surface-sunken text-text-secondary flex items-center justify-center hover:bg-accent-50 hover:text-accent-600 active:scale-90 transition-all disabled:opacity-40"
                            >
                              <Icon name="plus" className="w-4 h-4" strokeWidth={2.25} />
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
