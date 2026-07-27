-- Members created before the palette moved to Claude's clay still carry the
-- original indigo/pink accents, which now clash with everything around them.
-- Reassign by insertion order from the same warm set setup uses.
UPDATE member SET accent_color = '#d97757'
 WHERE rowid = (SELECT m.rowid FROM member m WHERE m.household_id = member.household_id ORDER BY m.rowid LIMIT 1);

UPDATE member SET accent_color = '#3f9e8c'
 WHERE rowid = (SELECT m.rowid FROM member m WHERE m.household_id = member.household_id ORDER BY m.rowid LIMIT 1 OFFSET 1);
