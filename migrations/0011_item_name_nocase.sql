-- Item names become unique regardless of case.
--
-- Everything that turns typed text into an item -- the shop list's merge,
-- buying a free-text entry, logging a spend -- already treats "Rice" and
-- "rice" as one thing. The index did not: idx_item_unique_name compared names
-- exactly, so the pantry could still hold both, each with half the purchase
-- history and its own learned interval. This makes the database agree with
-- the app, the same move 0009 made for free-text list entries.
--
-- Same shape as 0005, which merged exact-name duplicates: every set of
-- same-named items folds onto its oldest row, keeping every purchase.

-- 1. A pending list entry for an item about to be merged away would collide
--    with the survivor's own pending entry (idx_list_unique_pending_item).
--    Drop only those; a merged item with nothing pending keeps its entry.
DELETE FROM list_entry
 WHERE status = 'pending'
   AND item_id IN (
     SELECT d.id FROM item d
      WHERE d.rowid <> (SELECT MIN(s.rowid) FROM item s
                         WHERE s.household_id = d.household_id AND LOWER(s.name) = LOWER(d.name))
   )
   AND EXISTS (
     SELECT 1 FROM list_entry keep
       JOIN item s ON s.id = keep.item_id
       JOIN item d ON d.id = list_entry.item_id
      WHERE keep.status = 'pending'
        AND s.household_id = d.household_id
        AND LOWER(s.name) = LOWER(d.name)
        AND s.rowid = (SELECT MIN(f.rowid) FROM item f
                        WHERE f.household_id = s.household_id AND LOWER(f.name) = LOWER(s.name))
   );

-- 2. Repoint purchases and list entries at the surviving row for their name.
UPDATE purchase
   SET item_id = (
     SELECT s.id FROM item s
      WHERE s.household_id = purchase.household_id
        AND LOWER(s.name) = (SELECT LOWER(n.name) FROM item n WHERE n.id = purchase.item_id)
      ORDER BY s.rowid
      LIMIT 1
   );

UPDATE list_entry
   SET item_id = (
     SELECT s.id FROM item s
      WHERE s.household_id = list_entry.household_id
        AND LOWER(s.name) = (SELECT LOWER(n.name) FROM item n WHERE n.id = list_entry.item_id)
      ORDER BY s.rowid
      LIMIT 1
   )
 WHERE item_id IS NOT NULL;

-- 3. Drop the duplicates, which now hold nothing.
DELETE FROM item
 WHERE rowid NOT IN (SELECT MIN(rowid) FROM item GROUP BY household_id, LOWER(name));

-- 4. Survivors may have inherited newer purchases; the restock clock reads this.
UPDATE item
   SET last_purchased_at = COALESCE(
     (SELECT MAX(p.purchased_at) FROM purchase p WHERE p.item_id = item.id),
     last_purchased_at
   );

-- 5. Swap the index. No partial clause: archiving is gone (0005).
DROP INDEX idx_item_unique_name;
CREATE UNIQUE INDEX idx_item_unique_name ON item(household_id, LOWER(name));
