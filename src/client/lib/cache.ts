/**
 * Last-known-good copies of what the API returned.
 *
 * Purely so the app has something to show when the network is gone. Nothing
 * here is authoritative: every screen refetches on mount and overwrites its
 * snapshot on success, and a snapshot is only ever read after a fetch has
 * actually failed.
 *
 * localStorage rather than IndexedDB because the whole payload is a two-person
 * grocery list — kilobytes, read once per screen, and never touched from the
 * service worker. It also matches how the theme is already persisted in App.tsx.
 */

const PREFIX = "pantry-cache-v1:";

export type SnapshotName = "list" | "items" | "today" | "categories" | "session";

interface Snapshot<T> {
  /** Epoch seconds, so the UI can say how stale the data is. */
  savedAt: number;
  value: T;
}

export function writeSnapshot<T>(name: SnapshotName, value: T): void {
  try {
    const snapshot: Snapshot<T> = { savedAt: Math.floor(Date.now() / 1000), value };
    localStorage.setItem(PREFIX + name, JSON.stringify(snapshot));
  } catch {
    // Storage full or blocked. Losing a snapshot costs offline reads, nothing
    // that is happening right now, so there is nothing useful to say here.
  }
}

export function readSnapshot<T>(name: SnapshotName): Snapshot<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + name);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Snapshot<T>;
    return parsed && typeof parsed.savedAt === "number" ? parsed : null;
  } catch {
    return null;
  }
}

/** Drops every snapshot. Used on logout, so the next household starts clean. */
export function clearSnapshots(): void {
  try {
    for (const name of ["list", "items", "today", "categories", "session"] as SnapshotName[]) {
      localStorage.removeItem(PREFIX + name);
    }
  } catch {
    // Nothing to do — see writeSnapshot.
  }
}

/**
 * Whether a failure means "no network" rather than "the server said no".
 *
 * `fetch` rejects with a TypeError when the request never got a response;
 * anything that came back with a status is an ApiRequestError instead. The
 * distinction decides whether the app falls back to a snapshot or treats the
 * user as logged out, so it cannot be guessed from the message text.
 */
export function isOffline(err: unknown): boolean {
  return !(err instanceof Error && err.name === "ApiRequestError");
}
