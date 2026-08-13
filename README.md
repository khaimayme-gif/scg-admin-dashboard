# SCG Admin Dashboard

Internal admin dashboard for So Chic Gifts. Single shared password, one admin. Used to price
quotes across Thailand, Japan and Myanmar, track item costs against menu prices, and generate
branded QR codes.

Not launched yet.

## Architecture

Everything deploys as **one Vercel project rooted at `frontend/`**. There is no separate
backend service — the API is Vercel serverless functions living alongside the React app.

```
frontend/            <- Vercel Root Directory is set to this folder
├── src/             React 19 + TypeScript SPA, built by Vite to dist/
├── api/             one file per route group -> Vercel Functions (Node.js, CommonJS)
├── lib/             shared code, bundled into each function (never a route itself)
└── vercel.json      rewrites for bare collection URLs
backend/             deprecated, replaced by frontend/api/ — nothing here deploys
```

The SPA calls the API with relative `/api/...` paths, so the frontend and API are the same
origin. No CORS, and the session cookie just works.

## Deploying

Push to `main`. Vercel builds and promotes to production; there is no manual step.

- Install: **npm** (`frontend/package-lock.json` is committed; `pnpm-lock.yaml` is gitignored)
- Build: `npm run build` = `tsc -b && vite build` → `dist/`
- A TypeScript error in `src/` **fails the build and nothing ships.** Files in `api/` and
  `lib/` are plain JavaScript, so they are never type-checked — mistakes there deploy fine
  and fail at runtime instead.

Where to look when something breaks:

| Symptom | Look at |
|---|---|
| Nothing deployed | Build Logs for that deployment |
| API returns 500 | Runtime Logs / Functions tab |
| Quick liveness check | `/api/health` (does not touch the database) |
| Real end-to-end check | `/api/settings` (exercises auth + database + schema setup) |

## Environment variables

Set in the Vercel dashboard under Settings → Environment Variables. None of these live in the
repo. Set them for Preview as well as Production, or preview deployments will not work.

| Variable | Purpose | If missing |
|---|---|---|
| `POSTGRES_URL` | Postgres connection string (Supabase) | every data route 500s |
| `ADMIN_PASSWORD` | the single shared password | sign-in always rejects |
| `SESSION_SECRET` | HMAC key for session cookies | **sign-in is disabled on purpose** |

`SESSION_SECRET` has no fallback by design. Session cookies are `<expiry>.<hmac>`, so a
predictable secret would let anyone forge an admin session. If it is unset the app logs an
error and refuses to sign anyone in.

Use Supabase's **pooler** connection string (port 6543), not the direct one (5432). Functions
run in `iad1` (us-east-1) by default — if the Supabase project is hosted in Asia, every query
crosses the Pacific. Either move the database or pin the function region to match it.

## The 12-function limit

Vercel's Hobby plan allows **12 functions per deployment**, and without a framework every file
in `api/` becomes exactly one function. This is why routes are grouped into catch-all handlers
(`[action].js`, `[...action].js`) that dispatch on the path segment instead of one file per
endpoint — an earlier layout used 19 files and hit the ceiling.

Currently **7 functions** are used, so there are 5 left. When adding features, add branches
inside the existing handlers rather than new top-level folders under `api/`.

Catch-all routes cannot match an empty path segment, so bare collection URLs need a rewrite to
a `_root` sentinel in [`frontend/vercel.json`](frontend/vercel.json). `/api/settings` and
`/api/items` have one; `/api/japan-quotes` does not, so its list route is currently
unreachable.

## Database and schema changes

`ensureSchema()` in [`frontend/lib/db.js`](frontend/lib/db.js) runs chained
`CREATE TABLE IF NOT EXISTS` on the first request each cold function instance serves, memoised
in a module-level promise. Tables: `price_quotes`, `japan_quotes`, `qr_codes`, `settings`,
`items`, `login_attempts`.

There is no migration tool. `IF NOT EXISTS` creates missing tables but never alters existing
ones, so **adding a column to a table that already exists needs SQL run by hand** in the
Supabase console.

## Pricing rules

- **Thailand** (server-side, [`api/price-calculator/[action].js`](frontend/api/price-calculator/[action].js)):
  `(sum of item costs × 1.40) + delivery fee at cost`. Markup is 40%; delivery is never
  marked up. Optional digital website add-on: 800 THB standard, 2000 THB premium.
- **Japan** (client-side only, [`src/PriceCalculator.tsx`](frontend/src/PriceCalculator.tsx)):
  `gift cost + Japan admin fee + Thailand admin fee`, where the Thailand fee is derived as
  `Japan fee − 500`, or the Japan fee itself when it is 500 or less.

Exchange rates (THB→JPY, THB→MMK, MMK→JPY) are entered in Settings and stored in a
single-row `settings` table. The calculator uses them to show every total in all three
currencies.

## Modules

Live: **Price Calculator, Items, QR Code Generator, Settings**.

Not built: Orders, Customer Database, Template Library, Gift Packages, Delivery Schedule,
Expense Tracker, Monthly Profit. These appear in the sidebar disabled with a "soon" badge —
[`src/Sidebar.tsx`](frontend/src/Sidebar.tsx) is the source of truth.

Navigation is `useState` in `App.tsx`, not a router, so there are no deep links.

## Known gaps

- API handlers do not wrap `pool.query` in try/catch (except sign-in), so a database error
  becomes an unhandled rejection and a generic 500. The UI then shows "Could not reach the
  backend", which is misleading — the real cause is only in the runtime logs.
- `GET /api/price-calculator/quotes` and `GET /api/japan-quotes` exist but nothing in the UI
  calls them. Saved quotes are write-only today.
- Preview deployments share `POSTGRES_URL` with production, so branches write to live data.
