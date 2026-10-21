import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

interface ConfirmRequest {
  title: string;
  message?: string;
  /** Label for the destructive button, e.g. "Delete Purchase". */
  action: string;
}

type Confirm = (request: ConfirmRequest) => Promise<boolean>;

const ConfirmContext = createContext<Confirm>(async () => false);

/**
 * An iOS-style action sheet in place of window.confirm.
 *
 * The native dialog on an iPhone home-screen app is a grey system box headed by
 * the site's address -- it reads as an error, not as the app asking. This is
 * the shape iOS itself uses for a destructive choice: what will happen, one
 * red button that names it, and a separate Cancel that is always the easy tap.
 */
export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback<Confirm>((next) => {
    resolver.current?.(false);
    setRequest(next);
    return new Promise((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const answer = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setRequest(null);
  }, []);

  useEffect(() => {
    if (!request) return;
    // Capture phase, so Escape cancels only this and not the sheet beneath it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      answer(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [request, answer]);

  return (
    <ConfirmContext value={confirm}>
      {children}
      {request && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center animate-fade-in"
          style={{ backgroundColor: "oklch(0 0 0 / 0.4)" }}
          onClick={(e) => e.target === e.currentTarget && answer(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            className="w-full max-w-lg px-3 pb-3 safe-bottom flex flex-col gap-2 animate-slide-up"
          >
            <div className="rounded-xl bg-surface-overlay shadow-xl overflow-hidden text-center">
              <div className="px-5 py-4">
                <p id="confirm-title" className="text-sm font-semibold text-text-secondary">
                  {request.title}
                </p>
                {request.message && <p className="text-sm text-text-tertiary mt-1">{request.message}</p>}
              </div>
              <button
                onClick={() => answer(true)}
                className="w-full py-3.5 border-t border-border-subtle text-lg font-medium text-danger active:bg-surface-sunken"
              >
                {request.action}
              </button>
            </div>
            <button
              autoFocus
              onClick={() => answer(false)}
              className="w-full py-3.5 rounded-xl bg-surface-overlay shadow-xl text-lg font-semibold text-accent-text active:bg-surface-sunken"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </ConfirmContext>
  );
}
