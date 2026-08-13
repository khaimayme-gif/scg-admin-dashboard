# frontend

The deployed application. Vercel's Root Directory is set to this folder.

- `src/` — React + TypeScript SPA
- `api/index.js` — the single Vercel Function; every `/api/*` request is rewritten to it
- `lib/` — shared code and the per-resource route modules in `lib/routes/`

**Do not add files under `api/`.** Each one becomes another Vercel Function, and `[...param]`
catch-all filenames silently do not work here. See the [root README](../README.md) for why, plus
architecture, environment variables, the route table and how to verify a routing change.

## Scripts

| Command | Does |
|---|---|
| `npm run build` | `tsc -b && vite build` — same command Vercel runs |
| `npm run lint` | Oxlint over `src/` (`api/` and `lib/` are not covered) |
| `npm run dev` | Vite dev server; `/api/*` routes are **not** served, so the app cannot sign in |

Local development is not the normal workflow here — changes go out by pushing to `main`. To
exercise the functions locally you would need the Vercel CLI (`vercel dev`) plus a
`.env.local` holding `POSTGRES_URL`, `ADMIN_PASSWORD` and `SESSION_SECRET`.
