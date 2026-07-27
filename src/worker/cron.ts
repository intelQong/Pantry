// The hourly restock digest sweep. Runs once an hour for every household
// member, but a member is only ever actually notified once, in their own
// local hour, on their own configured weekdays -- everything else is a
// cheap skip.

import type { Env } from "./env";
import { computeStatus, isQuietHour, localParts, byUrgency, type RestockItemInput } from "./restock";
import { sendToMember } from "./push";

interface MemberSweepRow {
  member_id: string;
  household_id: string;
  notify_days: string;
  notify_hour: number;
  timezone: string;
  lead_days: number;
  quiet_start: number;
  quiet_end: number;
}

interface CandidateItemRow extends RestockItemInput {
  id: string;
  name: string;
}

export async function runDigestSweep(env: Env, nowSecondsValue: number): Promise<void> {
  const members = await env.DB.prepare(
    `SELECT m.id AS member_id, m.household_id, s.notify_days, s.notify_hour,
            s.timezone, s.lead_days, s.quiet_start, s.quiet_end
       FROM member m
       JOIN member_settings s ON s.member_id = m.id`,
  ).all<MemberSweepRow>();

  for (const member of members.results) {
    const { date, hour, isoWeekday } = localParts(nowSecondsValue, member.timezone);

    if (hour !== member.notify_hour) continue;

    const notifyDays = member.notify_days.split(",").map((d) => Number(d.trim()));
    if (!notifyDays.includes(isoWeekday)) continue;

    if (isQuietHour(hour, member.quiet_start, member.quiet_end)) continue;

    // One row per member per local day guards against double-sending when a
    // cron run is retried, or the Worker redeploys mid-hour.
    const alreadySent = await env.DB.prepare(
      "SELECT 1 FROM notification_log WHERE member_id = ? AND kind = 'restock_digest' AND local_date = ?",
    )
      .bind(member.member_id, date)
      .first();
    if (alreadySent) continue;

    // Non-archived staples that need attention, excluding anything already
    // sitting on the pending shop list -- nagging about something already
    // handled would just teach everyone to ignore the notification.
    const candidates = await env.DB.prepare(
      `SELECT i.id, i.name, i.last_purchased_at, i.created_at, i.restock_interval_days
         FROM item i
        WHERE i.household_id = ? AND i.is_staple = 1
          AND NOT EXISTS (
            SELECT 1 FROM list_entry le
             WHERE le.item_id = i.id AND le.household_id = i.household_id AND le.status = 'pending'
          )`,
    )
      .bind(member.household_id)
      .all<CandidateItemRow>();

    const due = candidates.results
      .map((row) => ({ name: row.name, status: computeStatus(row, member.lead_days, nowSecondsValue).status }))
      .filter((row) => row.status !== "ok")
      .sort(byUrgency);

    if (due.length === 0) continue;

    const title = due.length === 1 ? "1 item to restock" : `${due.length} items to restock`;
    const body = due
      .slice(0, 3)
      .map((row) => row.name)
      .join(", ");

    // One member's delivery blowing up must not abort the sweep for everyone
    // else -- this loop is the only thing standing between the household and
    // silently receiving no reminders at all.
    try {
      await sendToMember(env, member.member_id, { title, body });
    } catch (err) {
      console.error("Digest send failed for member", member.member_id, err);
      continue; // no log row, so the next sweep will retry
    }

    await env.DB.prepare(
      `INSERT INTO notification_log (id, member_id, kind, local_date, sent_at, item_count)
       VALUES (?,?,?,?,?,?)`,
    )
      .bind(crypto.randomUUID(), member.member_id, "restock_digest", date, nowSecondsValue, due.length)
      .run();
  }
}
