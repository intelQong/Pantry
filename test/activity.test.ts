import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { SELF, env } from "cloudflare:test";
import { summariseNames, describeActivity, notifyListActivity } from "../src/worker/activity";

const json = (path: string, body: unknown, cookie?: string) =>
  SELF.fetch(`https://pantry.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
const get = (path: string, cookie?: string) =>
  SELF.fetch(`https://pantry.test${path}`, { headers: cookie ? { Cookie: cookie } : {} });
const cookieFrom = (r: Response) => (r.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";

async function fakeKeys(): Promise<{ p256dh: string; auth: string }> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const b64url = (b: Uint8Array) =>
    btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { p256dh: b64url(raw), auth: b64url(crypto.getRandomValues(new Uint8Array(16))) };
}

async function subscribe(memberId: string, endpoint: string) {
  const keys = await fakeKeys();
  await env.DB.prepare(
    "INSERT INTO push_subscription (id, member_id, endpoint, p256dh, auth, created_at) VALUES (?,?,?,?,?,?)",
  )
    .bind(crypto.randomUUID(), memberId, endpoint, keys.p256dh, keys.auth, 0)
    .run();
}

/** Stubs the push service and records which endpoints were sent to. */
function capturePushes(): string[] {
  const sent: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    sent.push(url);
    return new Response(null, { status: 201 });
  });
  return sent;
}

afterEach(() => vi.unstubAllGlobals());

describe("notification wording", () => {
  it("lists up to three names, then counts the rest", () => {
    expect(summariseNames(["Milk"])).toBe("Milk");
    expect(summariseNames(["Milk", "Eggs"])).toBe("Milk and Eggs");
    expect(summariseNames(["Milk", "Eggs", "Rice"])).toBe("Milk, Eggs and Rice");
    expect(summariseNames(["Milk", "Eggs", "Rice", "Salt", "Tea"])).toBe("Milk, Eggs and 3 more");
  });

  it("says who did what", () => {
    expect(describeActivity("Sam", "added", ["Milk"]).body).toBe("Sam added Milk to the list");
    expect(describeActivity("Sam", "bought", ["Milk", "Eggs"]).body).toBe("Sam bought Milk and Eggs");
  });
});

let householdId: string;
let actorId: string;
let partnerId: string;
let actorCookie: string;

beforeAll(async () => {
  await json("/api/setup", { householdName: "Pings", passcode: "pingpong", memberNames: ["Sam", "Riley"] });
  const login = cookieFrom(await json("/api/login", { passcode: "pingpong" }));
  const { members } = await (await get("/api/session", login)).json<{ members: Array<{ id: string }> }>();
  [actorId, partnerId] = [members[0]!.id, members[1]!.id];
  actorCookie = cookieFrom(await json("/api/profile", { memberId: actorId }, login));
  householdId = (await env.DB.prepare("SELECT id FROM household").first<{ id: string }>())!.id;
  // Nobody's quiet hours get in the way of these tests unless one says so.
  await env.DB.prepare("UPDATE member_settings SET quiet_start = 0, quiet_end = 0").run();
  await subscribe(actorId, "https://push.test/actor");
  await subscribe(partnerId, "https://push.test/partner");
});

describe("who hears about it", () => {
  it("tells the other member and never the person who did it", async () => {
    const sent = capturePushes();
    await notifyListActivity(env, householdId, actorId, "added", "Milk", Math.floor(Date.now() / 1000));
    expect(sent).toEqual(["https://push.test/partner"]);
  });

  it("stays silent during the recipient's quiet hours", async () => {
    await env.DB.prepare(
      "UPDATE member_settings SET timezone = 'UTC', quiet_start = 22, quiet_end = 7 WHERE member_id = ?",
    )
      .bind(partnerId)
      .run();
    const sent = capturePushes();
    // 03:00 UTC sits inside 22:00-07:00.
    await notifyListActivity(env, householdId, actorId, "added", "Milk", Date.UTC(2026, 6, 1, 3) / 1000);
    expect(sent).toEqual([]);
    await env.DB.prepare("UPDATE member_settings SET quiet_start = 0, quiet_end = 0 WHERE member_id = ?")
      .bind(partnerId)
      .run();
  });
});

describe("the routes announce once per real change", () => {
  it("announces an add, but not a retry of the same queued add", async () => {
    const sent = capturePushes();
    const clientId = crypto.randomUUID();
    await json("/api/list", { customName: "Lentils", clientId }, actorCookie);
    await vi.waitFor(() => expect(sent).toEqual(["https://push.test/partner"]));

    await json("/api/list", { customName: "Lentils", clientId }, actorCookie);
    await new Promise((r) => setTimeout(r, 50));
    expect(sent).toHaveLength(1);
  });

  it("announces a buy, but not the double-tap after it", async () => {
    const entry = await (await json("/api/list", { customName: "Yogurt" }, actorCookie)).json<{ id: string }>();
    await new Promise((r) => setTimeout(r, 50));
    const sent = capturePushes();

    await json(`/api/list/${entry.id}/bought`, {}, actorCookie);
    await vi.waitFor(() => expect(sent).toEqual(["https://push.test/partner"]));

    await json(`/api/list/${entry.id}/bought`, {}, actorCookie);
    await new Promise((r) => setTimeout(r, 50));
    expect(sent).toHaveLength(1);
  });

  it("announces a logged grocery spend but not a bill payment", async () => {
    const sent = capturePushes();
    await json("/api/purchases", { itemName: "Paneer", priceTotal: 30000 }, actorCookie);
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    const items = await (await get("/api/items", actorCookie)).json<Array<{ id: string; name: string }>>();
    const wifi = items.find((i) => i.name === "Wifi Bill")!;
    await json("/api/purchases", { itemId: wifi.id, priceTotal: 100000 }, actorCookie);
    await new Promise((r) => setTimeout(r, 50));
    expect(sent).toHaveLength(1);
  });
});
