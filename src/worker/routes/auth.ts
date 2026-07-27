import { Hono } from "hono";
import type { AppEnv } from "../env";
import { nowSeconds, isSecureRequest } from "../env";
import {
  hashPasscode,
  verifyPasscode,
  signSession,
  sessionExpiry,
  buildSessionCookie,
  clearSessionCookie,
} from "../auth";
import { requireSession } from "../middleware";

/** Categories every new household starts with; reorderable in Settings. */
const DEFAULT_CATEGORIES: Array<[string, string]> = [
  ["Produce", "#22c55e"],
  ["Dairy & Eggs", "#38bdf8"],
  ["Meat & Fish", "#f43f5e"],
  ["Grains & Staples", "#f59e0b"],
  ["Spices & Condiments", "#a855f7"],
  ["Snacks & Drinks", "#ec4899"],
  ["Household & Cleaning", "#64748b"],
  ["Personal Care", "#14b8a6"],
];

const auth = new Hono<AppEnv>();

/** Who am I? Drives the client's boot sequence: setup -> login -> pick profile. */
auth.get("/session", async (c) => {
  const household = await c.env.DB.prepare("SELECT id, name FROM household LIMIT 1").first<{
    id: string;
    name: string;
  }>();

  if (!household) return c.json({ needsSetup: true, authenticated: false });

  const members = await c.env.DB.prepare(
    "SELECT id, name, accent_color FROM member WHERE household_id = ? ORDER BY created_at",
  )
    .bind(household.id)
    .all<{ id: string; name: string; accent_color: string }>();

  const memberList = members.results.map((m: { id: string; name: string; accent_color: string }) => ({
    id: m.id,
    name: m.name,
    accentColor: m.accent_color,
  }));

  const session = c.get("session");
  if (!session) {
    return c.json({
      needsSetup: false,
      authenticated: false,
      householdName: household.name,
      members: memberList,
    });
  }

  return c.json({
    needsSetup: false,
    authenticated: true,
    householdName: household.name,
    householdId: household.id,
    memberId: session.memberId,
    members: memberList,
  });
});

/** First-run only. Creates the household, its members, and default categories. */
auth.post("/setup", async (c) => {
  const existing = await c.env.DB.prepare("SELECT id FROM household LIMIT 1").first();
  if (existing) {
    return c.json({ error: "already_setup", message: "This household already exists." }, 409);
  }

  const body = await c.req.json<{
    householdName?: string;
    passcode?: string;
    memberNames?: string[];
  }>();

  const householdName = body.householdName?.trim() || "Home";
  const passcode = body.passcode ?? "";
  const memberNames = (body.memberNames ?? []).map((n) => n.trim()).filter(Boolean);

  if (passcode.length < 4) {
    return c.json(
      { error: "weak_passcode", message: "Passcode must be at least 4 characters." },
      400,
    );
  }
  if (memberNames.length < 1) {
    return c.json({ error: "no_members", message: "Add at least one person." }, 400);
  }

  const now = nowSeconds();
  const householdId = crypto.randomUUID();

  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare("INSERT INTO household (id, name, passcode_hash, created_at) VALUES (?,?,?,?)")
      .bind(householdId, householdName, await hashPasscode(passcode), now),
    c.env.DB.prepare("INSERT INTO household_settings (household_id) VALUES (?)").bind(householdId),
  ];

  const accents = ["#6366f1", "#ec4899", "#14b8a6", "#f59e0b"];
  for (const [i, name] of memberNames.entries()) {
    const memberId = crypto.randomUUID();
    statements.push(
      c.env.DB.prepare(
        "INSERT INTO member (id, household_id, name, accent_color, created_at) VALUES (?,?,?,?,?)",
      ).bind(memberId, householdId, name, accents[i % accents.length]!, now),
      c.env.DB.prepare("INSERT INTO member_settings (member_id) VALUES (?)").bind(memberId),
    );
  }

  for (const [i, [name, color]] of DEFAULT_CATEGORIES.entries()) {
    statements.push(
      c.env.DB.prepare(
        "INSERT INTO category (id, household_id, name, color, sort_order) VALUES (?,?,?,?,?)",
      ).bind(crypto.randomUUID(), householdId, name, color, i),
    );
  }

  await c.env.DB.batch(statements);

  return c.json({ ok: true, householdId }, 201);
});

/** Exchanges the household passcode for a session cookie (no member yet). */
auth.post("/login", async (c) => {
  const { passcode } = await c.req.json<{ passcode?: string }>();

  const household = await c.env.DB.prepare(
    "SELECT id, passcode_hash FROM household LIMIT 1",
  ).first<{ id: string; passcode_hash: string }>();

  if (!household) {
    return c.json({ error: "needs_setup", message: "No household exists yet." }, 404);
  }

  // PBKDF2 at 210k iterations is itself the brute-force brake here: each guess
  // costs ~100ms of Worker CPU, and only two people ever need to log in.
  if (!passcode || !(await verifyPasscode(passcode, household.passcode_hash))) {
    return c.json({ error: "bad_passcode", message: "That passcode isn't right." }, 401);
  }

  const token = await signSession(
    { householdId: household.id, memberId: null, exp: sessionExpiry() },
    c.env.SESSION_SECRET,
  );
  c.header("Set-Cookie", buildSessionCookie(token, isSecureRequest(c.req.raw)));

  return c.json({ ok: true });
});

/** Records which member is holding this device. Re-signs the cookie. */
auth.post("/profile", requireSession, async (c) => {
  const session = c.get("session");
  const { memberId } = await c.req.json<{ memberId?: string }>();

  const member = await c.env.DB.prepare("SELECT id FROM member WHERE id = ? AND household_id = ?")
    .bind(memberId ?? "", session.householdId)
    .first();

  if (!member) {
    return c.json({ error: "unknown_member", message: "That person isn't in this household." }, 404);
  }

  const token = await signSession(
    { householdId: session.householdId, memberId: memberId!, exp: sessionExpiry() },
    c.env.SESSION_SECRET,
  );
  c.header("Set-Cookie", buildSessionCookie(token, isSecureRequest(c.req.raw)));

  return c.json({ ok: true });
});

auth.post("/logout", (c) => {
  c.header("Set-Cookie", clearSessionCookie(isSecureRequest(c.req.raw)));
  return c.json({ ok: true });
});

export default auth;
