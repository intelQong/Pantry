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

  // Upsert: if this endpoint already exists (same browser re-subscribing),
  // update rather than insert a duplicate.
  const existing = await c.env.DB.prepare(
    "SELECT id FROM push_subscription WHERE endpoint = ?",
  )
    .bind(endpoint)
    .first<{ id: string }>();

  if (existing) {
    await c.env.DB.prepare(
      `UPDATE push_subscription
         SET member_id = ?, p256dh = ?, auth = ?, user_agent = ?, failure_count = 0
       WHERE id = ?`,
    )
      .bind(session.memberId, p256dh, auth, body.userAgent ?? null, existing.id)
      .run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO push_subscription (id, member_id, endpoint, p256dh, auth, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
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
