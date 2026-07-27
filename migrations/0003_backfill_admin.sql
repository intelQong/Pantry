-- 0002 only flagged the owner for households created *after* it ran, so any
-- household set up before then has no owner at all. Backfill the flag for the
-- first person named at setup.
--
-- Ordered by rowid rather than created_at: setup inserts every member inside a
-- single batch, so they all share a timestamp and created_at cannot break the
-- tie. rowid preserves insertion order, which is the order the names were typed.
UPDATE member
SET is_admin = 1
WHERE id IN (
  SELECT (
    SELECT m.id FROM member m
     WHERE m.household_id = h.id
     ORDER BY m.rowid
     LIMIT 1
  )
  FROM household h
);
