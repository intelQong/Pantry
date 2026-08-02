import { useCallback } from "react";
import { Icon, type IconName } from "./Icon";

const TABS: Array<{ id: string; label: string; icon: IconName }> = [
  { id: "today", label: "Today", icon: "sun" },
  { id: "list", label: "List", icon: "basket" },
  { id: "pantry", label: "Pantry", icon: "box" },
  { id: "utilities", label: "Bills", icon: "zap" },
  { id: "insights", label: "Stats", icon: "chart" },
  { id: "settings", label: "Settings", icon: "sliders" },
];

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
      <div className="flex items-stretch justify-around max-w-lg mx-auto h-[4.25rem]">
        {TABS.map((tab) => {
          const active = current === tab.id;
          return (
            <button
              key={tab.id}
              onClick={handleClick(tab.id)}
              aria-current={active ? "page" : undefined}
              className={`relative flex-1 flex flex-col items-center justify-center gap-1
                transition-colors ${
                  active ? "text-accent-text" : "text-text-tertiary hover:text-text-secondary"
                }`}
            >
              {/* The active marker is a short rule at the top edge rather than a
                  filled pill: it marks position without competing with content. */}
              <span
                className={`absolute top-0 h-0.5 w-7 rounded-full bg-accent-500 transition-opacity ${
                  active ? "opacity-100" : "opacity-0"
                }`}
              />
              <Icon name={tab.icon} className="w-[1.35rem] h-[1.35rem]" strokeWidth={active ? 2 : 1.6} />
              <span className={`text-[0.6875rem] ${active ? "font-semibold" : "font-medium"}`}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
