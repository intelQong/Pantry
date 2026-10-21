# Pantry — agent context

A shared weekly-grocery restock system for a two-person household (an iPhone and an
Android phone). It pushes a reminder when a staple is due for restocking, tracks how
fast things get consumed, and keeps a shared "buy this next visit" list.

**Read `docs/DESIGN.md` for why the product works the way it does, and
`docs/PROGRESS.md` for exactly where the work stopped and what to do next.**

---

## The one idea that explains the whole codebase

**Ticking an item off the shop list is the only data entry in the system.**

That single tap writes a `purchase` row → updates `item.last_purchased_at` →
recalculates the item's learned restock interval → determines when it next goes
"due" → fires the next push. The same row (with an optional price) is what every
consumption and spend statistic is built from.

There is deliberately no separate "log your consumption" step, because that is a
chore people stop doing after a week. If you are adding a feature, ask whether it
can ride on this existing loop before adding a new input.

---

## Stack

| Layer | Choice |
|---|---|
| Runtime | Cloudflare Workers |
| Routing | Hono (`src/worker/index.ts`) |
| Database | Cloudflare D1 (SQLite) |
| Client | Vite + React 19 + TypeScript + Tailwind 4 — **not built yet** |
| Push | `web-push-neo` (see the hard-won note below) |
| Tests | Vitest 4 + `@cloudflare/vitest-pool-workers` (real Worker, real D1) |

Node is installed via nvm and is **not on the default PATH**. Every command must be
prefixed:

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.0/bin:$PATH"
```

```bash
npm test          # full suite (94 tests)
npm run typecheck # tsc --noEmit
npm run dev       # Vite client, proxies /api to wrangler dev on :8787
npm run dev:worker
npm run db:migrate:local
npm run deploy
npx wrangler types  # regenerate worker-configuration.d.ts after editing wrangler.jsonc
```

---

## Layout

```
migrations/0001_init.sql   Schema. Authoritative — read it before touching data code.
src/shared/types.ts        Types shared by Worker and client. No runtime imports.
src/worker/
  index.ts                 Hono app assembly + fetch/scheduled handlers
  env.ts                   Env bindings, nowSeconds(), isSecureRequest()
  auth.ts                  PBKDF2 passcode hashing, HMAC session tokens
  middleware.ts            loadSession / requireSession / requireMember
  restock.ts               The engine: status, median learning, timezone helpers
  push.ts                  Web Push delivery + dead-subscription pruning
  cron.ts                  Hourly digest sweep
  audit.ts                 auditStatement(): the one audit_log writer
  routes/                  auth.ts, items.ts, list.ts, purchases.ts, insights.ts, push.ts, audit.ts
test/                      One file per area; each gets an isolated D1
```

---

## Conventions

- **Timestamps are unix epoch seconds (INTEGER)**, so day math is `(b - a) / 86400`.
- **Money is integer minor units** (poisha/cents). Never a float. `price_total` is
  nullable — a purchase with no recorded price is normal and expected.
- **Booleans are INTEGER 0/1** in SQL, real booleans in the API layer.
- Ids are `crypto.randomUUID()` TEXT.
- SQL columns are `snake_case`; API JSON is `camelCase`. Route files own the mapping
  (see `toListEntry`, `toPurchase`).
- Errors are always `c.json({ error: "snake_case_code", message: "Human sentence." }, status)`.
- Items are **hard-deleted** (since 0005; the `archived` column is vestigial and always 0).
  Deleting cascades to purchases; `audit_log` keeps a JSON snapshot of what went.
- Destructive routes sit behind `requireMember` and write their audit row via
  `auditStatement` (`src/worker/audit.ts`) in the same batch as the DELETE.
- Validators live once: `isValidQty` / `isValidPriceTotal` in `routes/purchases.ts`.
- Item names match **case-insensitively** wherever a typed name is resolved to an item.

---

## Invariants — breaking these causes silent data corruption

1. **Every query must be scoped by `household_id`.** No exceptions. Cross-household
   isolation is tested in `test/items.test.ts` and `test/list.test.ts`.
2. **Always use bound parameters.** Never interpolate a value into SQL.
3. **Buying must stay idempotent.** In `POST /list/:id/bought`, every write is guarded
   by `EXISTS (... status = 'pending')` and the status flip is ordered **last**, so the
   guards still see `pending` inside D1's batch transaction. This is not stylistic:
   before it existed, a double-tap in Shop Mode or a retry on flaky shop wifi wrote two
   purchase rows, which silently corrupts both the learned interval and the spend
   totals — and nothing downstream can distinguish that from genuinely buying rice
   twice. See the three regression tests in `test/list.test.ts`.
4. **Never let one bad row silence the household.** Push encryption sits *inside* the
   per-subscription try/catch, and the cron loop guards each member. A corrupt `p256dh`
   used to throw out of `sendToMember`, past the sweep, and stop every remaining member
   from being notified.
5. **`interval_locked = 1` means the engine must never touch that item's interval.**

---

## Web Push: read this before changing anything about notifications

**Use `aes128gcm`. Never `aesgcm`.**

Safari's web push shipped in 2023, six years after RFC 8291, and only ever implemented
the modern `aes128gcm` encoding with the RFC 8292 `Authorization: vapid t=..., k=...`
scheme. Chrome and Firefox still accept the older `aesgcm` draft (which pairs with
`Authorization: WebPush <jwt>` plus `Crypto-Key`/`Encryption` headers).

This asymmetry is a trap. A library using the legacy encoding works perfectly on
Android and **silently does nothing on iPhone** — the push service accepts the request
and the browser discards it. There is no error anywhere.

Libraries evaluated, and why they were rejected:

| Library | Encoding | Verdict |
|---|---|---|
| `web-push` (6.2M/wk) | — | Node-only (`node:crypto` ECDH, `https.request`). Will not run on Workers. |
| `@block65/webcrypto-web-push` | `aesgcm` | Silently fails on iOS. |
| `webpush-webcrypto` | `aesgcm` | Same, plus ships no types. |
| **`web-push-neo`** | **`aes128gcm` only** | **In use.** No legacy code paths. |

Firebase/FCM was considered and rejected: the send side still requires signing an RS256
service-account JWT in the Worker, so it removes no crypto while adding ~100KB of client
SDK and a Google dependency.

`test/push-encryption.test.ts` guards all of this. It stands up a fake browser
subscription, has the library encrypt to it, then decrypts the result with an
**independent** RFC 8291 implementation and asserts the plaintext round-trips. Keep that
test. It is the only cheap place to catch a miscrypted push, because in production the
failure is completely silent.

`src/worker/push.ts` deliberately uses `generateRequestDetails` + its own `fetch`
rather than the library's `sendNotification`, so failure handling is ours and tests can
stub `globalThis.fetch`.

---

## Gotchas that cost time

- **`@cloudflare/vitest-pool-workers` 0.18 changed its API.** `defineWorkersConfig` and
  the `./config` subpath are gone. It is now a Vite plugin: `cloudflareTest({...})` with
  flat options. `readD1Migrations` comes from the package root.
- **`cloudflare:test` types `env` as `Cloudflare.Env`**, not `ProvidedEnv`. Test-only
  bindings are declared by augmenting that namespace in `test/env.d.ts`.
- **`run_worker_first: ["/api/*"]`** in `wrangler.jsonc` is what routes API calls to the
  Worker while everything else falls through to static assets with SPA fallback.
- **PBKDF2 is capped at 100,000 iterations on Workers.** Exceeding it throws
  `NotSupportedError` at runtime — but the local workerd used by vitest does *not*
  enforce the cap. Setting 210k passed all 103 tests and then 500'd on every signup and
  login in production. Asserted now by a test in `test/auth.test.ts`. Treat any Web
  Crypto limit as untested-by-default and verify against a real deploy.
- **`worker-configuration.d.ts` is gitignored and generated.** Run `npx wrangler types`
  after changing bindings, or typecheck fails on missing `D1Database`/`ExecutionContext`.
- **`wrangler.jsonc` has a placeholder `database_id`.** Replace it after creating the D1
  database — see `docs/DEPLOYMENT.md`.
- Local D1 state lives in `.wrangler/state/v3/d1`; delete it to reset.

---

## Working style expected here

- Write the test that demonstrates the bug **before** fixing it, and show it failing.
- Do not claim something passes without pasting the actual command output.
- Comment the *why* for non-obvious decisions, not the *what*. Match surrounding density.
- Scope changes to what was asked; flag adjacent problems rather than silently fixing them.
