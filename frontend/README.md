# frontend

The deployed application: React + TypeScript SPA in `src/`, Vercel serverless functions in
`api/`, shared function code in `lib/`. Vercel's Root Directory is set to this folder.

See the [root README](../README.md) for architecture, environment variables, deployment and
the constraints that shape the `api/` layout.

## Scripts

| Command | Does |
|---|---|
| `npm run build` | `tsc -b && vite build` — same command Vercel runs |
| `npm run lint` | Oxlint over `src/` (`api/` and `lib/` are not covered) |
| `npm run dev` | Vite dev server; `/api/*` routes are **not** served, so the app cannot sign in |

Local development is not the normal workflow here — changes go out by pushing to `main`. To
exercise the functions locally you would need the Vercel CLI (`vercel dev`) plus a
`.env.local` holding `POSTGRES_URL`, `ADMIN_PASSWORD` and `SESSION_SECRET`.
