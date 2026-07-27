import { describe, it, expect } from "vitest";
import { SELF, env } from "cloudflare:test";
import {
  hashPasscode,
  verifyPasscode,
  signSession,
  verifySession,
  sessionExpiry,
  readSessionCookie,
  b64urlEncode,
  b64urlDecode,
} from "../src/worker/auth";

const SECRET = "test-secret-not-used-in-production";

describe("base64url", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = crypto.getRandomValues(new Uint8Array(64));
    expect(b64urlDecode(b64urlEncode(bytes))).toEqual(bytes);
  });

  it("emits no padding or url-unsafe characters", () => {
    // Length 1 forces two '=' of padding in standard base64.
    const encoded = b64urlEncode(new Uint8Array([255]));
    expect(encoded).not.toMatch(/[+/=]/);
  });
});

describe("passcode hashing", () => {
  it("accepts the correct passcode", async () => {
    const stored = await hashPasscode("open-sesame");
    expect(await verifyPasscode("open-sesame", stored)).toBe(true);
  });

  it("rejects a wrong passcode", async () => {
    const stored = await hashPasscode("open-sesame");
    expect(await verifyPasscode("open-sesamf", stored)).toBe(false);
  });

  it("salts, so the same passcode hashes differently each time", async () => {
    expect(await hashPasscode("same")).not.toBe(await hashPasscode("same"));
  });

  // Regression: this was set to 210_000 on OWASP's advice, which the local
  // workerd accepts silently but production rejects with
  // "NotSupportedError: iteration counts above 100000 are not supported".
  // Every signup and login 500'd in production while all tests stayed green,
  // so the ceiling has to be asserted explicitly rather than exercised.
  it("stays within the Workers PBKDF2 iteration ceiling of 100k", async () => {
    const iterations = Number((await hashPasscode("x")).split("$")[1]);
    expect(iterations).toBeGreaterThan(0);
    expect(iterations).toBeLessThanOrEqual(100_000);
  });

  it("rejects malformed stored hashes instead of throwing", async () => {
    for (const bad of ["", "nonsense", "pbkdf2$abc$x$y", "sha1$1$x$y", "pbkdf2$1$x"]) {
      expect(await verifyPasscode("whatever", bad)).toBe(false);
    }
  });
});

describe("session tokens", () => {
  const payload = { householdId: "h1", memberId: "m1", exp: sessionExpiry() };

  it("verifies a token it just signed", async () => {
    const token = await signSession(payload, SECRET);
    expect(await verifySession(token, SECRET)).toMatchObject({
      householdId: "h1",
      memberId: "m1",
    });
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signSession(payload, "other-secret");
    expect(await verifySession(token, SECRET)).toBeNull();
  });

  it("rejects a tampered payload", async () => {
    const token = await signSession(payload, SECRET);
    const forged = b64urlEncode(
      new TextEncoder().encode(JSON.stringify({ ...payload, householdId: "h2" })),
    );
    expect(await verifySession(`${forged}.${token.split(".")[1]}`, SECRET)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await signSession({ ...payload, exp: 1000 }, SECRET);
    expect(await verifySession(token, SECRET, 2000)).toBeNull();
  });

  it("rejects malformed tokens instead of throwing", async () => {
    for (const bad of ["", ".", "no-dot", "a.b", "!!!.???"]) {
      expect(await verifySession(bad, SECRET)).toBeNull();
    }
  });
});

describe("cookie parsing", () => {
  it("finds the session cookie among others", () => {
    expect(readSessionCookie("foo=1; pantry_session=abc.def; bar=2")).toBe("abc.def");
  });

  it("returns null when absent or empty", () => {
    expect(readSessionCookie(null)).toBeNull();
    expect(readSessionCookie("foo=1")).toBeNull();
    expect(readSessionCookie("pantry_session=")).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */

const json = (path: string, body: unknown, cookie?: string) =>
  SELF.fetch(`https://pantry.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });

/** Pulls the session cookie value out of a Set-Cookie response header. */
const cookieFrom = (res: Response): string => {
  const header = res.headers.get("Set-Cookie") ?? "";
  return header.split(";")[0] ?? "";
};

describe("auth flow", () => {
  it("walks setup -> login -> pick profile", async () => {
    // Fresh install: the client is told to show the setup screen.
    let res = await SELF.fetch("https://pantry.test/api/session");
    expect(await res.json()).toMatchObject({ needsSetup: true, authenticated: false });

    res = await json("/api/setup", {
      householdName: "Our Kitchen",
      passcode: "rice2026",
      memberNames: ["Mahmudul", "Wife"],
    });
    expect(res.status).toBe(201);

    // Setup seeds both members and the default categories.
    const categories = await env.DB.prepare("SELECT COUNT(*) AS n FROM category").first<{
      n: number;
    }>();
    expect(categories?.n).toBe(8);
    const settings = await env.DB.prepare("SELECT COUNT(*) AS n FROM member_settings").first<{
      n: number;
    }>();
    expect(settings?.n).toBe(2);

    // Setup is one-shot.
    res = await json("/api/setup", {
      householdName: "Hijack",
      passcode: "aaaa",
      memberNames: ["Someone"],
    });
    expect(res.status).toBe(409);

    // Wrong passcode gets nothing.
    res = await json("/api/login", { passcode: "wrong" });
    expect(res.status).toBe(401);
    expect(res.headers.get("Set-Cookie")).toBeNull();

    // Right passcode issues a cookie with no member chosen yet.
    res = await json("/api/login", { passcode: "rice2026" });
    expect(res.status).toBe(200);
    const cookie = cookieFrom(res);
    expect(cookie).toMatch(/^pantry_session=/);
    expect(res.headers.get("Set-Cookie")).toContain("HttpOnly");

    res = await SELF.fetch("https://pantry.test/api/session", { headers: { Cookie: cookie } });
    const session = await res.json<{ memberId: string | null; members: Array<{ id: string }> }>();
    expect(session.memberId).toBeNull();
    expect(session.members).toHaveLength(2);

    // Picking a profile re-signs the cookie with the member attached.
    const memberId = session.members[0]!.id;
    res = await json("/api/profile", { memberId }, cookie);
    expect(res.status).toBe(200);

    res = await SELF.fetch("https://pantry.test/api/session", {
      headers: { Cookie: cookieFrom(res) },
    });
    expect(await res.json()).toMatchObject({ authenticated: true, memberId });
  });

  it("refuses a profile that belongs to no household member", async () => {
    const login = await json("/api/login", { passcode: "rice2026" });
    const res = await json("/api/profile", { memberId: "made-up" }, cookieFrom(login));
    expect(res.status).toBe(404);
  });

  it("refuses to pick a profile without a session", async () => {
    expect((await json("/api/profile", { memberId: "anything" })).status).toBe(401);
  });

  it("clears the cookie on logout", async () => {
    const res = await json("/api/logout", {});
    expect(res.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });
});
