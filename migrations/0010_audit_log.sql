-- Migration 0010: Immutable System Audit Log
--
-- Records record deletions and household actions.
-- Undeletable: no foreign key cascade on entity_id so logs outlive the deleted records,
-- and no DELETE or UPDATE routes are exposed in the API.

CREATE TABLE audit_log (
  id           TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  member_id    TEXT REFERENCES member(id) ON DELETE SET NULL,
  member_name  TEXT NOT NULL,
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  summary      TEXT NOT NULL,
  details      TEXT,
  created_at   INTEGER NOT NULL
);

CREATE INDEX idx_audit_log_household ON audit_log(household_id, created_at DESC);
