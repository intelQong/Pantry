import { useState, useCallback } from "react";
import type { Member } from "@shared/types";
import * as api from "../api";

export function ProfilePickScreen({
  members,
  onDone,
}: {
  members: Member[];
  onDone: () => void;
}) {
  const [loading, setLoading] = useState<string | null>(null);

  const pick = useCallback(
    async (memberId: string) => {
      setLoading(memberId);
      try {
        await api.pickProfile(memberId);
        onDone();
      } catch {
        // Unlikely — the member was just fetched. Re-fetch will fix stale state.
        onDone();
      }
    },
    [onDone],
  );

  return (
    <div className="min-h-dvh flex items-center justify-center p-6 bg-surface">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl gradient-accent mb-4">
            <span className="text-3xl">👋</span>
          </div>
          <h1 className="text-2xl font-bold text-text">Who's this?</h1>
          <p className="text-sm text-text-secondary mt-1">
            Pick your profile so we know who's shopping
          </p>
        </div>

        <div className="space-y-3">
          {members.map((m) => (
            <button
              key={m.id}
              onClick={() => pick(m.id)}
              disabled={loading !== null}
              className="w-full flex items-center gap-4 p-4 rounded-2xl bg-surface-raised border border-border hover:border-accent-400 hover:shadow-md active:scale-[0.98] transition-all disabled:opacity-50"
            >
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg shrink-0"
                style={{ backgroundColor: m.accentColor }}
              >
                {m.name.charAt(0).toUpperCase()}
              </div>
              <span className="text-base font-semibold text-text">{m.name}</span>
              {loading === m.id && (
                <div className="ml-auto w-5 h-5 rounded-full border-2 border-accent-300 border-t-accent-600" style={{ animation: "spin 0.7s linear infinite" }} />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
