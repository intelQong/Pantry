import { useState, useCallback, useRef, useEffect } from "react";
import * as api from "../api";
import { BrandMark } from "../components/BrandMark";

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
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!passcode || loading) return;

      setError("");
      setLoading(true);
      try {
        await api.login(passcode);
        onDone();
      } catch (err) {
        setError(err instanceof api.ApiRequestError ? err.body.message : "Something went wrong.");
        setPasscode("");
        inputRef.current?.focus();
      } finally {
        setLoading(false);
      }
    },
    [passcode, loading, onDone],
  );

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6 bg-surface">
      <div className="w-full max-w-[19rem] animate-fade-in">
        <div className="flex flex-col items-center text-center mb-9">
          <BrandMark className="w-12 h-12 text-accent-text mb-5" />
          <h1 className="font-display text-[2rem] leading-none font-semibold text-text">Pantry</h1>
          <p className="text-sm text-text-secondary mt-2.5">{householdName}</p>
        </div>

        <form onSubmit={handleSubmit}>
          <label htmlFor="passcode" className="sr-only">
            Household passcode
          </label>
          <input
            ref={inputRef}
            id="passcode"
            type="password"
            value={passcode}
            onChange={(e) => {
              setPasscode(e.target.value);
              if (error) setError("");
            }}
            placeholder="Passcode"
            autoComplete="current-password"
            aria-invalid={error ? true : undefined}
            className={`w-full text-center tracking-[0.35em] text-lg px-4 py-3.5 rounded-2xl
              bg-surface-raised border text-text placeholder:tracking-normal
              placeholder:text-text-tertiary placeholder:text-base outline-none
              transition-colors ${error ? "border-danger" : "border-border focus:border-accent-400"}`}
          />

          {/* Reserved height, so the layout doesn't jump when an error appears. */}
          <p className="h-5 mt-2 text-center text-xs text-danger" role="alert">
            {error}
          </p>

          <button
            type="submit"
            disabled={loading || !passcode}
            className="w-full mt-1 py-3.5 rounded-2xl bg-accent-500 text-text-on-accent
              font-semibold text-sm shadow-sm hover:bg-accent-600 active:scale-[0.99]
              transition-all disabled:opacity-40 disabled:pointer-events-none"
          >
            {loading ? "Checking…" : "Unlock"}
          </button>
        </form>

        <p className="text-center text-xs text-text-tertiary mt-8">
          Shared by everyone in the household
        </p>
      </div>
    </div>
  );
}
