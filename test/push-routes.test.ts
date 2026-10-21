import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { SELF, env } from "cloudflare:test";

const json = (path: string, body: unknown, cookie?: string) =>
  SELF.fetch(`https://pantry.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });

const get = (path: string, cookie?: string) =>
  SELF.fetch(`https://pantry.test${path}`, { headers: cookie ? { Cookie: cookie } : {} });

const cookieFrom = (res: Response): string => (res.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";

let memberCookie: string;
let sessionOnlyCookie: string;
let memberId: string;

beforeAll(async () => {
  await json("/api/setup", {
    householdName: "Our Kitchen",
    passcode: "rice2026",
    memberNames: ["Sam", "Riley"],
  });

  const login = await json("/api/login", { passcode: "rice2026" });
  sessionOnlyCookie = cookieFrom(login);

  const session = await get("/api/session", sessionOnlyCookie);
  const { members } = await session.json<{ members: Array<{ id: string }> }>();
  memberId = members[0]!.id;

  const profile = await json("/api/profile", { memberId }, sessionOnlyCookie);
  memberCookie = cookieFrom(profile);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const SUB = {
  endpoint: "https://web.push.apple.com/sub-abc",
  keys: { p256dh: "BJ_fake_p256dh_value", auth: "fake_auth" },
};

describe("GET /api/push/key", () => {
  it("returns the VAPID public key the client needs to subscribe", async () => {
    const res = await get("/api/push/key", memberCookie);
    expect(res.status).toBe(200);
    const { key } = await res.json<{ key: string }>();
    expect(key).toBe(env.VAPID_PUBLIC_KEY);
  });
});

describe("POST /api/push/subscribe", () => {
  it("refuses a device that hasn't picked a profile", async () => {
    // Subscriptions are keyed to a member, so we must know who is holding the phone.
    expect((await json("/api/push/subscribe", SUB, sessionOnlyCookie)).status).toBe(403);
  });

  it("refuses an unauthenticated request", async () => {
    expect((await json("/api/push/subscribe", SUB)).status).toBe(401);
  });

  it("rejects a subscription missing endpoint or keys", async () => {
    for (const bad of [
      {},
      { endpoint: "https://x/y" },
      { endpoint: "https://x/y", keys: { p256dh: "a" } },
      { endpoint: "", keys: { p256dh: "a", auth: "b" } },
    ]) {
      expect((await json("/api/push/subscribe", bad, memberCookie)).status).toBe(400);
    }
  });

  it("stores the subscription against the calling member", async () => {
    const res = await json("/api/push/subscribe", { ...SUB, userAgent: "iPhone" }, memberCookie);
    expect(res.status).toBe(200);

    const row = await env.DB.prepare(
      "SELECT member_id, p256dh, auth, user_agent FROM push_subscription WHERE endpoint = ?",
    )
      .bind(SUB.endpoint)
      .first<{ member_id: string; p256dh: string; auth: string; user_agent: string }>();

    expect(row).toMatchObject({
      member_id: memberId,
      p256dh: SUB.keys.p256dh,
      auth: SUB.keys.auth,
      user_agent: "iPhone",
    });
  });

  it("updates in place when the same browser re-subscribes", async () => {
    // Browsers hand out a fresh key pair on re-subscribe while keeping the
    // endpoint. Inserting again would violate the UNIQUE index and, worse,
    // leave a stale row that push delivery would keep failing against.
    await json("/api/push/subscribe", SUB, memberCookie);
    await json(
      "/api/push/subscribe",
      { endpoint: SUB.endpoint, keys: { p256dh: "rotated_key", auth: "rotated_auth" } },
      memberCookie,
    );

    const rows = await env.DB.prepare(
      "SELECT p256dh FROM push_subscription WHERE endpoint = ?",
    )
      .bind(SUB.endpoint)
      .all<{ p256dh: string }>();

    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]!.p256dh).toBe("rotated_key");
  });

  it("resets failure_count when a dead-looking subscription comes back", async () => {
    await json("/api/push/subscribe", SUB, memberCookie);
    await env.DB.prepare("UPDATE push_subscription SET failure_count = 7 WHERE endpoint = ?")
      .bind(SUB.endpoint)
      .run();

    await json("/api/push/subscribe", SUB, memberCookie);

    const row = await env.DB.prepare(
      "SELECT failure_count FROM push_subscription WHERE endpoint = ?",
    )
      .bind(SUB.endpoint)
      .first<{ failure_count: number }>();
    expect(row?.failure_count).toBe(0);
  });
});

describe("POST /api/push/test", () => {
  it("refuses a device that hasn't picked a profile", async () => {
    expect((await json("/api/push/test", {}, sessionOnlyCookie)).status).toBe(403);
  });

  it("delivers to the calling member's registered devices", async () => {
    // A real P-256 public key is required here: encryption genuinely validates
    // the point, and a placeholder string is (correctly) treated as a corrupt
    // subscription and counted as a failure rather than a send.
    const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ])) as CryptoKeyPair;
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    const b64url = (b: Uint8Array) =>
      btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    await json(
      "/api/push/subscribe",
      {
        endpoint: SUB.endpoint,
        keys: { p256dh: b64url(raw), auth: b64url(crypto.getRandomValues(new Uint8Array(16))) },
      },
      memberCookie,
    );

    const fetchSpy = vi.fn(async () => new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", fetchSpy);

    const res = await json("/api/push/test", {}, memberCookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, sent: 1 });

    // Confirm it really went to the push service, with the modern encoding.
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(SUB.endpoint);
    expect(new Headers(init.headers).get("Content-Encoding")).toBe("aes128gcm");
  });
});
