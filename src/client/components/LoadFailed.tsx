import { EmptyState } from "./EmptyState";

/**
 * What a screen shows when its data would not load.
 *
 * It exists because the alternative had been to rethrow out of an async effect,
 * which produces an unhandled rejection and leaves the screen either spinning
 * forever or — worse — showing its empty state. "No items yet. Add your first
 * pantry item" is a confident lie to tell someone whose pantry is full and
 * whose server just returned a 500.
 *
 * Offline is a different sentence from broken. One is expected in a shop and
 * resolves itself; the other is worth knowing about. Both say the data is safe,
 * because the thing people actually fear here is that their list is gone.
 */
export function LoadFailed({ offline, onRetry }: { offline: boolean; onRetry: () => void }) {
  return (
    <EmptyState
      icon={offline ? "cloud-off" : "alert"}
      title={offline ? "No connection" : "Couldn't load this"}
      subtitle={
        offline
          ? "This screen is worked out on the server, so it needs a connection. Nothing has been lost."
          : "The server didn't answer. Nothing has been lost — try again in a moment."
      }
      action={
        <button
          onClick={onRetry}
          className="px-5 py-2 rounded-xl bg-accent-500 text-text-on-accent text-sm font-semibold"
        >
          Try again
        </button>
      }
    />
  );
}
