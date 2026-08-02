-- Gas, electricity and wifi are bought irregularly, cost real money, and hurt
-- when they lapse. They are structurally identical to a staple -- an infrequent
-- purchase with a learned interval and a price -- so they are modelled as
-- ordinary items rather than as a parallel system.
--
-- Existing households are backfilled here; new ones get the category from
-- DEFAULT_CATEGORIES in src/worker/routes/auth.ts.

INSERT INTO category (id, household_id, name, color, sort_order)
SELECT lower(hex(randomblob(16))), h.id, 'Utilities', '#0ea5e9', 8
FROM household h
WHERE NOT EXISTS (
  SELECT 1 FROM category c WHERE c.household_id = h.id AND c.name = 'Utilities'
);

-- interval_locked is 1 for wifi only: a wifi bill is a fixed 30-day billing
-- cycle, so paying four days late must not teach the median-gap learner that
-- the cycle is 34 days. Gas and electricity run on real consumption and learn.
INSERT INTO item (
  id, household_id, name, category_id, unit, default_qty,
  is_staple, restock_interval_days, interval_locked, archived, created_at
)
SELECT
  lower(hex(randomblob(16))), c.household_id, seed.name, c.id, seed.unit, 1,
  1, 30, seed.locked, 0, unixepoch()
FROM category c
JOIN (
  SELECT 'Gas Cylinder' AS name, 'cylinder' AS unit, 0 AS locked
  UNION ALL SELECT 'Electricity Recharge', 'recharge', 0
  UNION ALL SELECT 'Wifi Bill', 'month', 1
) seed
WHERE c.name = 'Utilities'
  AND NOT EXISTS (
    SELECT 1 FROM item i
    WHERE i.household_id = c.household_id AND i.name = seed.name
  );
