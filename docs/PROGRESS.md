# Progress

**Status: backend complete and tested. Frontend built. Nothing is deployed.**

94 tests passing, typecheck clean, Vite production build clean.

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.0/bin:$PATH"
npm test && npm run typecheck
```

---

## Done

### Phase 1 — foundation (`d9ab8dd`)
Vite/React/Tailwind scaffold, Hono Worker, full D1 schema, passcode auth (PBKDF2
210k iterations, HMAC-signed session cookie, 1-year expiry), profile pick, default
category seeding. All seven schema constraints verified by hand against a real D1.

### Phase 2 — items, list, purchases (`23deb49`)
Item CRUD (soft delete), shared shop list, purchase recording with optional price.

Found and fixed a real bug in the delegated work: buying a list entry had no status
guard, so buying twice wrote **two purchase rows, both HTTP 200**. Now every write is
guarded on the entry still being `pending`, with the status flip ordered last inside
D1's batch. Idempotent rather than merely erroring on retry.

### Phase 4 — restock engine + cron (`af7261e`)
Status computation, median interval auto-learning with the 20% guard, hourly digest
sweep with per-member timezone/weekday/quiet-hour gating and per-local-day dedupe, push
delivery with dead-subscription pruning.

Found and fixed a robustness bug: push encryption sat outside the try/catch and the cron
loop was unguarded, so one corrupt `p256dh` row would throw out of `sendToMember`, abort
the sweep, and silently stop **every** member being notified.

### Frontend — all six screens + PWA wiring (Antigravity)
Complete React 19 + Tailwind 4 frontend: auth flow (setup, login, profile pick),
Today screen (urgency-grouped due items), Shop List (category-grouped with autocomplete
quick-add), Shop Mode (full-screen immersive — big tap targets, aisle order, optional
price input, running total, progress bar, Wake Lock API, celebration on completion),
Pantry (search, item detail/edit bottom sheets, add item), Insights (placeholder with
stats cards), Settings (theme toggle, profile switch, logout). Plus: typed API client
for all 19 endpoints, hash-based router, Toast/BottomSheet/StatusBadge/CategoryBadge
components, PWA manifest, service worker, push subscription hook, and three new push
API routes (`GET /push/key`, `POST /push/subscribe`, `POST /push/test`). 30 new files,
1 modified. Build output: 243KB JS (71KB gzip), 28KB CSS (6KB gzip).

---

## API surface

All routes are under `/api`. `requireSession` = logged-in device;
`requireMember` = a profile is also chosen (needed for attribution).

| Method | Path | Guard |
|---|---|---|
| GET | `/session` | — |
| POST | `/setup` | — (first run only) |
| POST | `/login` | — |
| POST | `/profile` | session |
| POST | `/logout` | — |
| GET | `/items` | session |
| POST | `/items` | member |
| PATCH | `/items/:id` | session |
| DELETE | `/items/:id` | session (soft delete) |
| GET | `/categories` | session |
| GET | `/today` | member |
| GET | `/list` | session |
| POST | `/list` | member |
| PATCH | `/list/:id` | session |
| DELETE | `/list/:id` | session |
| POST | `/list/:id/skip` | session |
| POST | `/list/:id/bought` | member |
| POST | `/purchases` | member |
| GET | `/items/:id/purchases` | session |

---

## Remaining work

### Phase 3 — PWA + Web Push wiring — code complete, **verification blocked on user**

Manifest, icons, service worker, subscription flow, the three push routes, and the
iOS Home-Screen guidance are all in place and tested (103 tests).

**Still blocked on:** a Cloudflare account, a real HTTPS deployment, and both physical
phones. Do not mark push done on a green unit test — the suite proves the encryption is
correct, not that a phone buzzes. See `docs/DEPLOYMENT.md`.

### Phase 5 — Insights
Consumption rhythm per item, monthly spend, spend by category, price trend. All of it
reads existing `purchase` rows. Load the `dataviz` skill before writing charts.

Note: `POST /purchases` has no `purchasedAt` parameter, so past purchases cannot be
backfilled. Worth adding — it lets a new user seed history and get useful learned
intervals immediately instead of after three shops.

### Phase 6 — Customization & polish
All four settings areas, theme system, Shop Mode, empty states.

Known edge case to handle in the settings UI: if `notify_hour` is set inside the quiet
window, the member is never notified and nothing says so. Warn in the UI.

---

## How this work was run

The user asked for Opus to plan and cheaper models to execute, with verification. Phases
2 and 4 were delegated to Sonnet agents with precise specs; both were then independently
verified by re-running the suite and reading the diff. **Every delegated phase so far has shipped a real
bug its own passing tests did not catch:**

- Sonnet, Phase 2 — buying was not idempotent; a double-tap wrote two purchase rows.
- Sonnet, Phase 4 — push encryption sat outside the try/catch, so one corrupt row
  aborted the whole sweep.
- Antigravity, frontend — all four PWA icons referenced but never created (blocking
  install on both platforms, and therefore push on iOS); the service worker was only
  registered lazily inside `subscribe()`, leaving `serviceWorker.ready` hanging on
  mount; and `usePushSubscription` was dead code, imported nowhere, so notifications
  could not be enabled from the UI at all. Its three new backend routes shipped with
  zero tests.

Read delegated code. A green suite proves only that the tests that exist pass.
