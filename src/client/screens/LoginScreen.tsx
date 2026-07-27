import { useState, useCallback } from "react";
import * as api from "../api";

export function LoginScreen({
  householdName,
  onDone,
}: {
  householdName: string;
  onDone: () => void;
}) {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!passcode) return;
      setError("");
      setLoading(true);
      try {
        await api.login(passcode);
        onDone();
      } catch (err) {
        setError(err instanceof api.ApiRequestError ? err.body.message : "Something went wrong.");
        setPasscode("");
      } finally {
        setLoading(false);
      }
    },
    [passcode, onDone],
  );

  return (
    <div className="min-h-dvh flex items-center justify-center p-6 bg-surface">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl gradient-accent mb-4">
            <span className="text-3xl">🔒</span>
          </div>
          <h1 className="text-2xl font-bold text-text">{householdName}</h1>
          <p className="text-sm text-text-secondary mt-1">
            Enter the household passcode
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            autoFocus
            autoComplete="current-password"
            className="w-full px-3.5 py-3 rounded-xl bg-surface-sunken border border-border text-text text-center text-lg tracking-widest outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20 transition-all"
            placeholder="••••"
          />

          {error && (
            <p className="text-sm text-danger bg-danger-bg rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !passcode}
            className="w-full py-3 rounded-xl gradient-accent text-text-on-accent font-semibold text-sm shadow-md hover:shadow-lg active:scale-[0.98] transition-all disabled:opacity-50"
          >
            {loading ? "Unlocking…" : "Unlock"}
          </button>
        </form>
      </div>
    </div>
  );
}
