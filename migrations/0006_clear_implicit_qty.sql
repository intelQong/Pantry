-- Clear the quantities nobody asked for.
--
-- Typing a name into the shop list's quick-add box used to send qty = 1 with
-- the entry, while the other two add paths (picking a pantry suggestion, and
-- adding from Today) sent nothing and left it NULL. So the same field rendered
-- a solid, committed "1" or an empty box purely according to how the item got
-- onto the list.
--
-- Safe because NULL and 1 are already the same thing at buy time: Shop Mode
-- reads `item.qty ?? 1` both when it builds the row and when it parses what was
-- typed over it (src/client/screens/ShopModeScreen.tsx). Nulling these changes
-- what the box displays, not what gets purchased.
--
-- Scoped to pending rows: resolved entries are history, and the qty on them is
-- what was actually bought.
UPDATE list_entry
   SET qty = NULL
 WHERE status = 'pending'
   AND qty = 1;
