-- A gas cylinder runs until it runs out. It has no due date, so it must never
-- show as due or overdue, on Today or anywhere else; Bills just shows how long
-- ago it was bought.
--
-- is_staple = 0 is exactly that ("never considered by the restock engine",
-- 0001_init.sql). The API reports a non-staple as status 'ok' with no due date,
-- and the hourly digest already skips non-staples.
--
-- Matched on the seeded name inside the Utilities category, so a household's
-- own item that happens to mention gas is left alone.
UPDATE item
   SET is_staple = 0
 WHERE name = 'Gas Cylinder'
   AND category_id IN (SELECT id FROM category WHERE name = 'Utilities');
