import { useState, useCallback } from "react";
import type { Member } from "@shared/types";
import * as api from "../api";
import { clearSnapshots } from "../lib/cache";
import { useToast } from "../components/Toast";
import { usePushSubscription } from "../hooks/usePushSubscription";
import { Icon } from "../components/Icon";
import { Avatar } from "../components/Avatar";
import { AuditLogSheet } from "../components/AuditLogSheet";
import { MadeBy } from "../components/MadeBy";

export function SettingsScreen({
  currentMemberId,
  members,
  householdName,
  onRefresh,
  navigate,
}: {
  currentMemberId: string | null;
  members: Member[];
  householdName: string;
  onRefresh: () => void;
  navigate?: (path: string) => void;
}) {
  const [theme, setTheme] = useState<"system" | "light" | "dark">(() => {
    if (document.documentElement.classList.contains("dark")) return "dark";
    if (document.documentElement.classList.contains("light")) return "light";
    return "system";
  });
  const [auditLogOpen, setAuditLogOpen] = useState(false);
  const { toast } = useToast();
  const { state: pushState, error: pushError, subscribe } = usePushSubscription();
  const [busy, setBusy] = useState(false);

  const currentMember = members.find((m) => m.id === currentMemberId);

  const handleEnablePush = useCallback(async () => {
    setBusy(true);
    await subscribe();
    setBusy(false);
  }, [subscribe]);

  const handleTestPush = useCallback(async () => {
    try {
      const { sent } = await api.testPush();
      toast(sent > 0 ? "Test notification sent" : "No devices registered", sent > 0 ? "success" : "error");
    } catch {
      toast("Couldn't send test", "error");
    }
  }, [toast]);

  const handleThemeChange = useCallback((t: "system" | "light" | "dark") => {
    setTheme(t);
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    if (t !== "system") root.classList.add(t);
    // Persist to localStorage for instant load
    localStorage.setItem("pantry-theme", t);
  }, []);

  // A protected profile is challenged inline rather than switched straight into.
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [challengeCode, setChallengeCode] = useState("");
  const [challengeError, setChallengeError] = useState("");

  const handleSwitchProfile = useCallback(
    async (member: Member, adminPasscode?: string) => {
      if (member.hasAdminPasscode && !adminPasscode) {
        setChallengeId(member.id);
        setChallengeCode("");
        setChallengeError("");
        return;
      }
      try {
        await api.pickProfile(member.id, adminPasscode);
        setChallengeId(null);
        toast(`Switched to ${member.name}`);
        onRefresh();
      } catch (err) {
        if (member.hasAdminPasscode) {
          setChallengeError(
            err instanceof api.ApiRequestError ? err.body.message : "Couldn't switch",
          );
          setChallengeCode("");
        } else {
          toast("Couldn't switch profile", "error");
        }
      }
    },
    [toast, onRefresh],
  );

  // Profile lock, for the member currently signed in on this device.
  const [lockOpen, setLockOpen] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [currentCode, setCurrentCode] = useState("");
  const [lockError, setLockError] = useState("");
  const [lockBusy, setLockBusy] = useState(false);
  const hasLock = currentMember?.hasAdminPasscode ?? false;

  const handleSaveLock = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setLockBusy(true);
      setLockError("");
      try {
        await api.setProfilePasscode(newCode || null, currentCode || undefined);
        toast(newCode ? "Profile locked" : "Profile lock removed");
        setLockOpen(false);
        setNewCode("");
        setCurrentCode("");
        onRefresh();
      } catch (err) {
        setLockError(err instanceof api.ApiRequestError ? err.body.message : "Couldn't save");
      } finally {
        setLockBusy(false);
      }
    },
    [newCode, currentCode, toast, onRefresh],
  );

  const handleLogout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      // Even if the request failed. The intent is to leave this device, and
      // the cached session snapshot is what App.boot restores when it cannot
      // reach the server -- leaving it behind would drop the next person
      // straight back into this household, offline, as this member.
      clearSnapshots();
      onRefresh();
    }
  }, [onRefresh]);

  return (
    <div>
      <header className="px-5 pt-6 pb-4 flex items-center justify-between">
        <div>
          <h1 className="screen-title">Settings</h1>
          <p className="text-sm text-text-secondary mt-0.5">{householdName}</p>
        </div>
        {navigate && (
          <button
            onClick={() => navigate("today")}
            className="-mr-2 px-2 text-accent-text text-[1rem] font-semibold active:opacity-50 transition-opacity"
          >
            Done
          </button>
        )}
      </header>

      <div className="px-4 space-y-4 pb-8">
        {/* Current profile */}
        <section className="card p-4">
          <h3 className="eyebrow mb-3">
            Profile
          </h3>
          <div className="flex items-center gap-3 mb-3">
            <Avatar
              seed={currentMember?.id ?? "unknown"}
              color={currentMember?.accentColor ?? "#d97757"}
              className="w-11 h-11"
            />
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
                  <div key={m.id}>
                    <button
                      onClick={() => handleSwitchProfile(m)}
                      className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-surface-sunken transition-colors"
                    >
                      <Avatar seed={m.id} color={m.accentColor} className="w-8 h-8" />
                      <span className="flex-1 text-sm text-text">{m.name}</span>
                      {m.hasAdminPasscode && (
                        <Icon name="lock" className="w-3.5 h-3.5 text-text-tertiary" />
                      )}
                    </button>

                    {challengeId === m.id && (
                      <form
                        className="px-3 pb-2 pt-1"
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (challengeCode) handleSwitchProfile(m, challengeCode);
                        }}
                      >
                        <input
                          type="password"
                          autoFocus
                          value={challengeCode}
                          onChange={(e) => {
                            setChallengeCode(e.target.value);
                            if (challengeError) setChallengeError("");
                          }}
                          placeholder={`${m.name}'s passcode`}
                          autoComplete="off"
                          aria-label={`Passcode for ${m.name}`}
                          className={`w-full px-3 py-2 rounded-xl bg-surface-sunken border text-sm
                            text-text outline-none transition-colors ${
                              challengeError ? "border-danger" : "border-border focus:border-accent-400"
                            }`}
                        />
                        {challengeError && (
                          <p className="text-xs text-danger mt-1.5" role="alert">
                            {challengeError}
                          </p>
                        )}
                      </form>
                    )}
                  </div>
                ))}
            </div>
          )}
        </section>

        {/* Profile lock. Superadmin only -- everyone else has no lock to manage,
            so the section is absent rather than shown-and-disabled. */}
        {currentMember?.isAdmin && (
        <section className="card p-4">
          <h3 className="eyebrow mb-3">Profile lock</h3>

          <p className="text-sm text-text-secondary">
            {hasLock
              ? `Switching into ${currentMember?.name ?? "this profile"} needs its own passcode, on top of the household one.`
              : "Add a second passcode so only you can switch into this profile, even from a phone that already knows the household passcode."}
          </p>

          {!lockOpen ? (
            <button
              onClick={() => setLockOpen(true)}
              className="w-full mt-3 py-2.5 rounded-xl bg-surface-sunken text-text-secondary text-sm font-medium hover:text-text transition-colors"
            >
              {hasLock ? "Change or remove passcode" : "Lock this profile"}
            </button>
          ) : (
            <form onSubmit={handleSaveLock} className="mt-3 space-y-2">
              {hasLock && (
                <input
                  type="password"
                  autoFocus
                  value={currentCode}
                  onChange={(e) => setCurrentCode(e.target.value)}
                  placeholder="Current passcode"
                  autoComplete="off"
                  aria-label="Current profile passcode"
                  className="w-full px-3 py-2 rounded-xl bg-surface-sunken border border-border text-sm text-text outline-none focus:border-accent-400"
                />
              )}
              <input
                type="password"
                autoFocus={!hasLock}
                value={newCode}
                onChange={(e) => setNewCode(e.target.value)}
                placeholder={hasLock ? "New passcode (empty to remove)" : "New passcode"}
                autoComplete="new-password"
                aria-label="New profile passcode"
                className="w-full px-3 py-2 rounded-xl bg-surface-sunken border border-border text-sm text-text outline-none focus:border-accent-400"
              />

              {lockError && (
                <p className="text-xs text-danger" role="alert">
                  {lockError}
                </p>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setLockOpen(false);
                    setLockError("");
                    setNewCode("");
                    setCurrentCode("");
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-surface-sunken text-sm font-medium text-text-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={lockBusy || (hasLock && !currentCode)}
                  className="flex-1 py-2.5 rounded-xl bg-accent-500 text-text-on-accent text-sm font-semibold disabled:opacity-40 disabled:pointer-events-none"
                >
                  {lockBusy ? "Saving…" : "Save"}
                </button>
              </div>
            </form>
          )}
        </section>
        )}

        {/* Theme */}
        <section className="card p-4">
          <h3 className="eyebrow mb-3">
            Appearance
          </h3>
          {/* An iOS segmented control: one track, the choice raised in it. */}
          <div className="flex p-0.5 rounded-[0.6rem] bg-surface-sunken" role="radiogroup" aria-label="Appearance">
            {(["system", "light", "dark"] as const).map((t) => (
              <button
                key={t}
                role="radio"
                aria-checked={theme === t}
                onClick={() => handleThemeChange(t)}
                className={`flex-1 rounded-[0.5rem] text-sm transition-all ${
                  theme === t
                    ? "bg-surface-raised text-text font-semibold shadow-sm"
                    : "text-text font-medium"
                }`}
              >
                {t === "system" ? "Auto" : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </section>

        {/* Notifications */}
        <section className="card p-4">
          <h3 className="eyebrow mb-3">
            Notifications
          </h3>

          {pushState === "ios-safari" ? (
            // On iOS, Notification.requestPermission() only works once the site
            // has been added to the Home Screen -- from a normal Safari tab it
            // fails silently. Showing a button here would look broken, so we
            // give the install steps instead.
            <div className="space-y-2">
              <p className="text-sm text-text-secondary">
                To get reminders on iPhone, add Pantry to your Home Screen first:
              </p>
              <ol className="text-sm text-text-tertiary space-y-1 list-decimal list-inside">
                <li>Tap the Share button in Safari</li>
                <li>Choose <span className="text-text-secondary font-medium">Add to Home Screen</span></li>
                <li>Open Pantry from the new icon, then come back here</li>
              </ol>
            </div>
          ) : pushState === "unsupported" ? (
            <p className="text-sm text-text-tertiary">
              This browser doesn't support push notifications.
            </p>
          ) : pushState === "denied" ? (
            <p className="text-sm text-text-tertiary">
              Notifications are blocked. Re-enable them for this site in your browser settings.
            </p>
          ) : pushState === "subscribed" ? (
            <div className="space-y-3">
              <p className="flex items-center gap-1.5 text-sm text-text-secondary">
                <Icon name="check" className="w-4 h-4 text-status-ok" strokeWidth={2.5} />
                Notifications are on for this device.
              </p>
              <button
                onClick={handleTestPush}
                className="w-full py-2.5 rounded-xl bg-surface-sunken text-text-secondary text-sm font-medium hover:text-text transition-colors"
              >
                Send a test notification
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-text-secondary">
                Get a reminder when staples are due for restocking.
              </p>
              <button
                onClick={handleEnablePush}
                disabled={busy}
                className="w-full py-2.5 rounded-xl bg-accent-500 text-text-on-accent text-sm font-semibold shadow-sm disabled:opacity-60 transition-opacity"
              >
                {busy ? "Enabling…" : "Turn on reminders"}
              </button>
              {pushError && <p className="text-sm text-danger">{pushError}</p>}
            </div>
          )}
        </section>

        {/* Activity & System Log */}
        <section className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="eyebrow">Activity & System Log</h3>
              <p className="text-xs text-text-tertiary mt-0.5">
                Undeletable audit trail of record deletions and system events.
              </p>
            </div>
            <span className="px-2 py-0.5 rounded-full text-[0.6875rem] font-bold bg-accent-500/15 text-accent-text border border-accent-400/30">
              Immutable
            </span>
          </div>
          <button
            type="button"
            onClick={() => setAuditLogOpen(true)}
            className="w-full mt-2 py-2.5 px-3 rounded-xl bg-surface-sunken hover:bg-border/60 text-sm font-medium text-text flex items-center justify-between transition-colors"
          >
            <div className="flex items-center gap-2">
              <Icon name="shield" className="w-4 h-4 text-accent-text" />
              <span>View System Log</span>
            </div>
            <Icon name="chevron" className="w-4 h-4 text-text-tertiary" />
          </button>
        </section>

        {/* Coming soon */}
        <section className="card p-4">
          <h3 className="eyebrow mb-2">
            More Settings
          </h3>
          <p className="text-sm text-text-tertiary">
            Category & aisle order, and appearance customisation — coming soon.
          </p>
        </section>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="card w-full py-3 text-danger text-[1rem] font-normal active:bg-surface-sunken transition-colors"
        >
          Log Out
        </button>

        <div className="pt-2 space-y-1">
          <MadeBy />
          <p className="text-center text-xs text-text-tertiary">Pantry v0.1.0</p>
        </div>
      </div>

      <AuditLogSheet
        open={auditLogOpen}
        onClose={() => setAuditLogOpen(false)}
        members={members}
      />
    </div>
  );
}
