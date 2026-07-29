-- An id the *client* generates for a list entry, so adding to the list can be
-- retried safely.
--
-- Buying is already replay-safe: every write in POST /list/:id/bought is guarded
-- by the entry still being 'pending' and the status flip is ordered last, so a
-- retry no-ops. Adding had no such property -- a queued offline add whose
-- response was lost in flight would insert a second row on retry, and free text
-- ("birthday candles") has no unique name index to fall back on.
--
-- With this, the client stamps each queued add with a uuid and POST /list
-- returns the existing row instead of inserting when it has seen that id before.
--
-- Nullable, because entries added while online never need one, and the index is
-- partial so those NULLs don't collide with each other.
ALTER TABLE list_entry ADD COLUMN client_id TEXT;

CREATE UNIQUE INDEX idx_list_client_id
  ON list_entry(household_id, client_id) WHERE client_id IS NOT NULL;
