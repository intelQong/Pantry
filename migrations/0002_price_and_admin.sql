-- Adds a per-item expected price, and promotes one member to superadmin.

-- What this item usually costs, in minor currency units (poisha), matching the
-- convention `purchase.price_total` already uses. Nullable: most items never get
-- a price, and a missing price is meaningful ("we've never recorded one"),
-- distinct from zero.
ALTER TABLE item ADD COLUMN default_price INTEGER;

-- The superadmin's profile is passcode-protected on top of the household
-- passcode, so getting into the house does not mean getting into their profile.
ALTER TABLE member ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;

-- Same pbkdf2$iters$salt$hash format as household.passcode_hash. NULL means the
-- profile has no second gate yet, in which case switching to it is unrestricted.
ALTER TABLE member ADD COLUMN admin_passcode_hash TEXT;
