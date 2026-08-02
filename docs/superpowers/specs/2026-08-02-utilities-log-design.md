# Utilities log + global UI scale bump

**Status:** approved design, not implemented
**Date:** 2026-08-02
**Branch:** `offline-shop-mode`

---

## Context

Three household purchases live outside the grocery loop today: the LPG gas cylinder,
the prepaid electricity meter recharge, and the wifi bill. All three are paid
irregularly, all three cost real money, and all three hurt when they lapse
unannounced. They are currently tracked nowhere, so there is no answer to "when did
we last pay?" beyond memory.

They are structurally identical to a staple: an infrequent purchase with a learned
interval and a price. The system already models exactly that. So this feature adds a
place to *look* at them, not a new way to store them.

Separately, the UI reads small on a phone held at arm's length in a kitchen. The
whole app gets a type and tap-target bump at the same time, so the new screen and
the old ones stay one design.

---

## Decisions

| Question | Decision |
|---|---|
| Data model | Reuse `item` + `purchase`. No new tables. |
| Fields recorded | Date, amount, quantity/unit, note — all four already exist on `purchase`. |
| Reminders | Reuse the existing restock engine and hourly digest push. No new cron. |
| Placement | Dedicated screen, 6th tab in `BottomNav`. |
| UI scale | Global bump via tokens in `src/client/index.css`, not screen-local. |

---

## Data

`purchase` already carries every field this needs (`migrations/0001_init.sql:66`):
`purchased_at`, `qty`, `unit`, `price_total` (minor units), `note`, `bought_by`.
`item` already carries `unit`, `restock_interval_days`, `interval_locked`,
`last_purchased_at`, `notes`.

**Migration `0008_utilities.sql`:**

1. Insert one `Utilities` category (color `#0ea5e9`, `sort_order` 8) per existing
   household, via `INSERT ... SELECT id FROM household`.
2. Seed three items in that category per household:
   - `Gas Cylinder` — `unit` `cylinder`, `default_qty` 1, `restock_interval_days` 30,
     `interval_locked` 0
   - `Electricity Recharge` — `unit` `recharge`, `default_qty` 1,
     `restock_interval_days` 30, `interval_locked` 0
   - `Wifi Bill` — `unit` `month`, `default_qty` 1, `restock_interval_days` 30,
     **`interval_locked` 1**
   All `is_staple` 1. Gas and electricity run on consumption, so the median-gap
   learner (`src/worker/restock.ts`) refines them from real history. Wifi is a fixed
   monthly billing cycle, not consumption — paying late must not teach the app that
   the cycle is 40 days, so its interval is locked at 30.
3. Add `["Utilities", "#0ea5e9"]` to `DEFAULT_CATEGORIES` in
   `src/worker/routes/auth.ts:15` so new households get it from setup.

Seeded rows are ordinary items: renameable, editable, deletable. The screen resolves
them by category, not by hardcoded id, so a household that adds "Water tank refill"
gets it on the screen for free.

## API

**No new endpoints.** Reused as-is:

- `POST /api/purchases` — logs an entry. Accepts client-supplied `purchasedAt`
  (clamped to the 30-day backdate window, `src/worker/routes/purchases.ts`), `qty`,
  `unit`, `priceTotal`, `note`. Also relearns the interval via `relearnInterval`.
- `GET /api/items/:id/purchases` — history for one utility.
- `GET /api/items` — the item list, filtered client-side by category name.
- `PATCH /api/items/:id` — edit interval/unit/name.

Utility logging is **online-only**. The outbox (`src/client/lib/outbox.ts`) queues
three op kinds — `buy`, `skip`, `add` — all keyed to a list entry; a bare
`POST /purchases` is not among them. Offline shopping exists because shops kill
signal; bills are paid at home. A failed save shows an error and keeps the sheet
open with the values intact, rather than silently dropping the entry. Backdating
covers the "I forgot to log it on the day" case, which is the real one.

## Screen

New route `{ page: "utilities" }` in `src/client/hooks/useRouter.ts`, screen at
`src/client/screens/UtilitiesScreen.tsx`.

**Layout, top to bottom:**

1. One large card per utility item. Each shows: name, status badge
   (`StatusBadge`, driven by the existing `computeStatus`), days since last, next-due
   day count, last amount paid. A full-width primary button, labelled per unit —
   "Log refill" (cylinder), "Log recharge" (recharge), "Log payment" (month).
2. Tapping the button opens a `BottomSheet` (existing component) with: date
   (native `<input type="date">`, defaults today), amount (`PriceInput`, existing),
   quantity + unit, optional note. Save → `POST /purchases`.
3. Below the cards, a combined history list, newest first: date, which utility,
   amount, note. Grouped by month with a per-month spend subtotal.

Money formatting reuses `src/client/lib/money.ts`; category color reuses
`CategoryBadge`.

**Nav:** `BottomNav` goes to six tabs. To keep tap targets legal at that width, the
bar grows from `3.75rem` to `4.25rem`, labels shorten (`Today`, `List`, `Pantry`,
`Bills`, `Stats`, `Settings`), and each tab keeps a minimum 44px touch box even where
the visual label is narrower.

## Global UI scale

In `src/client/index.css`, additive to the existing `@theme` block:

- Root font-size 17px (from the browser default 16), so every `rem` in the app scales
  once instead of being retuned per screen.
- Minimum interactive height 44px (iOS HIG) applied to buttons, list rows, and nav
  tabs.
- List row vertical padding and card padding up one step.
- Screen title stays on the existing 2.25rem display rule (`index.css:380`) — it is
  already large; scaling it again would wrap on a small phone.

No per-screen font sizes are hand-edited. Anything that looks wrong after the bump is
a token that should have been a token.

## Testing

- Existing suite (94 tests) must stay green: `npm test`, `npm run typecheck`.
- One new Worker test: after migrations, every household has a `Utilities` category
  and the three seeded items, `POST /purchases` against a seeded item both writes the
  row and updates `last_purchased_at`, and a late wifi payment leaves
  `restock_interval_days` at 30 (interval lock holds).
- Manual: `npm run dev`, log a backdated gas refill, confirm the card's "days since"
  reflects the chosen date and not today.

## Out of scope

- Meter readings / kWh-remaining math. Amount and units only.
- Per-utility custom push copy — the existing digest wording covers it.
- A user-facing text-size setting. The global bump is a fixed value; revisit if it
  reads wrong on the two real phones.
