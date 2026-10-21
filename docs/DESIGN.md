# Pantry — design and decisions

## Problem

A two-person household keeps forgetting to restock weekly grocery staples. There is no
system telling them what is running low, no record of how fast things get consumed, and
no shared place to collect "buy this next time" items between shop visits.

Constraints from the user: one iPhone, one Android, **no native apps**, must actively
notify rather than wait to be opened, must track consumption, optional per-item price
recording, and customizable throughout.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Notifications | **Web Push only** | User chose it over Telegram/email. Both phones install the PWA to the Home Screen once — required on iOS 16.4+. |
| Restock logic | **Interval + auto-learn** | Seeded by a rough guess, corrected from real purchase history. Gets better the longer it's used, with no maintenance. |
| Hosting | **Cloudflare Workers + D1** | Free tier covers two users many times over, HTTPS out of the box (push needs it), Cron Triggers for the sweep, no server to maintain. |
| Sign-in | **Shared household passcode + profile pick** | Magic-link was the user's first choice, but Cloudflare (and every other sender) requires an owned domain to send email. User has no domain, so they chose the passcode. |
| Customization | All four areas | Per-item settings, per-person notification rules, custom categories/aisle order, theme & appearance. |
| Currency | `BDT` default, changeable | Stored as integer minor units (poisha). |

### Rejected

- **Firebase/FCM** — the send side still requires signing an RS256 service-account JWT
  in the Worker, so it removes no crypto while adding ~100KB of SDK and a Google
  dependency the "Web Push only" decision was meant to avoid.
- **Magic-link email** — blocked on not owning a domain.
- **Durable Objects / real-time sync** — two people do not need it; refetch-on-focus is
  enough.
- Barcode scanning, receipt OCR, price comparison, meal planning, multi-household,
  offline write queueing. All out of scope.

## The core loop

Ticking an item off the shop list is the only data entry:

```
tick in Shop Mode
  → purchase row written (qty, optional price, who bought it)
  → item.last_purchased_at updated
  → restock interval relearned from history
  → status recomputed → next push scheduled
  → spend + consumption stats read the same purchase rows
```

There is no separate consumption-logging step, because that is a chore people abandon.

## Money: one grocery bill a month, bills kept apart

Everything that isn't a utility is groceries, including spend logged without a name
("General expense"). A month's groceries form one bill that is settled the following
month, like a credit-card statement: October's shopping is paid in November. That
bill is the number the household plans around.

Utilities (gas, electricity, wifi) are paid up front, when they are bought. Adding
them in would overstate the bill, so they are kept out of every spend figure: Stats,
History and the grocery bill. They appear only on the Bills screen, beside the grocery
bill and never inside it. The split is made in one place on each side: `NOT_A_BILL`
in `src/worker/routes/insights.ts`, and `groupMonthlyBills` in
`src/client/lib/utilities.ts`.

## The restock engine (`src/worker/restock.ts`)

**Status**, where `daysSince = floor((now - reference) / 86400)`:

- `overdue` — `daysSince >= interval * 1.5`
- `due` — `daysSince >= interval`
- `due_soon` — `daysSince >= interval - leadDays`
- `ok` — otherwise

`reference = last_purchased_at ?? created_at`. **The `created_at` fallback is
deliberate**: without it, a freshly set-up pantry shows every staple as due on day one,
which teaches the user to ignore the notification on the very first day.

**Learning.** After each purchase, take the **median** gap between consecutive
purchases (needs ≥3 purchases), round, clamp to `[1, 365]`, and adopt it **only if it
differs from the current interval by more than 20%**.

- *Median, not mean* — one bulk buy before guests, or one skipped trip during a holiday,
  produces a single wild gap. A mean chases it; the median shrugs it off.
- *The 20% guard* — a household's real rhythm is noisy. Without the guard the interval
  churns by a day or two after almost every shop, making it meaningless as a signal.
- *`interval_locked`* — the per-item escape hatch. The engine must never overwrite it.

**Notification sweep** (`src/worker/cron.ts`) runs hourly, but each member is notified
at most once per local day: only at their `notify_hour`, only on their `notify_days`,
never during quiet hours, deduped via `notification_log` on `(member, kind, local_date)`.

Local time comes from `Intl.DateTimeFormat` + `formatToParts`, never manual UTC-offset
arithmetic, which breaks twice a year on DST.

The digest excludes anything already on the pending list — nagging about something
already handled is how you train someone to ignore notifications.

## Screens (not built yet)

- **Today** — what's due, grouped by urgency; one tap adds to the shop list.
- **Shop list** — the shared next-visit list; either person adds.
- **Shop Mode** — the store view: big tap targets, aisle order, screen kept awake,
  running total. The frontend's showcase piece.
- **Pantry** — all items, editable.
- **Insights** — consumption rhythm, monthly spend, spend by category, price trend.
- **Settings** — profile, notification rules, categories/aisle order, appearance.

Load the `frontend-design` skill before building UI, and `dataviz` before charts.

## Data model

See `migrations/0001_init.sql` — it is authoritative and commented. Tables:
`household`, `member`, `category`, `item`, `purchase`, `list_entry`,
`push_subscription`, `member_settings`, `household_settings`, `notification_log`.

Notable: `item.last_purchased_at` is denormalised from the newest purchase so the hourly
cron does one indexed scan rather than a per-item aggregate. `list_entry` has a CHECK
enforcing exactly one of `item_id`/`custom_name`, and a partial unique index so an item
can sit on the pending list only once — but can rejoin it once bought.
