// Web Push delivery.
//
// We deliberately do NOT use web-push-neo's `sendNotification`: it wraps
// `fetch` itself, which makes the failure path opaque and untestable without
// a real push service. `generateRequestDetails` builds the (encrypted,
// VAPID-signed) request and hands it back so we can issue it with our own
// `fetch` call and inspect the response ourselves -- and so tests can stub
// `globalThis.fetch` instead of talking to Apple/Google's push endpoints.

import { generateRequestDetails } from "web-push-neo";
import type { Env } from "./env";
import { nowSeconds } from "./env";

export interface PushPayload {
  title: string;
  body: string;
}

export interface PushSummary {
  sent: number;
  failed: number;
  pruned: number;
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

const zeroSummary = (): PushSummary => ({ sent: 0, failed: 0, pruned: 0 });

/** Sends `payload` to every device this member has registered. */
export async function sendToMember(env: Env, memberId: string, payload: PushPayload): Promise<PushSummary> {
  // Push isn't configured yet (VAPID secrets not set). The app must still run
  // -- items, lists, and purchases all work fine without notifications -- so
  // this is a silent no-op rather than a thrown error on every cron tick.
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
    return zeroSummary();
  }

  const rows = await env.DB.prepare("SELECT id, endpoint, p256dh, auth FROM push_subscription WHERE member_id = ?")
    .bind(memberId)
    .all<SubscriptionRow>();

  const body = JSON.stringify(payload);
  const summary = zeroSummary();

  for (const row of rows.results) {
    let response: Response;
    try {
      // Encryption is inside the try as well as the fetch: a corrupt p256dh or
      // auth value in the database makes generateRequestDetails throw, and one
      // bad row must not take down delivery for this member's other devices --
      // or, via the cron sweep, for the rest of the household.
      const details = await generateRequestDetails(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        body,
        {
          vapidDetails: {
            subject: env.VAPID_SUBJECT,
            publicKey: env.VAPID_PUBLIC_KEY,
            privateKey: env.VAPID_PRIVATE_KEY,
          },
        },
      );

      response = await fetch(details.endpoint, {
        method: details.method,
        headers: details.headers,
        body: details.body ?? undefined,
      });
    } catch (err) {
      // A network-level failure is indistinguishable from any other delivery
      // failure as far as this subscription is concerned.
      console.error("Push delivery failed for subscription", row.id, err);
      summary.failed++;
      await bumpFailure(env, row.id);
      continue;
    }

    if (response.ok) {
      summary.sent++;
      await env.DB.prepare("UPDATE push_subscription SET last_ok_at = ?, failure_count = 0 WHERE id = ?")
        .bind(nowSeconds(), row.id)
        .run();
    } else if (response.status === 404 || response.status === 410) {
      // The push service itself is telling us this endpoint is dead -- most
      // commonly an iOS PWA that was deleted from the Home Screen. Keeping a
      // dead row around just means paying the encrypt+fetch cost forever.
      summary.pruned++;
      await env.DB.prepare("DELETE FROM push_subscription WHERE id = ?").bind(row.id).run();
    } else {
      summary.failed++;
      await bumpFailure(env, row.id);
    }
  }

  return summary;
}

function bumpFailure(env: Env, subscriptionId: string): Promise<D1Result> {
  return env.DB.prepare("UPDATE push_subscription SET failure_count = failure_count + 1 WHERE id = ?")
    .bind(subscriptionId)
    .run();
}
