import { useState, useCallback } from "react";
import type { Member } from "@shared/types";
import * as api from "../api";
import { useToast } from "../components/Toast";

export function SettingsScreen({
  currentMemberId,
  members,
  householdName,
  onRefresh,
}: {
  currentMemberId: string | null;
  members: Member[];
  householdName: string;
  onRefresh: () => void;
}) {
  const [theme, setTheme] = useState<"system" | "light" | "dark">(() => {
    if (document.documentElement.classList.contains("dark")) return "dark";
    if (document.documentElement.classList.contains("light")) return "light";
    return "system";
  });
  const { toast } = useToast();

  const currentMember = members.find((m) => m.id === currentMemberId);

  const handleThemeChange = useCallback((t: "system" | "light" | "dark") => {
    setTheme(t);
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    if (t !== "system") root.classList.add(t);
    // Persist to localStorage for instant load
    localStorage.setItem("pantry-theme", t);
  }, []);

  const handleSwitchProfile = useCallback(
    async (memberId: string) => {
      try {
        await api.pickProfile(memberId);
        toast("Profile switched");
        onRefresh();
      } catch {
        toast("Failed to switch", "error");
      }
    },
    [toast, onRefresh],
  );

  const handleLogout = useCallback(async () => {
    await api.logout();
    onRefresh();
  }, [onRefresh]);

  return (
    <div className="safe-top">
      <header className="px-5 pt-6 pb-4">
        <h1 className="text-2xl font-bold text-text">Settings</h1>
        <p className="text-sm text-text-secondary mt-0.5">{householdName}</p>
      </header>

      <div className="px-4 space-y-4 pb-8">
        {/* Current profile */}
        <section className="bg-surface-raised border border-border-subtle rounded-2xl p-4">
          <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-3">
            Profile
          </h3>
          <div className="flex items-center gap-3 mb-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold"
              style={{ backgroundColor: currentMember?.accentColor ?? "#6366f1" }}
            >
              {currentMember?.name.charAt(0).toUpperCase() ?? "?"}
            </div>
            <div>
              <p className="font-medium text-text">{currentMember?.name ?? "Unknown"}</p>
              <p className="text-xs text-text-tertiary">Current profile</p>
            </div>
          </div>

          {members.length > 1 && (
            <div className="space-y-1.5 pt-2 border-t border-border-subtle">
              <p className="text-xs text-text-tertiary mb-1">Switch to:</p>
              {members
                .filter((m) => m.id !== currentMemberId)
                .map((m) => (
                  <button
                    key={m.id}
                    onClick={() => handleSwitchProfile(m.id)}
                    className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-surface-sunken transition-colors"
                  >
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white font-semibold text-sm"
                      style={{ backgroundColor: m.accentColor }}
                    >
                      {m.name.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-sm text-text">{m.name}</span>
                  </button>
                ))}
            </div>
          )}
        </section>

        {/* Theme */}
        <section className="bg-surface-raised border border-border-subtle rounded-2xl p-4">
          <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-3">
            Appearance
          </h3>
          <div className="flex gap-2">
            {(["system", "light", "dark"] as const).map((t) => (
              <button
                key={t}
                onClick={() => handleThemeChange(t)}
                className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all ${
                  theme === t
                    ? "gradient-accent text-text-on-accent shadow-sm"
                    : "bg-surface-sunken text-text-secondary hover:text-text"
                }`}
              >
                {t === "system" ? "Auto" : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </section>

        {/* Coming soon */}
        <section className="bg-surface-raised border border-border-subtle rounded-2xl p-4">
          <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">
            More Settings
          </h3>
          <p className="text-sm text-text-tertiary">
            Notification rules, category & aisle order, and appearance customisation — coming soon.
          </p>
        </section>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="w-full py-3 rounded-2xl border border-danger/30 text-danger text-sm font-semibold hover:bg-danger-bg transition-colors"
        >
          Log Out
        </button>

        <p className="text-center text-xs text-text-tertiary pt-2">
          Pantry v0.1.0 — built by Antigravity
        </p>
      </div>
    </div>
  );
}
