import { Hono } from "hono";
import type { AppEnv } from "../env";
import { requireSession } from "../middleware";
import type { AuditLogEntry } from "../../shared/types";

const audit = new Hono<AppEnv>();

interface AuditLogRow {
  id: string;
  household_id: string;
  member_id: string | null;
  member_name: string;
  action: string;
  entity_type: string;
  entity_id: string;
  summary: string;
  details: string | null;
  created_at: number;
}

function toAuditLogEntry(row: AuditLogRow): AuditLogEntry {
  return {
    id: row.id,
    householdId: row.household_id,
    memberId: row.member_id,
    memberName: row.member_name,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    summary: row.summary,
    details: row.details,
    createdAt: row.created_at,
  };
}

/**
 * Read-only system audit log, newest first.
 * Strictly immutable: there is deliberately NO delete or update route.
 */
audit.get("/audit-log", requireSession, async (c) => {
  const session = c.get("session");
  const limitParam = Number(c.req.query("limit")) || 100;
  const limit = Math.min(Math.max(limitParam, 1), 200);

  const rows = await c.env.DB.prepare(
    `SELECT id, household_id, member_id, member_name, action, entity_type, entity_id, summary, details, created_at
       FROM audit_log
      WHERE household_id = ?
      ORDER BY created_at DESC, rowid DESC
      LIMIT ?`,
  )
    .bind(session.householdId, limit)
    .all<AuditLogRow>();

  return c.json(rows.results.map(toAuditLogEntry));
});

export default audit;
