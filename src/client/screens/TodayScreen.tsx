import { useState, useEffect, useCallback, useMemo } from "react";
import type { ItemWithStatus, Category } from "@shared/types";
import * as api from "../api";
import { Icon, type IconName } from "../components/Icon";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { LoadFailed } from "../components/LoadFailed";
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
  const [dueUtilities, setDueUtilities] = useState<ItemWithStatus[]>([]);
  const [listCount, setListCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [stale, setStale] = useState(false);
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  const { queueAdd } = useOutbox();

  // Rerolled once per mount, the way Minecraft rerolls per launch.
  const splash = useMemo(() => pickSplash(), []);
  const hello = useMemo(() => greeting(), []);

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const [today, list, allItems] = await Promise.all([
        api.getToday(),
        api.getList(),
        api.getItems().catch(() => []),
      ]);
      writeSnapshot("today", today);
      writeSnapshot("list", list);
      setItems(today);
      setDueUtilities(allItems.filter((i) => i.isUtility && i.status !== "ok"));
      setListCount(list.length);
      setStale(false);
    } catch (err) {
      // This is the landing screen, so with no connection it is the first thing
      // seen. An empty one reads as "the app is broken" rather than "the phone
      // has no signal", which is why it shows the last known pantry instead --
      // labelled, so nothing here is mistaken for live.
      // A failure that is not the network is the server erroring. Falling back
      // to the cache there would show a stale list as though it were live, and
      // rethrowing (as this used to) escapes the effect as an unhandled
      // rejection and leaves the screen claiming the pantry is empty.
      if (!isOffline(err)) {
        setFailed(true);
        return;
      }
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
  if (failed) return <LoadFailed offline={false} onRetry={load} />;

  const total = items.length;
  const urgent = items.filter((i) => i.status !== "ok");

  const grouped = (["overdue", "due", "due_soon"] as UrgencyGroup[])
    .map((key) => ({ key, cfg: GROUPS[key], rows: urgent.filter((i) => i.status === key) }))
    .filter((g) => g.rows.length > 0);

  return (
    <div className="pb-6">
      {/* Greeting ------------------------------------------------------- */}
      <header className="px-5 pt-7 pb-6">
        <div className="flex items-start justify-between">
          <div>
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
          </div>
          <button
            onClick={() => onNavigate("settings")}
            aria-label="Settings"
            className="w-10 h-10 rounded-full bg-surface-raised border border-border-subtle flex items-center justify-center text-text-secondary hover:text-text hover:border-border active:scale-95 transition-all shadow-sm shrink-0 mt-1"
          >
            <Icon name="sliders" className="w-5 h-5" strokeWidth={1.75} />
          </button>
        </div>
        <p className="splash mt-2.5">{splash}</p>
      </header>

      <div className="px-4 space-y-3">
        {/* Pantry / Inventory tally ------------------------------------ */}
        <section className="card p-4">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="eyebrow">Inventory</h2>
            {/* Due dates move with the clock, so a cached inventory goes wrong
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
                onClick={() => onNavigate("inventory")}
                className="text-accent-text font-medium underline underline-offset-2"
              >
                Add your staples
              </button>{" "}
              and Pantry starts watching them.
            </p>
          ) : (
            /* One glance tells you how the inventory sits. Shared with Inventory. */
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

        {/* Bills Due ---------------------------------------------------- */}
        {dueUtilities.length > 0 && (
          <section className="card p-4 border border-status-due-soon/30 bg-surface-raised">
            <div className="flex items-center justify-between mb-3">
              <h2 className="flex items-center gap-1.5 text-xs font-semibold text-status-due">
                <Icon name="zap" className="w-4 h-4 text-accent-500" strokeWidth={2} />
                Bills Due · {dueUtilities.length}
              </h2>
              <button
                onClick={() => onNavigate("utilities")}
                className="text-xs font-medium text-accent-text hover:underline"
              >
                View Bills →
              </button>
            </div>
            <div className="space-y-2">
              {dueUtilities.map((util) => (
                <div
                  key={util.id}
                  className="flex items-center justify-between py-2 px-3 rounded-xl bg-surface-sunken border border-border-subtle"
                >
                  <div className="min-w-0 flex-1 pr-2">
                    <p className="text-sm font-medium text-text truncate">{util.name}</p>
                    <p className="text-xs text-text-tertiary">
                      {util.daysUntilDue === null
                        ? "Payment due"
                        : util.daysUntilDue < 0
                          ? `Overdue by ${Math.abs(util.daysUntilDue)}d`
                          : util.daysUntilDue === 0
                            ? "Due today"
                            : `Due in ${util.daysUntilDue}d`}
                    </p>
                  </div>
                  <button
                    onClick={() => onNavigate("utilities")}
                    className="shrink-0 px-3 py-1.5 rounded-lg bg-accent-500 text-text-on-accent text-xs font-semibold hover:bg-accent-600 active:scale-95 transition-all"
                  >
                    Log Bill
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

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

                  <ul className="grouped">
                    {rows.map((item) => {
                      const cat = item.categoryId ? catMap.get(item.categoryId) : null;
                      return (
                        <li
                          key={item.id}
                          className="flex items-center gap-3 py-2.5 pl-4 pr-3"
                        >
                          {/* A status dot, as iOS marks a row; the section
                              heading above already says it in words. */}
                          <span className={`shrink-0 w-2.5 h-2.5 rounded-full ${cfg.bar}`} aria-hidden="true" />

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
                              className="shrink-0 w-8 h-8 rounded-full bg-status-ok-bg text-status-ok flex items-center justify-center"
                              title="On the shop list"
                            >
                              <Icon name="check" className="w-4 h-4" strokeWidth={2.25} />
                            </span>
                          ) : (
                            <button
                              onClick={() => handleAdd(item)}
                              disabled={adding.has(item.id)}
                              aria-label={`Add ${item.name} to shop list`}
                              className="shrink-0 w-11 h-11 -mr-1.5 flex items-center justify-center text-accent-text active:opacity-50 transition-opacity disabled:opacity-30"
                            >
                              <span className="w-7 h-7 rounded-full bg-accent-500 text-text-on-accent flex items-center justify-center">
                                <Icon name="plus" className="w-4 h-4" strokeWidth={2.5} />
                              </span>
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
