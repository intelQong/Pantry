-- Archiving is gone: deleting an item now removes the row.
--
-- That leaves two problems in existing data. Archived rows were invisible but
-- still occupied a name, and the unique index on name is partial
-- (WHERE archived = 0), so re-adding an archived item created a second row with
-- the same name. Households therefore hold duplicate pairs, with purchases
-- split across both -- and now that queries no longer filter on archived, both
-- rows would surface.
--
-- Merge each set of same-named rows onto the oldest one, keeping every
-- purchase, then delete the emptied duplicates.

-- 1. Point every purchase at the surviving row for its item's name.
UPDATE purchase
   SET item_id = (
     SELECT s.id FROM item s
      WHERE s.household_id = purchase.household_id
        AND s.name = (SELECT n.name FROM item n WHERE n.id = purchase.item_id)
      ORDER BY s.rowid
      LIMIT 1
   )
 WHERE item_id IS NOT NULL;

-- 2. Same for list entries, which would otherwise point at a row about to go.
UPDATE list_entry
   SET item_id = (
     SELECT s.id FROM item s
      WHERE s.household_id = list_entry.household_id
        AND s.name = (SELECT n.name FROM item n WHERE n.id = list_entry.item_id)
      ORDER BY s.rowid
      LIMIT 1
   )
 WHERE item_id IS NOT NULL;

-- 3. Drop the duplicates, which now hold nothing.
DELETE FROM item
 WHERE rowid NOT IN (SELECT MIN(rowid) FROM item GROUP BY household_id, name);

-- 4. Nothing is archived any more.
UPDATE item SET archived = 0;

-- 5. Re-derive the restock clock from the merged history. Survivors inherited
--    purchases from their duplicate, so the denormalised stamp is now stale --
--    and the engine reads it to decide what is due.
UPDATE item
   SET last_purchased_at = (
     SELECT MAX(p.purchased_at) FROM purchase p WHERE p.item_id = item.id
   );
