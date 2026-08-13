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
├── api/
│   └── [...path].js the single Vercel Function; dispatches on the first path segment
└── lib/             never routes, so never functions
    ├── auth.js      sessions, password check
    ├── db.js        pg pool + ensureSchema
    ├── rate-limit.js
    └── routes/      one module per resource, called by the dispatcher
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

## Why the API is one function

Vercel's Hobby plan allows **12 functions per deployment**, and without a framework every file
under `api/` becomes exactly one function. An early layout used 19 files and hit that ceiling;
grouping into per-resource catch-alls brought it to 7, which still would not have fitted the
seven unbuilt modules below.

So the whole API is a single dispatcher, [`api/[...path].js`](frontend/api/%5B...path%5D.js).
It splits the path, looks the first segment up in a route table, and delegates to a module in
`lib/routes/`. **Function count is 1 and stays 1** no matter how many endpoints get added.

Two things fall out of this:

- A bare collection path like `/api/items` is just a one-segment request, so it routes normally.
  The old `_root` rewrites in `vercel.json` are gone, and `vercel.json` with them.
- Every request passes through one try/catch, so a database error is logged with its method and
  path and returns a JSON 500 instead of becoming an unhandled rejection.

### Adding a resource

1. Create `lib/routes/<name>.js` exporting `async (req, res, rest)`, where `rest` is the path
   segments after the resource name — `/api/items/delete/7` gives `['delete', '7']`.
2. Add one line to the `ROUTES` table in `api/[...path].js`.

Guard each branch on both the segment and `req.method`, and call `requireAuth(req, res)` first.
Return a 404 at the end for anything unmatched.

## Routes

| Route | Method | Notes |
|---|---|---|
| `/api/health` | GET | liveness only, touches nothing |
| `/api/auth/{login,logout,check}` | POST/POST/GET | login is rate limited |
| `/api/items` | GET | list, grouped by category in the UI |
| `/api/items/save` | POST | insert, or update when `id` is present |
| `/api/items/delete/:id` | DELETE | numeric ids only |
| `/api/settings` | GET | current exchange rates |
| `/api/settings/save` | POST | upsert into the single-row table |
| `/api/price-calculator/calculate` | POST | pure maths, no database |
| `/api/price-calculator/save` | POST | store a Thailand quote |
| `/api/price-calculator/quotes` | GET | **no caller yet** |
| `/api/japan-quotes` | GET | **no caller yet** |
| `/api/japan-quotes/save` | POST | store a Japan quote |
| `/api/qr/save` | POST | store a generated code |
| `/api/qr/history` | GET | list saved codes |
| `/api/qr/history/:id` | DELETE | numeric ids only |

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

## Sessions expiring

`App.tsx` checks authentication once on mount. Anything that 401s afterwards goes through
`apiFetch` in [`src/api.ts`](frontend/src/api.ts), which calls the handler registered by
`App.tsx` and returns the user to the login screen. Without that, an expired cookie showed up
as empty panels — no rates, no autocomplete, an empty Items table — while still looking signed
in, which reads like a broken API.

The three auth-flow calls (`login`, `logout`, `check`) deliberately use plain `fetch`, since
they are what establishes auth state in the first place.

## Known gaps

- `GET /api/price-calculator/quotes` and `GET /api/japan-quotes` work but nothing in the UI
  calls them, so saved quotes are still write-only.
- Preview deployments share `POSTGRES_URL` with production, so branches write to live data.
- `api/` and `lib/` are plain JavaScript: no type checking and Oxlint does not cover them.
