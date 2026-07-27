import type { SessionPayload } from "./auth";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;

  /** HMAC key for session cookies. `wrangler secret put SESSION_SECRET`. */
  SESSION_SECRET: string;

  /** Web Push (VAPID). Generated in Phase 3, stored as secrets. */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

/** Values attached to the Hono context by middleware. */
export interface Variables {
  session: SessionPayload;
}

export type AppEnv = { Bindings: Env; Variables: Variables };

export const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/**
 * Local `wrangler dev` runs over plain http, where a `Secure` cookie would be
 * dropped. Everywhere else is https and must set it.
 */
export const isSecureRequest = (req: Request): boolean =>
  new URL(req.url).protocol === "https:";
