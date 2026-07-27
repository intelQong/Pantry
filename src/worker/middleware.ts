import { createMiddleware } from "hono/factory";
import type { AppEnv } from "./env";
import { readSessionCookie, verifySession } from "./auth";

/**
 * Attaches the session to the context when a valid cookie is present.
 * Never rejects -- routes like /session need to answer "not logged in" too.
 */
export const loadSession = createMiddleware<AppEnv>(async (c, next) => {
  const token = readSessionCookie(c.req.header("Cookie") ?? null);
  if (token) {
    const payload = await verifySession(token, c.env.SESSION_SECRET);
    // `set` is typed as non-null, but reading it when unset yields undefined,
    // which is exactly what `requireSession` and /session check for.
    if (payload) c.set("session", payload);
  }
  await next();
});

/** Gate for routes that need a logged-in device. */
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("session")) {
    return c.json({ error: "unauthenticated", message: "Enter the household passcode." }, 401);
  }
  await next();
});

/**
 * Gate for routes that also need to know *which person* is acting -- anything
 * that writes attribution (added_by, bought_by) or reads per-member settings.
 */
export const requireMember = createMiddleware<AppEnv>(async (c, next) => {
  const session = c.get("session");
  if (!session) {
    return c.json({ error: "unauthenticated", message: "Enter the household passcode." }, 401);
  }
  if (!session.memberId) {
    return c.json({ error: "no_profile", message: "Choose who you are first." }, 403);
  }
  await next();
});
