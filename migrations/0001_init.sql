-- Pantry initial schema.
--
-- Conventions used throughout:
--   * ids are TEXT uuids generated in the Worker (crypto.randomUUID)
--   * timestamps are INTEGER unix epoch *seconds* -- day math is then just
--     (b - a) / 86400, which the restock engine leans on heavily
--   * booleans are INTEGER 0/1
--   * money is INTEGER minor units (poisha/cents), never a float

CREATE TABLE household (
  id            TEXT PRIMARY KEY,
  name          TEXT    NOT NULL,
  passcode_hash TEXT    NOT NULL, -- pbkdf2$<iters>$<salt_b64>$<hash_b64>
  created_at    INTEGER NOT NULL
);

CREATE TABLE member (
  id           TEXT PRIMARY KEY,
  household_id TEXT    NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  name         TEXT    NOT NULL,
  accent_color TEXT    NOT NULL DEFAULT '#6366f1',
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_member_household ON member(household_id);

CREATE TABLE category (
  id           TEXT PRIMARY KEY,
  household_id TEXT    NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  name         TEXT    NOT NULL,
  color        TEXT    NOT NULL DEFAULT '#94a3b8',
  -- sort_order doubles as aisle order: the sequence you actually walk the shop in
  sort_order   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_category_household ON category(household_id, sort_order);

CREATE TABLE item (
  id           TEXT PRIMARY KEY,
  household_id TEXT    NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  name         TEXT    NOT NULL,
  category_id  TEXT             REFERENCES category(id) ON DELETE SET NULL,
  unit         TEXT    NOT NULL DEFAULT 'pcs',
  default_qty  REAL    NOT NULL DEFAULT 1,
  brand        TEXT,
  notes        TEXT,

  -- is_staple=1 means "watch this and remind us". One-off buys are 0 and are
  -- never considered by the restock engine.
  is_staple             INTEGER NOT NULL DEFAULT 1,
  restock_interval_days INTEGER NOT NULL DEFAULT 7,
  -- interval_locked=1 pins the interval to the user's number and opts the item
  -- out of median auto-learning entirely.
  interval_locked       INTEGER NOT NULL DEFAULT 0,

  -- Denormalised from the newest purchase row so the hourly cron can find due
  -- items with one indexed scan instead of a per-item aggregate.
  last_purchased_at INTEGER,

  archived   INTEGER NOT NULL DEFAULT 0,
  created_by TEXT             REFERENCES member(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_item_household ON item(household_id, archived);
CREATE INDEX idx_item_due ON item(household_id, is_staple, archived, last_purchased_at);
CREATE UNIQUE INDEX idx_item_unique_name ON item(household_id, name) WHERE archived = 0;

CREATE TABLE purchase (
  id           TEXT PRIMARY KEY,
  household_id TEXT    NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  item_id      TEXT    NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  purchased_at INTEGER NOT NULL,
  qty          REAL    NOT NULL DEFAULT 1,
  unit         TEXT    NOT NULL DEFAULT 'pcs',
  -- Price is always optional: NULL means "we bought it but didn't log a price".
  -- Stored in minor currency units.
  price_total  INTEGER,
  bought_by    TEXT             REFERENCES member(id) ON DELETE SET NULL,
  note         TEXT
);
CREATE INDEX idx_purchase_item ON purchase(item_id, purchased_at DESC);
CREATE INDEX idx_purchase_household_time ON purchase(household_id, purchased_at DESC);

-- The shared "what to buy on the next shop visit" list.
CREATE TABLE list_entry (
  id           TEXT PRIMARY KEY,
  household_id TEXT    NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  -- Exactly one of item_id / custom_name is set: either it's a known pantry
  -- item, or it's free text someone typed ("birthday candles").
  item_id      TEXT             REFERENCES item(id) ON DELETE CASCADE,
  custom_name  TEXT,
  qty          REAL,
  note         TEXT,
  added_by     TEXT             REFERENCES member(id) ON DELETE SET NULL,
  added_at     INTEGER NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'bought', 'skipped')),
  resolved_at  INTEGER,
  CHECK ((item_id IS NOT NULL) <> (custom_name IS NOT NULL))
);
CREATE INDEX idx_list_pending ON list_entry(household_id, status, added_at);
-- An item can only sit on the pending list once; re-adding bumps the existing row.
CREATE UNIQUE INDEX idx_list_unique_pending_item
  ON list_entry(household_id, item_id) WHERE status = 'pending' AND item_id IS NOT NULL;

CREATE TABLE push_subscription (
  id            TEXT PRIMARY KEY,
  member_id     TEXT    NOT NULL REFERENCES member(id) ON DELETE CASCADE,
  endpoint      TEXT    NOT NULL UNIQUE,
  p256dh        TEXT    NOT NULL,
  auth          TEXT    NOT NULL,
  user_agent    TEXT,
  created_at    INTEGER NOT NULL,
  last_ok_at    INTEGER,
  -- Bumped on send failure; a subscription is pruned once the push service
  -- returns 404/410 (browser uninstalled the PWA, common on iOS).
  failure_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_push_member ON push_subscription(member_id);

CREATE TABLE member_settings (
  member_id             TEXT PRIMARY KEY REFERENCES member(id) ON DELETE CASCADE,
  -- Comma-separated ISO weekday numbers, 1=Mon..7=Sun. '1,2,3,4,5,6,7' = daily.
  notify_days           TEXT    NOT NULL DEFAULT '6',
  notify_hour           INTEGER NOT NULL DEFAULT 9,
  timezone              TEXT    NOT NULL DEFAULT 'Asia/Dhaka',
  -- How many days *before* an item comes due it starts showing as due_soon.
  lead_days             INTEGER NOT NULL DEFAULT 2,
  quiet_start           INTEGER NOT NULL DEFAULT 22,
  quiet_end             INTEGER NOT NULL DEFAULT 7,
  notify_on_partner_add INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE household_settings (
  household_id TEXT PRIMARY KEY REFERENCES household(id) ON DELETE CASCADE,
  currency     TEXT NOT NULL DEFAULT 'BDT',
  theme        TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('system','light','dark')),
  accent       TEXT NOT NULL DEFAULT 'indigo',
  density      TEXT NOT NULL DEFAULT 'comfortable' CHECK (density IN ('comfortable','compact'))
);

-- Guards against double-sending the same digest when a cron run is retried or
-- the Worker is redeployed mid-hour. One row per member per local day per kind.
CREATE TABLE notification_log (
  id         TEXT PRIMARY KEY,
  member_id  TEXT    NOT NULL REFERENCES member(id) ON DELETE CASCADE,
  kind       TEXT    NOT NULL,
  local_date TEXT    NOT NULL, -- 'YYYY-MM-DD' in the member's own timezone
  sent_at    INTEGER NOT NULL,
  item_count INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX idx_notification_dedupe
  ON notification_log(member_id, kind, local_date);
