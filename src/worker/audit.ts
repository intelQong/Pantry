import type { SessionPayload } from "./auth";
import { nowSeconds } from "./env";

/**
 * The audit_log insert for a delete, to run in the same batch as the DELETE so
 * the record and the removal land together or not at all.
 *
 * One builder for every audited route, so they cannot drift on who gets
 * credited. Routes calling this sit behind requireMember: an audit row
 * crediting "someone" is not attribution.
 */
export async function auditStatement(
  db: D1Database,
  session: SessionPayload,
  entry: { action: string; entityType: string; entityId: string; summary: string; details: unknown },
): Promise<D1PreparedStatement> {
  const member = await db
    .prepare("SELECT name FROM member WHERE id = ? AND household_id = ?")
    .bind(session.memberId, session.householdId)
    .first<{ name: string }>();

  return db
    .prepare(
      `INSERT INTO audit_log (id, household_id, member_id, member_name, action, entity_type, entity_id, summary, details, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      crypto.randomUUID(),
      session.householdId,
      session.memberId,
      // member_name is stored so the log still reads after the member is gone.
      member?.name ?? "Unknown member",
      entry.action,
      entry.entityType,
      entry.entityId,
      entry.summary,
      JSON.stringify(entry.details),
      nowSeconds(),
    );
}
