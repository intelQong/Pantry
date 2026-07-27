import { describe, it, expect, vi, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { runDigestSweep } from "../src/worker/cron";
import { sendToMember } from "../src/worker/push";
import type { Env } from "../src/worker/env";

const DAY = 86400;
const FAR_PAST = Date.UTC(2020, 0, 1) / 1000;

// 2026-07-27 is a Monday, 2026-07-25 is the Saturday before it.
const MON_0800_UTC = Date.UTC(2026, 6, 27, 8, 0, 0) / 1000;
const MON_0900_UTC = Date.UTC(2026, 6, 27, 9, 0, 0) / 1000;
const SAT_0900_UTC = Date.UTC(2026, 6, 25, 9, 0, 0) / 1000;
// 03:00 UTC on the Monday is 09:00 local in Asia/Dhaka (a fixed UTC+6, no DST).
const DHAKA_0900_LOCAL_AS_UTC = Date.UTC(2026, 6, 27, 3, 0, 0) / 1000;

async function seedHousehold(): Promise<string> {
  const householdId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO household (id, name, passcode_hash, created_at) VALUES (?,?,?,?)")
    .bind(householdId, "Test House", "pbkdf2$1$AA$AA", FAR_PAST)
    .run();
  return householdId;
}

interface MemberOpts {
  notifyDays?: string;
  notifyHour?: number;
  timezone?: string;
  leadDays?: number;
  quietStart?: number;
  quietEnd?: number;
}

async function seedMember(householdId: string, opts: MemberOpts = {}): Promise<string> {
  const memberId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO member (id, household_id, name, created_at) VALUES (?,?,?,?)").bind(
      memberId,
      householdId,
      "Person",
      FAR_PAST,
    ),
    env.DB.prepare(
      `INSERT INTO member_settings (member_id, notify_days, notify_hour, timezone, lead_days, quiet_start, quiet_end)
       VALUES (?,?,?,?,?,?,?)`,
    ).bind(
      memberId,
      opts.notifyDays ?? "1,2,3,4,5,6,7",
      opts.notifyHour ?? 9,
      opts.timezone ?? "UTC",
      opts.leadDays ?? 2,
      opts.quietStart ?? 22,
      opts.quietEnd ?? 7,
    ),
  ]);
  return memberId;
}

/** A staple item, overdue by default (20 days since purchase, 7-day interval -> overdue at 1.5x). */
async function seedStapleItem(
  householdId: string,
  name: string,
  opts: { lastPurchasedAt?: number | null; intervalDays?: number } = {},
): Promise<string> {
  const itemId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO item (id, household_id, name, restock_interval_days, last_purchased_at, created_at)
     VALUES (?,?,?,?,?,?)`,
  )
    .bind(
      itemId,
      householdId,
      name,
      opts.intervalDays ?? 7,
      opts.lastPurchasedAt === undefined ? MON_0900_UTC - 20 * DAY : opts.lastPurchasedAt,
      FAR_PAST,
    )
    .run();
  return itemId;
}

async function addPending(householdId: string, itemId: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO list_entry (id, household_id, item_id, added_at, status) VALUES (?,?,?,?,'pending')",
  )
    .bind(crypto.randomUUID(), householdId, itemId, FAR_PAST)
    .run();
}

async function fakeSubscriptionKeys(): Promise<{ p256dh: string; auth: string }> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  const b64url = (b: Uint8Array) =>
    btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { p256dh: b64url(publicRaw), auth: b64url(authSecret) };
}

async function seedSubscription(memberId: string, endpoint: string): Promise<string> {
  const id = crypto.randomUUID();
  const keys = await fakeSubscriptionKeys();
  await env.DB.prepare(
    "INSERT INTO push_subscription (id, member_id, endpoint, p256dh, auth, created_at) VALUES (?,?,?,?,?,?)",
  )
    .bind(id, memberId, endpoint, keys.p256dh, keys.auth, FAR_PAST)
    .run();
  return id;
}

async function logCount(memberId: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM notification_log WHERE member_id = ? AND kind = 'restock_digest'",
  )
    .bind(memberId)
    .first<{ n: number }>();
  return row!.n;
}

describe("runDigestSweep", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fires only at the member's configured local hour", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 201 })));
    const householdId = await seedHousehold();
    const memberId = await seedMember(householdId, { notifyHour: 9, timezone: "UTC" });
    await seedStapleItem(householdId, "Rice");

    await runDigestSweep(env as unknown as Env, MON_0800_UTC);
    expect(await logCount(memberId)).toBe(0);

    await runDigestSweep(env as unknown as Env, MON_0900_UTC);
    expect(await logCount(memberId)).toBe(1);
  });

  it("fires only on the member's configured weekdays", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 201 })));
    const householdId = await seedHousehold();
    // Saturday (isoWeekday 6) only.
    const memberId = await seedMember(householdId, { notifyDays: "6", notifyHour: 9, timezone: "UTC" });
    await seedStapleItem(householdId, "Rice");

    await runDigestSweep(env as unknown as Env, MON_0900_UTC); // Monday: not in notify_days
    expect(await logCount(memberId)).toBe(0);

    await runDigestSweep(env as unknown as Env, SAT_0900_UTC); // Saturday: matches
    expect(await logCount(memberId)).toBe(1);
  });

  it("skips during the member's quiet hours even when the hour and weekday match", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 201 })));
    const householdId = await seedHousehold();
    // Quiet window 08:00-10:00 covers the 09:00 notify_hour.
    const memberId = await seedMember(householdId, { notifyHour: 9, timezone: "UTC", quietStart: 8, quietEnd: 10 });
    await seedStapleItem(householdId, "Rice");

    await runDigestSweep(env as unknown as Env, MON_0900_UTC);
    expect(await logCount(memberId)).toBe(0);
  });

  it("notifies two members in different timezones at different UTC hours", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 201 })));
    const householdId = await seedHousehold();
    const utcMember = await seedMember(householdId, { notifyHour: 9, timezone: "UTC" });
    const dhakaMember = await seedMember(householdId, { notifyHour: 9, timezone: "Asia/Dhaka" });
    await seedStapleItem(householdId, "Rice");

    // 09:00 UTC: only the UTC member's local hour is 9.
    await runDigestSweep(env as unknown as Env, MON_0900_UTC);
    expect(await logCount(utcMember)).toBe(1);
    expect(await logCount(dhakaMember)).toBe(0);

    // 03:00 UTC = 09:00 in Asia/Dhaka: only the Dhaka member's local hour is 9.
    await runDigestSweep(env as unknown as Env, DHAKA_0900_LOCAL_AS_UTC);
    expect(await logCount(utcMember)).toBe(1);
    expect(await logCount(dhakaMember)).toBe(1);
  });

  it("dedupes: a second sweep the same local day sends nothing more", async () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", fetchSpy);
    const householdId = await seedHousehold();
    const memberId = await seedMember(householdId, { notifyHour: 9, timezone: "UTC" });
    await seedStapleItem(householdId, "Rice");
    await seedSubscription(memberId, "https://push.example/a");

    await runDigestSweep(env as unknown as Env, MON_0900_UTC);
    await runDigestSweep(env as unknown as Env, MON_0900_UTC);

    expect(await logCount(memberId)).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("excludes items already sitting on the pending shop list from the digest", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 201 })));
    const householdId = await seedHousehold();
    const memberId = await seedMember(householdId, { notifyHour: 9, timezone: "UTC" });
    const overdueButListed = await seedStapleItem(householdId, "Rice");
    await seedStapleItem(householdId, "Milk");
    await addPending(householdId, overdueButListed);

    await runDigestSweep(env as unknown as Env, MON_0900_UTC);

    const row = await env.DB.prepare(
      "SELECT item_count FROM notification_log WHERE member_id = ?",
    )
      .bind(memberId)
      .first<{ item_count: number }>();
    expect(row?.item_count).toBe(1); // only "Milk" -- "Rice" is already on the list
  });

  it("sends nothing and writes no log row when the digest is empty", async () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", fetchSpy);
    const householdId = await seedHousehold();
    const memberId = await seedMember(householdId, { notifyHour: 9, timezone: "UTC" });
    // An item purchased yesterday against a 30-day interval: nowhere near due.
    await seedStapleItem(householdId, "Rice", { lastPurchasedAt: MON_0900_UTC - DAY, intervalDays: 30 });

    await runDigestSweep(env as unknown as Env, MON_0900_UTC);

    expect(await logCount(memberId)).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("sendToMember", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prunes the subscription row on a 410 response", async () => {
    const householdId = await seedHousehold();
    const memberId = await seedMember(householdId);
    const subId = await seedSubscription(memberId, "https://push.example/dead");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 410 })));

    const summary = await sendToMember(env as unknown as Env, memberId, { title: "t", body: "b" });
    expect(summary).toEqual({ sent: 0, failed: 0, pruned: 1 });

    const row = await env.DB.prepare("SELECT id FROM push_subscription WHERE id = ?").bind(subId).first();
    expect(row).toBeNull();
  });

  it("prunes the subscription row on a 404 response too", async () => {
    const householdId = await seedHousehold();
    const memberId = await seedMember(householdId);
    const subId = await seedSubscription(memberId, "https://push.example/gone");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));

    const summary = await sendToMember(env as unknown as Env, memberId, { title: "t", body: "b" });
    expect(summary).toEqual({ sent: 0, failed: 0, pruned: 1 });

    const row = await env.DB.prepare("SELECT id FROM push_subscription WHERE id = ?").bind(subId).first();
    expect(row).toBeNull();
  });

  it("increments failure_count on a 500 response", async () => {
    const householdId = await seedHousehold();
    const memberId = await seedMember(householdId);
    const subId = await seedSubscription(memberId, "https://push.example/flaky");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));

    const summary = await sendToMember(env as unknown as Env, memberId, { title: "t", body: "b" });
    expect(summary).toEqual({ sent: 0, failed: 1, pruned: 0 });

    const row = await env.DB.prepare("SELECT failure_count FROM push_subscription WHERE id = ?")
      .bind(subId)
      .first<{ failure_count: number }>();
    expect(row?.failure_count).toBe(1);
  });

  it("stamps last_ok_at and resets failure_count to 0 on success", async () => {
    const householdId = await seedHousehold();
    const memberId = await seedMember(householdId);
    const subId = await seedSubscription(memberId, "https://push.example/ok");
    await env.DB.prepare("UPDATE push_subscription SET failure_count = 3 WHERE id = ?").bind(subId).run();

    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 201 })));

    const summary = await sendToMember(env as unknown as Env, memberId, { title: "t", body: "b" });
    expect(summary).toEqual({ sent: 1, failed: 0, pruned: 0 });

    const row = await env.DB.prepare("SELECT last_ok_at, failure_count FROM push_subscription WHERE id = ?")
      .bind(subId)
      .first<{ last_ok_at: number | null; failure_count: number }>();
    expect(row?.last_ok_at).not.toBeNull();
    expect(row?.failure_count).toBe(0);
  });

  it("returns a zeroed summary without throwing when VAPID secrets aren't configured", async () => {
    const householdId = await seedHousehold();
    const memberId = await seedMember(householdId);
    await seedSubscription(memberId, "https://push.example/whatever");

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const unconfigured: Env = { ...(env as unknown as Env), VAPID_PUBLIC_KEY: undefined, VAPID_PRIVATE_KEY: undefined, VAPID_SUBJECT: undefined };
    const summary = await sendToMember(unconfigured, memberId, { title: "t", body: "b" });

    expect(summary).toEqual({ sent: 0, failed: 0, pruned: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // Regression: encryption used to happen outside the try/catch, so a single
  // corrupt row threw straight out of sendToMember, past the cron sweep, and
  // stopped every remaining member from being notified. One dead device must
  // never silence the whole household.
  it("counts a corrupt subscription as a failure and still delivers to the good one", async () => {
    const householdId = await seedHousehold();
    const memberId = await seedMember(householdId);

    await env.DB.prepare(
      `INSERT INTO push_subscription (id, member_id, endpoint, p256dh, auth, created_at)
       VALUES (?,?,?,?,?,?)`,
    )
      .bind("corrupt-sub", memberId, "https://push.example/corrupt", "!!!not-a-key!!!", "@@@", 0)
      .run();
    const goodId = await seedSubscription(memberId, "https://push.example/good");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 201 })));

    const summary = await sendToMember(env as unknown as Env, memberId, { title: "t", body: "b" });

    expect(summary.sent).toBe(1);
    expect(summary.failed).toBe(1);

    const good = await env.DB.prepare("SELECT last_ok_at FROM push_subscription WHERE id = ?")
      .bind(goodId)
      .first<{ last_ok_at: number | null }>();
    expect(good?.last_ok_at).not.toBeNull();

    const corrupt = await env.DB.prepare("SELECT failure_count FROM push_subscription WHERE id = ?")
      .bind("corrupt-sub")
      .first<{ failure_count: number }>();
    expect(corrupt?.failure_count).toBe(1);
  });
});
