-- Free text gets the unique-pending guarantee that known items have had since
-- 0001.
--
-- idx_list_unique_pending_item stops the same item sitting on the list twice,
-- but a custom_name entry has no item_id, so nothing stopped "Rice" and "rice"
-- both landing as pending rows. The app now merges them in POST /list, and the
-- shop list screen absorbs a repeat add before it is even queued -- but both of
-- those are checks, and a check can be missed by a path nobody thought about,
-- by two phones adding at the same moment, or by a future caller. This is the
-- one place the rule cannot be bypassed.
--
-- LOWER() because the whole point is that case does not make two things
-- different. It is ASCII-only in SQLite, which is correct for a list typed in
-- English.

-- Any duplicates that already exist have to go before the index can be built.
-- The oldest row of each set survives, carrying the summed quantity, because
-- two people adding "Rice" separately meant two lots of rice. A NULL qty counts
-- as one -- that is what a blank quantity box means everywhere else.
UPDATE list_entry AS keep
   SET qty = (
     SELECT SUM(COALESCE(dup.qty, 1))
       FROM list_entry dup
      WHERE dup.household_id = keep.household_id
        AND dup.status = 'pending'
        AND dup.custom_name IS NOT NULL
        AND LOWER(dup.custom_name) = LOWER(keep.custom_name)
   )
 WHERE keep.status = 'pending'
   AND keep.custom_name IS NOT NULL
   AND keep.rowid = (
     SELECT MIN(first.rowid)
       FROM list_entry first
      WHERE first.household_id = keep.household_id
        AND first.status = 'pending'
        AND first.custom_name IS NOT NULL
        AND LOWER(first.custom_name) = LOWER(keep.custom_name)
   )
   -- Only where there is actually something to merge, so a list with no
   -- duplicates comes through this migration completely untouched.
   AND EXISTS (
     SELECT 1
       FROM list_entry other
      WHERE other.household_id = keep.household_id
        AND other.status = 'pending'
        AND other.custom_name IS NOT NULL
        AND LOWER(other.custom_name) = LOWER(keep.custom_name)
        AND other.rowid <> keep.rowid
   );

DELETE FROM list_entry
 WHERE status = 'pending'
   AND custom_name IS NOT NULL
   AND rowid <> (
     SELECT MIN(first.rowid)
       FROM list_entry first
      WHERE first.household_id = list_entry.household_id
        AND first.status = 'pending'
        AND first.custom_name IS NOT NULL
        AND LOWER(first.custom_name) = LOWER(list_entry.custom_name)
   );

CREATE UNIQUE INDEX idx_list_unique_pending_name
  ON list_entry(household_id, LOWER(custom_name))
  WHERE status = 'pending' AND custom_name IS NOT NULL;
