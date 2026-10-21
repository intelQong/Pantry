import { describe, it, expect, beforeAll } from "vitest";
import { SELF, env } from "cloudflare:test";

const post = (path: string, body: unknown, cookie?: string) =>
  SELF.fetch(`https://pantry.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });

const get = (path: string, cookie?: string) =>
  SELF.fetch(`https://pantry.test${path}`, { headers: cookie ? { Cookie: cookie } : {} });

const cookieFrom = (res: Response) => (res.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";

let houseCookie: string;
let admin: { id: string; name: string; isAdmin: boolean; hasAdminPasscode: boolean };
let partner: { id: string; name: string; isAdmin: boolean; hasAdminPasscode: boolean };

beforeAll(async () => {
  await post("/api/setup", {
    householdName: "Our Kitchen",
    passcode: "rice2026",
    memberNames: ["Sam", "Riley"],
    adminPasscode: "owner9999",
  });

  houseCookie = cookieFrom(await post("/api/login", { passcode: "rice2026" }));
  const session = await get("/api/session", houseCookie);
  const { members } = await session.json<{ members: typeof admin[] }>();
  admin = members[0]!;
  partner = members[1]!;
});

describe("superadmin profile", () => {
  it("marks the first member named at setup as the owner", () => {
    expect(admin).toMatchObject({ name: "Sam", isAdmin: true, hasAdminPasscode: true });
    expect(partner).toMatchObject({ name: "Riley", isAdmin: false, hasAdminPasscode: false });
  });

  it("never exposes the passcode hash to the client", async () => {
    const body = await (await get("/api/session", houseCookie)).text();
    expect(body).not.toContain("pbkdf2$");
    expect(body).not.toContain("admin_passcode_hash");
  });

  it("refuses to switch into the owner profile with no passcode", async () => {
    const res = await post("/api/profile", { memberId: admin.id }, houseCookie);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "admin_passcode_required" });
  });

  it("refuses the household passcode as a stand-in for the owner's", async () => {
    // The whole point is that knowing the household code is not enough.
    const res = await post(
      "/api/profile",
      { memberId: admin.id, adminPasscode: "rice2026" },
      houseCookie,
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "bad_admin_passcode" });
  });

  it("issues no session cookie on a failed attempt", async () => {
    const res = await post("/api/profile", { memberId: admin.id, adminPasscode: "nope" }, houseCookie);
    expect(res.status).toBe(403);
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("lets the owner in with the right passcode", async () => {
    const res = await post(
      "/api/profile",
      { memberId: admin.id, adminPasscode: "owner9999" },
      houseCookie,
    );
    expect(res.status).toBe(200);

    const session = await get("/api/session", cookieFrom(res));
    expect(await session.json()).toMatchObject({ memberId: admin.id });
  });

  it("leaves the unprotected profile freely switchable", async () => {
    const res = await post("/api/profile", { memberId: partner.id }, houseCookie);
    expect(res.status).toBe(200);
  });

  it("gates switching *into* the owner even from the owner's own session", async () => {
    // Switching away is free; coming back is not. Otherwise handing the unlocked
    // phone to someone else would leave the owner profile permanently open.
    const asAdmin = cookieFrom(
      await post("/api/profile", { memberId: admin.id, adminPasscode: "owner9999" }, houseCookie),
    );
    const away = cookieFrom(await post("/api/profile", { memberId: partner.id }, asAdmin));
    const back = await post("/api/profile", { memberId: admin.id }, away);
    expect(back.status).toBe(403);
  });

  it("rejects a weak owner passcode at setup", async () => {
    // Setup is one-shot, so assert the validator against a fresh household row.
    await env.DB.prepare("DELETE FROM household").run();
    const res = await post("/api/setup", {
      householdName: "Second",
      passcode: "goodenough",
      memberNames: ["A"],
      adminPasscode: "abc",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "weak_admin_passcode" });
  });

  it("leaves the owner unprotected when no owner passcode is given", async () => {
    await env.DB.prepare("DELETE FROM household").run();
    await post("/api/setup", {
      householdName: "Third",
      passcode: "goodenough",
      memberNames: ["Solo"],
    });

    const cookie = cookieFrom(await post("/api/login", { passcode: "goodenough" }));
    const { members } = await (await get("/api/session", cookie)).json<{ members: typeof admin[] }>();

    expect(members[0]).toMatchObject({ isAdmin: true, hasAdminPasscode: false });
    expect((await post("/api/profile", { memberId: members[0]!.id }, cookie)).status).toBe(200);
  });
});

describe("item price", () => {
  let cookie: string;

  beforeAll(async () => {
    await env.DB.prepare("DELETE FROM household").run();
    await post("/api/setup", {
      householdName: "Prices",
      passcode: "goodenough",
      memberNames: ["Buyer"],
    });
    const login = cookieFrom(await post("/api/login", { passcode: "goodenough" }));
    const { members } = await (await get("/api/session", login)).json<{ members: typeof admin[] }>();
    cookie = cookieFrom(await post("/api/profile", { memberId: members[0]!.id }, login));
  });

  it("stores a price as integer minor units", async () => {
    const res = await post("/api/items", { name: "Rice", defaultPrice: 34000 }, cookie);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ defaultPrice: 34000 });
  });

  it("treats a missing price as null rather than zero", async () => {
    const res = await post("/api/items", { name: "Salt" }, cookie);
    expect(await res.json()).toMatchObject({ defaultPrice: null });
  });

  it("rejects a fractional price, which would corrupt every total downstream", async () => {
    const res = await post("/api/items", { name: "Sugar", defaultPrice: 12.5 }, cookie);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_price" });
  });

  it("rejects a negative price", async () => {
    expect((await post("/api/items", { name: "Tea", defaultPrice: -1 }, cookie)).status).toBe(400);
  });

  it("clears the price when set back to null", async () => {
    const created = await (
      await post("/api/items", { name: "Oil", defaultPrice: 25000 }, cookie)
    ).json<{ id: string }>();

    const res = await SELF.fetch(`https://pantry.test/api/items/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ defaultPrice: null }),
    });
    expect(await res.json()).toMatchObject({ defaultPrice: null });
  });
});

describe("locking your own profile after setup", () => {
  let cookie: string;
  let meId: string;

  beforeAll(async () => {
    await env.DB.prepare("DELETE FROM household").run();
    await post("/api/setup", {
      householdName: "Later",
      passcode: "goodenough",
      memberNames: ["Owner", "Other"],
    });
    const login = cookieFrom(await post("/api/login", { passcode: "goodenough" }));
    const { members } = await (await get("/api/session", login)).json<{ members: typeof admin[] }>();
    meId = members[0]!.id;
    cookie = cookieFrom(await post("/api/profile", { memberId: meId }, login));
  });

  it("locks a profile that started with no passcode", async () => {
    // This is the path a household set up before the feature existed has to
    // take: there is no passcode yet, so none is required to set the first one.
    const res = await post("/api/profile/passcode", { passcode: "owner9999" }, cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ hasAdminPasscode: true });

    const again = await post("/api/profile", { memberId: meId }, cookie);
    expect(again.status).toBe(403);
  });

  it("refuses to change it without the current passcode", async () => {
    const res = await post("/api/profile/passcode", { passcode: "newcode123" }, cookie);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "bad_current_passcode" });
  });

  it("changes it when the current passcode is given", async () => {
    const res = await post(
      "/api/profile/passcode",
      { passcode: "newcode123", currentPasscode: "owner9999" },
      cookie,
    );
    expect(res.status).toBe(200);
    expect(
      (await post("/api/profile", { memberId: meId, adminPasscode: "newcode123" }, cookie)).status,
    ).toBe(200);
  });

  it("removes the lock when given an empty passcode", async () => {
    const res = await post(
      "/api/profile/passcode",
      { passcode: "", currentPasscode: "newcode123" },
      cookie,
    );
    expect(await res.json()).toMatchObject({ hasAdminPasscode: false });
    expect((await post("/api/profile", { memberId: meId }, cookie)).status).toBe(200);
  });

  it("rejects a weak new passcode", async () => {
    expect((await post("/api/profile/passcode", { passcode: "abc" }, cookie)).status).toBe(400);
  });

  it("refuses to lock a profile that is not the household owner", async () => {
    // The UI hides the control for non-owners; this is the rule behind it.
    const login = cookieFrom(await post("/api/login", { passcode: "goodenough" }));
    const { members } = await (await get("/api/session", login)).json<{ members: typeof admin[] }>();
    const other = members.find((m) => !m.isAdmin)!;
    const asOther = cookieFrom(await post("/api/profile", { memberId: other.id }, login));

    const res = await post("/api/profile/passcode", { passcode: "sneaky123" }, asOther);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "not_admin" });

    const row = await env.DB.prepare("SELECT admin_passcode_hash FROM member WHERE id = ?")
      .bind(other.id)
      .first<{ admin_passcode_hash: string | null }>();
    expect(row?.admin_passcode_hash).toBeNull();
  });

  it("refuses to set a lock from a device with no profile chosen", async () => {
    const houseOnly = cookieFrom(await post("/api/login", { passcode: "goodenough" }));
    expect((await post("/api/profile/passcode", { passcode: "abcd1234" }, houseOnly)).status).toBe(403);
  });
});
