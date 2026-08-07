import { useState, useEffect, useCallback, useMemo } from "react";
import type { ItemWithStatus, Category } from "@shared/types";
import * as api from "../api";
import { Icon, type IconName } from "../components/Icon";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { StatusStrip } from "../components/StatusStrip";
import { useToast } from "../components/Toast";
import { useOutbox } from "../components/Outbox";
import { readSnapshot, writeSnapshot, isOffline } from "../lib/cache";
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
  const [stale, setStale] = useState(false);
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  const { queueAdd } = useOutbox();

  // Rerolled once per mount, the way Minecraft rerolls per launch.
  const splash = useMemo(() => pickSplash(), []);
  const hello = useMemo(() => greeting(), []);

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const load = useCallback(async () => {
    try {
      const [today, list] = await Promise.all([api.getToday(), api.getList()]);
      writeSnapshot("today", today);
      writeSnapshot("list", list);
      setItems(today);
      setListCount(list.length);
      setStale(false);
    } catch (err) {
      // This is the landing screen, so with no connection it is the first thing
      // seen. An empty one reads as "the app is broken" rather than "the phone
      // has no signal", which is why it shows the last known pantry instead --
      // labelled, so nothing here is mistaken for live.
      if (!isOffline(err)) throw err;
      const cached = readSnapshot<ItemWithStatus[]>("today");
      if (cached) {
        setItems(cached.value);
        setListCount(readSnapshot<unknown[]>("list")?.value.length ?? 0);
        setStale(true);
      }
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
        // Queued rather than sent, same as the shop list's own add box, so
        // remembering something with no signal still works.
        queueAdd({ itemId: item.id });
        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, onList: true } : i)));
        setListCount((n) => n + 1);
        toast(`${item.name} added to list`);
      } finally {
        setAdding((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
      }
    },
    [toast, queueAdd],
  );

  if (loading) return <LoadingSpinner />;

  const total = items.length;
  const urgent = items.filter((i) => i.status !== "ok");

  const grouped = (["overdue", "due", "due_soon"] as UrgencyGroup[])
    .map((key) => ({ key, cfg: GROUPS[key], rows: urgent.filter((i) => i.status === key) }))
    .filter((g) => g.rows.length > 0);

  return (
    <div className="safe-top pb-6">
      {/* Greeting ------------------------------------------------------- */}
      <header className="px-5 pt-7 pb-6">
        <p className="eyebrow mb-2">
          {new Date().toLocaleDateString(undefined, {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </p>
        <h1 className="screen-title">
          {hello},{" "}
          <span className="text-accent-text">{memberName}</span>
        </h1>
        <p className="splash mt-2.5">{splash}</p>
      </header>

      <div className="px-4 space-y-3">
        {/* Pantry tally ------------------------------------------------- */}
        <section className="card p-4">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="eyebrow">Pantry</h2>
            {/* Due dates move with the clock, so a cached pantry goes wrong
                quietly. Better to say the numbers are old than to show them
                as though they were checked just now. */}
            <span className="numeral text-sm text-text-secondary">
              {stale ? "Last seen offline" : `${total} ${total === 1 ? "staple" : "staples"}`}
            </span>
          </div>

          {total === 0 ? (
            <p className="text-sm text-text-secondary">
              Nothing tracked yet.{" "}
              <button
                onClick={() => onNavigate("pantry")}
                className="text-accent-text font-medium underline underline-offset-2"
              >
                Add your staples
              </button>{" "}
              and Pantry starts watching them.
            </p>
          ) : (
            /* One glance tells you how the pantry sits. Shared with Pantry. */
            <StatusStrip items={items} />
          )}
        </section>

        {/* Shop list ---------------------------------------------------- */}
        <button
          onClick={() => onNavigate("list")}
          className="w-full flex items-center gap-3 card p-4 text-left hover:border-border transition-colors active:scale-[0.99]"
        >
          <span className="shrink-0 w-9 h-9 rounded-xl bg-accent-50 text-accent-text flex items-center justify-center">
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
            <section className="card px-4 py-8 text-center">
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
            <h2 className="eyebrow px-1 mb-2">
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
                          className="relative flex items-center gap-3 card-row py-2.5 pl-4 pr-2.5 overflow-hidden"
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
                              className="shrink-0 w-9 h-9 rounded-lg bg-surface-sunken text-text-secondary flex items-center justify-center hover:bg-accent-50 hover:text-accent-text active:scale-90 transition-all disabled:opacity-40"
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
