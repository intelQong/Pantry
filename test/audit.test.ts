import { describe, it, expect, beforeAll } from "vitest";
import { SELF, env } from "cloudflare:test";
import type { AuditLogEntry } from "../src/shared/types";

const json = (path: string, body: unknown, cookie?: string, method = "POST") =>
  SELF.fetch(`https://pantry.test${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });

const get = (path: string, cookie?: string) =>
  SELF.fetch(`https://pantry.test${path}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });

const del = (path: string, cookie?: string) =>
  SELF.fetch(`https://pantry.test${path}`, {
    method: "DELETE",
    headers: cookie ? { Cookie: cookie } : {},
  });

const cookieFrom = (res: Response): string => {
  const header = res.headers.get("Set-Cookie") ?? "";
  return header.split(";")[0] ?? "";
};

let memberCookie: string;
let memberName: string;

beforeAll(async () => {
  await json("/api/setup", {
    householdName: "Audit Test Household",
    passcode: "auditpass123",
    memberNames: ["Alice", "Bob"],
  });

  const login = await json("/api/login", { passcode: "auditpass123" });
  const sessionCookie = cookieFrom(login);

  const session = await get("/api/session", sessionCookie);
  const { members } = await session.json<{ members: Array<{ id: string; name: string }> }>();
  memberName = members[0]!.name;

  const profile = await json("/api/profile", { memberId: members[0]!.id }, sessionCookie);
  memberCookie = cookieFrom(profile);
});

describe("audit log", () => {
  it("requires session to access audit log", async () => {
    const res = await get("/api/audit-log");
    expect(res.status).toBe(401);
  });

  it("records purchase deletion in audit log and deletes the purchase", async () => {
    // 1. Create an item
    const itemRes = await json("/api/items", { name: "Audit Milk", defaultPrice: 15000 }, memberCookie);
    expect(itemRes.status).toBe(201);
    const item = await itemRes.json<{ id: string }>();

    // 2. Add to list
    const listRes = await json("/api/list", { itemId: item.id }, memberCookie);
    expect(listRes.status).toBe(201);
    const entry = await listRes.json<{ id: string }>();

    // 3. Mark bought to create a purchase
    const boughtRes = await json(`/api/list/${entry.id}/bought`, { priceTotal: 15000 }, memberCookie);
    expect(boughtRes.status).toBe(200);
    const bought = await boughtRes.json<{ purchaseId: string }>();
    expect(bought.purchaseId).toBeTruthy();

    // 4. Delete the purchase
    const delRes = await del(`/api/purchases/${bought.purchaseId}`, memberCookie);
    expect(delRes.status).toBe(200);
    const delBody = await delRes.json<{ ok: boolean }>();
    expect(delBody.ok).toBe(true);

    // 5. Query audit log
    const logRes = await get("/api/audit-log", memberCookie);
    expect(logRes.status).toBe(200);
    const logs = await logRes.json<AuditLogEntry[]>();

    const auditEntry = logs.find((l) => l.action === "delete_purchase" && l.entityId === bought.purchaseId);
    expect(auditEntry).toBeDefined();
    expect(auditEntry!.entityType).toBe("purchase");
    expect(auditEntry!.memberName).toBe(memberName);
    expect(auditEntry!.summary).toContain("Audit Milk");
    expect(auditEntry!.summary).toContain("150");

    const details = JSON.parse(auditEntry!.details!);
    expect(details.id).toBe(bought.purchaseId);
    expect(details.itemName).toBe("Audit Milk");
    expect(details.priceTotal).toBe(15000);
  });

  it("records item deletion in audit log", async () => {
    const itemRes = await json("/api/items", { name: "Temporary Item", defaultQty: 2 }, memberCookie);
    expect(itemRes.status).toBe(201);
    const item = await itemRes.json<{ id: string; name: string }>();

    const delRes = await del(`/api/items/${item.id}`, memberCookie);
    expect(delRes.status).toBe(200);

    const logRes = await get("/api/audit-log", memberCookie);
    const logs = await logRes.json<AuditLogEntry[]>();

    const auditEntry = logs.find((l) => l.action === "delete_item" && l.entityId === item.id);
    expect(auditEntry).toBeDefined();
    expect(auditEntry!.entityType).toBe("item");
    expect(auditEntry!.memberName).toBe(memberName);
    expect(auditEntry!.summary).toContain("Temporary Item");

    const details = JSON.parse(auditEntry!.details!);
    expect(details.name).toBe("Temporary Item");
    expect(details.default_qty).toBe(2);
  });

  it("records shopping list entry deletion in audit log", async () => {
    const addRes = await json("/api/list", { customName: "Rare Spices" }, memberCookie);
    expect(addRes.status).toBe(201);
    const entry = await addRes.json<{ id: string }>();

    const delRes = await del(`/api/list/${entry.id}`, memberCookie);
    expect(delRes.status).toBe(200);

    const logRes = await get("/api/audit-log", memberCookie);
    const logs = await logRes.json<AuditLogEntry[]>();

    const auditEntry = logs.find((l) => l.action === "delete_list_entry" && l.entityId === entry.id);
    expect(auditEntry).toBeDefined();
    expect(auditEntry!.entityType).toBe("list_entry");
    expect(auditEntry!.summary).toContain("Rare Spices");
  });

  it("is strictly undeletable via the API", async () => {
    // Attempting to DELETE /api/audit-log must be rejected with 404
    const delAll = await del("/api/audit-log", memberCookie);
    expect(delAll.status).toBe(404);

    // Attempting to DELETE /api/audit-log/:id must be rejected with 404
    const delOne = await del("/api/audit-log/any-id", memberCookie);
    expect(delOne.status).toBe(404);

    // Attempting to POST /api/audit-log must be rejected with 404
    const postRes = await json("/api/audit-log", { test: true }, memberCookie);
    expect(postRes.status).toBe(404);
  });

  it("enforces cross-household isolation on audit logs", async () => {
    // Directly insert an audit log entry for another household into DB
    const otherHouseholdId = crypto.randomUUID();
    const otherAuditId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO household (id, name, passcode_hash, created_at) VALUES (?,?,?,?)",
      ).bind(otherHouseholdId, "Household B", "pbkdf2$1$AA$AA", now),
      env.DB.prepare(
        `INSERT INTO audit_log (id, household_id, member_id, member_name, action, entity_type, entity_id, summary, details, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        otherAuditId,
        otherHouseholdId,
        null,
        "Intruder",
        "delete_item",
        "item",
        "item-b",
        "Household B Secret Deletion",
        null,
        now,
      ),
    ]);

    // Household A reads its audit log: must not see Household B's entry
    const logRes = await get("/api/audit-log", memberCookie);
    expect(logRes.status).toBe(200);
    const logs = await logRes.json<AuditLogEntry[]>();

    expect(logs.find((l) => l.id === otherAuditId)).toBeUndefined();
    expect(logs.find((l) => l.summary.includes("Household B Secret Deletion"))).toBeUndefined();
  });
});
