# Deployment

Nothing is deployed yet. This is the full first-time path.

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.0/bin:$PATH"
```

## 1. Cloudflare account

Free tier is enough. Then log in — this is interactive, so run it yourself:

```
npx wrangler login
```

## 2. Create the D1 database

```bash
npx wrangler d1 create pantry-db
```

Copy the returned `database_id` into `wrangler.jsonc`, replacing
`PLACEHOLDER_REPLACE_AFTER_D1_CREATE`. Then:

```bash
npx wrangler types                      # regenerate binding types
npm run db:migrate:remote               # apply the schema
```

## 3. Secrets

```bash
# Session cookie signing key
openssl rand -base64 32 | npx wrangler secret put SESSION_SECRET
```

VAPID keys identify this application server to the push services. Generate one pair and
keep it stable forever — **rotating them invalidates every existing subscription**, and
both phones would have to re-subscribe.

```bash
node -e "import('web-push-neo').then(async m => console.log(JSON.stringify(await m.generateVAPIDKeys(), null, 2)))"
```

```bash
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT     # e.g. mailto:mahmudulhk13@gmail.com
```

The **public** key must also reach the client, which passes it to
`pushManager.subscribe({ applicationServerKey })`. Expose it via a small
`GET /api/push/key` route rather than baking it into the bundle, so rotation only needs
a redeploy.

## 4. Deploy

```bash
npm run deploy    # vite build && wrangler deploy
```

This gives a `https://pantry.<subdomain>.workers.dev` URL. HTTPS is what makes PWA
install and Web Push possible at all, which is why local `wrangler dev` cannot fully
test push.

## 5. First run

Open the URL, complete setup (household name, passcode, both member names). Setup is
one-shot and refuses to run twice.

## 6. Install on both phones — required for notifications

**iPhone:** Safari → Share → **Add to Home Screen**. Open the app *from the Home Screen
icon*, then allow notifications. iOS will not grant push permission to a normal Safari
tab; the request silently fails. Deleting the icon destroys the subscription.

**Android:** Chrome → menu → **Install app** / Add to Home Screen, then allow
notifications.

## 7. Verify push actually works

```bash
npx wrangler tail    # watch live logs
```

Trigger `POST /api/push/test` from each phone and confirm a notification arrives on
**both**. A passing test suite proves the encryption is correct; it does not prove a
phone buzzes. Do not consider push done until both devices have received one.

To test the scheduled sweep without waiting for the hour:

```bash
npx wrangler dev --test-scheduled
curl "http://localhost:8787/__scheduled?cron=0+*+*+*+*"
```

## Cron

`wrangler.jsonc` registers `0 * * * *` — hourly. The sweep itself decides who is due a
notification in their own local timezone, so the cron frequency never needs changing.

## Cost

Comfortably inside the free tier for two users: Workers 100k requests/day, D1 5GB and
5M row reads/day, Cron Triggers free. Expected load is roughly 24 cron invocations plus
a few dozen requests per day.
