import { Hono } from "hono";
import type { AppEnv } from "../env";
import { nowSeconds } from "../env";
import { requireMember } from "../middleware";
import { sendToMember } from "../push";

const push = new Hono<AppEnv>();

/** Returns the VAPID public key so the client can subscribe. */
push.get("/push/key", (c) => {
  const key = c.env.VAPID_PUBLIC_KEY;
  if (!key) {
    return c.json({ error: "not_configured", message: "VAPID keys are not set up yet." }, 503);
  }
  return c.json({ key });
});

/** Upsert a push subscription for the current member. */
push.post("/push/subscribe", requireMember, async (c) => {
  const session = c.get("session");
  const body = await c.req.json<{
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
    userAgent?: string;
  }>();

  const endpoint = body.endpoint?.trim();
  const p256dh = body.keys?.p256dh?.trim();
  const auth = body.keys?.auth?.trim();

  if (!endpoint || !p256dh || !auth) {
    return c.json(
      { error: "invalid_subscription", message: "endpoint, keys.p256dh, and keys.auth are required." },
      400,
    );
  }

  const now = nowSeconds();

  // One statement rather than select-then-write. Reading the row first was
  // check-then-act against a UNIQUE column, so a device re-subscribing while
  // the service worker also re-registers -- the common iOS pattern -- could
  // have both attempts miss the lookup and the loser blow up with a raw
  // constraint error.
  //
  // The DO UPDATE is scoped to the member who already owns the row. Without
  // that, anyone who learned another member's endpoint could re-point it at
  // themselves: the other phone would quietly stop receiving digests and start
  // delivering them to the thief, with nothing visible on either device.
  const result = await c.env.DB.prepare(
    `INSERT INTO push_subscription (id, member_id, endpoint, p256dh, auth, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE
        SET p256dh = excluded.p256dh,
            auth = excluded.auth,
            user_agent = excluded.user_agent,
            failure_count = 0
      WHERE push_subscription.member_id = excluded.member_id`,
  )
    .bind(
      crypto.randomUUID(),
      session.memberId,
      endpoint,
      p256dh,
      auth,
      body.userAgent ?? null,
      now,
    )
    .run();

  // Zero rows means the endpoint belongs to the other member. Nothing was
  // written, and saying so is better than reporting a success that silently
  // did nothing.
  if ((result.meta.changes ?? 0) === 0) {
    return c.json(
      { error: "endpoint_taken", message: "That device is already registered to someone else." },
      409,
    );
  }

  return c.json({ ok: true });
});

/** Fire a test push to the calling member. */
push.post("/push/test", requireMember, async (c) => {
  const session = c.get("session");
  const env = c.env;

  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
    return c.json({ error: "not_configured", message: "VAPID keys are not set up yet." }, 503);
  }

  const result = await sendToMember(env, session.memberId!, {
    title: "Pantry",
    body: "🔔 Test notification — push is working!",
  });

  return c.json({ ok: true, sent: result.sent, failed: result.failed });
});

export default push;
