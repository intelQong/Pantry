// Tells the rest of the household when someone adds to the shop list or buys
// from it.
//
// One shopping trip can tick off fifteen things, and fifteen buzzes would get
// these switched off within a week. So each push *replaces* the last one from
// the same person (a shared notification tag) and describes everything they
// did in the last half hour -- "Sam bought Milk, Eggs and 3 more" -- and only
// the first in that window makes a sound.

import type { Env } from "./env";
import { sendToMember, type PushPayload } from "./push";
import { isQuietHour, localParts } from "./restock";

export type ActivityKind = "added" | "bought";

/** How far back one running notification reaches. */
const WINDOW_SECONDS = 30 * 60;

/** "Milk", "Milk and Eggs", "Milk, Eggs and Rice", "Milk, Eggs and 3 more". */
export function summariseNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length <= 3) return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

export function describeActivity(actor: string, kind: ActivityKind, names: string[]): PushPayload {
  const what = summariseNames(names);
  return {
    title: kind === "added" ? "Shopping list" : "Bought",
    body: kind === "added" ? `${actor} added ${what} to the list` : `${actor} bought ${what}`,
  };
}

/** What this person has added or bought recently, newest first, deduplicated. */
async function recentNames(
  env: Env,
  householdId: string,
  actorId: string,
  kind: ActivityKind,
  since: number,
): Promise<string[]> {
  const sql =
    kind === "added"
      ? `SELECT COALESCE(i.name, le.custom_name) AS name
           FROM list_entry le LEFT JOIN item i ON i.id = le.item_id
          WHERE le.household_id = ? AND le.added_by = ? AND le.added_at >= ?
          ORDER BY le.added_at DESC, le.rowid DESC`
      : // Bills are paid, not bought, and are not announced; keep them out of
        // the running summary too.
        `SELECT i.name AS name
           FROM purchase p JOIN item i ON i.id = p.item_id
           LEFT JOIN category c ON c.id = i.category_id
          WHERE p.household_id = ? AND p.bought_by = ? AND p.purchased_at >= ?
            AND COALESCE(c.name, '') != 'Utilities'
          ORDER BY p.purchased_at DESC, p.rowid DESC`;
  const rows = await env.DB.prepare(sql).bind(householdId, actorId, since).all<{ name: string }>();
  return rows.results.map((r) => r.name);
}

/**
 * Pushes `kind` to every other member of the household.
 *
 * `latest` is the name this call is about. It is put first explicitly rather
 * than trusted to the recent-activity query, which can miss it: a backdated
 * offline buy, or an add merged into a row someone else created.
 *
 * Never throws. It runs after the response has gone, and a failed push must
 * not surface as a failed add or buy -- or stop the other members' pushes.
 */
export async function notifyListActivity(
  env: Env,
  householdId: string,
  actorId: string,
  kind: ActivityKind,
  latest: string,
  now: number,
): Promise<void> {
  try {
    const [actor, recipients, recent] = await Promise.all([
      env.DB.prepare("SELECT name FROM member WHERE id = ? AND household_id = ?")
        .bind(actorId, householdId)
        .first<{ name: string }>(),
      env.DB.prepare(
        `SELECT m.id, s.timezone, s.quiet_start, s.quiet_end
           FROM member m JOIN member_settings s ON s.member_id = m.id
          WHERE m.household_id = ? AND m.id != ?`,
      )
        .bind(householdId, actorId)
        .all<{ id: string; timezone: string; quiet_start: number; quiet_end: number }>(),
      recentNames(env, householdId, actorId, kind, now - WINDOW_SECONDS),
    ]);

    const names = [...new Set([latest, ...recent])];
    const payload: PushPayload = {
      ...describeActivity(actor?.name ?? "Someone", kind, names),
      tag: `list-${kind}-${actorId}`,
      renotify: names.length === 1,
      url: "/#/list",
    };

    for (const member of recipients.results) {
      // Quiet hours drop the push rather than delaying it: by morning the list
      // itself says what changed, and a backlog of stale pushes says nothing.
      const { hour } = localParts(now, member.timezone);
      if (isQuietHour(hour, member.quiet_start, member.quiet_end)) continue;
      try {
        await sendToMember(env, member.id, payload);
      } catch (err) {
        console.error("List activity push failed for member", member.id, err);
      }
    }
  } catch (err) {
    console.error("List activity push failed", err);
  }
}
