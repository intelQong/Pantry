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
import { requireSession, requireMember } from "../middleware";

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
    `SELECT id, name, accent_color, is_admin, admin_passcode_hash
       FROM member WHERE household_id = ? ORDER BY created_at`,
  )
    .bind(household.id)
    .all<{
      id: string;
      name: string;
      accent_color: string;
      is_admin: number;
      admin_passcode_hash: string | null;
    }>();

  // The hash itself never leaves the Worker -- the client only needs to know
  // whether a second passcode will be demanded, not what it is.
  const memberList = members.results.map((m) => ({
    id: m.id,
    name: m.name,
    accentColor: m.accent_color,
    isAdmin: m.is_admin === 1,
    hasAdminPasscode: m.admin_passcode_hash !== null,
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
    adminPasscode?: string;
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

  // Clay, rose, teal, amber -- drawn from the same warm family as the app's accent.
  const accents = ["#d97757", "#c2557a", "#3f9e8c", "#d19a3e"];

  // The first person named owns the household: they get the superadmin flag, and
  // optionally a second passcode so knowing the household code isn't enough to
  // act as them.
  const adminPasscode = body.adminPasscode?.trim();
  if (adminPasscode && adminPasscode.length < 4) {
    return c.json(
      { error: "weak_admin_passcode", message: "Admin passcode must be at least 4 characters." },
      400,
    );
  }

  for (const [i, name] of memberNames.entries()) {
    const memberId = crypto.randomUUID();
    const isAdmin = i === 0;
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO member (id, household_id, name, accent_color, is_admin, admin_passcode_hash, created_at)
         VALUES (?,?,?,?,?,?,?)`,
      ).bind(
        memberId,
        householdId,
        name,
        accents[i % accents.length]!,
        isAdmin ? 1 : 0,
        isAdmin && adminPasscode ? await hashPasscode(adminPasscode) : null,
        now,
      ),
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

  // PBKDF2 is itself the brute-force brake here: each guess costs real Worker
  // CPU, and only two people ever need to log in. See auth.ts for why the
  // iteration count is pinned to the Workers ceiling rather than OWASP's number.
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
  const { memberId, adminPasscode } = await c.req.json<{
    memberId?: string;
    adminPasscode?: string;
  }>();

  const member = await c.env.DB.prepare(
    "SELECT id, admin_passcode_hash FROM member WHERE id = ? AND household_id = ?",
  )
    .bind(memberId ?? "", session.householdId)
    .first<{ id: string; admin_passcode_hash: string | null }>();

  if (!member) {
    return c.json({ error: "unknown_member", message: "That person isn't in this household." }, 404);
  }

  // A protected profile needs its own passcode on top of the household one.
  // Switching *away* is always free -- only becoming this person is gated.
  if (member.admin_passcode_hash) {
    if (!adminPasscode) {
      return c.json(
        { error: "admin_passcode_required", message: "This profile needs its own passcode." },
        403,
      );
    }
    if (!(await verifyPasscode(adminPasscode, member.admin_passcode_hash))) {
      return c.json({ error: "bad_admin_passcode", message: "That passcode isn't right." }, 403);
    }
  }

  const token = await signSession(
    { householdId: session.householdId, memberId: memberId!, exp: sessionExpiry() },
    c.env.SESSION_SECRET,
  );
  c.header("Set-Cookie", buildSessionCookie(token, isSecureRequest(c.req.raw)));

  return c.json({ ok: true });
});

/**
 * Sets, changes, or clears the passcode guarding the caller's own profile.
 *
 * Deliberately scoped to the caller: you can lock your own profile and nobody
 * else's. Anything broader would let whoever is holding the phone lock the
 * other person out of theirs.
 */
auth.post("/profile/passcode", requireMember, async (c) => {
  const session = c.get("session");
  const { passcode, currentPasscode } = await c.req.json<{
    passcode?: string | null;
    currentPasscode?: string;
  }>();

  const member = await c.env.DB.prepare(
    "SELECT admin_passcode_hash FROM member WHERE id = ? AND household_id = ?",
  )
    .bind(session.memberId, session.householdId)
    .first<{ admin_passcode_hash: string | null }>();

  if (!member) {
    return c.json({ error: "unknown_member", message: "That profile no longer exists." }, 404);
  }

  // Changing or removing an existing passcode requires proving you know it --
  // otherwise an unlocked phone is enough to silently replace the lock.
  if (member.admin_passcode_hash) {
    if (!currentPasscode || !(await verifyPasscode(currentPasscode, member.admin_passcode_hash))) {
      return c.json(
        { error: "bad_current_passcode", message: "Your current passcode isn't right." },
        403,
      );
    }
  }

  const next = passcode?.trim();

  if (!next) {
    await c.env.DB.prepare("UPDATE member SET admin_passcode_hash = NULL WHERE id = ?")
      .bind(session.memberId)
      .run();
    return c.json({ ok: true, hasAdminPasscode: false });
  }

  if (next.length < 4) {
    return c.json(
      { error: "weak_passcode", message: "Passcode must be at least 4 characters." },
      400,
    );
  }

  await c.env.DB.prepare("UPDATE member SET admin_passcode_hash = ? WHERE id = ?")
    .bind(await hashPasscode(next), session.memberId)
    .run();

  return c.json({ ok: true, hasAdminPasscode: true });
});

auth.post("/logout", (c) => {
  c.header("Set-Cookie", clearSessionCookie(isSecureRequest(c.req.raw)));
  return c.json({ ok: true });
});

export default auth;
