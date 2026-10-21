import { useCallback } from "react";
import { Icon, type IconName } from "./Icon";

interface TabDef {
  id: string;
  label: string;
  icon: IconName;
}

// A plain tab bar, the way iOS draws one: every tab is a place, named after the
// screen it opens. The raised "+" this replaced looked like an add action but
// opened the shopping list, so the one tab that most needed a clear name had
// the least clear one.
const TABS: TabDef[] = [
  { id: "today", label: "Today", icon: "sun" },
  { id: "inventory", label: "Inventory", icon: "box" },
  { id: "list", label: "List", icon: "basket" },
  { id: "stats", label: "Stats", icon: "chart" },
  { id: "utilities", label: "Bills", icon: "zap" },
];

/** History is reached from Stats, so Stats stays lit while it is open. */
const activeTab = (page: string) => (page === "history" ? "stats" : page);

export function BottomNav({
  current,
  onNavigate,
}: {
  current: string;
  onNavigate: (page: string) => void;
}) {
  const handleClick = useCallback((id: string) => () => onNavigate(id), [onNavigate]);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 glass border-t border-border-subtle safe-bottom">
      <div className="flex items-stretch justify-around max-w-lg mx-auto h-[3.25rem]">
        {TABS.map((tab) => {
          const active = activeTab(current) === tab.id;
          return (
            <button
              key={tab.id}
              onClick={handleClick(tab.id)}
              aria-current={active ? "page" : undefined}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
                active ? "text-accent-text" : "text-text-tertiary"
              }`}
            >
              <Icon name={tab.icon} className="w-6 h-6" strokeWidth={active ? 2.2 : 1.7} />
              <span className="text-[0.6875rem] font-medium">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
