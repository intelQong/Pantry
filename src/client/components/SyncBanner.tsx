/**
 * Says whether the app is holding anything back, and offers to send it.
 *
 * Deliberately silent when there is nothing to say: online with an empty queue
 * shows nothing at all. A permanent connection indicator would be noise on the
 * 99% of trips that have signal, and would train people to stop reading it.
 */

import { Icon } from "./Icon";
import { useOutbox } from "./Outbox";

export function SyncBanner() {
  const { online, pending, syncing, sync } = useOutbox();

  if (online && pending === 0) return null;

  const label = !online
    ? pending > 0
      ? `Offline · ${pending} waiting`
      : "Offline · your list is saved"
    : syncing
      ? "Syncing…"
      : `${pending} waiting to sync`;

  return (
    <div className="sync-banner sticky top-0 z-40 safe-top">
      <div
        className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold tracking-wide ${
          online ? "bg-accent-500 text-text-on-accent" : "bg-text text-surface"
        }`}
      >
        <Icon
          name={online ? "refresh" : "cloud-off"}
          className={`w-3.5 h-3.5 shrink-0 ${syncing ? "animate-spin-slow" : ""}`}
          strokeWidth={2}
        />
        <span className="flex-1">{label}</span>

        {online && pending > 0 && !syncing && (
          <button
            onClick={() => sync()}
            className="shrink-0 underline underline-offset-2 font-bold"
          >
            Sync now
          </button>
        )}
      </div>
    </div>
  );
}
