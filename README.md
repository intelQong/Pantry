# Pantry

Smart weekly grocery restock for your household. Know what's running low, when it's due, and what to buy next — without maintaining a separate consumption log.

Two phones (iPhone + Android), one shared list, one tap to buy.

## How it works

Ticking an item off the shop list is the only data entry in the system. That single tap writes a purchase row, which updates the item's learned restock interval, recalculates its status, and fires a push notification when it's due again. No separate consumption-logging step — that's a chore people abandon after a week.

- **Auto-learning intervals** — median of purchase gaps, with a 20% stability guard. Gets better the longer you use it.
- **Per-member notifications** — each person chooses their own notify hour, days, timezone, and quiet hours.
- **Shop Mode** — immersive full-screen view with aisle-order grouping, big tap targets, optional price entry, running total, and wake-lock API.
- **Insights** — consumption rhythm, monthly spend, spend by category, price trends. All built from existing purchase data.
- **PWA** — installable on both phones, works with Safari and Chrome, delivers push notifications without a native app.

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────┐
│  Vite/React  │────▶│  Hono Worker │────▶│   D1    │
│  + Tailwind  │◀────│  (Cloudflare)│◀────│ (SQLite)│
└─────────────┘     └──────────────┘     └─────────┘
                           │
                    ┌──────┴──────┐
                    │  Cron (hour) │
                    │  Web Push    │
                    └─────────────┘
```

Static assets are served by Cloudflare's edge; API routes (`/api/*`) run in the Worker. A cron trigger fires hourly and decides which member is due a notification in their own timezone.

## Tech stack

| Layer | Choice |
|---|---|
| Runtime | Cloudflare Workers |
| Framework | Hono |
| Database | Cloudflare D1 (SQLite) |
| Client | Vite + React 19 + TypeScript + Tailwind 4 |
| Push | web-push-neo (aes128gcm only — Safari-compatible) |
| Tests | Vitest + @cloudflare/vitest-pool-workers |

## Development

### Prerequisites

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.0/bin:$PATH"
```

### Commands

```bash
npm install
npm run dev            # Vite client, proxies /api to wrangler dev on :8787
npm run dev:worker     # wrangler dev (runs the Worker + D1 locally)
npm test               # full test suite (103 tests)
npm run typecheck      # tsc --noEmit
npm run db:migrate:local
npm run build
npm run deploy         # build + wrangler deploy
```

### Environment

Copy `.dev.vars.example` to `.dev.vars` and fill in the secrets (or use `wrangler secret put` for production):

```
SESSION_SECRET=<openssl rand -base64 32>
VAPID_PUBLIC_KEY=<from web-push-neo generateVAPIDKeys>
VAPID_PRIVATE_KEY=<from web-push-neo generateVAPIDKeys>
VAPID_SUBJECT=mailto:you@example.com
```

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the full guide. Quick version:

1. `npx wrangler login`
2. `npx wrangler d1 create pantry-db` → paste `database_id` into `wrangler.jsonc`
3. `npm run db:migrate:remote`
4. Set secrets via `npx wrangler secret put`
5. `npm run deploy`

## Project structure

```
migrations/              D1 schema migrations
src/
  client/                React frontend
    components/          Reusable UI components (shell, sheets, badges, icons)
    hooks/               Custom React hooks (router, push subscription)
    lib/                 Utilities (catalog, money, numbers, splashes)
    screens/             Page-level components
    api.ts               Typed API client
    App.tsx              App root with router
  shared/
    types.ts             Types shared by Worker and client
  worker/                Cloudflare Worker backend
    routes/              Route handlers (auth, items, list, purchases, push)
    auth.ts              PBKDF2 passcode hashing, HMAC session tokens
    cron.ts              Hourly digest sweep
    env.ts               Env bindings, helpers
    index.ts             Hono app assembly
    middleware.ts        Session/member guards
    push.ts              Web Push delivery
    restock.ts           Status computation, interval learning
docs/                    Design decisions, progress, deployment guide
public/                  PWA manifest, icons, service worker
test/                    Vitest test suite (one file per area)
```

## Design decisions

- **Timestamps are unix epoch seconds** — day math is `(b - a) / 86400`
- **Money is integer minor units (poisha/cents)** — never a float
- **Items are soft-deleted (archived)** — purchase history outlives them
- **Every query is scoped by household_id** — cross-household isolation
- **Interval learning uses median, not mean** — one bulk buy before guests shouldn't rewrite your restock rhythm

See [docs/DESIGN.md](docs/DESIGN.md) for the full rationale behind every decision.

## Invariants

These are tested and breaking them causes silent data corruption:

1. Every query must be scoped by `household_id`
2. Always use bound parameters in SQL
3. Buying must stay idempotent — double-tap must not write duplicate purchase rows
4. One corrupt push subscription must not silence the entire household
5. `interval_locked = 1` means the engine must never touch that item's interval

## License

MIT