import { useState, useCallback } from "react";
import * as api from "../api";
import { BrandMark } from "../components/BrandMark";
import { Icon } from "../components/Icon";

export function SetupScreen({ onDone }: { onDone: () => void }) {
  const [householdName, setHouseholdName] = useState("Home");
  const [passcode, setPasscode] = useState("");
  const [passcodeConfirm, setPasscodeConfirm] = useState("");
  const [member1, setMember1] = useState("");
  const [member2, setMember2] = useState("");
  const [adminPasscode, setAdminPasscode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError("");

      if (passcode.length < 4) {
        setError("Passcode must be at least 4 characters.");
        return;
      }
      if (passcode !== passcodeConfirm) {
        setError("Passcodes don't match.");
        return;
      }
      const names = [member1.trim(), member2.trim()].filter(Boolean);
      if (names.length < 1) {
        setError("Add at least one person.");
        return;
      }
      if (adminPasscode && adminPasscode.length < 4) {
        setError("Owner passcode must be at least 4 characters.");
        return;
      }

      setLoading(true);
      try {
        await api.setup(householdName, passcode, names, adminPasscode || undefined);
        // Auto-login after setup
        await api.login(passcode);
        onDone();
      } catch (err) {
        setError(err instanceof api.ApiRequestError ? err.body.message : "Something went wrong.");
      } finally {
        setLoading(false);
      }
    },
    [householdName, passcode, passcodeConfirm, member1, member2, adminPasscode, onDone],
  );

  return (
    <div className="min-h-dvh flex items-center justify-center p-6 bg-surface">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="flex flex-col items-center text-center mb-8">
          <BrandMark className="w-12 h-12 text-accent-500 mb-5" />
          <h1 className="font-display text-[2rem] leading-none font-semibold text-text">Pantry</h1>
          <p className="text-sm text-text-secondary mt-2.5">
            Set up your household
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Household Name
            </label>
            <input
              type="text"
              value={householdName}
              onChange={(e) => setHouseholdName(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-surface-sunken border border-border text-text text-sm outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-400/20 transition-all"
              placeholder="e.g. Home"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Passcode
            </label>
            <input
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-surface-sunken border border-border text-text text-sm outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-400/20 transition-all"
              placeholder="At least 4 characters"
              autoComplete="new-password"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Confirm Passcode
            </label>
            <input
              type="password"
              value={passcodeConfirm}
              onChange={(e) => setPasscodeConfirm(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-surface-sunken border border-border text-text text-sm outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-400/20 transition-all"
              placeholder="Type it again"
              autoComplete="new-password"
            />
          </div>

          <div className="pt-2">
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Who lives here?
            </label>
            <div className="space-y-2">
              <input
                type="text"
                value={member1}
                onChange={(e) => setMember1(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-surface-sunken border border-border text-text text-sm outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-400/20 transition-all"
                placeholder="Person 1"
              />
              <input
                type="text"
                value={member2}
                onChange={(e) => setMember2(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-surface-sunken border border-border text-text text-sm outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-400/20 transition-all"
                placeholder="Person 2 (optional)"
              />
            </div>
          </div>

          <div className="pt-2">
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Owner passcode <span className="text-text-tertiary font-normal">· optional</span>
            </label>
            <input
              type="password"
              value={adminPasscode}
              onChange={(e) => setAdminPasscode(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-surface-sunken border border-border text-text text-sm outline-none focus:border-accent-400 transition-all"
              placeholder="Leave empty to skip"
              autoComplete="new-password"
            />
            <p className="flex items-start gap-1.5 text-xs text-text-tertiary mt-1.5">
              <Icon name="shield" className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span>
                Set this and only {member1.trim() || "the first person"} can switch into their own
                profile, even from a phone that already knows the household passcode.
              </span>
            </p>
          </div>

          {error && (
            <p className="text-sm text-danger bg-danger-bg rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-accent-500 text-text-on-accent font-semibold text-sm shadow-md hover:shadow-lg active:scale-[0.98] transition-all disabled:opacity-50"
          >
            {loading ? "Setting up…" : "Get Started"}
          </button>
        </form>
      </div>
    </div>
  );
}
