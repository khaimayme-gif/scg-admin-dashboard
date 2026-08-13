# SCG Admin Dashboard

Internal admin dashboard for So Chic Gifts. Single shared password, one admin. Used to price
quotes across Thailand, Japan and Myanmar, track item costs against menu prices, and generate
branded QR codes.

Not launched yet.

## Architecture

Everything deploys as **one Vercel project rooted at `frontend/`**. There is no separate
backend service — the whole API is a single Vercel Function sitting alongside the React app.

```
frontend/              <- Vercel Root Directory is set to this folder
├── src/               React 19 + TypeScript SPA, built by Vite to dist/
├── api/index.js       the ONLY Vercel Function; every /api/* request is rewritten to it
├── lib/               not under api/, so none of this becomes a function
│   ├── auth.js        sessions, password check
│   ├── db.js          pg pool + ensureSchema
│   ├── rate-limit.js  failed sign-in counter
│   └── routes/        one module per resource, called by the dispatcher
└── vercel.json        the single rewrite that sends /api/* to api/index.js
backend/               deprecated, replaced by frontend/api/ — nothing here deploys
```

The SPA calls the API with relative `/api/...` paths, so the frontend and API are the same
origin. No CORS, and the session cookie just works.

`api/` and `lib/` each carry a one-line `package.json` setting `"type": "commonjs"`, because the
root `frontend/package.json` is `"type": "module"` for the Vite build. That is why server code
uses `require` while the SPA uses `import`. New files in either directory inherit this, and so do
new subdirectories such as `lib/routes/`, since Node walks up to the nearest `package.json`.

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

Use Supabase's **pooler** connection string (port 6543), not the direct one (5432).

Functions run in **`iad1`** (us-east-1). That is measured, not assumed: the `x-vercel-id`
response header reads `sin1::iad1::…`, meaning the Singapore edge forwards to a Washington DC
function. So if the Supabase project is hosted in Asia, every query crosses the Pacific — and
`ensureSchema()` adds more round trips on each cold start. Either move the database near `iad1`
or pin the function region to match the database.

## Routing: read this before adding an endpoint

**Vercel's zero-config `api/` directory does not support `[...param]` catch-all filenames.**
The segment name is taken literally, so `req.query.param` is `undefined`, and any path with an
extra segment never reaches the function at all. Plain `[param]` works. `[...param]` does not.

This was learned the hard way. Commit `7dc9894` renamed the endpoint files to `[...action].js`
to get under the function limit, and from then until the fix in `59fa013` **seven endpoints
silently 404'd in production** — saving items, deleting items, saving settings, saving Japan
quotes, and all three QR routes. The app could read but could not write anything except Thailand
quotes. The `_root` rewrites that used to be in `vercel.json` were patching two visible symptoms
of this, not the cause.

The layout now avoids dynamic filenames entirely:

- One function, `api/index.js` — a static filename, which is always safe.
- One rewrite in [`frontend/vercel.json`](frontend/vercel.json) sends every `/api/*` request to
  it: `{ "source": "/api/(.*)", "destination": "/api/index?apiPath=$1" }`.
- `api/index.js` splits the path itself and delegates to `lib/routes/<name>.js`.

The dispatcher reads the path from `req.url`, which the rewrite leaves as the original request
path, and falls back to the `?apiPath=` capture. Both were verified against the deployed
platform with a throwaway probe endpoint; neither is assumed.

Consequences worth knowing:

- **Function count is 1 and stays 1.** Hobby allows 12 per deployment and, without a framework,
  every file under `api/` becomes one. New endpoints now cost a branch, not a slot. The seven
  unbuilt modules below would not have fitted the old one-folder-per-resource layout.
- Bare collection paths like `/api/items` are ordinary one-segment requests, so no `_root`
  sentinel is needed and `GET /api/japan-quotes` works.
- Every request passes through one try/catch, so a database error is logged with its method and
  path and returns a JSON 500 instead of becoming an unhandled rejection.

### Adding a resource

1. Create `lib/routes/<name>.js` exporting `async (req, res, rest)`, where `rest` is the path
   segments after the resource name — `/api/items/delete/7` gives `['delete', '7']`.
2. Add one line to the `ROUTES` table in `api/index.js`.

Guard each branch on both the segment and `req.method`, and call `requireAuth(req, res)` first.
Return a 404 at the end for anything unmatched. Do not create new files under `api/`.

### Verifying a routing change

`404` means a path never reached its branch; `401` means it routed and hit the auth guard. So an
unauthenticated probe distinguishes the two without logging in:

```
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<deployment>/api/items/save   # expect 401
curl -s -o /dev/null -w '%{http_code}\n' https://<deployment>/api/nope                 # expect 404
```

Preview deployments sit behind Vercel SSO, so they cannot be probed anonymously — either use a
Protection Bypass token or test against production.

## Routes

Every one of these is served by `api/index.js`. The handler module is `lib/routes/<resource>.js`.

| Route | Method | Notes |
|---|---|---|
| `/api/health` | GET | liveness only, touches nothing — useful when the database is the problem |
| `/api/auth/login` | POST | rate limited: 10 failures per IP per 15 minutes, then 429 |
| `/api/auth/logout` | POST | clears the cookie |
| `/api/auth/check` | GET | the only data route that never returns 401 |
| `/api/items` | GET | list, grouped by category in the UI |
| `/api/items/save` | POST | insert, or update when `id` is present |
| `/api/items/delete/:id` | DELETE | numeric ids only, else 400 |
| `/api/settings` | GET | current exchange rates |
| `/api/settings/save` | POST | upsert into the single-row table |
| `/api/price-calculator/calculate` | POST | pure arithmetic, no database |
| `/api/price-calculator/save` | POST | store a Thailand quote |
| `/api/price-calculator/quotes` | GET | **no caller yet** |
| `/api/japan-quotes` | GET | **no caller yet** |
| `/api/japan-quotes/save` | POST | store a Japan quote |
| `/api/qr/save` | POST | store a generated code |
| `/api/qr/history` | GET | list saved codes |
| `/api/qr/history/:id` | DELETE | numeric ids only, else 400 |

- **No database at all:** `health`, `auth/logout`, `auth/check`, `price-calculator/calculate`.
  Note `auth/login` *does* hit Postgres, for the rate-limit counter — so a database outage blocks
  signing in, not just reading data.
- **Requires a valid session**, returning 401 without one: everything except `health` and
  `auth/*`.

## Database and schema changes

`ensureSchema()` in [`frontend/lib/db.js`](frontend/lib/db.js) runs chained
`CREATE TABLE IF NOT EXISTS` on the first request each cold function instance serves, memoised
in a module-level promise. Tables: `price_quotes`, `japan_quotes`, `qr_codes`, `settings`,
`items`, `login_attempts`.

There is no migration tool. `IF NOT EXISTS` creates missing tables but never alters existing
ones, so **adding a column to a table that already exists needs SQL run by hand** in the
Supabase console.

## Pricing rules

- **Thailand** (server-side, [`lib/routes/price-calculator.js`](frontend/lib/routes/price-calculator.js)):
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
`apiFetch` in [`frontend/src/api.ts`](frontend/src/api.ts), which calls the handler registered
by `App.tsx` and returns the user to the login screen. Without that, an expired cookie showed up
as empty panels — no rates, no autocomplete, an empty Items table — while still looking signed
in, which reads like a broken API.

The three auth-flow calls (`login`, `logout`, `check`) deliberately use plain `fetch`, since
they are what establishes auth state in the first place.

## Known gaps

- `GET /api/price-calculator/quotes` and `GET /api/japan-quotes` work but nothing in the UI
  calls them, so saved quotes are still write-only.
- Preview deployments share `POSTGRES_URL` with production, so branches write to live data.
- `api/` and `lib/` are plain JavaScript: no type checking, and Oxlint does not cover them. A
  mistake there deploys cleanly and fails at runtime.
