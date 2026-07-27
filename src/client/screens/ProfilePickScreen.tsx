import { useState, useCallback, useRef, useEffect } from "react";
import type { Member } from "@shared/types";
import * as api from "../api";
import { Icon } from "../components/Icon";
import { Avatar } from "../components/Avatar";

export function ProfilePickScreen({
  members,
  onDone,
}: {
  members: Member[];
  onDone: () => void;
}) {
  const [loading, setLoading] = useState<string | null>(null);
  // The member whose second passcode we're currently asking for.
  const [challenge, setChallenge] = useState<Member | null>(null);
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const challengeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (challenge) challengeRef.current?.focus();
  }, [challenge]);

  const enter = useCallback(
    async (member: Member, adminPasscode?: string) => {
      setLoading(member.id);
      setError("");
      try {
        await api.pickProfile(member.id, adminPasscode);
        onDone();
      } catch (err) {
        if (err instanceof api.ApiRequestError) {
          setError(err.body.message);
          setPasscode("");
          challengeRef.current?.focus();
        } else {
          onDone(); // stale member list; a re-fetch will straighten it out
        }
      } finally {
        setLoading(null);
      }
    },
    [onDone],
  );

  const pick = useCallback(
    (member: Member) => {
      // Protected profiles ask for their own passcode before we even try, so
      // the common case never round-trips to collect a guaranteed 403.
      if (member.hasAdminPasscode) {
        setChallenge(member);
        setPasscode("");
        setError("");
        return;
      }
      enter(member);
    },
    [enter],
  );

  if (challenge) {
    return (
      <div className="min-h-dvh flex items-center justify-center px-6 bg-surface">
        <div className="w-full max-w-[19rem] animate-fade-in">
          <div className="flex flex-col items-center text-center mb-8">
            <Avatar seed={challenge.id} color={challenge.accentColor} className="w-14 h-14 mb-4" />
            <h1 className="font-display text-2xl font-semibold text-text">{challenge.name}</h1>
            <p className="text-sm text-text-secondary mt-1.5 flex items-center gap-1.5">
              <Icon name="shield" className="w-3.5 h-3.5" />
              This profile has its own passcode
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (passcode && !loading) enter(challenge, passcode);
            }}
          >
            <input
              ref={challengeRef}
              type="password"
              value={passcode}
              onChange={(e) => {
                setPasscode(e.target.value);
                if (error) setError("");
              }}
              placeholder="Profile passcode"
              autoComplete="off"
              aria-label={`Passcode for ${challenge.name}`}
              aria-invalid={error ? true : undefined}
              className={`w-full text-center tracking-[0.35em] text-lg px-4 py-3.5 rounded-2xl
                bg-surface-raised border text-text placeholder:tracking-normal
                placeholder:text-text-tertiary placeholder:text-base outline-none transition-colors
                ${error ? "border-danger" : "border-border focus:border-accent-400"}`}
            />
            <p className="h-5 mt-2 text-center text-xs text-danger" role="alert">
              {error}
            </p>

            <button
              type="submit"
              disabled={!passcode || loading !== null}
              className="w-full mt-1 py-3.5 rounded-2xl bg-accent-500 text-text-on-accent font-semibold
                text-sm shadow-sm hover:bg-accent-600 active:scale-[0.99] transition-all
                disabled:opacity-40 disabled:pointer-events-none"
            >
              {loading ? "Checking…" : "Continue"}
            </button>
          </form>

          <button
            onClick={() => setChallenge(null)}
            className="w-full mt-3 py-2.5 text-sm text-text-secondary hover:text-text transition-colors"
          >
            Choose someone else
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex items-center justify-center px-6 bg-surface">
      <div className="w-full max-w-[19rem] animate-fade-in">
        <div className="text-center mb-8">
          <h1 className="font-display text-[1.75rem] font-semibold text-text">Who's shopping?</h1>
          <p className="text-sm text-text-secondary mt-1.5">
            So the list knows who added what
          </p>
        </div>

        <div className="space-y-2.5">
          {members.map((m) => (
            <button
              key={m.id}
              onClick={() => pick(m)}
              disabled={loading !== null}
              className="w-full flex items-center gap-3.5 p-3.5 rounded-2xl bg-surface-raised
                border border-border hover:border-accent-400 active:scale-[0.99]
                transition-all disabled:opacity-50"
            >
              <Avatar seed={m.id} color={m.accentColor} />
              <span className="flex-1 text-left">
                <span className="block text-[0.95rem] font-medium text-text">{m.name}</span>
                {m.hasAdminPasscode && (
                  <span className="flex items-center gap-1 text-xs text-text-tertiary mt-0.5">
                    <Icon name="lock" className="w-3 h-3" />
                    Passcode required
                  </span>
                )}
              </span>
              {loading === m.id ? (
                <span
                  className="w-4 h-4 rounded-full border-2 border-accent-200 border-t-accent-600"
                  style={{ animation: "spin 0.7s linear infinite" }}
                />
              ) : (
                <Icon name="chevron" className="w-4 h-4 text-text-tertiary" />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
