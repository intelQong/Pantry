# Utilities Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Utilities screen that records when the gas cylinder, electricity meter, and wifi bill were last paid, and bump the whole app's type and tap-target scale.

**Architecture:** No new tables and no new API routes. Gas, electricity, and wifi become ordinary `item` rows in a seeded `Utilities` category, so the existing purchase loop, restock learner, and push digest carry them for free. The new work is one migration, one client screen, one nav tab, and a token-level UI scale bump.

**Tech Stack:** Cloudflare Workers + Hono + D1 (SQLite), React 19 + TypeScript + Tailwind 4 (CSS-first `@theme` config), Vitest 4 with `@cloudflare/vitest-pool-workers` (real Worker, real D1).

## Global Constraints

- **Every command needs the nvm PATH prefix:** `export PATH="$HOME/.nvm/versions/node/v22.23.0/bin:$PATH"`
- Timestamps are INTEGER unix epoch **seconds**, never milliseconds.
- Money is INTEGER minor units (poisha), never a float.
- Booleans are INTEGER 0/1.
- IDs are TEXT uuids from `crypto.randomUUID()` in the Worker; in SQL migrations use `lower(hex(randomblob(16)))`.
- Migrations are numbered sequentially: the next free number is `0008`.
- All tests run in the Workers pool (`npm test`); there is no DOM/render test setup, so client-side tests cover pure functions only.
- Do not hand-edit per-screen font sizes in Task 4. Scale is a token change.
- Existing suite is 94 tests and must stay green. `npm run typecheck` must stay clean.

---

### Task 1: Seed the Utilities category and its three items

**Files:**
- Create: `migrations/0008_utilities.sql`
- Modify: `src/worker/routes/auth.ts:15-24` (the `DEFAULT_CATEGORIES` array)
- Test: `test/utilities.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a category named exactly `Utilities` per household, containing three items named exactly `Gas Cylinder`, `Electricity Recharge`, `Wifi Bill`. Task 3's screen resolves them by that category name.

**Background:** `migrations/0001_init.sql:26` defines `category(id, household_id, name, color, icon, sort_order)` and `:36` defines `item`, whose relevant columns are `id, household_id, name, category_id, unit, default_qty, brand, notes, is_staple, restock_interval_days, interval_locked, last_purchased_at, archived, created_by, created_at`. `migrations/0003_backfill_admin.sql` is the precedent for a data-backfill migration.

Wifi gets `interval_locked = 1` because it is a fixed 30-day billing cycle. Paying late must not teach the median-gap learner in `src/worker/restock.ts` that the cycle is 40 days. Gas and electricity are consumption-driven and stay unlocked so they learn.

- [ ] **Step 1: Write the failing test**

Create `test/utilities.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { SELF } from "cloudflare:test";

const json = (path: string, body: unknown, cookie?: string, method = "POST") =>
  SELF.fetch(`https://pantry.test${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });

const get = (path: string, cookie?: string) =>
  SELF.fetch(`https://pantry.test${path}`, { headers: cookie ? { Cookie: cookie } : {} });

const cookieFrom = (res: Response): string => (res.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";

let memberCookie: string;

beforeAll(async () => {
  await json("/api/setup", {
    householdName: "Our Kitchen",
    passcode: "rice2026",
    memberNames: ["Sam", "Riley"],
  });
  const login = await json("/api/login", { passcode: "rice2026" });
  const sessionCookie = cookieFrom(login);
  const session = await get("/api/session", sessionCookie);
  const { members } = await session.json<{ members: Array<{ id: string }> }>();
  const profile = await json("/api/profile", { memberId: members[0]!.id }, sessionCookie);
  memberCookie = cookieFrom(profile);
});

describe("utilities seeding", () => {
  it("gives the household a Utilities category", async () => {
    const res = await get("/api/categories", memberCookie);
    const cats = await res.json<Array<{ id: string; name: string }>>();
    expect(cats.map((c) => c.name)).toContain("Utilities");
  });

  it("seeds gas, electricity and wifi into it", async () => {
    const catRes = await get("/api/categories", memberCookie);
    const cats = await catRes.json<Array<{ id: string; name: string }>>();
    const utilities = cats.find((c) => c.name === "Utilities")!;

    const res = await get("/api/items", memberCookie);
    const items = await res.json<Array<{ name: string; categoryId: string | null; unit: string }>>();
    const seeded = items.filter((i) => i.categoryId === utilities.id);

    expect(seeded.map((i) => i.name).sort()).toEqual([
      "Electricity Recharge",
      "Gas Cylinder",
      "Wifi Bill",
    ]);
    expect(seeded.find((i) => i.name === "Gas Cylinder")!.unit).toBe("cylinder");
  });

  it("locks the wifi interval so a late payment does not stretch the cycle", async () => {
    const res = await get("/api/items", memberCookie);
    const items = await res.json<Array<{ id: string; name: string; restockIntervalDays: number; intervalLocked: boolean }>>();
    const wifi = items.find((i) => i.name === "Wifi Bill")!;

    expect(wifi.restockIntervalDays).toBe(30);
    expect(wifi.intervalLocked).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.0/bin:$PATH"
npm test -- test/utilities.test.ts
```

Expected: FAIL — the categories list has no `Utilities` entry.

- [ ] **Step 3: Write the migration**

Create `migrations/0008_utilities.sql`:

```sql
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
```

- [ ] **Step 4: Add the category to new-household setup**

In `src/worker/routes/auth.ts`, append one entry to `DEFAULT_CATEGORIES` (currently ends with `["Personal Care", "#14b8a6"],` at line 23):

```ts
  ["Personal Care", "#14b8a6"],
  ["Utilities", "#0ea5e9"],
];
```

Note: the migration's backfill and this array are both needed. Setup writes categories for a brand-new household directly; the migration covers the household that already exists. The migration's `NOT EXISTS` guard makes the overlap harmless.

- [ ] **Step 5: Run the test and confirm it passes**

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.0/bin:$PATH"
npm test -- test/utilities.test.ts
```

Expected: PASS, 3 tests.

If the third test fails on `restockIntervalDays`/`intervalLocked` being absent rather than wrong, check the item serializer in `src/worker/routes/items.ts` for the exact field names it returns and fix the test's property names to match — do not add fields to the API.

- [ ] **Step 6: Run the full suite and typecheck**

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.0/bin:$PATH"
npm test && npm run typecheck
```

Expected: all previous tests still pass (94 + 3).

- [ ] **Step 7: Commit**

```bash
git add migrations/0008_utilities.sql src/worker/routes/auth.ts test/utilities.test.ts
git commit -m "Track gas, electricity and wifi as pantry items"
```

---

### Task 2: Backdating and month-grouping helpers

**Files:**
- Modify: `src/client/api.ts:186-193` (the `addPurchase` function)
- Create: `src/client/lib/utilities.ts`
- Test: `test/utilities-lib.test.ts`

**Interfaces:**
- Consumes: `Purchase` from `@shared/types` (`{ id, itemId, purchasedAt, qty, unit, priceTotal, boughtBy, note }`).
- Produces:
  - `api.addPurchase(data)` gains an optional `purchasedAt?: number` field (epoch **seconds**).
  - `export function dateInputToEpochSeconds(value: string): number` — `"2026-07-14"` → epoch seconds at local midnight.
  - `export function epochSecondsToDateInput(seconds: number): string` — inverse, for prefilling `<input type="date">`.
  - `export interface PurchaseMonth { key: string; label: string; total: number; purchases: Purchase[] }`
  - `export function groupByMonth(purchases: Purchase[]): PurchaseMonth[]` — newest month first, newest purchase first within a month, `total` in minor units summing non-null `priceTotal`.

**Background:** `POST /api/purchases` already accepts and clamps a client-supplied `purchasedAt` (see the long comment in `src/worker/routes/purchases.ts` — never in the future, never more than 30 days back). The client wrapper just never passed it. Everything else this task adds is pure date and grouping arithmetic, which is the only kind of client code this repo can test (all tests run in the Workers pool; there is no DOM setup).

- [ ] **Step 1: Write the failing test**

Create `test/utilities-lib.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  dateInputToEpochSeconds,
  epochSecondsToDateInput,
  groupByMonth,
} from "../src/client/lib/utilities";
import type { Purchase } from "../src/shared/types";

const purchase = (id: string, purchasedAt: number, priceTotal: number | null): Purchase => ({
  id,
  itemId: "item-1",
  purchasedAt,
  qty: 1,
  unit: "cylinder",
  priceTotal,
  boughtBy: null,
  note: null,
});

describe("date input round trip", () => {
  it("survives a round trip", () => {
    expect(epochSecondsToDateInput(dateInputToEpochSeconds("2026-07-14"))).toBe("2026-07-14");
  });

  it("returns whole seconds, not milliseconds", () => {
    const seconds = dateInputToEpochSeconds("2026-07-14");
    expect(Number.isInteger(seconds)).toBe(true);
    // Sanity: anything in ms would be ~1000x larger than a 2026 timestamp.
    expect(seconds).toBeLessThan(4_000_000_000);
  });

  it("zero-pads single-digit months and days", () => {
    expect(epochSecondsToDateInput(dateInputToEpochSeconds("2026-01-05"))).toBe("2026-01-05");
  });
});

describe("groupByMonth", () => {
  it("groups by calendar month, newest month first", () => {
    const groups = groupByMonth([
      purchase("a", dateInputToEpochSeconds("2026-06-02"), 12000),
      purchase("b", dateInputToEpochSeconds("2026-07-14"), 34000),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["2026-07", "2026-06"]);
  });

  it("orders purchases newest first inside a month", () => {
    const groups = groupByMonth([
      purchase("early", dateInputToEpochSeconds("2026-07-02"), 100),
      purchase("late", dateInputToEpochSeconds("2026-07-28"), 100),
    ]);
    expect(groups[0]!.purchases.map((p) => p.id)).toEqual(["late", "early"]);
  });

  it("totals the month in minor units and ignores unpriced entries", () => {
    const groups = groupByMonth([
      purchase("a", dateInputToEpochSeconds("2026-07-02"), 12000),
      purchase("b", dateInputToEpochSeconds("2026-07-03"), null),
      purchase("c", dateInputToEpochSeconds("2026-07-04"), 34050),
    ]);
    expect(groups[0]!.total).toBe(46050);
  });

  it("returns an empty array for no purchases", () => {
    expect(groupByMonth([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.0/bin:$PATH"
npm test -- test/utilities-lib.test.ts
```

Expected: FAIL — cannot resolve `../src/client/lib/utilities`.

- [ ] **Step 3: Write the helpers**

Create `src/client/lib/utilities.ts`:

```ts
import type { Purchase } from "@shared/types";

/**
 * `<input type="date">` speaks 'YYYY-MM-DD' in the user's own calendar, and the
 * database speaks epoch seconds. These two convert between them in *local* time
 * on purpose: someone picking "14 July" means midnight on the 14th where they
 * are standing, and parsing it as UTC would land the entry on the 13th for
 * anyone east of Greenwich -- which is everyone using this app.
 */
export function dateInputToEpochSeconds(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  return Math.floor(new Date(year!, month! - 1, day!).getTime() / 1000);
}

export function epochSecondsToDateInput(seconds: number): string {
  const d = new Date(seconds * 1000);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

export interface PurchaseMonth {
  /** 'YYYY-MM', used as the React key and for sorting. */
  key: string;
  /** Human heading, e.g. 'July 2026'. */
  label: string;
  /** Sum of priceTotal in minor units; unpriced entries contribute nothing. */
  total: number;
  purchases: Purchase[];
}

export function groupByMonth(purchases: Purchase[]): PurchaseMonth[] {
  const months = new Map<string, Purchase[]>();

  for (const p of purchases) {
    const key = epochSecondsToDateInput(p.purchasedAt).slice(0, 7);
    const bucket = months.get(key);
    if (bucket) bucket.push(p);
    else months.set(key, [p]);
  }

  return [...months.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, list]) => {
      const sorted = [...list].sort((a, b) => b.purchasedAt - a.purchasedAt);
      return {
        key,
        label: new Date(sorted[0]!.purchasedAt * 1000).toLocaleDateString(undefined, {
          month: "long",
          year: "numeric",
        }),
        total: sorted.reduce((sum, p) => sum + (p.priceTotal ?? 0), 0),
        purchases: sorted,
      };
    });
}
```

- [ ] **Step 4: Let the API client send a purchase date**

In `src/client/api.ts`, add one field to `addPurchase`'s parameter type (it currently takes `itemId`, `qty`, `unit`, `priceTotal`, `note`):

```ts
export const addPurchase = (data: {
  itemId: string;
  /** Epoch seconds. The server clamps it: never future, never >30 days back. */
  purchasedAt?: number;
  qty?: number;
  unit?: string;
  priceTotal?: number | null;
  note?: string | null;
}) => request<Purchase>("POST", "/purchases", data);
```

- [ ] **Step 5: Run the test and confirm it passes**

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.0/bin:$PATH"
npm test -- test/utilities-lib.test.ts && npm run typecheck
```

Expected: PASS, 7 tests; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/client/lib/utilities.ts src/client/api.ts test/utilities-lib.test.ts
git commit -m "Add date and month-grouping helpers for the utilities log"
```

---

### Task 3: The Utilities screen and its nav tab

**Files:**
- Create: `src/client/screens/UtilitiesScreen.tsx`
- Modify: `src/client/hooks/useRouter.ts:3-25` (add the route)
- Modify: `src/client/App.tsx:19` and the `route.page === ...` block (import and render)
- Modify: `src/client/components/BottomNav.tsx:4-10` (sixth tab, shorter labels)

**Interfaces:**
- Consumes: `groupByMonth`, `dateInputToEpochSeconds`, `epochSecondsToDateInput` from `src/client/lib/utilities.ts`; `api.getItems()`, `api.addPurchase()`, `api.getItemPurchases()` from `src/client/api.ts`; the `Utilities` category name seeded in Task 1.
- Produces: `export function UtilitiesScreen({ categories }: { categories: Category[] })`, rendered for `route.page === "utilities"`.

**Background:** Read `src/client/screens/PantryScreen.tsx` first — it is the shortest screen and shows the house style for load/error/empty states, headers, and card markup. Reuse the existing components rather than writing new ones: `BottomSheet` (`open`, `onClose`, `title`, `children`), `PriceInput` (`value: number | null`, `onChange`), `StatusBadge`, `EmptyState`, `LoadingSpinner`, `useToast` from `components/Toast`, and `formatMoney` from `lib/money`.

Items arrive from `GET /items` as `ItemWithStatus` — check the exact shape in `src/shared/types.ts` before writing markup; it carries the computed `status`, `daysSince`, and `daysUntilDue` alongside the item fields, so the screen must not recompute any of that.

Logging is online-only: a failed save shows an error toast and leaves the sheet open with its values intact. Do not add an outbox op kind for it.

- [ ] **Step 1: Add the route**

In `src/client/hooks/useRouter.ts`, add `| { page: "utilities" }` to the `Route` union and `case "utilities": return { page: "utilities" };` to the `switch` in `parseHash`.

- [ ] **Step 2: Build the screen**

Create `src/client/screens/UtilitiesScreen.tsx`. Required behaviour:

1. On mount, `api.getItems()`, keep only items whose `categoryId` matches the category named `Utilities` from the `categories` prop. If no such category exists, render `EmptyState` explaining that no utilities are set up.
2. For each utility, fetch its history with `api.getItemPurchases(item.id)` and hold them in one flat array.
3. Render one large card per utility: name, `StatusBadge` for its `status`, "Last paid N days ago" (or "Never logged"), "Due in N days" / "Overdue by N days" from `daysUntilDue`, and the last amount via `formatMoney`.
4. Each card has a full-width primary button whose label follows the item's `unit`: `cylinder` → "Log refill", `recharge` → "Log recharge", `month` → "Log payment", anything else → "Log purchase".
5. The button opens a `BottomSheet` containing: `<input type="date">` defaulting to `epochSecondsToDateInput(Date.now() / 1000)` and capped with `max={today}`; a `PriceInput`; a number input for quantity defaulting to 1; a text input for an optional note. Save calls:

```tsx
await api.addPurchase({
  itemId: item.id,
  purchasedAt: dateInputToEpochSeconds(date),
  qty,
  unit: item.unit,
  priceTotal: price,
  note: note.trim() || null,
});
```

then closes the sheet, shows a success toast, and refetches items and history. On failure: keep the sheet open, show an error toast, do not clear the fields.

6. Below the cards, render `groupByMonth(allPurchases)`: a heading per month showing the label and `formatMoney(total)`, then each purchase as a row with its date, which utility it was (map `itemId` back to the item name), amount, and note.

Every interactive element gets `className="... min-h-11"` or taller — Task 4 sets the app-wide floor, but the sheet's inputs must not fall below it.

- [ ] **Step 3: Wire it into the app**

In `src/client/App.tsx`, import the screen alongside the other screens and add to the render block, next to the `pantry` line:

```tsx
{route.page === "utilities" && <UtilitiesScreen categories={categories} />}
```

- [ ] **Step 4: Add the sixth nav tab**

In `src/client/components/BottomNav.tsx`, the `TABS` array becomes six entries. Six tabs in a 375px-wide phone is ~62px each, so the labels shorten to stay on one line:

```ts
const TABS: Array<{ id: string; label: string; icon: IconName }> = [
  { id: "today", label: "Today", icon: "sun" },
  { id: "list", label: "List", icon: "basket" },
  { id: "pantry", label: "Pantry", icon: "box" },
  { id: "utilities", label: "Bills", icon: "zap" },
  { id: "insights", label: "Stats", icon: "chart" },
  { id: "settings", label: "Settings", icon: "sliders" },
];
```

Check `src/client/components/Icon.tsx` for the available `IconName` values. If there is no `zap`, add one to that file following the existing icon pattern (a `<path>` inside the shared `<svg>` wrapper) — a lightning bolt, since it covers all three utilities better than a gas or wifi glyph would.

- [ ] **Step 5: Verify it typechecks and builds**

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.0/bin:$PATH"
npm run typecheck && npm run build && npm test
```

Expected: typecheck clean, build clean, all tests still green.

- [ ] **Step 6: Verify it in the browser**

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.0/bin:$PATH"
npm run db:migrate:local
npm run dev
```

Open the app, tap the Bills tab. Confirm: three cards appear; logging a gas refill backdated by five days makes the card read "Last paid 5 days ago" (not "today"); the entry shows under the right month with the right total.

- [ ] **Step 7: Commit**

```bash
git add src/client/screens/UtilitiesScreen.tsx src/client/App.tsx \
        src/client/hooks/useRouter.ts src/client/components/BottomNav.tsx \
        src/client/components/Icon.tsx
git commit -m "Add a Utilities screen for gas, electricity and wifi"
```

---

### Task 4: Global UI scale bump

**Files:**
- Modify: `src/client/index.css` (the `@theme` block and the base layer below it)
- Modify: `src/client/components/BottomNav.tsx` (bar height)

**Interfaces:**
- Consumes: the six-tab `BottomNav` from Task 3.
- Produces: nothing other tasks depend on. This is the last task on purpose — it changes every screen at once, so it lands after the new screen exists and can be judged in the same pass.

**Background:** The app is read at arm's length in a kitchen and the current scale is too small. Everything in the app is already expressed in `rem`, so raising the root font size scales the whole thing in one edit — which is why this must not be done by hand-editing screens. `src/client/index.css:374-380` already documents a deliberate exception: screen titles sit at `2.25rem` and are large enough; do not scale them again or they will wrap on a small phone.

- [ ] **Step 1: Raise the root font size**

In `src/client/index.css`, in the base layer (alongside the existing `html`/`body` rules, near the title rules around line 374):

```css
/* The app is read at arm's length in a kitchen, not at a desk. Everything in
   here is expressed in rem, so the whole scale moves from this one number --
   which is also why nothing below this line should hardcode a px font size. */
html {
  font-size: 17px;
}
```

- [ ] **Step 2: Set a tap-target floor**

Add, in the same base layer:

```css
/* iOS HIG minimum touch target. Applied to the controls rather than to a
   utility class so a new button cannot forget it. */
button,
[role="button"],
input:not([type="checkbox"]):not([type="radio"]),
select {
  min-height: 2.75rem; /* 44px at the 16px browser default, 47px at ours */
}
```

- [ ] **Step 3: Grow the bottom nav**

In `src/client/components/BottomNav.tsx`, change the row height class `h-[3.75rem]` to `h-[4.25rem]`, and raise the label size from `text-[0.625rem]` to `text-[0.6875rem]` so six labels stay legible without wrapping.

- [ ] **Step 4: Confirm the title exception still holds**

Read the comment block at `src/client/index.css:374-380` and leave the `2.25rem` title size untouched. Titles now render at `2.25 × 17px` = 38px; check on a 375px-wide viewport that the longest screen title ("Settings", "Utilities") still fits on one line. If one wraps, reduce that rule to `2rem` and note why in the commit message.

- [ ] **Step 5: Verify every screen**

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.0/bin:$PATH"
npm run build && npm run dev
```

At a 375×812 viewport walk all six tabs plus Shop Mode. Check for: horizontal overflow, wrapped nav labels, a bottom nav that covers content (the `pb-20` in `src/client/components/Shell.tsx:27` may need to become `pb-24` now that the bar is taller), and clipped bottom sheets.

- [ ] **Step 6: Run the full suite**

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.0/bin:$PATH"
npm test && npm run typecheck
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/client/index.css src/client/components/BottomNav.tsx src/client/components/Shell.tsx
git commit -m "Scale the interface up for a phone held at arm's length"
```

---

## Final verification

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.0/bin:$PATH"
npm test && npm run typecheck && npm run build
```

Expected: 104 tests passing (94 existing + 3 from Task 1 + 7 from Task 2), typecheck clean, Vite build clean.

Then, manually, with `npm run db:migrate:local && npm run dev`:

1. Bills tab shows three cards — Gas Cylinder, Electricity Recharge, Wifi Bill.
2. Logging a payment backdated five days makes the card read "5 days ago", not "today".
3. The history list groups it under the right month with the right subtotal.
4. Logging three gas refills roughly 25 days apart moves Gas Cylinder's learned interval off 30; three wifi payments at odd gaps leave Wifi Bill at 30 (interval lock).
5. Every screen still reads correctly at the larger scale on a 375px viewport.
